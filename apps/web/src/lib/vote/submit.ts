import { getAddress, type Address } from 'viem';
import type { SnapshotAdapter } from './adapter';
import type { VoteDuplicateGuard } from './duplicate-guard';
import {
  CITIZEN_ONLY_REFUSAL,
  type VoteViewerMembership,
} from './eligibility';
import {
  buildSnapshotVoteTypedData,
  isSupportedVoteType,
  SNAPSHOT_VOTE_APP,
} from './snapshot';
import { voteSpaceConfigById } from './spaces';
import type { SnapshotSequencerClient } from './sequencer';
import type { SafeMessageSigner } from '@/lib/safe/owner-sign-message';

/**
 * Casting a Snapshot vote, server-side.
 *
 * The resident clicks; the **backend signs through the owner Safe** and the
 * click is the authorisation. Nothing is trusted from the client except the
 * three identifiers that name *what* to vote on: the space, the proposal and the
 * choice. The voter (the Safe whose credential counts), the signer and the
 * sequencer are all resolved server-side.
 *
 * The consequences of that authorisation model are stated plainly rather than
 * hidden: whoever holds the backend signer key can cast a vote with any
 * credential the signer owns. The key is the authorisation; the click only
 * selects the ballot.
 *
 * ## Every precondition is checked before anything is signed
 *
 * In order, each failing closed with a reason and **no signature**:
 *
 *   1. the signer, the sequencer, the voter Safe and the chain are configured;
 *   2. the proposal exists (read from Snapshot, never asserted by the client);
 *   3. the space is configured and its network equals the voter Safe's chain;
 *   4. the proposal is `active`;
 *   5. the proposal's vote type is supported (`basic` / `single-choice`);
 *   6. the choice index is within the proposal's real `choices`;
 *   7. a Citizen-only proposal is refused to a non-Citizen, with the exact text;
 *   8. no vote already exists for `(space, proposal, voter)`;
 *   9. voting power is **known** and strictly greater than zero at the
 *      proposal's `snapshot` block.
 *
 * Only then is the canonical `Vote` typed data built, signed through the Safe
 * and POSTed to the sequencer. `submitted: true` appears only for a sequencer
 * acceptance; a refusal is a `blocked` / `failed` outcome that names the stage.
 */

export type SnapshotVoteOutcome =
  | { readonly status: 'not-configured'; readonly submitted: false; readonly reason: string }
  | { readonly status: 'blocked'; readonly submitted: false; readonly reason: string }
  | { readonly status: 'failed'; readonly submitted: false; readonly reason: string }
  | {
      readonly status: 'submitted';
      readonly submitted: true;
      readonly reason: string;
      readonly spaceId: string;
      readonly proposalId: string;
      readonly voter: string;
      /** The 1-based choice Snapshot recorded. */
      readonly choice: number;
      /** The sequencer's message id, or null when it did not report one. */
      readonly voteId: string | null;
      /** The sequencer's IPFS hash, or null when it did not report one. */
      readonly ipfsHash: string | null;
    };

/**
 * The vote result the screen sees: the cast outcome, or an authentication
 * refusal from the server action. The screen treats every non-`submitted`
 * result as "not recorded".
 */
export type SnapshotVoteResult =
  | SnapshotVoteOutcome
  | {
      readonly status: 'unauthenticated';
      readonly submitted: false;
      readonly reason: string;
    };

export interface SnapshotVoteDependencies {
  /** The real Snapshot adapter: proposals and voting power are read through it. */
  readonly adapter: SnapshotAdapter;
  /** The voter Safe's chain. `null` when unconfigured. */
  readonly chainId: number | null;
  /**
   * The voter Safe (the address whose credential counts), resolved server-side.
   * `null` when the resident has no Safe recorded.
   */
  readonly safeAddress: Address | null;
  /** The viewer's membership, for the Citizen-only rule. */
  readonly membership: VoteViewerMembership;
  /** The bound owner-Safe signer; `null` when the signer/config is absent. */
  readonly signer: SafeMessageSigner | null;
  /** The sequencer client; `null` when unconfigured. */
  readonly sequencer: SnapshotSequencerClient | null;
  /** The duplicate guard; `null` when unconfigured. */
  readonly duplicateGuard: VoteDuplicateGuard | null;
  /** The `app` id carried in the signed payload. Defaults to `kade`. */
  readonly app?: string;
  /** Injected for tests; defaults to `Date.now()`. */
  readonly now?: () => number;
}

export interface CastSnapshotVoteInput {
  readonly spaceId: string;
  readonly proposalId: string;
  /** The screen's **0-based** choice index into the proposal's `choices`. */
  readonly choice: number;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

const notConfigured = (reason: string): SnapshotVoteOutcome => ({
  status: 'not-configured',
  submitted: false,
  reason,
});
const blocked = (reason: string): SnapshotVoteOutcome => ({
  status: 'blocked',
  submitted: false,
  reason,
});
const failed = (reason: string): SnapshotVoteOutcome => ({
  status: 'failed',
  submitted: false,
  reason,
});

/**
 * Validate the preconditions and, if they all hold, sign and submit the vote.
 *
 * Never throws for an expected refusal: every refusal is a discriminated
 * outcome. The signer is called only after every check has passed.
 */
export async function castSnapshotVote(
  input: CastSnapshotVoteInput,
  deps: SnapshotVoteDependencies,
): Promise<SnapshotVoteOutcome> {
  const now = deps.now ?? Date.now;

  // 1. Configuration.
  if (deps.chainId === null) {
    return notConfigured('The voter Safe chain is not configured, so nothing was signed.');
  }
  const chainId = deps.chainId;
  if (deps.safeAddress === null) {
    return notConfigured(
      "The resident's Safe is not recorded, so there is no credential to vote with.",
    );
  }
  let voter: Address;
  try {
    voter = getAddress(deps.safeAddress);
  } catch {
    return blocked(
      "The resident's Safe address is malformed, so nothing was signed.",
    );
  }
  if (deps.signer === null) {
    return notConfigured(
      'No owner-Safe signer is configured (the signer key is absent), so nothing ' +
        'was signed.',
    );
  }
  const signer = deps.signer;
  if (deps.sequencer === null) {
    return notConfigured('No Snapshot sequencer is configured, so nothing was sent.');
  }
  const sequencer = deps.sequencer;
  if (deps.duplicateGuard === null) {
    return notConfigured('No duplicate guard is configured, so nothing was signed.');
  }
  const guard = deps.duplicateGuard;

  // 2. The choice index crosses the network, so the type annotation is not a
  //    guard: reject anything that is not a non-negative integer.
  if (!Number.isInteger(input.choice) || input.choice < 0) {
    return blocked(
      `The choice "${String(input.choice)}" is not a valid option index, so nothing ` +
        'was signed.',
    );
  }

  // 3. The proposal is read from Snapshot, never asserted by the client.
  let proposal;
  try {
    const proposals = await deps.adapter.listProposals(input.spaceId);
    proposal = proposals.find((candidate) => candidate.proposalId === input.proposalId);
  } catch (cause) {
    return blocked(`The proposal could not be read from Snapshot: ${describe(cause)}`);
  }
  if (!proposal) {
    return blocked(
      `The proposal "${input.proposalId}" was not found in space "${input.spaceId}", ` +
        'so nothing was signed.',
    );
  }
  if (proposal.spaceId !== input.spaceId) {
    return blocked(
      `The proposal "${input.proposalId}" does not belong to space "${input.spaceId}", ` +
        'so nothing was signed.',
    );
  }

  // 4. The space's network must match the voter Safe's chain.
  const config = voteSpaceConfigById(input.spaceId);
  if (config === null) {
    return blocked(`The space "${input.spaceId}" is not configured, so nothing was signed.`);
  }
  if (config.chainId !== chainId) {
    return blocked(
      `The space "${input.spaceId}" is on chain ${config.chainId} but the voter Safe ` +
        `is on chain ${chainId}, so nothing was signed.`,
    );
  }

  // 5. Only an active proposal can be voted on.
  if (proposal.state !== 'open') {
    return blocked('This proposal is not active, so nothing was signed.');
  }

  // 6. Only the single-choice types are supported.
  if (!isSupportedVoteType(proposal.type)) {
    return blocked(
      proposal.type === undefined
        ? 'This proposal did not report a vote type, so nothing was signed.'
        : `This proposal uses the "${proposal.type}" vote type, which is not ` +
          'supported, so nothing was signed.',
    );
  }

  // 7. The choice must be one of the proposal's real choices.
  if (input.choice >= proposal.choices.length) {
    return blocked(
      `Choice ${input.choice} is outside this proposal's ${proposal.choices.length} ` +
        'choices, so nothing was signed.',
    );
  }

  // 8. The Citizen-only rule, re-derived server-side.
  if (proposal.category === 'citizen' && deps.membership !== 'citizen') {
    return blocked(CITIZEN_ONLY_REFUSAL);
  }

  // 9. Duplicate guard, before signing.
  try {
    const reserved = await guard.reserve({
      spaceId: input.spaceId,
      proposalId: input.proposalId,
      voter,
    });
    if (!reserved) {
      return blocked(
        'A vote for this proposal already exists for this credential, so nothing ' +
          'was signed.',
      );
    }
  } catch (cause) {
    return blocked(`The existing vote could not be checked: ${describe(cause)}`);
  }

  // 10. Voting power must be known and positive at the proposal's snapshot block.
  let power;
  try {
    power = await deps.adapter.readVotingPower({
      spaceId: input.spaceId,
      proposalId: input.proposalId,
      wallet: voter,
      blockNumber: proposal.snapshotBlock,
    });
  } catch (cause) {
    await guard.release({ spaceId: input.spaceId, proposalId: input.proposalId, voter });
    return blocked(`Voting power could not be read, so eligibility is not assumed: ${describe(cause)}`);
  }
  if (power.status !== 'known') {
    await guard.release({ spaceId: input.spaceId, proposalId: input.proposalId, voter });
    return blocked(
      power.status === 'error'
        ? `Voting power could not be read, so eligibility is not assumed: ${power.reason}`
        : `Voting power could not be read, so eligibility is not assumed.`,
    );
  }
  if (power.power <= 0n) {
    await guard.release({ spaceId: input.spaceId, proposalId: input.proposalId, voter });
    return blocked('This credential holds no voting power for this proposal.');
  }

  // 11. Build the canonical typed data. `choice` is converted from the screen's
  //     0-based index to Snapshot's 1-based value, exactly once, here.
  const typedData = buildSnapshotVoteTypedData({
    from: voter,
    space: input.spaceId,
    proposal: input.proposalId,
    choice: input.choice + 1,
    timestamp: Math.floor(now() / 1000),
    app: deps.app ?? SNAPSHOT_VOTE_APP,
  });

  // 12. Sign through the owner Safe.
  let signature;
  try {
    signature = await signer({ chainId, message: typedData });
  } catch (cause) {
    await guard.release({ spaceId: input.spaceId, proposalId: input.proposalId, voter });
    return failed(`The vote could not be signed through the owner Safe: ${describe(cause)}`);
  }

  // 13. Submit to the sequencer. `primaryType` is not part of the wire body.
  let result;
  try {
    result = await sequencer.submitVote({
      address: voter,
      sig: signature.signature,
      data: {
        domain: typedData.domain,
        types: typedData.types,
        message: typedData.message,
      },
    });
  } catch (cause) {
    await guard.release({ spaceId: input.spaceId, proposalId: input.proposalId, voter });
    return failed(`The Snapshot sequencer could not be reached: ${describe(cause)}`);
  }
  if (!result.ok) {
    await guard.release({ spaceId: input.spaceId, proposalId: input.proposalId, voter });
    return failed(result.reason);
  }

  // 14. Accepted. The reservation stays claimed so a retry is refused.
  return {
    status: 'submitted',
    submitted: true,
    reason: 'The Snapshot sequencer accepted the vote.',
    spaceId: input.spaceId,
    proposalId: input.proposalId,
    voter,
    choice: input.choice + 1,
    voteId: result.id,
    ipfsHash: result.ipfsHash,
  };
}
