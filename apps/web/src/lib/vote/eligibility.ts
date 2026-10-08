import type { VoteProposal, VotingPowerRead } from './types';

/**
 * The Vote screen's eligibility derivation.
 *
 * This is **real policy code** evaluated against whatever source the adapter
 * provides. It is a companion to the on-chain rule, never the protection: the
 * contract and the Snapshot strategy are what actually stop an ineligible vote.
 * The UI only reflects the decision.
 *
 * The rules, in order:
 *   1. a disconnected wallet cannot vote;
 *   2. a closed proposal cannot be voted on;
 *   3. a Citizen-only proposal is refused to anyone who is not a Citizen, with
 *      the exact text "Colosseum Citizens only";
 *   4. an unreadable voting power (an error, or a source that could not answer)
 *      is **never** assumed — it refuses;
 *   5. power must be strictly greater than zero;
 *   6. otherwise the voter is eligible.
 *
 * Step 4 is the important one: a chain read that failed is not "no power", and
 * it is not "eligible" either. It is unknown, and unknown refuses.
 */

/** The viewer's membership, as the vote layer needs it. */
export type VoteViewerMembership = 'none' | 'resident' | 'citizen';

export type VoteEligibilityReason =
  | 'eligible'
  | 'wallet-disconnected'
  | 'loading'
  | 'closed'
  | 'citizen-only'
  | 'power-unread'
  | 'no-power';

export interface VoteEligibility {
  readonly eligible: boolean;
  readonly reason: VoteEligibilityReason;
  /** The exact, user-facing explanation for a refusal, or null when eligible. */
  readonly message: string | null;
}

const CITIZEN_ONLY_MESSAGE = 'Colosseum Citizens only';

/**
 * Evaluate eligibility for a proposal.
 *
 * `power` is `null` while the read is still in flight (the loading state); pass
 * a {@link VotingPowerRead} once it settles. A read error or an unknown source
 * refuses, so eligibility is never assumed from a failed read.
 */
export function evaluateVoteEligibility(input: {
  readonly wallet: string | null;
  readonly membership: VoteViewerMembership;
  readonly proposal: VoteProposal | null;
  readonly power: VotingPowerRead | null;
}): VoteEligibility {
  const { wallet, membership, proposal, power } = input;

  if (wallet === null) {
    return {
      eligible: false,
      reason: 'wallet-disconnected',
      message: 'Connect your wallet to vote.',
    };
  }

  if (proposal === null || power === null) {
    return {
      eligible: false,
      reason: 'loading',
      message: 'Checking your eligibility…',
    };
  }

  if (proposal.state === 'closed') {
    return {
      eligible: false,
      reason: 'closed',
      message: 'This proposal is closed.',
    };
  }

  // The category rule is real policy, independent of the power read's result: a
  // Resident is refused a Citizen proposal with the exact required text rather
  // than a power-based refusal. It is checked before the power status below;
  // the loading guard above still wins while the read is in flight.
  if (proposal.category === 'citizen' && membership !== 'citizen') {
    return {
      eligible: false,
      reason: 'citizen-only',
      message: CITIZEN_ONLY_MESSAGE,
    };
  }

  if (power.status === 'error' || power.status === 'unknown') {
    return {
      eligible: false,
      reason: 'power-unread',
      message: 'Your voting power could not be read, so eligibility is not assumed.',
    };
  }

  if (power.power <= 0n) {
    return {
      eligible: false,
      reason: 'no-power',
      message: 'You hold no voting power for this proposal.',
    };
  }

  return { eligible: true, reason: 'eligible', message: null };
}

/** The exact citizen-only refusal text, exported so callers cannot drift. */
export const CITIZEN_ONLY_REFUSAL = CITIZEN_ONLY_MESSAGE;

/** A proposal paired with the viewer's eligibility decision for it. */
export interface VoteProposalAvailability {
  readonly proposal: VoteProposal;
  readonly eligibility: VoteEligibility;
  /**
   * True when the viewer is eligible for this proposal: the eligibility
   * derivation holds (wallet connected, open, category allowed, voting power
   * known and strictly greater than zero). A failed or unread power read is
   * never available.
   *
   * Eligible is not castable: this mirrors {@link VoteEligibility.eligible} and
   * does not consider the vote type, so a proposal whose type is unsupported is
   * still available here and is refused later by the ballot's own rule.
   */
  readonly available: boolean;
}

/** The viewer's proposals, partitioned into the eligible set and the rest. */
export interface VoteProposalPartition {
  /** Every proposal, in the source order, each with its eligibility decision. */
  readonly all: readonly VoteProposalAvailability[];
  /** The eligible set: exactly the proposals the eligibility derivation accepts. */
  readonly available: readonly VoteProposalAvailability[];
  /** The rest, each carrying the honest eligibility refusal it failed. */
  readonly unavailable: readonly VoteProposalAvailability[];
}

/**
 * Derive, for every proposal, the viewer's eligibility decision for it.
 *
 * Availability is exactly {@link evaluateVoteEligibility}'s `eligible` decision:
 * open, category-allowed, connected and with known power strictly greater than
 * zero. A proposal whose power read failed or has not settled is therefore not
 * available, and a caller must never present it as one.
 *
 * "Eligible" is not "castable": this function does not consider the vote type,
 * so a proposal with an unsupported type stays available here and is refused
 * later by the ballot's `supportedType` rule. The unavailable set keeps every
 * proposal reachable with its honest refusal message, so nothing is silently
 * deleted.
 */
export function deriveVoteProposalAvailability(input: {
  readonly wallet: string | null;
  readonly membership: VoteViewerMembership;
  readonly proposals: readonly VoteProposal[];
  readonly powers: Readonly<Record<string, VotingPowerRead>>;
}): VoteProposalPartition {
  const all = input.proposals.map((proposal) => {
    const eligibility = evaluateVoteEligibility({
      wallet: input.wallet,
      membership: input.membership,
      proposal,
      power: input.powers[proposal.proposalId] ?? null,
    });
    return { proposal, eligibility, available: eligibility.eligible };
  });
  return {
    all,
    available: all.filter((entry) => entry.available),
    unavailable: all.filter((entry) => !entry.available),
  };
}
