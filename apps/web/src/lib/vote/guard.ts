import { createSnapshotVoteLookup } from './hub';
import { createVoteDuplicateGuard, type VoteDuplicateGuard } from './duplicate-guard';

/**
 * The server's default duplicate guard.
 *
 * A single module-level guard keeps one in-process reservation set for the
 * server process, so a double click in the same warm process is refused
 * immediately; the hub-backed lookup refuses a retry after the first vote was
 * indexed, even in a fresh process. The lookup is read-only.
 *
 * The guard is ephemeral: it is not persisted and is not a substitute for a
 * durable record. Snapshot's own duplicate rejection remains the final backstop.
 * See `./duplicate-guard` for the stated limitation.
 */
let defaultGuard: VoteDuplicateGuard | null = null;

export function serverVoteDuplicateGuard(): VoteDuplicateGuard {
  if (defaultGuard === null) {
    const lookup = createSnapshotVoteLookup({ fetch: globalThis.fetch });
    defaultGuard = createVoteDuplicateGuard({
      lookup: (key) => lookup.hasVoted({ proposal: key.proposalId, voter: key.voter }),
    });
  }
  return defaultGuard;
}
