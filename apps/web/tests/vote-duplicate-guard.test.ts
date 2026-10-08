import { describe, expect, it } from 'vitest';
import { createVoteDuplicateGuard, type VoteKey } from '@/lib/vote/duplicate-guard';

/**
 * The duplicate-vote guard.
 *
 * A reservation is claimed once per `(space, proposal, voter)`; a release after
 * a failure allows a retry; and a durable lookup that says "already voted"
 * refuses the reservation. The lookup is injected, so these tests never dial the
 * network.
 */

const KEY: VoteKey = {
  spaceId: 'kadeglobal.eth',
  proposalId: '0xproposal',
  voter: '0xAAAaAaAaaAAaAaAaaAaAaaAaaAaAaaAaAaaAaAaa',
};

describe('vote duplicate guard', () => {
  it('reserves a key once and refuses a second reservation', async () => {
    const guard = createVoteDuplicateGuard();
    expect(await guard.reserve(KEY)).toBe(true);
    expect(await guard.reserve(KEY)).toBe(false);
  });

  it('treats the voter case-insensitively', async () => {
    const guard = createVoteDuplicateGuard();
    expect(await guard.reserve(KEY)).toBe(true);
    expect(await guard.reserve({ ...KEY, voter: KEY.voter.toLowerCase() })).toBe(false);
  });

  it('allows a retry after a failed submission releases the key', async () => {
    const guard = createVoteDuplicateGuard();
    expect(await guard.reserve(KEY)).toBe(true);
    await guard.release(KEY);
    expect(await guard.reserve(KEY)).toBe(true);
  });

  it('refuses a key the durable lookup says already voted', async () => {
    const guard = createVoteDuplicateGuard({ lookup: async () => true });
    expect(await guard.reserve(KEY)).toBe(false);
    // The claim is kept, so a retry is refused without another lookup.
    expect(await guard.reserve(KEY)).toBe(false);
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
    expect(await guard.reserve(KEY)).toBe(true);
  });

  it('keeps distinct proposals independent', async () => {
    const guard = createVoteDuplicateGuard();
    expect(await guard.reserve(KEY)).toBe(true);
    expect(await guard.reserve({ ...KEY, proposalId: '0xother' })).toBe(true);
  });
});
