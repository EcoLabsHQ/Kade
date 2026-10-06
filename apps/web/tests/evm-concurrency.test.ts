import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EVM_READ_CONCURRENCY,
  readEvmChainBalances,
  type EvmReadChain,
} from '@/lib/wealth/evm';

/**
 * The independent per-chain reads overlap instead of running one after another.
 *
 * `readEvmChainBalances` used to await the one ETH/USD price and then read each
 * chain in series, so a navigation paid the sum of every chain's latency. The
 * chains and the price are independent, so they now run with a small concurrency
 * bound (`EVM_READ_CONCURRENCY`) that keeps the provider from being hammered.
 *
 * These tests record when each read is in flight and fail unless they overlap. A
 * serial implementation cannot have two chains in flight at once, nor the price
 * in flight with a chain, so the assertions are the negative control for the old
 * serial code.
 */

const ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';

const inFlight = new Set<string>();
const moments: string[][] = [];

beforeEach(() => {
  inFlight.clear();
  moments.length = 0;
});

function enter(tag: string): void {
  inFlight.add(tag);
  moments.push([...inFlight]);
}

function leave(tag: string): void {
  inFlight.delete(tag);
}

/** Resolve after a macrotask, so a concurrent read can enter while it is open. */
function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function maxConcurrent(prefix: string): number {
  return moments.reduce(
    (max, moment) =>
      Math.max(max, moment.filter((tag) => tag.startsWith(prefix)).length),
    0,
  );
}

function overlaps(...tags: readonly string[]): boolean {
  return moments.some((moment) => tags.every((tag) => moment.includes(tag)));
}

interface FakeInit {
  readonly ok?: boolean;
  readonly status?: number;
}

function jsonResponse(body: unknown, init: FakeInit = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    async json() {
      return body;
    },
  } as unknown as Response;
}

function rpcResult(result: string): Response {
  return jsonResponse({ jsonrpc: '2.0', id: 1, result });
}

/** A chain whose own RPC is the read source, so every read is observable. */
function chain(chainId: number): EvmReadChain {
  return {
    chainId,
    name: `Chain ${chainId}`,
    symbol: 'ETH',
    baseUrl: `https://provider.test/${chainId}`,
    usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    rpcUrl: `https://rpc.test/${chainId}`,
  };
}

function methodOf(init: RequestInit | undefined): string | null {
  if (typeof init?.body !== 'string') return null;
  try {
    return (JSON.parse(init.body) as { method?: string }).method ?? null;
  } catch {
    return null;
  }
}

/** A fetch that records each read's in-flight window, tagged by kind. */
function trackingFetch(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = methodOf(init);
    let tag: string;
    if (url.includes('/api/v2/stats')) {
      tag = 'price';
    } else if (method === 'eth_call') {
      tag = `usdc:${url}`;
    } else {
      tag = `native:${url}`;
    }

    enter(tag);
    await settle();
    leave(tag);

    if (tag === 'price') return jsonResponse({ coin_price: '2500' });
    if (method === 'eth_getBalance') return rpcResult('0x0');
    if (method === 'eth_call') return rpcResult('0x0');
    return jsonResponse({}, { ok: false, status: 404 });
  }) as unknown as typeof fetch;
}

describe('readEvmChainBalances overlaps the independent reads', () => {
  it('has the ETH price and the chain reads in flight together', async () => {
    await readEvmChainBalances(ADDRESS, {
      chains: [chain(1), chain(8453), chain(42161)],
      fetchImpl: trackingFetch(),
    });

    // The price used to be awaited before the loop; now it overlaps the chains.
    expect(overlaps('price', 'native:https://rpc.test/1')).toBe(true);
    // And at least two chains are read at the same time.
    expect(maxConcurrent('native:')).toBeGreaterThanOrEqual(2);
  });

  it('keeps the number of chains in flight under the bound', async () => {
    const chains = [chain(1), chain(2), chain(3), chain(4), chain(5)];

    await readEvmChainBalances(ADDRESS, {
      chains,
      fetchImpl: trackingFetch(),
    });

    // Overlapping, but bounded: never more than the configured limit.
    expect(maxConcurrent('native:')).toBeGreaterThanOrEqual(2);
    expect(maxConcurrent('native:')).toBeLessThanOrEqual(EVM_READ_CONCURRENCY);
  });

  it('returns the chain outcomes in input order despite the overlap', async () => {
    const reads = await readEvmChainBalances(ADDRESS, {
      chains: [chain(1), chain(8453), chain(42161)],
      fetchImpl: trackingFetch(),
    });

    expect(reads.map((read) => read.chain.chainId)).toEqual([1, 8453, 42161]);
  });
});
