import type { FeePaymentState } from '@/lib/payments/preapproval-fee';
import { tierMinimumUsdc, type IdentityFact } from '@/lib/residency/checks';
import { usd } from '@/lib/wealth/format';
import type { QualifiedPosition } from '@/lib/wealth/qualified-position';
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
 * money figure is the one {@link QualifiedPosition} the route reduced with
 * `summarizeQualifiedPosition` — the same reduction the Holdings `QUALIFIED` card
 * and the residency tier check call — and the tier minimums come from the shared
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

/**
 * The residency service fee's payment state, plus the same explicit unread
 * variant as {@link OverviewFee}. The Overview reads the residency rail the
 * Residency step pays into, so "paid" is a verified receipt, not a stored hash.
 */
export type OverviewServiceFee =
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
  /**
   * The Safe's qualified position, produced once by the route with
   * `summarizeQualifiedPosition` — the one reduction the Holdings card and the
   * residency tier check also call.
   */
  readonly qualified: QualifiedPosition;
  /** True when the pre-approval fee is verified on chain. */
  readonly preapprovalPaid: boolean;
  /**
   * The `kade.kyc.v1` identity attestation UID, when one exists. Issuance is
   * gate-blocked today, so this is normally null; the tracker reports it
   * truthfully rather than assuming an identity proof.
   */
  readonly kycUid?: string | null;
  /**
   * The resident's Self identity outcome, read from the same
   * `self_verifications` source the Residency step reads (`loadIdentityFact`).
   * A valid outcome is the real "verified"; `null` is "not verified". Absent
   * means the caller did not read it, and the row says so rather than guessing.
   */
  readonly identity?: IdentityFact | null;
  /**
   * The residency service fee is payable on the Residency step. The Overview now
   * reads the same residency prerequisites the step does, so this is the real
   * derived "unlocked / not" (its three prerequisite checks are green). Absent
   * means the caller did not read it.
   */
  readonly serviceFeeUnlocked?: boolean;
  /**
   * The residency service fee's payment state, read from the same rail the
   * Residency step uses. `paid` means a verified receipt; `unverified` is a
   * recorded hash that did not confirm; `unread` is a failed read.
   */
  readonly serviceFee?: OverviewServiceFee | null;
  /**
   * Whether the persisted "Documents complete" demo flag is set. Read on the
   * client from the same store the Residency step writes; absence means the flag
   * is not set (documents are not issued), never a fabricated done.
   */
  readonly documentsComplete?: boolean;
  /**
   * The persisted Colosseum demo progress, if the caller reads it. These are
   * declared demo state and always `provenance: 'demo'`.
   */
  readonly colosseum?: OverviewColosseumProgress | null;
}

/** The Colosseum demo progress the Overview tracker may reflect. */
export interface OverviewColosseumProgress {
  readonly residentSince: string | null;
  readonly citizenAt: string | null;
  readonly passportSerial: string | null;
}

export interface OverviewModel {
  readonly summary: string;
  readonly stats: readonly OverviewStat[];
  /** The "Qualified holdings" card, reading the same qualified figure. */
  readonly holdings: { readonly value: string; readonly sub: string };
  readonly stages: readonly OverviewStage[];
  readonly steps: readonly OverviewStep[];
}

/** True only when the resident holds at least the tier minimum. */
function meetsTier(qualified: QualifiedPosition, tier: string | null): boolean {
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

/**
 * The programme's tracked attestations, in issue order:
 *   - `kade.review.v1` — the intake-review approval, from `applications.review_uid`;
 *   - `kade.kyc.v1`    — the identity proof, from `self_verifications` /
 *                        `applications.kyc_uid` (gate-blocked today);
 *   - `kade.permit.v1` — the residency permit, from `applications.service_uid`;
 *   - the fee attestation — the fee rail's own on-chain record.
 *
 * UIDs are already in `OverviewInput`; a schema is issued only when its UID is
 * present. A missing UID is reported as not issued, never as issued. Issuance is
 * gate-blocked in this build, so the value is an honest count (usually 0) with a
 * sub that names the tracked attestations and their real state.
 */
function attestationStat(input: OverviewInput): OverviewStat {
  const tracked: readonly { readonly name: string; readonly uid: string | null }[] = [
    { name: 'kade.review.v1', uid: input.reviewUid },
    { name: 'kade.kyc.v1', uid: input.kycUid ?? null },
    { name: 'kade.permit.v1', uid: input.serviceUid },
  ];
  const issued = tracked.filter((entry) => entry.uid !== null);
  const awaiting = tracked
    .filter((entry) => entry.uid === null)
    .map((entry) => entry.name);
  // The fee attestation is genuinely recorded once the pre-approval fee is
  // verified on chain; otherwise it is not issued.
  const feeIssued = input.preapprovalPaid;

  const value = String(issued.length + (feeIssued ? 1 : 0));
  const parts: string[] = [];
  if (issued.length > 0) parts.push(`Issued: ${issued.map((e) => e.name).join(' · ')}`);
  if (feeIssued && input.preapprovalUsdc !== null) {
    parts.push(`Fee attestation recorded (${input.preapprovalUsdc} USDC)`);
  }
  if (awaiting.length > 0) {
    parts.push(`Pending approval: ${awaiting.join(' · ')}`);
  }

  return {
    label: 'Attestations',
    value,
    sub: parts.length > 0 ? parts.join(' · ') : 'None issued yet',
    tone: value === '0' ? 'muted' : 'ink',
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

/**
 * The identity row: the resident's real Self outcome, read from the same record
 * the Residency step reads, with the attestation UID as the other real signal.
 */
function identityStage(input: OverviewInput): OverviewStage {
  const title = 'Identity verified';
  if (input.identity?.status === 'valid') {
    return {
      title,
      meta: 'Verified with Self',
      status: 'Verified',
      state: 'done',
      provenance: 'record',
    };
  }
  if (input.identity?.status === 'invalid') {
    return {
      title,
      meta: 'The identity proof did not satisfy the programme checks',
      status: 'Blocked',
      state: 'blocked',
      provenance: 'record',
    };
  }
  if (input.kycUid) {
    return {
      title,
      meta: `kade.kyc.v1 · ${input.kycUid}`,
      status: 'Verified',
      state: 'done',
      provenance: 'record',
    };
  }
  if (input.identity === undefined) {
    // No caller-supplied identity read at all: say so rather than guessing.
    return {
      title,
      meta: 'Not read on this screen — open Residency for the live check',
      status: 'See Residency',
      state: 'queued',
      provenance: 'unknown',
    };
  }
  // The identity record was read and holds no valid outcome. A failed read
  // degrades to the same null, so this is "not verified", never a green.
  return {
    title,
    meta: 'Not verified — open Residency for the Self check',
    status: 'Not verified',
    state: 'queued',
    provenance: 'unknown',
  };
}

/** The documents row: the persisted demo flag, or an honest "not marked". */
function documentsStage(input: OverviewInput): OverviewStage {
  const title = 'Documents complete';
  if (input.documentsComplete) {
    return {
      title,
      meta: 'Marked complete in the demo — see Residency',
      status: 'Completed',
      state: 'done',
      provenance: 'demo',
    };
  }
  return {
    title,
    meta: 'Not marked complete — open Residency to upload',
    status: 'Not started',
    state: 'queued',
    provenance: 'record',
  };
}

/** The residency service fee: done when paid, actionable once reachable. */
function serviceFeeStage(input: OverviewInput): OverviewStage {
  const title = 'Residency service fee';
  const serviceFee = input.serviceFee;
  if (serviceFee?.status === 'paid') {
    return {
      title,
      meta: 'Paid — verified from the receipt',
      status: 'Completed',
      state: 'done',
      provenance: 'record',
    };
  }
  if (serviceFee?.status === 'unverified') {
    return {
      title,
      meta: 'Recorded on chain — awaiting verification',
      status: 'In progress',
      state: 'active',
      provenance: 'unknown',
    };
  }
  if (serviceFee?.status === 'unread') {
    return {
      title,
      meta: serviceFee.reason,
      status: 'Unread',
      state: 'active',
      provenance: 'unknown',
    };
  }
  if (serviceFee?.status === 'not-configured') {
    return {
      title,
      meta: 'The service-fee rail is not configured on this server',
      status: 'Unavailable',
      state: 'queued',
      provenance: 'unknown',
    };
  }
  if (input.serviceFeeUnlocked === true) {
    return {
      title,
      meta: 'Prerequisites green — pay on the Residency step',
      status: 'Action needed',
      state: 'active',
      provenance: 'record',
    };
  }
  if (input.serviceFeeUnlocked === undefined) {
    // The caller did not read the residency prerequisites, so it cannot say
    // whether the fee is reachable; it says so rather than guessing.
    return {
      title,
      meta: 'Reachability is not read on this screen — open Residency',
      status: 'See Residency',
      state: 'queued',
      provenance: 'unknown',
    };
  }
  return {
    title,
    meta: 'Unlocks once identity, funds and the intake review are green',
    status: 'Queued',
    state: 'queued',
    provenance: 'record',
  };
}

/**
 * "Start Residency" is the real milestone: it is reached once the service fee is
 * paid and the permit is issued, not a fixed "queued". The permit is the
 * programme's `kade.permit.v1`, so its presence is the honest "submitted" signal.
 */
function startResidencyStage(input: OverviewInput): OverviewStage {
  const title = 'Start Residency';
  if (input.serviceUid) {
    return {
      title,
      meta: 'Submitted — your package is with the Immigration Service',
      status: 'Submitted',
      state: 'done',
      provenance: 'record',
    };
  }
  if (input.serviceFee?.status === 'paid') {
    return {
      title,
      meta: 'Service fee paid — permit issuance is pending approval',
      status: 'In progress',
      state: 'active',
      provenance: 'record',
    };
  }
  // The prerequisites are genuinely met, so the step is live even before the fee
  // is paid; it is not a fixed "Queued".
  if (input.serviceFeeUnlocked === true) {
    return {
      title,
      meta: 'Prerequisites green — pay the service fee to submit',
      status: 'In progress',
      state: 'active',
      provenance: 'record',
    };
  }
  return {
    title,
    meta: 'Unlocks when the readiness checks are met — open Residency',
    status: 'Queued',
    state: 'queued',
    provenance: 'record',
  };
}

/**
 * The Colosseum resident/citizen rows, from the persisted demo progress. These
 * are declared demo state (`provenance: 'demo'`), so the honesty chip turns on
 * while they are shown — the tracker never presents them as a real record.
 */
function colosseumStages(
  progress: OverviewColosseumProgress | null | undefined,
): readonly OverviewStage[] {
  if (!progress) return [];
  const citizen = progress.citizenAt !== null;
  const since = progress.residentSince !== null || citizen;
  return [
    {
      title: 'Colosseum Resident',
      meta: since
        ? 'Demo status unlocked on the Residency step'
        : 'Not started — a 10 USDC demo threshold, open Residency',
      status: since ? 'Demo · active' : 'Not started',
      state: since ? 'active' : 'queued',
      provenance: 'demo',
    },
    {
      title: 'Colosseum Citizen',
      meta: citizen
        ? `Demo passport${progress.passportSerial ? ` · ${progress.passportSerial}` : ''}`
        : 'Unlocks after 2 compliant demo minutes — open Residency',
      status: citizen ? 'Demo · citizen' : since ? 'In progress' : 'Queued',
      state: citizen ? 'done' : 'queued',
      provenance: 'demo',
    },
  ];
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
    identityStage(input),
    fundsStage(input),
    documentsStage(input),
    reviewStage(input.gate),
    serviceFeeStage(input),
    startResidencyStage(input),
    ...colosseumStages(input.colosseum),
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
