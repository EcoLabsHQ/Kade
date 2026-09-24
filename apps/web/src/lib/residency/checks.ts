/**
 * Residency checks and tracker, derived from records.
 *
 * D16 / EXE-012 (week-2 contract section 4.2): a resident completing the
 * Residency step sees four checks — identity, funds, review, service fee —
 * "shown with their real state", and "a residency tracker derived from on-chain
 * records, not fixtures".
 *
 * This module is the derivation and nothing else: no Supabase client, no
 * `next/*`, no chain read. `./server` assembles the facts from the database and
 * the receipt verifiers; this turns facts into state so the rules are exercised
 * directly in a test and the UI cannot invent a state the records do not
 * support.
 *
 * The tier minimum is read from `@kade/shared` `TIERS`, never re-typed here, so
 * a change to the frozen tier table cannot drift from the check.
 */

import { TIERS } from '@kade/shared';

/* -------------------------------------------------------------------------- */
/* Facts                                                                      */
/* -------------------------------------------------------------------------- */

/** The Self verification outcome for the resident, or none recorded. */
export interface IdentityFact {
  readonly provider: 'self';
  readonly status: 'valid' | 'invalid';
  /** ISO timestamp of a valid outcome, or null when none was established. */
  readonly verifiedAt: string | null;
  /**
   * Self's per-person identifier, when supplied. Kept for Sybil resistance; it
   * is not the identity criterion and carries no personal data.
   */
  readonly selfNullifier: string | null;
}

export type ReviewFactState = 'cleared' | 'pending' | 'blocked';

export interface ServiceFeeFact {
  /** True when a service-fee transaction hash is recorded. */
  readonly recorded: boolean;
  /** True when the recorded receipt re-verifies on the server. */
  readonly verified: boolean;
  /** The fee_schedule-resolved amount, or null when it could not be read. */
  readonly amountUsdc: number | null;
}

export interface PermitFact {
  readonly issued: boolean;
  /** The `kade.permit.v1` attestation UID, when one exists. */
  readonly uid: string | null;
}

export interface ResidencyFacts {
  /** `applications.tier`: '3-year' | '5-year' | 'indefinite', or null. */
  readonly tier: string | null;
  readonly identity: IdentityFact | null;
  /** Qualified balance in whole USDC, or null when nothing is recorded. */
  readonly qualifiedUsd: number | null;
  readonly review: ReviewFactState;
  readonly serviceFee: ServiceFeeFact;
  readonly permit: PermitFact;
}

/* -------------------------------------------------------------------------- */
/* Derived values                                                             */
/* -------------------------------------------------------------------------- */

export type ResidencyCheckId = 'identity' | 'funds' | 'review' | 'service-fee';

export type ResidencyCheckState = 'met' | 'pending' | 'blocked';

export interface ResidencyCheck {
  readonly id: ResidencyCheckId;
  readonly label: string;
  readonly state: ResidencyCheckState;
  readonly detail: string;
  /**
   * The checks that must be green before the service fee is payable. The
   * service fee is the fourth check and is the payment itself, so it is not its
   * own prerequisite (build guide section 6: the service-fee card unlocks only
   * when the readiness checks are green).
   */
  readonly blocksServiceFee: boolean;
}

/** The production qualifying minimum for `applications.tier`, or null. */
export function tierMinimumUsdc(tier: string | null): number | null {
  if (!tier) return null;
  const match = TIERS.find(
    (candidate) => candidate.name.toLowerCase() === tier.trim().toLowerCase(),
  );
  return match ? match.minUsdc : null;
}

/** Sum qualified balances from the resident's `container_balances` rows. */
export function sumQualifiedUsd(
  rows: readonly { readonly usd_value: number | string | null }[],
): number {
  let total = 0;
  for (const row of rows) {
    const value = Number(row.usd_value);
    if (Number.isFinite(value) && value > 0) total += value;
  }
  return total;
}

export function deriveChecks(facts: ResidencyFacts): readonly ResidencyCheck[] {
  return [
    deriveIdentityCheck(facts),
    deriveFundsCheck(facts),
    deriveReviewCheck(facts),
    deriveServiceFeeCheck(facts),
  ];
}

function deriveIdentityCheck(facts: ResidencyFacts): ResidencyCheck {
  const id: ResidencyCheckId = 'identity';
  const label = 'Identity (Self)';
  const blocksServiceFee = true;
  if (facts.identity === null) {
    return {
      id,
      label,
      blocksServiceFee,
      state: 'pending',
      detail: 'Identity verification has not started.',
    };
  }
  // As amended v1.7, identity is verified on chain by Self, which issues a
  // soulbound token. The flow is configured with Minimum age ≥18 and OFAC, so a
  // valid result means the age and sanctions predicates held; Kade stores the
  // outcome, not the facts. Fail closed: anything but an explicit valid outcome
  // blocks rather than passes.
  if (facts.identity.status !== 'valid') {
    return {
      id,
      label,
      blocksServiceFee,
      state: 'blocked',
      detail: 'The identity proof did not satisfy the programme checks.',
    };
  }
  return {
    id,
    label,
    blocksServiceFee,
    state: 'met',
    detail: 'Verified with Self.',
  };
}

function deriveFundsCheck(facts: ResidencyFacts): ResidencyCheck {
  const id: ResidencyCheckId = 'funds';
  const label = 'Qualified holdings';
  const blocksServiceFee = true;
  const minimum = tierMinimumUsdc(facts.tier);
  if (minimum === null) {
    return {
      id,
      label,
      blocksServiceFee,
      state: 'pending',
      detail: 'No qualifying tier is set.',
    };
  }
  const balance = facts.qualifiedUsd ?? 0;
  if (balance >= minimum) {
    return {
      id,
      label,
      blocksServiceFee,
      state: 'met',
      detail: `$${balance.toLocaleString('en-US')} meets the tier.`,
    };
  }
  return {
    id,
    label,
    blocksServiceFee,
    state: 'pending',
    detail: `$${balance.toLocaleString('en-US')} of $${minimum.toLocaleString('en-US')}.`,
  };
}

function deriveReviewCheck(facts: ResidencyFacts): ResidencyCheck {
  const id: ResidencyCheckId = 'review';
  const label = 'Intake review';
  const blocksServiceFee = true;
  if (facts.review === 'cleared') {
    return { id, label, blocksServiceFee, state: 'met', detail: 'Review cleared.' };
  }
  if (facts.review === 'blocked') {
    return {
      id,
      label,
      blocksServiceFee,
      state: 'blocked',
      detail: 'The application is blocked pending review.',
    };
  }
  return {
    id,
    label,
    blocksServiceFee,
    state: 'pending',
    detail: 'Awaiting intake review.',
  };
}

function deriveServiceFeeCheck(facts: ResidencyFacts): ResidencyCheck {
  const id: ResidencyCheckId = 'service-fee';
  const label = 'Residency service fee';
  const blocksServiceFee = false;
  if (facts.serviceFee.verified) {
    return {
      id,
      label,
      blocksServiceFee,
      state: 'met',
      detail: 'Service fee verified.',
    };
  }
  if (facts.serviceFee.amountUsdc === null) {
    return {
      id,
      label,
      blocksServiceFee,
      state: 'blocked',
      detail: 'The service fee is not configured.',
    };
  }
  if (facts.serviceFee.recorded) {
    return {
      id,
      label,
      blocksServiceFee,
      state: 'pending',
      detail: 'A service-fee transaction is recorded but not verified.',
    };
  }
  return {
    id,
    label,
    blocksServiceFee,
    state: 'pending',
    detail: `Not paid — ${facts.serviceFee.amountUsdc} USDC.`,
  };
}

/**
 * Whether the service fee may be paid. Requires identity, funds and review to
 * be `met`; the service fee check itself is the payment and is excluded.
 */
export function serviceFeeUnlocked(checks: readonly ResidencyCheck[]): boolean {
  const prerequisites = checks.filter((check) => check.blocksServiceFee);
  return prerequisites.length > 0 && prerequisites.every((c) => c.state === 'met');
}

/* -------------------------------------------------------------------------- */
/* Tracker                                                                    */
/* -------------------------------------------------------------------------- */

export type ResidencyStageState = 'done' | 'active' | 'queued' | 'blocked';

export interface ResidencyStage {
  readonly id: string;
  readonly title: string;
  readonly meta: string;
  readonly state: ResidencyStageState;
}

export interface ResidencyView {
  readonly checks: readonly ResidencyCheck[];
  readonly tracker: readonly ResidencyStage[];
  readonly serviceFeeUnlocked: boolean;
  readonly permitIssued: boolean;
  readonly permitUid: string | null;
}

function stageState(
  met: boolean,
  blocked: boolean,
  cursor: { active: boolean },
): ResidencyStageState {
  if (blocked) return 'blocked';
  if (met) return 'done';
  const state: ResidencyStageState = cursor.active ? 'active' : 'queued';
  cursor.active = false;
  return state;
}

/**
 * The six residency stages, derived from the same records as the checks.
 *
 * The stage list is the one in DOCX section 6: pre-approval paid, identity,
 * qualified holdings, intake review, service fee, permit. Nothing here is a
 * fixture: a stage is `done` only when its record exists.
 */
export function deriveTracker(
  facts: ResidencyFacts,
  preapprovalPaid: boolean,
): readonly ResidencyStage[] {
  const checks = deriveChecks(facts);
  const identity = checks.find((c) => c.id === 'identity');
  const funds = checks.find((c) => c.id === 'funds');
  const review = checks.find((c) => c.id === 'review');
  const serviceFee = checks.find((c) => c.id === 'service-fee');

  const cursor = { active: true };
  const stages: ResidencyStage[] = [];

  stages.push({
    id: 'pre-approval',
    title: 'Pre-approval fee',
    meta: preapprovalPaid ? 'Verified on chain' : 'Awaiting payment',
    state: preapprovalPaid
      ? 'done'
      : stageState(false, false, cursor),
  });

  const pushCheck = (
    id: string,
    title: string,
    check: ResidencyCheck | undefined,
  ) => {
    if (!check) return;
    stages.push({
      id,
      title,
      meta: check.detail,
      state: stageState(check.state === 'met', check.state === 'blocked', cursor),
    });
  };

  pushCheck('identity', 'Identity verified', identity);
  pushCheck('funds', 'Qualified holdings funded', funds);
  pushCheck('review', 'Intake review', review);
  pushCheck('service-fee', 'Residency service fee', serviceFee);

  stages.push({
    id: 'permit',
    title: 'Permit issued',
    meta: facts.permit.issued
      ? `kade.permit.v1${facts.permit.uid ? ` · ${facts.permit.uid}` : ''}`
      : 'Unlocks when the checks are green',
    state: facts.permit.issued ? 'done' : 'queued',
  });

  return stages;
}

/** The complete derived view the Residency step renders. */
export function deriveResidencyView(
  facts: ResidencyFacts,
  preapprovalPaid: boolean,
): ResidencyView {
  const checks = deriveChecks(facts);
  return {
    checks,
    tracker: deriveTracker(facts, preapprovalPaid),
    serviceFeeUnlocked: serviceFeeUnlocked(checks),
    permitIssued: facts.permit.issued,
    permitUid: facts.permit.uid,
  };
}
