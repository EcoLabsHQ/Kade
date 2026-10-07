import { describe, expect, it, vi } from 'vitest';
import {
  createSnapshotSequencerClient,
  SNAPSHOT_SEQUENCER_URL,
  type SnapshotVoteEnvelope,
} from '@/lib/vote/sequencer';
import { buildSnapshotVoteTypedData } from '@/lib/vote/snapshot';

/**
 * The Snapshot sequencer client.
 *
 * The vote is POSTed as the exact envelope Snapshot's own client sends, and a
 * non-2xx response or an error body is surfaced honestly — never as success.
 * The `fetch` is injected, so these tests never dial the network.
 */

const TYPED = buildSnapshotVoteTypedData({
  from: '0x1111111111111111111111111111111111111111',
  space: 'kadeglobal.eth',
  proposal: '0xproposal',
  choice: 1,
  timestamp: 1_791_382_034,
});

const ENVELOPE: SnapshotVoteEnvelope = {
  address: TYPED.message.from,
  sig: `0x${'ab'.repeat(65)}`,
  data: { domain: TYPED.domain, types: TYPED.types, message: TYPED.message },
};

interface Captured {
  readonly url: string;
  readonly init: RequestInit;
}

function fakeFetch(
  body: unknown,
  init: { ok?: boolean; status?: number; throwOnCall?: boolean } = {},
): { fetch: typeof fetch; captured: Captured[] } {
  const captured: Captured[] = [];
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, request?: RequestInit) => {
    captured.push({ url: String(url), init: request ?? {} });
    if (init.throwOnCall) throw new Error('network down');
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => body,
    } as Response;
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, captured };
}

describe('Snapshot sequencer client', () => {
  it('POSTs the exact snapshot.js envelope, without primaryType', async () => {
    const { fetch, captured } = fakeFetch({ id: '0x1', ipfs: 'QmHash' });
    const client = createSnapshotSequencerClient({ fetch });

    const result = await client.submitVote(ENVELOPE);

    expect(result).toEqual({ ok: true, id: '0x1', ipfsHash: 'QmHash' });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe(SNAPSHOT_SEQUENCER_URL);
    expect(captured[0]?.init.method).toBe('POST');
    const body = JSON.parse(String(captured[0]?.init.body)) as Record<string, unknown>;
    expect(body).toEqual({
      address: ENVELOPE.address,
      sig: ENVELOPE.sig,
      data: {
        domain: { name: 'snapshot', version: '0.1.4' },
        types: TYPED.types,
        message: TYPED.message,
      },
    });
    // The wire body carries no `primaryType`.
    expect('primaryType' in (body.data as Record<string, unknown>)).toBe(false);
  });

  it('surfaces a non-2xx sequencer rejection with its message', async () => {
    const { fetch } = fakeFetch(
      { error: { message: 'invalid signature' } },
      { ok: false, status: 400 },
    );
    const client = createSnapshotSequencerClient({ fetch });

    const result = await client.submitVote(ENVELOPE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('400');
      expect(result.reason).toContain('invalid signature');
    }
  });

  it('treats a 2xx error body as a refusal', async () => {
    const { fetch } = fakeFetch({ error: 'duplicate vote' });
    const client = createSnapshotSequencerClient({ fetch });

    const result = await client.submitVote(ENVELOPE);
    expect(result).toEqual({
      ok: false,
      reason: 'The Snapshot sequencer rejected the vote: duplicate vote',
    });
  });

  it('surfaces an unreachable sequencer as a failure', async () => {
    const { fetch } = fakeFetch(null, { throwOnCall: true });
    const client = createSnapshotSequencerClient({ fetch });

    const result = await client.submitVote(ENVELOPE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('could not be reached');
  });
});
