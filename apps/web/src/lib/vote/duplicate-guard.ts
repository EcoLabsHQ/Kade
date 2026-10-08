/**
 * The duplicate-vote guard.
 *
 * A double click, a retry, or two concurrent requests must not cast two votes
 * for the same `(space, proposal, voter)`. Snapshot rejects a duplicate itself,
 * but the server should not *try* to submit one.
 *
 * The guard has two layers:
 *
 *   1. an **in-process reservation** — a synchronous claim taken before anything
 *      is signed, so two concurrent clicks in the same server process cannot
 *      both proceed;
 *   2. a **durable lookup** — the injected `lookup` asks Snapshot's read-only hub
 *      whether the voter already has a vote on the proposal, so a retry after
 *      the first vote was indexed is refused even in a fresh process.
 *
 * The reservation is released only when the submission **fails**, so a failed
 * attempt can be retried; a successful one keeps it.
 *
 * Known limitation, stated rather than hidden: the in-process layer is not
 * shared across serverless instances, and the hub read can lag Snapshot's
 * indexing. Snapshot's own duplicate rejection remains the final backstop.
 * A durable record (a table with a unique constraint) would close both gaps; it
 * is deliberately not added here to keep the change free of schema migration.
 */

export interface VoteKey {
  readonly spaceId: string;
  readonly proposalId: string;
  readonly voter: string;
}

export interface VoteDuplicateGuard {
  /**
   * Claim `(space, proposal, voter)` before signing.
   *
   * Returns `false` when the key is already reserved or a vote already exists on
   * Snapshot. Throws when the durable lookup could not be performed — the caller
   * must fail closed and not sign.
   */
  reserve(key: VoteKey): Promise<boolean>;
  /** Release a reservation after a failed submission, so a retry may proceed. */
  release(key: VoteKey): Promise<void>;
}

export interface VoteDuplicateGuardDeps {
  /**
   * Whether Snapshot already has a vote for the key. Injected so tests never
   * dial the network; the default is the hub-backed lookup.
   */
  readonly lookup?: (key: VoteKey) => Promise<boolean>;
}

function keyOf(key: VoteKey): string {
  return `${key.spaceId}|${key.proposalId}|${key.voter.toLowerCase()}`;
}

/**
 * Build a guard with an in-process reservation set and an optional durable
 * lookup.
 */
export function createVoteDuplicateGuard(
  deps: VoteDuplicateGuardDeps = {},
): VoteDuplicateGuard {
  const reserved = new Set<string>();
  return {
    async reserve(key) {
      const id = keyOf(key);
      if (reserved.has(id)) return false;
      // Claim synchronously, before the await, so two concurrent calls cannot
      // both pass the check.
      reserved.add(id);
      if (deps.lookup) {
        try {
          if (await deps.lookup(key)) {
            // Already voted on Snapshot: keep the claim so a retry is refused.
            return false;
          }
        } catch (cause) {
          // The duplicate check could not be performed: release and let the
          // caller fail closed rather than signing unchecked.
          reserved.delete(id);
          throw cause;
        }
      }
      return true;
    },
    async release(key) {
      reserved.delete(keyOf(key));
    },
  };
}
