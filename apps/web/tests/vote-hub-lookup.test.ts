import { describe, expect, it, vi } from 'vitest';
import { createSnapshotVoteLookup, SNAPSHOT_HUB_URL } from '@/lib/vote/hub';

/**
 * The read-only "has this voter already voted?" hub lookup.
 *
 * It only ever POSTs a query; a hub error is thrown rather than collapsed into
 * "no vote", so the caller fails closed instead of signing a duplicate.
 */

function fakeFetch(body: unknown, ok = true, status = 200): typeof fetch {
  return vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

const PROPOSAL = '0xproposal';
const VOTER = '0x1111111111111111111111111111111111111111';

describe('Snapshot vote lookup', () => {
  it('reports an existing vote for the voter on the proposal', async () => {
    const fetch = fakeFetch({ data: { votes: [{ id: '0x1' }] } });
    const lookup = createSnapshotVoteLookup({ fetch });
    expect(await lookup.hasVoted({ proposal: PROPOSAL, voter: VOTER })).toBe(true);

    const call = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(String(call?.[0])).toBe(SNAPSHOT_HUB_URL);
    const body = JSON.parse(String((call?.[1] as RequestInit | undefined)?.body)) as {
      variables: Record<string, string>;
    };
    expect(body.variables).toEqual({ proposal: PROPOSAL, voter: VOTER });
  });

  it('reports no vote when the hub returns an empty list', async () => {
    const lookup = createSnapshotVoteLookup({ fetch: fakeFetch({ data: { votes: [] } }) });
    expect(await lookup.hasVoted({ proposal: PROPOSAL, voter: VOTER })).toBe(false);
  });

  it('throws on a hub error rather than assuming no vote', async () => {
    const lookup = createSnapshotVoteLookup({
      fetch: fakeFetch({ errors: [{ message: 'rate limited' }] }),
    });
    await expect(lookup.hasVoted({ proposal: PROPOSAL, voter: VOTER })).rejects.toThrow(
      /rate limited/,
    );
  });
});
