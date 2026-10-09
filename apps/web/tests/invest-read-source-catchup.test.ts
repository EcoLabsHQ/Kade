import { describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import {
  READ_SOURCE_CATCHUP_DELAYS_MS,
  waitForReadSourceToSeeTransaction,
} from '@/lib/invest/read-source-catchup';

/**
 * The Invest refresh's real defect: the confirmation comes from the bundler,
 * while the position the screen re-reads comes from the chain's own
 * (load-balanced) RPC, which can still be a block behind. Revalidating
 * immediately therefore re-renders the pre-deposit position. This helper is the
 * fix's mechanism: it polls the **read source** until it can serve the
 * confirmed transaction, and only then does the caller revalidate.
 *
 * The schedule and the seams are injected, so every branch runs with no network
 * and no real timer.
 */

const TX = `0x${'ab'.repeat(32)}` as Hex;

/** A `fetch`-shaped response carrying a JSON-RPC result body. */
function jsonResponse(result: unknown, ok = true): Response {
  return {
    ok,
    json: async () => ({ result }),
  } as unknown as Response;
}

/** A `fetch`-shaped response carrying a JSON-RPC error body. */
function errorResponse(): Response {
  return {
    ok: true,
    json: async () => ({ error: { code: -32000, message: 'not found' } }),
  } as unknown as Response;
}

/** A reader whose answers are scripted in order, repeating the last one. */
function scriptedFetch(answers: readonly (() => Response)[]) {
  let index = 0;
  return vi.fn(async () => {
    const answer = answers[Math.min(index, answers.length - 1)] as () => Response;
    index += 1;
    return answer();
  });
}

/** A sleep seam that records the delays it was asked to wait. */
function makeSleep() {
  const slept: number[] = [];
  const sleep = vi.fn(async (ms: number) => {
    slept.push(ms);
  });
  return { sleep, slept };
}

describe('waitForReadSourceToSeeTransaction', () => {
  it('returns "seen" without sleeping when the read source already serves the transaction', async () => {
    const fetchImpl = scriptedFetch([() => jsonResponse({ blockNumber: '0x10' })]);
    const { sleep } = makeSleep();

    const outcome = await waitForReadSourceToSeeTransaction(
      { chainId: 1, transactionHash: TX },
      { fetchImpl: fetchImpl as unknown as typeof fetch, sleep, rpcUrl: 'https://read.example' },
    );

    expect(outcome).toBe('seen');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    // The poll targets exactly the chain's read endpoint and the confirmed hash.
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://read.example');
    expect(JSON.parse(String(init.body))).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getTransactionReceipt',
      params: [TX],
    });
  });

  it('keeps polling until a lagging read source serves the transaction', async () => {
    const fetchImpl = scriptedFetch([
      () => jsonResponse(null),
      () => jsonResponse(null),
      () => jsonResponse({ blockNumber: '0x10' }),
    ]);
    const { sleep, slept } = makeSleep();

    const outcome = await waitForReadSourceToSeeTransaction(
      { chainId: 1, transactionHash: TX },
      { fetchImpl: fetchImpl as unknown as typeof fetch, sleep, rpcUrl: 'https://read.example' },
    );

    expect(outcome).toBe('seen');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    // Two null answers, so two bounded sleeps: the first two delays.
    expect(slept).toEqual([
      READ_SOURCE_CATCHUP_DELAYS_MS[0],
      READ_SOURCE_CATCHUP_DELAYS_MS[1],
    ]);
  });

  it('reports "not-seen" after the bounded schedule rather than waiting forever', async () => {
    const fetchImpl = scriptedFetch([() => jsonResponse(null)]);
    const { sleep } = makeSleep();

    const outcome = await waitForReadSourceToSeeTransaction(
      { chainId: 1, transactionHash: TX },
      { fetchImpl: fetchImpl as unknown as typeof fetch, sleep, rpcUrl: 'https://read.example' },
    );

    expect(outcome).toBe('not-seen');
    // One immediate poll plus one per delay.
    expect(fetchImpl).toHaveBeenCalledTimes(READ_SOURCE_CATCHUP_DELAYS_MS.length + 1);
    expect(sleep).toHaveBeenCalledTimes(READ_SOURCE_CATCHUP_DELAYS_MS.length);
  });

  it('treats a failed poll as "not yet" and can still observe a later success', async () => {
    const fetchImpl = scriptedFetch([
      () => jsonResponse(null, false),
      () => errorResponse(),
      () => jsonResponse({ blockNumber: '0x10' }),
    ]);
    const { sleep } = makeSleep();

    const outcome = await waitForReadSourceToSeeTransaction(
      { chainId: 1, transactionHash: TX },
      { fetchImpl: fetchImpl as unknown as typeof fetch, sleep, rpcUrl: 'https://read.example' },
    );

    expect(outcome).toBe('seen');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('is "unavailable" with no transaction hash, and never polls', async () => {
    const fetchImpl = vi.fn();

    const outcome = await waitForReadSourceToSeeTransaction(
      { chainId: 1, transactionHash: null },
      { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: vi.fn(), rpcUrl: 'https://read.example' },
    );

    expect(outcome).toBe('unavailable');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('is "unavailable" with no read endpoint, and never polls', async () => {
    const fetchImpl = vi.fn();

    const outcome = await waitForReadSourceToSeeTransaction(
      { chainId: 1, transactionHash: TX },
      { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: vi.fn(), rpcUrl: null },
    );

    expect(outcome).toBe('unavailable');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
