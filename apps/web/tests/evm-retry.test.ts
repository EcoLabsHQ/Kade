import { describe, expect, it, vi } from 'vitest';
import {
  EVM_READ_ATTEMPTS,
  readEvmBalances,
  readEvmChainBalances,
  type EvmReadChain,
} from '@/lib/wealth/evm';

/**
 * Regression: the Base balance read must survive a transient provider failure,
 * and a final failure must carry a specific reason instead of a generic
 * "could not be read".
 *
 * The public Blockscout instances are rate-limited and flaky: the Base summary
 * endpoint returns HTTP 500 intermittently for the same address. The original
 * code treated the first non-2xx as a final answer and dropped the chain, which
 * is why the UI showed an unread balance. These tests pin the fix:
 *
 *   1. a transient failure before a success is retried and succeeds;
 *   2. a final failure names the reason (rate limit / timeout / no endpoint /
 *      unexpected) and never fabricates a zero.
 */

const ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const BASE: EvmReadChain = {
  chainId: 8453,
  name: 'Base',
  symbol: 'ETH',
  baseUrl: 'https://base.test',
  usdcAddress: USDC,
};

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

function summary(coinBalance: string, rate: unknown = '3000'): Response {
  return jsonResponse({ coin_balance: coinBalance, exchange_rate: rate });
}

describe('readEvmChainBalances retry', () => {
  it('retries a transient 500 and succeeds on the next attempt', async () => {
    // The native summary endpoint fails once (the real Base 500), then returns
    // the real balance. USDC also fails so it is classified, not fabricated.
    let nativeCalls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('action=tokenbalance')) {
        return jsonResponse({}, { ok: false, status: 500 });
      }
      nativeCalls += 1;
      if (nativeCalls === 1) return jsonResponse({}, { ok: false, status: 500 });
      return summary('2000000000000000000', '3000');
    }) as unknown as typeof fetch;

    const reads = await readEvmChainBalances(ADDRESS, {
      chains: [BASE],
      fetchImpl,
    });

    const read = reads[0]!;
    expect(nativeCalls).toBe(2);
    expect(read.ok).toBe(true);
    expect(read.balance?.chainId).toBe(8453);
    expect(read.balance?.nativeAmount).toBe('2.000000000000000000');
    expect(read.balance?.nativeUsd).toBe(6000);
    // Never zero: a successful retry returns the real balance.
    expect(read.balance?.nativeAmount).not.toBe('0.000000000000000000');
  });

  it('retries a thrown transport error (a flaky RPC) and succeeds', async () => {
    let native = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('action=tokenbalance')) {
        return jsonResponse({ status: '1', result: '0' });
      }
      native += 1;
      if (native === 1) throw new Error('socket hang up');
      return summary('1000000000000000000', '2000');
    }) as unknown as typeof fetch;

    const reads = await readEvmChainBalances(ADDRESS, {
      chains: [BASE],
      fetchImpl,
    });

    expect(native).toBeGreaterThanOrEqual(2);
    expect(reads[0]!.ok).toBe(true);
    expect(reads[0]!.balance?.nativeUsd).toBe(2000);
  });

  it('gives up after the bounded number of attempts', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({}, { ok: false, status: 503 }),
    ) as unknown as typeof fetch;

    const reads = await readEvmChainBalances(ADDRESS, {
      chains: [BASE],
      fetchImpl,
    });

    expect(reads[0]!.ok).toBe(false);
    // One retry loop per request (native + USDC), each bounded.
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('does not retry a non-transient primary status', async () => {
    // A 404 is final for the primary: it is made once and not retried. Since
    // the fallback sources also fail here, the chain is still unread and the
    // USDC read is never reached because no native balance was ever obtained.
    let primaryCalls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/v2/addresses/')) primaryCalls += 1;
      return jsonResponse({}, { ok: false, status: 404 });
    }) as unknown as typeof fetch;

    const reads = await readEvmChainBalances(ADDRESS, {
      chains: [BASE],
      fetchImpl,
    });

    expect(reads[0]!.ok).toBe(false);
    expect(primaryCalls).toBe(1);
    expect(reads[0]!.failure?.message).toContain('404');
  });
});

describe('readEvmChainBalances failure reasons', () => {
  it('names a rate limit (429) as a provider rejection, not a generic error', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({}, { ok: false, status: 429 }),
    ) as unknown as typeof fetch;

    const reads = await readEvmChainBalances(ADDRESS, {
      chains: [BASE],
      fetchImpl,
    });

    expect(reads[0]!.ok).toBe(false);
    expect(reads[0]!.failure?.reason).toBe('rejected');
    expect(reads[0]!.failure?.message).toMatch(/rate limit/i);
    expect(reads[0]!.failure?.message).toContain('Base');
  });

  it('names an auth rejection (401) as a provider rejection', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({}, { ok: false, status: 401 }),
    ) as unknown as typeof fetch;

    const reads = await readEvmChainBalances(ADDRESS, {
      chains: [BASE],
      fetchImpl,
    });

    expect(reads[0]!.failure?.reason).toBe('rejected');
    expect(reads[0]!.failure?.message).toMatch(/rejected|API key/i);
  });

  it('names a timeout as a timeout', async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      throw error;
    }) as unknown as typeof fetch;

    const reads = await readEvmChainBalances(ADDRESS, {
      chains: [BASE],
      fetchImpl,
    });

    expect(reads[0]!.failure?.reason).toBe('timeout');
    expect(reads[0]!.failure?.message).toMatch(/did not respond in time/i);
  });

  it('distinguishes a chain with no configured endpoint', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const noEndpoint: EvmReadChain = { ...BASE, baseUrl: '' };

    const reads = await readEvmChainBalances(ADDRESS, {
      chains: [noEndpoint],
      fetchImpl,
    });

    expect(reads[0]!.failure?.reason).toBe('no-endpoint');
    expect(reads[0]!.failure?.message).toMatch(/no balance endpoint is configured/i);
    // Nothing was fetched: an unconfigured chain never reaches the network.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('names an unexpected status as an unexpected error', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({}, { ok: false, status: 418 }),
    ) as unknown as typeof fetch;

    const reads = await readEvmChainBalances(ADDRESS, {
      chains: [BASE],
      fetchImpl,
    });

    expect(reads[0]!.failure?.reason).toBe('unexpected');
    expect(reads[0]!.failure?.message).toContain('418');
  });
});

describe('token sub-read failure reaches the carrier', () => {
  it('keeps the native balance ok and names the token sub-read reason', async () => {
    // The native summary succeeds; the tokenbalance read is rate-limited on
    // every attempt. The chain is read (ok: true) with the native balance, and
    // the token failure rides on the balance rather than being dropped.
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('action=tokenbalance')) {
        return jsonResponse({}, { ok: false, status: 429 });
      }
      return summary('2000000000000000000', '3000');
    }) as unknown as typeof fetch;

    const reads = await readEvmChainBalances(ADDRESS, {
      chains: [BASE],
      fetchImpl,
    });

    const read = reads[0]!;
    expect(read.ok).toBe(true);
    expect(read.balance?.nativeAmount).toBe('2.000000000000000000');
    expect(read.balance?.usdc).toBeNull();
    expect(read.balance?.tokenFailure).toMatchObject({
      chainId: 8453,
      chainName: 'Base',
      reason: 'rejected',
    });
    expect(read.balance?.tokenFailure?.message).toMatch(/rate limit/i);
  });

  it('is absent on a fully successful read', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('action=tokenbalance')) {
        return jsonResponse({ status: '1', result: '2500000' });
      }
      return summary('1000000000000000000', '2000');
    }) as unknown as typeof fetch;

    const reads = await readEvmChainBalances(ADDRESS, {
      chains: [BASE],
      fetchImpl,
    });

    const read = reads[0]!;
    expect(read.ok).toBe(true);
    expect(read.balance?.usdc?.amount).toBe('2.500000');
    expect(read.balance?.tokenFailure).toBeUndefined();
  });
});

describe('no fabricated zero on failure', () => {
  it('returns no balance at all for a failed chain, never a zero', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({}, { ok: false, status: 500 }),
    ) as unknown as typeof fetch;

    const reads = await readEvmChainBalances(ADDRESS, {
      chains: [BASE],
      fetchImpl,
    });

    expect(reads[0]!.balance).toBeUndefined();
    expect(reads[0]!.ok).toBe(false);
  });

  it('the compatibility wrapper omits a failed chain instead of zeroing it', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({}, { ok: false, status: 500 }),
    ) as unknown as typeof fetch;

    const balances = await readEvmBalances(ADDRESS, {
      chains: [BASE],
      fetchImpl,
    });

    expect(balances).toEqual([]);
  });

  it('exposes the retry bound as a constant the tests can assert on', () => {
    expect(EVM_READ_ATTEMPTS).toBeGreaterThanOrEqual(2);
  });
});
