import { describe, expect, it, vi } from 'vitest';
import { createSnapshotHubClient, type HubProposal } from '@/lib/vote/hub';
import { RESIDENT_SPACE_ID } from '@/lib/vote/spaces';

/**
 * The Snapshot hub client's proposal-content parsing.
 *
 * The client reads the proposal's own fields — `body`, `type`, `choices`,
 * `scores`, `scores_total`, `votes`, `quorum` — and carries them through
 * untouched. A field the hub did not report stays `undefined`; the client never
 * invents a value. The `fetch` is injected, so these tests never dial the
 * network.
 */

/** The proposal fields that are not the content this task added. */
const BASE_PROPOSAL = {
  id: '0xresident',
  title: 'Resident: Add February 2nd to official holiday',
  state: 'active',
  start: 1791382034,
  end: 1791814034,
  snapshot: 512586595,
  choices: ['For', 'Against', 'Abstain'],
  space: { id: RESIDENT_SPACE_ID, name: 'Curaçao Residents' },
};

/** The same proposal carrying every content field the screen reads. */
const FULL_PROPOSAL = {
  ...BASE_PROPOSAL,
  body: 'Add February 2nd to official holiday',
  type: 'basic',
  scores: [10, 5, 5],
  scores_total: 20,
  votes: 3,
  quorum: 0,
};

function fakeFetch(body: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
  })) as unknown as typeof fetch;
}

function clientFor(proposal: Record<string, unknown>) {
  return createSnapshotHubClient({
    fetch: fakeFetch({ data: { proposals: [proposal] } }),
  });
}

describe('Snapshot hub client — proposal content fields', () => {
  it('parses the real body, type, scores, votes and quorum', async () => {
    const [proposal] = await clientFor(FULL_PROPOSAL).fetchProposals([
      RESIDENT_SPACE_ID,
    ]);
    expect(proposal).toMatchObject({
      body: 'Add February 2nd to official holiday',
      type: 'basic',
      choices: ['For', 'Against', 'Abstain'],
      scores: [10, 5, 5],
      scoresTotal: 20,
      votes: 3,
      quorum: 0,
    } satisfies Partial<HubProposal>);
  });

  it('leaves absent content fields undefined rather than inventing them', async () => {
    const [proposal] = await clientFor(BASE_PROPOSAL).fetchProposals([
      RESIDENT_SPACE_ID,
    ]);
    expect(proposal?.body).toBeUndefined();
    expect(proposal?.type).toBeUndefined();
    expect(proposal?.scores).toBeUndefined();
    expect(proposal?.scoresTotal).toBeUndefined();
    expect(proposal?.votes).toBeUndefined();
    expect(proposal?.quorum).toBeUndefined();
  });

  it('reports a null hub body as an empty string, not undefined', async () => {
    const [proposal] = await clientFor({ ...FULL_PROPOSAL, body: null }).fetchProposals([
      RESIDENT_SPACE_ID,
    ]);
    expect(proposal?.body).toBe('');
  });

  it('rejects a malformed tally rather than presenting it', async () => {
    const [proposal] = await clientFor({
      ...FULL_PROPOSAL,
      scores: [1, 'two', 3],
    }).fetchProposals([RESIDENT_SPACE_ID]);
    expect(proposal?.scores).toBeUndefined();
  });
});
