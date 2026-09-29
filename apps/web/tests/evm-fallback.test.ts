import { describe, expect, it, vi } from 'vitest';
import {
  readEvmChainBalances,
  type EvmReadChain,
} from '@/lib/wealth/evm';

/**
 * Regression: a Base balance is readable while the primary endpoint is dead.
 *
 * `GET /api/v2/addresses/{address}` was returning HTTP 500 for every request on
 * Base, so the app reported the chain as unread even though the same provider's
 * Etherscan-compatible module API (`action=balance`) served the real balance, as
 * did the chain's own RPC. These tests pin the fallback chain and its rules:
 *
 *   1. primary 5xx  → the real balance from the module API, not an unread chain;
 *   2. both provider endpoints dead → the authoritative `eth_getBalance`;
 *   3. every source fails → unread with a specific reason, never a `0`;
 *   4. a fallback balance has no price → the amount is kept and USD is unknown;
 *   5. a provider-declared failure (`status: "0"`) is never read as a zero.
 *
 * All offline: the provider and the RPC are injected fakes and no endpoint is
 * resolved from the ambient environment.
 */

const ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const RPC_URL = 'https://base-rpc.test';

/** The measured real Base balance from the reported defect. */
const REAL_BALANCE_WEI = '854991001320761';
const REAL_BALANCE_FORMATTED = '0.000854991001320761';

const BASE: EvmReadChain = {
  chainId: 8453,
  name: 'Base',
  symbol: 'ETH',
  baseUrl: 'https://base.blockscout.test',
  usdcAddress: USDC,
  // Pinned so no ambient `BASE_RPC_URL` is ever consulted in these tests.
  rpcUrl: RPC_URL,
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

/** The provider's `/api/v2/addresses/{address}` summary body. */
function summary(coinBalance: string, rate: unknown): Response {
  return jsonResponse({ coin_balance: coinBalance, exchange_rate: rate });
}

/** The module API's Etherscan-compatible balance body. */
function moduleBalance(result: string): Response {
  return jsonResponse({ status: '1', message: 'OK', result });
}

/** The module API's token-balance body for USDC. */
function tokenBalance(result: string): Response {
  return jsonResponse({ status: '1', message: 'OK', result });
}

interface Harness {
  readonly fetchImpl: typeof fetch;
  readonly calls: readonly string[];
  readonly rpcInits: readonly (RequestInit | undefined)[];
}

/** A fake fetch that records every URL (and the RPC request init). */
function harness(route: (url: string, init?: RequestInit) => Response): Harness {
  const calls: string[] = [];
  const rpcInits: (RequestInit | undefined)[] = [];
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url === RPC_URL) rpcInits.push(init);
      return route(url, init);
    },
  ) as unknown as typeof fetch;
  return { fetchImpl, calls, rpcInits };
}

describe('EVM native balance fallback', () => {
  it('reads the real balance from the module API when the primary 500s', async () => {
    const h = harness((url) => {
      if (url.includes('/api/v2/addresses/')) {
        return jsonResponse({}, { ok: false, status: 500 });
      }
      if (url.includes('action=balance')) return moduleBalance(REAL_BALANCE_WEI);
      if (url.includes('action=tokenbalance')) return tokenBalance('183500000');
      throw new Error(`unrouted URL: ${url}`);
    });

    const reads = await readEvmChainBalances(ADDRESS, {
      chains: [BASE],
      fetchImpl: h.fetchImpl,
    });
    const read = reads[0]!;

    // The defect was a false negative: the chain must read, with the real
    // balance rather than an unread row.
    expect(read.ok).toBe(true);
    expect(read.balance?.nativeAmount).toBe(REAL_BALANCE_FORMATTED);
    // The balance came from the fallback, which carries no price.
    expect(read.balance?.nativeUsd).toBeNull();
    // The USDC read is unaffected and still valued.
    expect(read.balance?.usdc?.amount).toBe('183.500000');
    // The fallback answered, so the RPC was never needed.
    expect(h.calls.some((url) => url === RPC_URL)).toBe(false);
    expect(h.calls.some((url) => url.includes('action=balance'))).toBe(true);
  });

  it('does not consult a fallback when the primary answers', async () => {
    const h = harness((url) => {
      if (url.includes('/api/v2/addresses/')) return summary('1000000000000000000', '2000');
      if (url.includes('action=tokenbalance')) return tokenBalance('0');
      throw new Error(`unrouted URL: ${url}`);
    });

    const reads = await readEvmChainBalances(ADDRESS, {
      chains: [BASE],
      fetchImpl: h.fetchImpl,
    });

    expect(reads[0]!.ok).toBe(true);
    expect(reads[0]!.balance?.nativeUsd).toBe(2000);
    expect(h.calls.some((url) => url.includes('action=balance'))).toBe(false);
    expect(h.calls.some((url) => url === RPC_URL)).toBe(false);
  });

  it('falls back to the chain RPC when both provider endpoints fail', async () => {
    const oneEtherHex = `0x${(10n ** 18n).toString(16)}`;
    const h = harness((url) => {
      if (url === RPC_URL) {
        return jsonResponse({ jsonrpc: '2.0', id: 1, result: oneEtherHex });
      }
      if (url.includes('/api/v2/addresses/')) {
        return jsonResponse({}, { ok: false, status: 500 });
      }
      if (url.includes('action=balance')) {
        return jsonResponse({}, { ok: false, status: 500 });
      }
      if (url.includes('action=tokenbalance')) return tokenBalance('0');
      throw new Error(`unrouted URL: ${url}`);
    });

    const reads = await readEvmChainBalances(ADDRESS, {
      chains: [BASE],
      fetchImpl: h.fetchImpl,
    });
    const read = reads[0]!;

    expect(read.ok).toBe(true);
    expect(read.balance?.nativeAmount).toBe('1.000000000000000000');
    expect(read.balance?.nativeUsd).toBeNull();
    // `eth_getBalance` is sent as a JSON-RPC POST to the chain's endpoint.
    expect(h.rpcInits[0]?.method).toBe('POST');
    expect(JSON.parse(String(h.rpcInits[0]?.body))).toMatchObject({
      method: 'eth_getBalance',
      params: [ADDRESS, 'latest'],
    });
  });

  it('resolves the RPC endpoint from the shared per-chain variable', async () => {
    vi.stubEnv('BASE_RPC_URL', RPC_URL);
    try {
      const h = harness((url) => {
        if (url === RPC_URL) return jsonResponse({ result: '0x1' });
        if (url.includes('/api/v2/addresses/')) {
          return jsonResponse({}, { ok: false, status: 500 });
        }
        if (url.includes('action=balance')) {
          return jsonResponse({}, { ok: false, status: 500 });
        }
        if (url.includes('action=tokenbalance')) return tokenBalance('0');
        throw new Error(`unrouted URL: ${url}`);
      });
      const baseWithoutInjectedRpc: EvmReadChain = { ...BASE, rpcUrl: undefined };

      const reads = await readEvmChainBalances(ADDRESS, {
        chains: [baseWithoutInjectedRpc],
        fetchImpl: h.fetchImpl,
      });

      expect(reads[0]!.ok).toBe(true);
      expect(reads[0]!.balance?.nativeAmount).toBe('0.000000000000000001');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('fails closed with a specific reason and never a zero when every source fails', async () => {
    const h = harness((url) => {
      if (url === RPC_URL) return jsonResponse({}, { ok: false, status: 500 });
      if (url.includes('/api/v2/addresses/')) {
        return jsonResponse({}, { ok: false, status: 500 });
      }
      if (url.includes('action=balance')) {
        return jsonResponse({}, { ok: false, status: 500 });
      }
      throw new Error(`unrouted URL: ${url}`);
    });

    const reads = await readEvmChainBalances(ADDRESS, {
      chains: [BASE],
      fetchImpl: h.fetchImpl,
    });
    const read = reads[0]!;

    expect(read.ok).toBe(false);
    expect(read.balance).toBeUndefined();
    expect(read.failure?.chainId).toBe(8453);
    expect(read.failure?.chainName).toBe('Base');
    expect(read.failure?.reason).toBe('unexpected');
    expect(read.failure?.message).toContain('500');
    // No fabricated zero anywhere in the outcome.
    expect(JSON.stringify(read)).not.toContain('0.000000000000000000');
  });

  it('keeps a fallback balance and leaves USD unknown when the price is unavailable', async () => {
    const h = harness((url) => {
      if (url.includes('/api/v2/addresses/')) {
        return jsonResponse({}, { ok: false, status: 500 });
      }
      if (url.includes('action=balance')) return moduleBalance(REAL_BALANCE_WEI);
      if (url.includes('action=tokenbalance')) {
        return jsonResponse({}, { ok: false, status: 500 });
      }
      throw new Error(`unrouted URL: ${url}`);
    });

    const reads = await readEvmChainBalances(ADDRESS, {
      chains: [BASE],
      fetchImpl: h.fetchImpl,
    });
    const read = reads[0]!;

    // Known balance + unknown price stays a readable row with an unknown USD,
    // rather than becoming unread or inventing a rate.
    expect(read.ok).toBe(true);
    expect(read.balance?.nativeAmount).toBe(REAL_BALANCE_FORMATTED);
    expect(read.balance?.nativeUsd).toBeNull();
    expect(read.balance?.usd).toBeNull();
    // The token sub-read's failure still rides along, unchanged.
    expect(read.balance?.tokenFailure).toBeDefined();
  });

  it('does not read a module-API status "0" as a zero balance', async () => {
    const h = harness((url) => {
      if (url === RPC_URL) return jsonResponse({}, { ok: false, status: 500 });
      if (url.includes('/api/v2/addresses/')) {
        return jsonResponse({}, { ok: false, status: 500 });
      }
      if (url.includes('action=balance')) {
        return jsonResponse({ status: '0', message: 'NOTOK', result: '0' });
      }
      throw new Error(`unrouted URL: ${url}`);
    });

    const reads = await readEvmChainBalances(ADDRESS, {
      chains: [BASE],
      fetchImpl: h.fetchImpl,
    });

    expect(reads[0]!.ok).toBe(false);
    expect(reads[0]!.balance).toBeUndefined();
  });
});
