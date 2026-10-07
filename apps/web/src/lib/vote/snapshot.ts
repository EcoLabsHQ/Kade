/**
 * The canonical Snapshot `Vote` typed data.
 *
 * This is the exact shape Snapshot's own client (`snapshot.js` /
 * `sx.js`) signs and the sequencer verifies. It is reproduced here rather than
 * imported, because the repository does not depend on the Snapshot SDK and the
 * shape is small and frozen by the protocol:
 *
 *   - the domain is `{ name: 'snapshot', version: '0.1.4' }`; the sequencer
 *     **enforces** those two values, and there is deliberately no `chainId` (a
 *     Snapshot vote is not chain-scoped at the EIP-712 layer);
 *   - the single-choice `Vote` type is `from`, `space`, `timestamp`, `proposal`,
 *     `choice`, `reason`, `app`, `metadata`, in that order;
 *   - `from` is **inside** the signed payload and is the voter. For a contract
 *     wallet that is why EIP-1271 is required: the voter cannot recover an EOA
 *     signature, so the sequencer asks the voter's contract to validate one.
 *
 * `choice` is the **1-based** index Snapshot records (option `0` of the proposal
 * is `choice: 1`). The screen works in 0-based array indices; the conversion
 * happens in `@/lib/vote/submit`, once, with a test.
 *
 * The type list below is the single source of truth for both the vote path and
 * the screen's "supported vote type" rule, so the two cannot drift.
 */

/** The EIP-712 domain the Snapshot sequencer enforces, verbatim. */
export const SNAPSHOT_VOTE_DOMAIN = {
  name: 'snapshot',
  version: '0.1.4',
} as const;

/** One field of an EIP-712 type. */
export interface SnapshotVoteField {
  readonly name: string;
  readonly type: string;
}

/**
 * The canonical single-choice `Vote` type.
 *
 * `basic` and `single-choice` proposals share this type: `choice` is a single
 * `uint32`. (Snapshot's `voteArrayTypes` / `voteStringTypes` cover approval,
 * ranked-choice, weighted and quadratic, which this screen does not support.)
 */
export const SNAPSHOT_VOTE_TYPES = {
  Vote: [
    { name: 'from', type: 'string' },
    { name: 'space', type: 'string' },
    { name: 'timestamp', type: 'uint64' },
    { name: 'proposal', type: 'string' },
    { name: 'choice', type: 'uint32' },
    { name: 'reason', type: 'string' },
    { name: 'app', type: 'string' },
    { name: 'metadata', type: 'string' },
  ],
} as const;

/** The signed `Vote` message. */
export type SnapshotVoteMessage = {
  /** The voter address (the Safe). Inside the signed payload by protocol. */
  readonly from: string;
  readonly space: string;
  /** Unix seconds. */
  readonly timestamp: number;
  readonly proposal: string;
  /** The 1-based choice Snapshot records. */
  readonly choice: number;
  readonly reason: string;
  readonly app: string;
  readonly metadata: string;
};

/** The complete EIP-712 typed data for one vote. */
export type SnapshotVoteTypedData = {
  readonly domain: typeof SNAPSHOT_VOTE_DOMAIN;
  readonly types: typeof SNAPSHOT_VOTE_TYPES;
  readonly primaryType: 'Vote';
  readonly message: SnapshotVoteMessage;
};

/**
 * The integration's app id, carried in the signed `app` field (Snapshot's
 * `app` is the integrator identifier, max 24 chars). Not a secret.
 */
export const SNAPSHOT_VOTE_APP = 'kade';

/**
 * The vote types this client can present and sign.
 *
 * `basic` is Snapshot's default single-choice type; `single-choice` is the
 * explicit one. Every other type (approval, ranked-choice, weighted,
 * quadratic) has a different signed `choice` type and is refused.
 */
export const SUPPORTED_VOTE_TYPES: ReadonlySet<string> = new Set([
  'basic',
  'single-choice',
]);

/** Whether the screen can present this proposal's real vote type as a ballot. */
export function isSupportedVoteType(type: string | undefined): boolean {
  return type !== undefined && SUPPORTED_VOTE_TYPES.has(type);
}

/**
 * Build the canonical Snapshot `Vote` typed data.
 *
 * `choice` is the 1-based value Snapshot records; the caller converts from the
 * screen's 0-based index. `reason` defaults to the empty string and `metadata`
 * to `'{}'`, exactly as Snapshot's own client defaults them. Nothing here reads
 * the environment or signs: it is a pure builder.
 */
export function buildSnapshotVoteTypedData(input: {
  readonly from: string;
  readonly space: string;
  readonly proposal: string;
  /** The 1-based choice. */
  readonly choice: number;
  readonly timestamp: number;
  readonly reason?: string;
  readonly app?: string;
  readonly metadata?: string;
}): SnapshotVoteTypedData {
  return {
    domain: SNAPSHOT_VOTE_DOMAIN,
    types: SNAPSHOT_VOTE_TYPES,
    primaryType: 'Vote',
    message: {
      from: input.from,
      space: input.space,
      timestamp: input.timestamp,
      proposal: input.proposal,
      choice: input.choice,
      reason: input.reason ?? '',
      app: input.app ?? SNAPSHOT_VOTE_APP,
      metadata: input.metadata ?? '{}',
    },
  };
}
