import { randomBytes } from 'node:crypto';
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
  type SnapshotVoteTypedData,
} from './snapshot';
import { voteSpaceConfigById } from './spaces';
import type { SnapshotSequencerClient } from './sequencer';

/**
 * Casting a Snapshot vote, server-side, in two phases.
 *
 * The **resident authorises**; the backend only validates and submits. The
 * passkey lives in the browser, so the signature cannot be produced on the
 * server. The flow is therefore split:
 *
 *   1. `beginSnapshotVote` — server, no signing. Runs every precondition and,
 *      only when they all hold, builds the canonical `Vote` typed data and
 *      retains it under a one-time token. It returns the typed data for the
 *      resident to sign with their passkey; it never signs and never sends.
 *   2. `completeSnapshotVote` — server, after the browser signs. Takes the
 *      client's EIP-1271 signature, looks up the retained typed data (so the
 *      client cannot substitute what is submitted) and POSTs the signed envelope
 *      to the Snapshot sequencer.
 *
 * The backend holds **no voting power**: it cannot sign, and the only signature
 * it can submit is one the resident's passkey produced over the retained typed
 * data. Nothing is trusted from the client except the signature, and the
 * sequencer verifies that against the voter Safe's EIP-1271 `isValidSignature`.
 *
 * ## Every precondition is checked before the resident is asked to sign
 *
 * In order, each failing closed with a reason and **no typed data returned**:
 *
 *   1. the sequencer, the voter Safe, the chain and the duplicate guard are
 *      configured;
 *   2. the choice index is a non-negative integer;
 *   3. the proposal exists (read from Snapshot, never asserted by the client);
 *   4. the space is configured and its network equals the voter Safe's chain;
 *   5. the proposal is `active`;
 *   6. the proposal's vote type is supported (`basic` / `single-choice`);
 *   7. the choice index is within the proposal's real `choices`;
 *   8. a Citizen-only proposal is refused to a non-Citizen, with the exact text;
 *   9. no vote already exists for `(space, proposal, voter)`;
 *  10. voting power is **known** and strictly greater than zero at the
 *      proposal's `snapshot` block.
 *
 * Only then is the canonical `Vote` typed data built and retained.
 * `submitted: true` appears only for a sequencer acceptance of the resident's
 * signature; a refusal is a `blocked` / `failed` outcome that names the stage.
 */

export type SnapshotVoteRefusal =
  | { readonly status: 'not-configured'; readonly submitted: false; readonly reason: string }
  | { readonly status: 'blocked'; readonly submitted: false; readonly reason: string }
  | { readonly status: 'failed'; readonly submitted: false; readonly reason: string };

export type SnapshotVoteOutcome =
  | SnapshotVoteRefusal
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

/**
 * The result of the build phase: the typed data to sign, or a refusal. The
 * `ready` variant is deliberately **not** a `submitted` outcome — nothing has
 * been signed or sent yet.
 */
export type BeginSnapshotVoteOutcome =
  | {
      readonly status: 'ready';
      readonly submitted: false;
      /** A cryptographically random, single-use token for the retained vote. */
      readonly token: string;
      /** The canonical Snapshot `Vote` typed data the resident must sign. */
      readonly typedData: SnapshotVoteTypedData;
      /** The voter Safe the sequencer will verify against. */
      readonly voter: Address;
    }
  | SnapshotVoteRefusal;

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
  /** The sequencer client; `null` when unconfigured. */
  readonly sequencer: SnapshotSequencerClient | null;
  /** The duplicate guard; `null` when unconfigured. */
  readonly duplicateGuard: VoteDuplicateGuard | null;
  /** The `app` id carried in the signed payload. Defaults to `kade`. */
  readonly app?: string;
  /** Injected for tests; defaults to `Date.now()`. */
  readonly now?: () => number;
}

/** The deps the submit phase needs: the sequencer and the guard to release. */
export interface CompleteSnapshotVoteDependencies {
  readonly sequencer: SnapshotSequencerClient | null;
  readonly duplicateGuard: VoteDuplicateGuard | null;
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

const notConfigured = (reason: string): SnapshotVoteRefusal => ({
  status: 'not-configured',
  submitted: false,
  reason,
});
const blocked = (reason: string): SnapshotVoteRefusal => ({
  status: 'blocked',
  submitted: false,
  reason,
});
const failed = (reason: string): SnapshotVoteRefusal => ({
  status: 'failed',
  submitted: false,
  reason,
});

/** A retained vote: the exact typed data the resident is signing. */
interface SnapshotVoteContext {
  readonly spaceId: string;
  readonly proposalId: string;
  readonly voter: Address;
  /** The 1-based choice Snapshot records. */
  readonly choice: number;
  readonly typedData: SnapshotVoteTypedData;
}

interface RetainedVote {
  readonly context: SnapshotVoteContext;
  readonly expiresAt: number;
}

/** How long a retained vote may be signed and submitted before it expires. */
export const RETAINED_VOTE_TTL_MS = 5 * 60_000;

/**
 * The retained votes awaiting the resident's signature, keyed by token.
 *
 * ## Limits (read before scaling)
 *
 * Like the resident-Safe engine's retained operations, this store is
 * **per-process, in memory**. It does not survive a restart and is not shared
 * across instances, so a build handled by one process cannot be completed by
 * another; the client simply starts again and signs a fresh typed data. The
 * token is cryptographically random and single-use, so a replay cannot reach the
 * same retained vote twice, and an unknown or expired token is refused honestly
 * rather than treated as a signed vote.
 */
const retainedVotes = new Map<string, RetainedVote>();

function retainVote(context: SnapshotVoteContext, now: number): string {
  // Drop votes that were never signed, so the map cannot grow without bound.
  for (const [key, entry] of retainedVotes) {
    if (entry.expiresAt <= now) retainedVotes.delete(key);
  }
  const token = randomBytes(32).toString('base64url');
  retainedVotes.set(token, { context, expiresAt: now + RETAINED_VOTE_TTL_MS });
  return token;
}

/** Consume a token and return its retained vote, or `null`. Single-use. */
function consumeVote(token: string, now: number): SnapshotVoteContext | null {
  const entry = retainedVotes.get(token);
  if (entry === undefined) return null;
  retainedVotes.delete(token);
  if (entry.expiresAt <= now) return null;
  return entry.context;
}

/**
 * Validate every precondition and, if they all hold, build and retain the
 * canonical `Vote` typed data for the resident to sign.
 *
 * Never throws for an expected refusal: every refusal is a discriminated
 * outcome. Nothing is signed and nothing is sent here.
 */
export async function beginSnapshotVote(
  input: CastSnapshotVoteInput,
  deps: SnapshotVoteDependencies,
): Promise<BeginSnapshotVoteOutcome> {
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
  if (deps.sequencer === null) {
    return notConfigured('No Snapshot sequencer is configured, so nothing was sent.');
  }
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

  // 9. Duplicate guard, before the resident is asked to sign.
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

  // 12. Retain the exact typed data the resident will sign, under a one-time
  //     token, so the client cannot substitute what is submitted.
  const token = retainVote(
    {
      spaceId: input.spaceId,
      proposalId: input.proposalId,
      voter,
      choice: input.choice + 1,
      typedData,
    },
    // The TTL is wall-clock, not the injected timestamp clock, so a test that
    // pins `now` for the signed timestamp still completes promptly.
    Date.now(),
  );

  return { status: 'ready', submitted: false, token, typedData, voter };
}

/**
 * Submit the resident's signature for a retained vote.
 *
 * The client supplies only `{ token, signature }`. The typed data that is
 * submitted is the server-retained one, never the client's; the signature must
 * therefore match it or the sequencer rejects it. A failure releases the
 * duplicate reservation so the resident may retry.
 */
export async function completeSnapshotVote(
  input: { readonly token: string; readonly signature: string },
  deps: CompleteSnapshotVoteDependencies,
): Promise<SnapshotVoteOutcome> {
  const context = consumeVote(input.token, Date.now());
  if (context === null) {
    return failed(
      'The vote request is unknown, already used, or expired, so nothing was sent. ' +
        'Start again and sign a fresh vote.',
    );
  }

  const key = {
    spaceId: context.spaceId,
    proposalId: context.proposalId,
    voter: context.voter,
  };

  if (deps.sequencer === null) {
    if (deps.duplicateGuard) await deps.duplicateGuard.release(key);
    return notConfigured('No Snapshot sequencer is configured, so nothing was sent.');
  }

  // The signature is the only client input. An empty or malformed value is not a
  // signed vote and must not be sent as one.
  if (
    typeof input.signature !== 'string' ||
    !input.signature.startsWith('0x') ||
    input.signature.length <= 2
  ) {
    if (deps.duplicateGuard) await deps.duplicateGuard.release(key);
    return failed('The vote was not signed, so nothing was sent.');
  }

  const typedData = context.typedData;
  let result;
  try {
    result = await deps.sequencer.submitVote({
      address: context.voter,
      sig: input.signature,
      data: {
        domain: typedData.domain,
        types: typedData.types,
        message: typedData.message,
      },
    });
  } catch (cause) {
    if (deps.duplicateGuard) await deps.duplicateGuard.release(key);
    return failed(`The Snapshot sequencer could not be reached: ${describe(cause)}`);
  }
  if (!result.ok) {
    if (deps.duplicateGuard) await deps.duplicateGuard.release(key);
    return failed(result.reason);
  }

  // Accepted. The reservation stays claimed so a retry is refused.
  return {
    status: 'submitted',
    submitted: true,
    reason: 'The Snapshot sequencer accepted the vote.',
    spaceId: context.spaceId,
    proposalId: context.proposalId,
    voter: context.voter,
    choice: context.choice,
    voteId: result.id,
    ipfsHash: result.ipfsHash,
  };
}
