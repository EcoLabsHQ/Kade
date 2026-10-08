/**
 * The duplicate-vote guard.
 *
 * A double click, a retry, or two concurrent requests must not cast two votes
 * for the same `(space, proposal, voter)`. Snapshot rejects a duplicate itself,
 * but the server should not *try* to submit one.
 *
 * The guard has two layers:
 *
 *   1. an **in-process reservation** — a synchronous claim taken before the
 *      resident is asked to sign, so two concurrent attempts in the same server
 *      process cannot both proceed;
 *   2. a **durable lookup** — the injected `lookup` asks Snapshot's read-only hub
 *      whether the voter already has a vote on the proposal, so a retry after
 *      the first vote was indexed is refused even in a fresh process.
 *
 * ## The reservation is bounded, and its refusal is honest
 *
 * A reservation now carries a **state** and an **expiry**, so a refused
 * reservation can say *why* it was refused, truthfully:
 *
 *   - `already-voted` — a vote genuinely exists (the durable lookup found one),
 *     or a reservation that was completed by a successful submission is still
 *     live;
 *   - `in-progress` — another attempt is currently signing, so this one is
 *     refused.
 *
 * An **abandoned** attempt (the resident dismissed the passkey prompt, or the
 * session expired before signing) is released explicitly, and every reservation
 * also has a **bounded lifetime** so a claim can never outlive a normal attempt
 * even if the release is missed. This is what keeps the refusal message true: a
 * resident who abandons can try again, and they are never told a vote exists
 * when one does not.
 *
 * Known limitation, stated rather than hidden: the in-process layer is not
 * shared across serverless instances, and the hub read can lag Snapshot's
 * indexing. The expiry bounds how long a stale claim can matter, but a `begin`
 * on one instance and a `complete` on another still relies on Snapshot. A
 * durable record (a table with a unique constraint) would close both gaps; it is
 * deliberately not added here to keep the change free of schema migration.
 */

export interface VoteKey {
  readonly spaceId: string;
  readonly proposalId: string;
  readonly voter: string;
}

/**
 * Why a reservation was granted or refused. The refusal variants are distinct
 * so the caller can state the truth rather than asserting a vote exists when an
 * attempt merely is in progress.
 */
export type VoteReservation =
  | { readonly status: 'reserved' }
  | { readonly status: 'already-voted' }
  | { readonly status: 'in-progress' };

export interface VoteDuplicateGuard {
  /**
   * Claim `(space, proposal, voter)` before the resident signs.
   *
   * Returns `already-voted` when a vote genuinely exists (the durable lookup
   * found one, or a completed reservation is still live) and `in-progress` when
   * another attempt is signing. Throws when the durable lookup could not be
   * performed — the caller must fail closed and not sign.
   */
  reserve(key: VoteKey): Promise<VoteReservation>;
  /**
   * Mark a reservation as a completed vote, so a retry reports `already-voted`
   * rather than `in-progress`.
   */
  commit(key: VoteKey): Promise<void>;
  /**
   * Release a reservation after a failed or abandoned attempt, so a retry may
   * proceed immediately.
   */
  release(key: VoteKey): Promise<void>;
}

export interface VoteDuplicateGuardDeps {
  /**
   * Whether Snapshot already has a vote for the key. Injected so tests never
   * dial the network; the default is the hub-backed lookup.
   */
  readonly lookup?: (key: VoteKey) => Promise<boolean>;
  /** Injected clock; defaults to `Date.now()`. */
  readonly now?: () => number;
  /** How long a reservation may live. Defaults to {@link DEFAULT_RESERVATION_TTL_MS}. */
  readonly ttlMs?: number;
}

/**
 * How long a reservation lives before it self-releases.
 *
 * It matches the retained-vote lifetime: a `complete` can arrive at most that
 * long after `begin`, so the reservation must cover the same window. A normal
 * abandoned attempt is released explicitly and does not wait for this.
 */
export const DEFAULT_RESERVATION_TTL_MS = 5 * 60_000;

interface Reservation {
  readonly expiresAt: number;
  /** Whether a submission completed under this reservation. */
  voted: boolean;
}

function keyOf(key: VoteKey): string {
  return `${key.spaceId}|${key.proposalId}|${key.voter.toLowerCase()}`;
}

/**
 * Build a guard with an in-process reservation set, a bounded lifetime and an
 * optional durable lookup.
 */
export function createVoteDuplicateGuard(
  deps: VoteDuplicateGuardDeps = {},
): VoteDuplicateGuard {
  const reservations = new Map<string, Reservation>();
  const now = deps.now ?? Date.now;
  const ttlMs = deps.ttlMs ?? DEFAULT_RESERVATION_TTL_MS;

  /** The live reservation for `id`, dropping an expired one first. */
  function live(id: string, at: number): Reservation | null {
    const existing = reservations.get(id);
    if (existing === undefined) return null;
    if (existing.expiresAt <= at) {
      // An abandoned attempt that was never released self-releases here, so a
      // stale claim can never be reported as a live one.
      reservations.delete(id);
      return null;
    }
    return existing;
  }

  return {
    async reserve(key) {
      const id = keyOf(key);
      const at = now();

      const existing = live(id, at);
      if (existing !== null) {
        return existing.voted
          ? { status: 'already-voted' }
          : { status: 'in-progress' };
      }

      // Claim synchronously, before the await, so two concurrent calls cannot
      // both pass the check.
      reservations.set(id, { expiresAt: at + ttlMs, voted: false });
      if (deps.lookup) {
        try {
          if (await deps.lookup(key)) {
            // A vote genuinely exists: keep the claim, marked so the refusal
            // says "already voted" truthfully and a retry is refused.
            reservations.set(id, { expiresAt: at + ttlMs, voted: true });
            return { status: 'already-voted' };
          }
        } catch (cause) {
          // The duplicate check could not be performed: release and let the
          // caller fail closed rather than signing unchecked.
          reservations.delete(id);
          throw cause;
        }
      }
      return { status: 'reserved' };
    },
    async commit(key) {
      const id = keyOf(key);
      const at = now();
      if (reservations.has(id)) {
        reservations.set(id, { expiresAt: at + ttlMs, voted: true });
      }
    },
    async release(key) {
      reservations.delete(keyOf(key));
    },
  };
}
