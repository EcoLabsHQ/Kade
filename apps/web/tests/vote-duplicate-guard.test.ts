import { describe, expect, it } from 'vitest';
import {
  createVoteDuplicateGuard,
  DEFAULT_RESERVATION_TTL_MS,
  type VoteKey,
} from '@/lib/vote/duplicate-guard';

/**
 * The duplicate-vote guard.
 *
 * A reservation is claimed once per `(space, proposal, voter)`; a release after
 * a failure or an abandon allows an immediate retry; a completed vote reports
 * `already-voted`; and a durable lookup that says "already voted" refuses the
 * reservation. Every reservation also has a bounded lifetime, so a claim that is
 * never released self-releases rather than blocking the resident forever. The
 * lookup and the clock are injected, so these tests never dial the network and
 * never wait.
 */

const KEY: VoteKey = {
  spaceId: 'kadeglobal.eth',
  proposalId: '0xproposal',
  voter: '0xAAAaAaAaaAAaAaAaaAaAaaAaaAaAaaAaAaaAaAaa',
};

/** A guard with an injected, controllable clock. */
function guardAt(
  startMs: number,
  overrides: Partial<Parameters<typeof createVoteDuplicateGuard>[0]> = {},
) {
  let now = startMs;
  const guard = createVoteDuplicateGuard({
    now: () => now,
    ...overrides,
  });
  return {
    guard,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('vote duplicate guard', () => {
  it('reserves a key once and refuses a second reservation as in-progress', async () => {
    const guard = createVoteDuplicateGuard();
    expect(await guard.reserve(KEY)).toEqual({ status: 'reserved' });
    expect(await guard.reserve(KEY)).toEqual({ status: 'in-progress' });
  });

  it('treats the voter case-insensitively', async () => {
    const guard = createVoteDuplicateGuard();
    expect(await guard.reserve(KEY)).toEqual({ status: 'reserved' });
    expect(await guard.reserve({ ...KEY, voter: KEY.voter.toLowerCase() })).toEqual({
      status: 'in-progress',
    });
  });

  it('allows an immediate retry after a failed submission releases the key', async () => {
    const guard = createVoteDuplicateGuard();
    expect(await guard.reserve(KEY)).toEqual({ status: 'reserved' });
    await guard.release(KEY);
    expect(await guard.reserve(KEY)).toEqual({ status: 'reserved' });
  });

  it('reports a completed reservation as already-voted, not in-progress', async () => {
    const guard = createVoteDuplicateGuard();
    expect(await guard.reserve(KEY)).toEqual({ status: 'reserved' });
    await guard.commit(KEY);
    // The message the caller derives from this must be "a vote exists", and it
    // must stay that way while the completed reservation is live.
    expect(await guard.reserve(KEY)).toEqual({ status: 'already-voted' });
  });

  it('self-releases an abandoned reservation after its bounded lifetime', async () => {
    const { guard, advance } = guardAt(1_000, { ttlMs: 30_000 });
    expect(await guard.reserve(KEY)).toEqual({ status: 'reserved' });

    // Still inside the window: the claim is live and reported honestly.
    advance(29_000);
    expect(await guard.reserve(KEY)).toEqual({ status: 'in-progress' });

    // Past the window: the abandoned attempt has self-released.
    advance(2_000);
    expect(await guard.reserve(KEY)).toEqual({ status: 'reserved' });
  });

  it('self-releases a completed reservation after its bounded lifetime', async () => {
    const { guard, advance } = guardAt(1_000, { ttlMs: 30_000 });
    await guard.reserve(KEY);
    await guard.commit(KEY);
    advance(30_001);
    // The in-process claim is gone; a durable lookup is the next line of
    // defence in production.
    expect(await guard.reserve(KEY)).toEqual({ status: 'reserved' });
  });

  it('has a default lifetime long enough to cover a signing attempt', () => {
    expect(DEFAULT_RESERVATION_TTL_MS).toBeGreaterThanOrEqual(60_000);
  });

  it('refuses a key the durable lookup says already voted', async () => {
    const guard = createVoteDuplicateGuard({ lookup: async () => true });
    expect(await guard.reserve(KEY)).toEqual({ status: 'already-voted' });
    // The claim is kept and marked, so a retry is refused without another lookup.
    expect(await guard.reserve(KEY)).toEqual({ status: 'already-voted' });
  });

  it('releases the claim and throws when the lookup fails, so the caller fails closed', async () => {
    let calls = 0;
    const guard = createVoteDuplicateGuard({
      lookup: async () => {
        calls += 1;
        if (calls === 1) throw new Error('hub down');
        return false;
      },
    });
    await expect(guard.reserve(KEY)).rejects.toThrow(/hub down/);
    // The claim was released, so a later attempt can be checked again.
    expect(await guard.reserve(KEY)).toEqual({ status: 'reserved' });
  });

  it('keeps distinct proposals independent', async () => {
    const guard = createVoteDuplicateGuard();
    expect(await guard.reserve(KEY)).toEqual({ status: 'reserved' });
    expect(await guard.reserve({ ...KEY, proposalId: '0xother' })).toEqual({
      status: 'reserved',
    });
  });
});
