import { describe, expect, it, vi } from 'vitest';
import {
  ETH_USD_PRICE_CACHE_SECONDS,
  readEvmChainBalances,
  type EvmReadChain,
} from '@/lib/wealth/evm';

/**
 * The ETH/USD price is a public market rate, not a balance, so it may be cached
 * server-side for a short, bounded window. `readEthUsdPrice` asks Next to reuse
 * the stats response for `ETH_USD_PRICE_CACHE_SECONDS` (60 s), which removes the
 * price round-trip from repeated navigations without ever showing a stale
 * balance: the native amount itself is always the fresh on-chain read.
 *
 * These tests pin the three properties that make the cache safe:
 *
 *   1. it is **bounded** — the window is a small positive number, not `false`
 *      and not unbounded;
 *   2. it **does not leak across users** — the cache key is the stats URL alone,
 *      with no address or profile in it, and it is identical for two different
 *      residents; and
 *   3. a **failed** price read is never a fabricated rate: the native amount is
 *      still returned and the USD figure stays `null`, and a later successful
 *      read values it (a failure is not remembered).
 *
 * The fetch is injected, so no network is touched; the injected call still
 * carries the `next.revalidate` directive the production read applies.
 */

const ADDRESS_ONE = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const ADDRESS_TWO = '0x3e8cD8C29a32912f7E6e659c6f8645e4f178A9bb';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const ONE_ETH_WEI = '1000000000000000000'; // 1 ETH in wei (decimal, as the provider reports)
const REAL_BALANCE_FORMATTED = '1.000000000000000000';

const CHAIN: EvmReadChain = {
  chainId: 1,
  name: 'Ethereum',
  symbol: 'ETH',
  baseUrl: 'https://price.test',
  usdcAddress: USDC,
};

interface Call {
  readonly url: string;
  readonly init?: RequestInit & { next?: { revalidate?: number } };
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    async json() {
      return body;
    },
  } as unknown as Response;
}

/** A fake fetch that records each call and routes by URL. */
function harness(statsResponse: () => Response) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: Call['init']) => {
      const call: Call = { url: String(input), init };
      calls.push(call);
      if (call.url.includes('/api/v2/stats')) return statsResponse();
      if (call.url.includes('/api/v2/addresses/')) {
        return jsonResponse({ coin_balance: ONE_ETH_WEI });
      }
      if (call.url.includes('action=tokenbalance')) {
        return jsonResponse({ status: '1', message: 'OK', result: '0' });
      }
      return jsonResponse({}, { ok: false, status: 404 });
    },
  ) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function statsCalls(calls: readonly Call[]): Call[] {
  return calls.filter((call) => call.url.includes('/api/v2/stats'));
}

describe('the ETH/USD price cache is bounded', () => {
  it('is a small positive window, not unbounded', () => {
    expect(Number.isInteger(ETH_USD_PRICE_CACHE_SECONDS)).toBe(true);
    expect(ETH_USD_PRICE_CACHE_SECONDS).toBeGreaterThan(0);
    // Bounded well below a day; the current policy is ~60 s.
    expect(ETH_USD_PRICE_CACHE_SECONDS).toBeLessThanOrEqual(3600);
    expect(ETH_USD_PRICE_CACHE_SECONDS).toBe(60);
  });

  it('asks Next to reuse the stats response for that window', async () => {
    const { fetchImpl, calls } = harness(() => jsonResponse({ coin_price: '2500' }));

    await readEvmChainBalances(ADDRESS_ONE, { chains: [CHAIN], fetchImpl });

    const [stats] = statsCalls(calls);
    expect(stats).toBeDefined();
    expect(stats?.init?.next).toEqual({
      revalidate: ETH_USD_PRICE_CACHE_SECONDS,
    });
  });

  it('reads the one price once, not once per chain', async () => {
    const second: EvmReadChain = { ...CHAIN, chainId: 8453, name: 'Base' };
    const { fetchImpl, calls } = harness(() => jsonResponse({ coin_price: '2500' }));

    await readEvmChainBalances(ADDRESS_ONE, {
      chains: [CHAIN, second],
      fetchImpl,
    });

    expect(statsCalls(calls)).toHaveLength(1);
  });
});

describe('the price cache key carries no user data', () => {
  it('uses the same stats URL for two different residents', async () => {
    const first = harness(() => jsonResponse({ coin_price: '2500' }));
    const second = harness(() => jsonResponse({ coin_price: '2500' }));

    await readEvmChainBalances(ADDRESS_ONE, {
      chains: [CHAIN],
      fetchImpl: first.fetchImpl,
    });
    await readEvmChainBalances(ADDRESS_TWO, {
      chains: [CHAIN],
      fetchImpl: second.fetchImpl,
    });

    const urlOne = statsCalls(first.calls)[0]?.url;
    const urlTwo = statsCalls(second.calls)[0]?.url;
    expect(urlOne).toBe('https://price.test/api/v2/stats');
    // Identical key: a shared public price, never one resident's read.
    expect(urlTwo).toBe(urlOne);
    expect(urlOne).not.toContain(ADDRESS_ONE);
    expect(urlOne).not.toContain(ADDRESS_TWO);
  });
});

describe('a failed price read is unknown, never a fabricated rate', () => {
  it('keeps the real native amount and leaves USD null on a non-200 price', async () => {
    const { fetchImpl } = harness(() => jsonResponse({}, { ok: false, status: 500 }));

    const reads = await readEvmChainBalances(ADDRESS_ONE, {
      chains: [CHAIN],
      fetchImpl,
    });
    const balance = reads[0]!.balance!;

    expect(reads[0]!.ok).toBe(true);
    expect(balance.nativeAmount).toBe(REAL_BALANCE_FORMATTED);
    expect(balance.nativeUsd).toBeNull();
    expect(balance.nativeUsd).not.toBe(0);
  });

  it('does not remember the failure: a later successful read values the native amount', async () => {
    // First navigation: the price endpoint is down.
    const down = harness(() => jsonResponse({}, { ok: false, status: 500 }));
    const firstRead = await readEvmChainBalances(ADDRESS_ONE, {
      chains: [CHAIN],
      fetchImpl: down.fetchImpl,
    });
    expect(firstRead[0]!.balance?.nativeUsd).toBeNull();

    // A later navigation: the endpoint recovers and the price is applied. A
    // cached failure would have masked this success.
    const up = harness(() => jsonResponse({ coin_price: '2000' }));
    const secondRead = await readEvmChainBalances(ADDRESS_ONE, {
      chains: [CHAIN],
      fetchImpl: up.fetchImpl,
    });
    expect(secondRead[0]!.balance?.nativeUsd).toBe(2000);
  });
});
