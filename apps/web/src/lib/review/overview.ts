import type { AmountRead } from '@/lib/invest/invest-position';
import type { FeePaymentState } from '@/lib/payments/preapproval-fee';
import { tierMinimumUsdc } from '@/lib/residency/checks';
import { usd } from '@/lib/wealth/format';
import { residentGateLabel, type ResidentGate } from './gate';

/**
 * The Overview dashboard's content, derived from the resident's real state.
 *
 * The screen used to render a fixed stage list and literal dollars ("$0",
 * "$425,000 to 5-year tier", "1.75 USDC", "3") plus a "Demo data · not this
 * resident's records" chip. This module is the single place that turns the state
 * the route can actually reach — the review gate, the recorded Safe, the
 * qualified position read from the chain, and the application row — into every
 * value the screen shows. Nothing here is a fixture and nothing is re-typed: the
 * money figure is the one {@link AmountRead} the route reduced with the app's
 * existing position reduction, and the tier minimums come from the shared
 * `TIERS` table through `tierMinimumUsdc`.
 *
 * Honesty rules carried through from the rest of the app:
 *
 *   - an unknown read is rendered as `—` **with its specific reason**, never as
 *     a fabricated `$0`;
 *   - a stage that has no source on this screen says so in its copy instead of
 *     inventing a status;
 *   - a block is marked `provenance: 'demo'` only if it is demo data, so the
 *     honesty chip cannot be dropped while a fabricated value remains.
 */

export type OverviewTone = 'ink' | 'success' | 'warning' | 'danger' | 'muted';

/** Where a block's value came from, so the honesty chip can be derived. */
export type Provenance = 'record' | 'unknown' | 'demo';

export interface OverviewStat {
  readonly label: string;
  readonly value: string;
  readonly sub: string;
  readonly tone: OverviewTone;
  readonly highlight: boolean;
  readonly provenance: Provenance;
}

export type StageState = 'done' | 'active' | 'queued' | 'blocked';

export interface OverviewStage {
  readonly title: string;
  readonly meta: string;
  readonly status: string;
  readonly state: StageState;
  readonly provenance: Provenance;
}

export interface OverviewStep {
  readonly label: string;
  readonly note: string;
  readonly provenance: Provenance;
}

/**
 * The fee rail state, plus an explicit unread variant. `loadFeePayment` can
 * throw when its database read fails; collapsing that into "not configured"
 * would fabricate a reason, so the route passes the real one through here.
 */
export type OverviewFee =
  | FeePaymentState
  | { readonly status: 'unread'; readonly reason: string };

export interface OverviewInput {
  readonly gate: ResidentGate;
  readonly tier: string | null;
  readonly preapprovalUsdc: number | null;
  readonly fee: OverviewFee;
  readonly reviewUid: string | null;
  readonly serviceUid: string | null;
  readonly safeAddress: string | null;
  readonly safeDeployed: boolean;
  /** The Safe's qualified position, composed from the one position reduction. */
  readonly qualified: AmountRead;
}

export interface OverviewModel {
  readonly summary: string;
  readonly stats: readonly OverviewStat[];
  /** The "Qualified holdings" card, reading the same qualified figure. */
  readonly holdings: { readonly value: string; readonly sub: string };
  readonly stages: readonly OverviewStage[];
  readonly steps: readonly OverviewStep[];
}

/**
 * Compose the one position reduction's two buckets (free USDC and the Morpho
 * allocation) into the single qualified figure. This is deliberately a
 * composition of `summarizeInvestPosition`'s own output, not a second reduction
 * over the chain rows: if either bucket is unknown, the whole figure is unknown
 * with that bucket's real reason, so a partial sum can never be shown as a
 * total.
 */
export function combineAmountReads(parts: readonly AmountRead[]): AmountRead {
  for (const part of parts) {
    if (part.status === 'unknown') return part;
  }
  let total = 0;
  for (const part of parts) {
    total += part.status === 'known' ? part.usd : 0;
  }
  return { status: 'known', usd: total };
}

/** True only when the resident holds at least the tier minimum. */
function meetsTier(qualified: AmountRead, tier: string | null): boolean {
  const minimum = tierMinimumUsdc(tier);
  return (
    qualified.status === 'known' &&
    minimum !== null &&
    qualified.usd >= minimum
  );
}

function summaryFor(input: OverviewInput): string {
  switch (input.gate) {
    case 'approved':
      return 'Your intake review is complete. Keep your qualified holdings funded so they count toward your permit; card, payouts and borrowing follow the programme.';
    case 'blocked':
      return 'Your application needs attention. Open Residency to see what is required and address it.';
    case 'pending':
      return 'Your application is in review. Next: move funds into a qualified vault so they count toward your permit.';
    case 'unknown':
    default:
      return 'Your application status could not be read. Open Residency to retry.';
  }
}

function qualifiedStat(input: OverviewInput): OverviewStat {
  if (input.qualified.status === 'unknown') {
    return {
      label: 'Qualifying balance',
      value: '—',
      sub: input.qualified.reason,
      tone: 'muted',
      highlight: true,
      provenance: 'unknown',
    };
  }
  const minimum = tierMinimumUsdc(input.tier);
  if (minimum === null) {
    return {
      label: 'Qualifying balance',
      value: usd(input.qualified.usd),
      sub: 'No qualifying tier is set on this account.',
      tone: 'ink',
      highlight: true,
      provenance: 'record',
    };
  }
  const toGo = Math.max(0, minimum - input.qualified.usd);
  return {
    label: 'Qualifying balance',
    value: usd(input.qualified.usd),
    sub:
      toGo === 0
        ? `Meets the ${input.tier} tier.`
        : `Below ${input.tier} tier — ${usd(toGo)} to go`,
    tone: 'ink',
    highlight: true,
    provenance: 'record',
  };
}

function accountStat(gate: ResidentGate): OverviewStat {
  switch (gate) {
    case 'approved':
      return {
        label: 'Account status',
        value: residentGateLabel(gate),
        sub: 'Intake review complete',
        tone: 'success',
        highlight: false,
        provenance: 'record',
      };
    case 'blocked':
      return {
        label: 'Account status',
        value: residentGateLabel(gate),
        sub: 'Action needed — open Residency',
        tone: 'danger',
        highlight: false,
        provenance: 'record',
      };
    case 'unknown':
      return {
        label: 'Account status',
        value: 'Unknown',
        sub: 'The application status could not be read',
        tone: 'muted',
        highlight: false,
        provenance: 'unknown',
      };
    case 'pending':
    default:
      return {
        label: 'Account status',
        value: residentGateLabel(gate),
        sub: 'Intake review in progress',
        tone: 'warning',
        highlight: false,
        provenance: 'record',
      };
  }
}

function feeStat(input: OverviewInput): OverviewStat {
  const base = { label: 'Fees paid onchain', highlight: false } as const;
  switch (input.fee.status) {
    case 'paid':
      return {
        ...base,
        value:
          input.preapprovalUsdc !== null
            ? `${input.preapprovalUsdc} USDC`
            : 'Paid',
        sub: 'Verified from the receipt',
        tone: 'success',
        provenance: 'record',
      };
    case 'unverified':
      return {
        ...base,
        value: '—',
        sub: 'Recorded on chain — not verified',
        tone: 'warning',
        provenance: 'unknown',
      };
    case 'none':
      return {
        ...base,
        value: '—',
        sub: 'Not paid yet',
        tone: 'muted',
        provenance: 'record',
      };
    case 'unread':
      return {
        ...base,
        value: '—',
        sub: input.fee.reason,
        tone: 'muted',
        provenance: 'unknown',
      };
    case 'not-configured':
    default:
      return {
        ...base,
        value: '—',
        sub: 'The fee rail is not configured on this server',
        tone: 'muted',
        provenance: 'unknown',
      };
  }
}

function attestationStat(input: OverviewInput): OverviewStat {
  const issued: string[] = [];
  if (input.reviewUid) issued.push('kade.review.v1');
  if (input.serviceUid) issued.push('kade.permit.v1');
  return {
    label: 'Attestations',
    value: String(issued.length),
    sub: issued.length > 0 ? issued.join(' · ') : 'None issued yet',
    tone: issued.length > 0 ? 'ink' : 'muted',
    highlight: false,
    provenance: 'record',
  };
}

function feeStage(input: OverviewInput): OverviewStage {
  const title = 'Fee paid · account pre-approved';
  switch (input.fee.status) {
    case 'paid':
      return {
        title,
        meta: 'Verified from the receipt',
        status: 'Completed',
        state: 'done',
        provenance: 'record',
      };
    case 'unverified':
      return {
        title,
        meta: 'Recorded on chain · awaiting verification',
        status: 'In progress',
        state: 'active',
        provenance: 'unknown',
      };
    case 'none':
      return {
        title,
        meta: 'Not paid yet',
        status: 'In progress',
        state: 'active',
        provenance: 'record',
      };
    case 'unread':
      return {
        title,
        meta: input.fee.reason,
        status: 'Unread',
        state: 'active',
        provenance: 'unknown',
      };
    case 'not-configured':
    default:
      return {
        title,
        meta: 'The fee rail is not configured on this server',
        status: 'Unavailable',
        state: 'queued',
        provenance: 'unknown',
      };
  }
}

function reviewStage(gate: ResidentGate): OverviewStage {
  const title = 'Intake review';
  switch (gate) {
    case 'approved':
      return {
        title,
        meta: 'Admin review · approved',
        status: 'Approved',
        state: 'done',
        provenance: 'record',
      };
    case 'blocked':
      return {
        title,
        meta: 'Admin review · blocked, action needed',
        status: 'Blocked',
        state: 'blocked',
        provenance: 'record',
      };
    case 'unknown':
      return {
        title,
        meta: 'The review state could not be read',
        status: 'Unread',
        state: 'active',
        provenance: 'unknown',
      };
    case 'pending':
    default:
      return {
        title,
        meta: 'Admin review · in progress',
        status: 'In progress',
        state: 'active',
        provenance: 'record',
      };
  }
}

function fundsStage(input: OverviewInput): OverviewStage {
  const title = 'Qualified holdings funded';
  if (input.qualified.status === 'unknown') {
    return {
      title,
      meta: input.qualified.reason,
      status: 'Unread',
      state: 'active',
      provenance: 'unknown',
    };
  }
  const minimum = tierMinimumUsdc(input.tier);
  if (minimum === null) {
    return {
      title,
      meta: `${usd(input.qualified.usd)} in the Safe · no qualifying tier is set`,
      status: 'In progress',
      state: 'active',
      provenance: 'record',
    };
  }
  if (input.qualified.usd >= minimum) {
    return {
      title,
      meta: `${usd(input.qualified.usd)} · meets the ${input.tier} tier`,
      status: 'Funded',
      state: 'done',
      provenance: 'record',
    };
  }
  return {
    title,
    meta: `${usd(input.qualified.usd)} of ${usd(minimum)} · ${usd(
      minimum - input.qualified.usd,
    )} to go`,
    status: 'In progress',
    state: 'active',
    provenance: 'record',
  };
}

function buildStages(input: OverviewInput): readonly OverviewStage[] {
  return [
    {
      title: 'Profile, household & proof of wealth',
      // Onboarding completion proves the profile and household; the proof of
      // wealth is a separate step this screen does not read, so it is not
      // claimed.
      meta: 'Profile and household recorded · proof of wealth is not read here',
      status: 'Completed',
      state: 'done',
      provenance: 'record',
    },
    feeStage(input),
    {
      // Identity is read and attested on the Residency step, not here. Saying so
      // is honest; inventing a status (the old "Verify with Self · in progress")
      // is not.
      title: 'Identity verified',
      meta: 'Not read on this screen — open Residency for the live check',
      status: 'See Residency',
      state: 'queued',
      provenance: 'unknown',
    },
    fundsStage(input),
    reviewStage(input.gate),
    {
      // The service-fee amount is resolved on the Residency step from
      // `fee_schedule`; no figure is quoted here rather than pasted from the
      // reference.
      title: 'Start Residency',
      meta: 'Unlocks when the readiness checks are met — open Residency',
      status: 'Queued',
      state: 'queued',
      provenance: 'record',
    },
  ];
}

function fundsStepNote(input: OverviewInput): string {
  if (input.qualified.status === 'unknown') {
    return 'The Safe position could not be read';
  }
  const minimum = tierMinimumUsdc(input.tier);
  if (minimum === null) return 'No qualifying tier is set';
  if (input.qualified.usd >= minimum) return `${input.tier} tier met`;
  return `${usd(minimum - input.qualified.usd)} to go`;
}

function buildSteps(input: OverviewInput): readonly OverviewStep[] {
  const steps: OverviewStep[] = [];
  // Moving funds is only a next step while the qualified position is unfunded
  // or unread; once the tier is met the screen does not tell the resident to do
  // a thing they have already done.
  if (!meetsTier(input.qualified, input.tier)) {
    steps.push({
      label: 'Move funds into the qualified vault',
      note: fundsStepNote(input),
      provenance: input.qualified.status === 'unknown' ? 'unknown' : 'record',
    });
  }
  steps.push({
    label: 'Order Onchain Island Card',
    note:
      input.gate === 'approved'
        ? 'Available'
        : 'Unlocks after the intake review',
    provenance: 'record',
  });
  steps.push({
    label: 'Start Residency',
    note: 'Open Residency for readiness',
    provenance: 'record',
  });
  return steps;
}

/**
 * The "Qualified holdings" card. Its value is the same qualified figure the
 * first stat shows; its sub says what is actually true of the Safe rather than
 * implying holdings that are not there.
 */
function holdingsCard(input: OverviewInput): {
  readonly value: string;
  readonly sub: string;
} {
  const value = input.qualified.status === 'known'
    ? usd(input.qualified.usd)
    : '—';
  if (input.safeAddress === null) {
    return {
      value,
      sub: 'No Safe is recorded yet · nothing is locked',
    };
  }
  if (input.qualified.status === 'unknown') {
    return { value, sub: input.qualified.reason };
  }
  if (input.qualified.usd === 0) {
    return {
      value,
      sub: input.safeDeployed
        ? 'Safe deployed · no qualified holdings yet'
        : 'Safe not deployed yet · nothing is locked',
    };
  }
  return {
    value,
    sub: input.safeDeployed
      ? 'Safe deployed · read from the chain'
      : 'Safe recorded · read from the chain',
  };
}

export function buildOverview(input: OverviewInput): OverviewModel {
  return {
    summary: summaryFor(input),
    stats: [
      qualifiedStat(input),
      accountStat(input.gate),
      feeStat(input),
      attestationStat(input),
    ],
    holdings: holdingsCard(input),
    stages: buildStages(input),
    steps: buildSteps(input),
  };
}

/**
 * The honesty chip's label, or null when the screen is entirely the resident's
 * records. A block is only `demo` if it is a fixture; unknown values are honest
 * and do not trigger the chip. After this change every block is `record` or
 * `unknown`, so the chip is not rendered — the function is the single switch
 * that keeps a future placeholder from shipping without it.
 */
export function demoBadgeLabel(model: OverviewModel): string | null {
  const blocks: readonly { readonly provenance: Provenance }[] = [
    ...model.stats,
    ...model.stages,
    ...model.steps,
  ];
  return blocks.some((block) => block.provenance === 'demo')
    ? 'Demo data · not this resident’s records'
    : null;
}
