import { describe, expect, it, vi } from 'vitest';
import {
  readEvmChainBalances,
  type EvmReadChain,
} from '@/lib/wealth/evm';

/**
 * Regression: the balances must survive the provider, and the ETH price must be
 * read once for every chain.
 *
 * The owner's design makes the chain's own RPC the primary balance source
 * (`eth_getBalance` and USDC `balanceOf`), keeps the Blockscout endpoints only
 * as a fallback for a chain with no RPC variable, and reads a **single** ETH/USD
 * price used for every chain. The Base summary endpoint that was returning HTTP
 * 500 for every request therefore can no longer leave a Base balance unread.
 *
 * These tests pin, offline:
 *
 *   1. the RPC is consulted first and the provider only when it cannot answer;
 *   2. one ETH/USD price is fetched and applied to more than one chain;
 *   3. a missing price leaves USD null without failing the read;
 *   4. USDC stays 1:1 with USD and triggers no price lookup;
 *   5. every source failing is unread with a specific reason, never a zero.
 */

const ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const ETH_RPC = 'https://eth-rpc.test';
const BASE_RPC = 'https://base-rpc.test';

/** The measured real Base balance from the reported defect. */
const REAL_BALANCE_WEI = '854991001320761';
const REAL_BALANCE_FORMATTED = '0.000854991001320761';

/** 183.5 USDC in its 6-decimal raw form. */
const USDC_RAW = '183500000';
const USDC_FORMATTED = '183.500000';

const ETH: EvmReadChain = {
  chainId: 1,
  name: 'Ethereum',
  symbol: 'ETH',
  baseUrl: 'https://eth.blockscout.test',
  usdcAddress: USDC,
  rpcUrl: ETH_RPC,
};

const BASE: EvmReadChain = {
  chainId: 8453,
  name: 'Base',
  symbol: 'ETH',
  baseUrl: 'https://base.blockscout.test',
  usdcAddress: USDC,
  rpcUrl: BASE_RPC,
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

function hexQuantity(value: string): string {
  return `0x${BigInt(value).toString(16)}`;
}

/** A JSON-RPC success body. */
function rpcResult(result: string): Response {
  return jsonResponse({ jsonrpc: '2.0', id: 1, result });
}

interface Call {
  readonly url: string;
  readonly init?: RequestInit;
}

interface Harness {
  readonly fetchImpl: typeof fetch;
  readonly calls: readonly Call[];
}

/** A fake fetch that records every call, so the source order is observable. */
function harness(route: (call: Call) => Response): Harness {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const call: Call = { url: String(input), init };
      calls.push(call);
      return route(call);
    },
  ) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

/** The JSON-RPC method of a POST call, or null for a plain GET. */
function rpcMethod(call: Call): string | null {
  if (typeof call.init?.body !== 'string') return null;
  try {
    return (JSON.parse(call.init.body) as { method?: string }).method ?? null;
  } catch {
    return null;
  }
}

function countCalls(calls: readonly Call[], needle: string): number {
  return calls.filter((call) => call.url.includes(needle)).length;
}

describe('EVM chain RPC is the primary balance source', () => {
  it('reads the native balance and USDC from the chain RPC, not the provider', async () => {
    const { fetchImpl, calls } = harness((call) => {
      const method = rpcMethod(call);
      if (call.url === ETH_RPC && method === 'eth_getBalance') {
        return rpcResult(hexQuantity(REAL_BALANCE_WEI));
      }
      if (call.url === ETH_RPC && method === 'eth_call') {
        return rpcResult(hexQuantity(USDC_RAW));
      }
      if (call.url.includes('/api/v2/stats')) {
        return jsonResponse({ coin_price: '2000' });
      }
      throw new Error(`the provider must not be consulted: ${call.url}`);
    });

    const reads = await readEvmChainBalances(ADDRESS, {
      chains: [ETH],
      fetchImpl,
    });
    const read = reads[0]!;

    expect(read.ok).toBe(true);
    expect(read.balance?.nativeAmount).toBe(REAL_BALANCE_FORMATTED);
    expect(read.balance?.nativeUsd).toBeCloseTo(
      Number(REAL_BALANCE_FORMATTED) * 2000,
    );
    expect(read.balance?.usdc).toEqual({
      symbol: 'USDC',
      amount: USDC_FORMATTED,
      usd: 183.5,
    });
    // The provider endpoints were never touched.
    expect(countCalls(calls, '/api/v2/addresses/')).toBe(0);
    expect(countCalls(calls, 'action=balance')).toBe(0);
    expect(countCalls(calls, 'action=tokenbalance')).toBe(0);
  });

  it('falls back to the provider only when the RPC cannot answer', async () => {
    const { fetchImpl, calls } = harness((call) => {
      const method = rpcMethod(call);
      if (call.url === ETH_RPC && method !== null) {
        // The RPC is down: both the native and the token call fail.
        return jsonResponse({}, { ok: false, status: 502 });
      }
      if (call.url.includes('/api/v2/stats')) {
        return jsonResponse({ coin_price: '2000' });
      }
      if (call.url.includes('/api/v2/addresses/')) {
        return jsonResponse({ coin_balance: REAL_BALANCE_WEI });
      }
      if (call.url.includes('action=tokenbalance')) {
        return jsonResponse({ status: '1', message: 'OK', result: USDC_RAW });
      }
      throw new Error(`unrouted URL: ${call.url}`);
    });

    const reads = await readEvmChainBalances(ADDRESS, {
      chains: [ETH],
      fetchImpl,
    });
    const read = reads[0]!;

    expect(read.ok).toBe(true);
    expect(read.balance?.nativeAmount).toBe(REAL_BALANCE_FORMATTED);
    expect(read.balance?.usdc?.amount).toBe(USDC_FORMATTED);
    // The RPC was tried first, and the provider was reached only afterwards.
    expect(countCalls(calls, ETH_RPC)).toBeGreaterThan(0);
    expect(countCalls(calls, '/api/v2/addresses/')).toBeGreaterThan(0);
  });
});

describe('one ETH/USD price for every chain', () => {
  it('fetches the price once and applies it to more than one chain', async () => {
    const { fetchImpl, calls } = harness((call) => {
      const method = rpcMethod(call);
      if (call.url === ETH_RPC && method === 'eth_getBalance') {
        return rpcResult(`0x${(10n ** 18n).toString(16)}`); // 1 ETH
      }
      if (call.url === BASE_RPC && method === 'eth_getBalance') {
        return rpcResult(`0x${(2n * 10n ** 18n).toString(16)}`); // 2 ETH
      }
      if (method === 'eth_call') return rpcResult('0x0'); // no USDC
      if (call.url.includes('/api/v2/stats')) {
        return jsonResponse({ coin_price: '2500' });
      }
      throw new Error(`unrouted URL: ${call.url}`);
    });

    const reads = await readEvmChainBalances(ADDRESS, {
      chains: [ETH, BASE],
      fetchImpl,
    });

    expect(reads.map((read) => read.balance?.nativeAmount)).toEqual([
      '1.000000000000000000',
      '2.000000000000000000',
    ]);
    // The same one price values both chains.
    expect(reads[0]!.balance?.nativeUsd).toBe(2500);
    expect(reads[1]!.balance?.nativeUsd).toBe(5000);
    // Fetched once, not once per chain.
    expect(countCalls(calls, '/api/v2/stats')).toBe(1);
  });
});

describe('a missing price never fails a balance read', () => {
  it('keeps the real balance and leaves USD unknown', async () => {
    const { fetchImpl } = harness((call) => {
      const method = rpcMethod(call);
      if (method === 'eth_getBalance') {
        return rpcResult(hexQuantity(REAL_BALANCE_WEI));
      }
      if (method === 'eth_call') return jsonResponse({}, { ok: false, status: 500 });
      if (call.url.includes('/api/v2/stats')) {
        return jsonResponse({}, { ok: false, status: 500 });
      }
      if (call.url.includes('/api/v2/addresses/')) {
        return jsonResponse({}, { ok: false, status: 500 });
      }
      if (call.url.includes('action=tokenbalance')) {
        return jsonResponse({}, { ok: false, status: 500 });
      }
      throw new Error(`unrouted URL: ${call.url}`);
    });

    const reads = await readEvmChainBalances(ADDRESS, {
      chains: [ETH],
      fetchImpl,
    });
    const read = reads[0]!;

    // Not unread: the real amount survives, only the USD value is unknown.
    expect(read.ok).toBe(true);
    expect(read.failure).toBeUndefined();
    expect(read.balance?.nativeAmount).toBe(REAL_BALANCE_FORMATTED);
    expect(read.balance?.nativeUsd).toBeNull();
    expect(read.balance?.usd).toBeNull();
    // The unread token still carries its specific reason.
    expect(read.balance?.tokenFailure).toBeDefined();
  });
});

describe('USDC stays 1:1 with USD', () => {
  it('values USDC from its amount and never looks up a price for it', async () => {
    const { fetchImpl, calls } = harness((call) => {
      const method = rpcMethod(call);
      if (method === 'eth_getBalance') return rpcResult('0x0');
      if (method === 'eth_call') return rpcResult(hexQuantity(USDC_RAW));
      // The one ETH price is deliberately unavailable: USDC must not care.
      if (call.url.includes('/api/v2/stats')) {
        return jsonResponse({}, { ok: false, status: 404 });
      }
      throw new Error(`unrouted URL: ${call.url}`);
    });

    const reads = await readEvmChainBalances(ADDRESS, {
      chains: [ETH],
      fetchImpl,
    });
    const read = reads[0]!;

    expect(read.ok).toBe(true);
    expect(read.balance?.nativeUsd).toBeNull(); // ETH price absent
    expect(read.balance?.usdc).toEqual({
      symbol: 'USDC',
      amount: USDC_FORMATTED,
      usd: 183.5,
    });
    expect(read.balance?.usd).toBe(183.5);
    // The only price call is the single ETH stats read; there is no per-token
    // price lookup.
    expect(countCalls(calls, '/api/v2/stats')).toBe(1);
  });
});

describe('no fabricated zero when every source fails', () => {
  it('reports the chain unread with a specific reason', async () => {
    const { fetchImpl } = harness((call) => {
      const method = rpcMethod(call);
      if (call.url === ETH_RPC && method !== null) {
        return jsonResponse({}, { ok: false, status: 500 });
      }
      if (call.url.includes('/api/v2/stats')) {
        return jsonResponse({}, { ok: false, status: 500 });
      }
      if (call.url.includes('/api/v2/addresses/')) {
        return jsonResponse({}, { ok: false, status: 500 });
      }
      if (call.url.includes('action=balance')) {
        return jsonResponse({}, { ok: false, status: 500 });
      }
      if (call.url.includes('action=tokenbalance')) {
        return jsonResponse({}, { ok: false, status: 500 });
      }
      throw new Error(`unrouted URL: ${call.url}`);
    });

    const reads = await readEvmChainBalances(ADDRESS, {
      chains: [ETH],
      fetchImpl,
    });
    const read = reads[0]!;

    expect(read.ok).toBe(false);
    expect(read.balance).toBeUndefined();
    expect(read.failure?.chainId).toBe(1);
    expect(read.failure?.chainName).toBe('Ethereum');
    expect(read.failure?.reason).toBe('unexpected');
    expect(read.failure?.message).toContain('500');
    expect(JSON.stringify(read)).not.toContain('0.000000000000000000');
  });

  it('does not read a module-API status "0" as a zero balance', async () => {
    const { fetchImpl } = harness((call) => {
      const method = rpcMethod(call);
      if (call.url === ETH_RPC && method !== null) {
        return jsonResponse({}, { ok: false, status: 500 });
      }
      if (call.url.includes('/api/v2/stats')) {
        return jsonResponse({}, { ok: false, status: 404 });
      }
      if (call.url.includes('/api/v2/addresses/')) {
        return jsonResponse({}, { ok: false, status: 500 });
      }
      if (call.url.includes('action=balance')) {
        return jsonResponse({ status: '0', message: 'NOTOK', result: '0' });
      }
      throw new Error(`unrouted URL: ${call.url}`);
    });

    const reads = await readEvmChainBalances(ADDRESS, {
      chains: [ETH],
      fetchImpl,
    });

    expect(reads[0]!.ok).toBe(false);
    expect(reads[0]!.balance).toBeUndefined();
  });
});
