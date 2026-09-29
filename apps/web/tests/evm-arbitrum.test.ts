import { describe, expect, it, vi } from 'vitest';
import {
  EVM_READ_CHAINS,
  readEvmChainBalances,
  type EvmReadChain,
} from '@/lib/wealth/evm';
import {
  aggregateHoldings,
  selectVerifiedWallets,
} from '@/lib/wealth/holdings';

/**
 * The app promises three chains and must read all three.
 *
 * `HoldingsScreen` tells the resident that qualified vaults run on Ethereum,
 * Base and **Arbitrum One** and that the tier is the total across all three, but
 * `EVM_READ_CHAINS` used to read only Ethereum and Base — an Arbitrum deposit
 * existed on-chain and was never counted. These tests pin, offline, that:
 *
 *   1. Arbitrum One (42161) is in the read list and uses Circle's **native**
 *      USDC, never the bridged USDC.e;
 *   2. its native and USDC balances are read through its own chain RPC and land
 *      in the Holdings aggregate, so the tier arithmetic matches the copy;
 *   3. its native amount is valued with the **one** shared ETH/USD price, with
 *      no second price read.
 *
 * The RPC and the provider are fake and injected; no network is touched. The
 * chains are the real `EVM_READ_CHAINS` entries with only `rpcUrl` overridden,
 * so the canonical USDC address under test is the one the app ships.
 */

const ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const ARBITRUM_CHAIN_ID = 42161;

/** Circle's canonical, native Arbitrum One USDC (verified on-chain). */
const ARBITRUM_USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
/** The bridged USDC.e, which must never be read. */
const ARBITRUM_BRIDGED_USDC_E =
  '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8';

const ETH_USD = 2500;
const ARBITRUM_NATIVE_WEI = 2n * 10n ** 18n; // 2 ETH
const ARBITRUM_USDC_RAW = 183_500_000n; // 183.5 USDC
const ARBITRUM_NATIVE_USD = 2 * ETH_USD;
const ARBITRUM_USDC_USD = 183.5;
const ARBITRUM_TOTAL_USD = ARBITRUM_NATIVE_USD + ARBITRUM_USDC_USD;

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

function hex(value: bigint): string {
  return `0x${value.toString(16)}`;
}

interface Call {
  readonly url: string;
  readonly init?: RequestInit;
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

function rpcUrlFor(chainId: number): string {
  return `https://rpc.test/${chainId}`;
}

/** The real read list, with an injectable RPC so the read never leaves the test. */
function offlineChains(): readonly EvmReadChain[] {
  return EVM_READ_CHAINS.map((chain) => ({
    ...chain,
    rpcUrl: rpcUrlFor(chain.chainId),
  }));
}

interface Harness {
  readonly fetchImpl: typeof fetch;
  readonly calls: readonly Call[];
}

/**
 * A fake fetch: Arbitrum answers with a real native + USDC balance, the other
 * chains answer with a genuine zero, and the one ETH price comes from the stats
 * endpoint. Every call is recorded, so the source and count are observable.
 */
function harness(): Harness {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const call: Call = { url: String(input), init };
      calls.push(call);

      if (call.url.includes('/api/v2/stats')) {
        return jsonResponse({ coin_price: String(ETH_USD) });
      }

      const method = rpcMethod(call);
      if (call.url === rpcUrlFor(ARBITRUM_CHAIN_ID) && method === 'eth_getBalance') {
        return rpcResult(hex(ARBITRUM_NATIVE_WEI));
      }
      if (call.url === rpcUrlFor(ARBITRUM_CHAIN_ID) && method === 'eth_call') {
        return rpcResult(hex(ARBITRUM_USDC_RAW));
      }
      if (method === 'eth_getBalance' || method === 'eth_call') {
        return rpcResult('0x0');
      }
      return jsonResponse({}, { ok: false, status: 404 });
    },
  ) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('Arbitrum One balance read', () => {
  it('targets Arbitrum One with Circle-native USDC, never the bridged USDC.e', () => {
    const arbitrum = EVM_READ_CHAINS.find(
      (chain) => chain.chainId === ARBITRUM_CHAIN_ID,
    );
    expect(arbitrum).toBeDefined();
    expect(arbitrum?.name).toBe('Arbitrum One');
    expect(arbitrum?.symbol).toBe('ETH');
    expect(arbitrum?.usdcAddress).toBe(ARBITRUM_USDC);
    expect(arbitrum?.usdcAddress.toLowerCase()).not.toBe(
      ARBITRUM_BRIDGED_USDC_E.toLowerCase(),
    );
  });

  it('reads the Arbitrum native balance and its canonical USDC through its own RPC', async () => {
    const { fetchImpl, calls } = harness();

    const reads = await readEvmChainBalances(ADDRESS, {
      chains: offlineChains(),
      fetchImpl,
    });
    const arbitrum = reads.find((read) => read.chain.chainId === ARBITRUM_CHAIN_ID);

    expect(arbitrum?.ok).toBe(true);
    expect(arbitrum?.balance?.nativeAmount).toBe('2.000000000000000000');
    expect(arbitrum?.balance?.usdc).toEqual({
      symbol: 'USDC',
      amount: '183.500000',
      usd: ARBITRUM_USDC_USD,
    });
    expect(arbitrum?.balance?.usd).toBeCloseTo(ARBITRUM_TOTAL_USD);
    // The chain name is real, so a row is never mislabelled `Chain 42161`.
    expect(arbitrum?.balance?.name).toBe('Arbitrum One');

    // The token balance was asked of the canonical contract, explicitly.
    const tokenCall = calls.find(
      (call) =>
        call.url === rpcUrlFor(ARBITRUM_CHAIN_ID) && rpcMethod(call) === 'eth_call',
    );
    const to = (
      JSON.parse(String(tokenCall?.init?.body)) as {
        params: readonly [{ to: string }];
      }
    ).params[0].to;
    expect(to).toBe(ARBITRUM_USDC);
    // The bridged USDC.e is never queried anywhere.
    expect(JSON.stringify(calls)).not.toContain(ARBITRUM_BRIDGED_USDC_E);
  });

  it('values Arbitrum with the one shared ETH price and adds no second price read', async () => {
    const { fetchImpl, calls } = harness();

    const reads = await readEvmChainBalances(ADDRESS, {
      chains: offlineChains(),
      fetchImpl,
    });
    const arbitrum = reads.find((read) => read.chain.chainId === ARBITRUM_CHAIN_ID);

    expect(arbitrum?.balance?.nativeUsd).toBe(ARBITRUM_NATIVE_USD);

    // Exactly one ETH/USD price is fetched, from the single canonical source
    // (Ethereum mainnet), and Arbitrum's own provider is never asked for a rate.
    const statsCalls = calls.filter((call) => call.url.includes('/api/v2/stats'));
    expect(statsCalls).toHaveLength(1);
    expect(statsCalls[0]?.url).toContain('eth.blockscout.com');
    expect(countCalls(calls, 'arbitrum.blockscout.com/api/v2/stats')).toBe(0);
  });

  it('counts the Arbitrum balance in the Holdings aggregate', async () => {
    const { fetchImpl } = harness();

    const reads = await readEvmChainBalances(ADDRESS, {
      chains: offlineChains(),
      fetchImpl,
    });
    const balances = reads
      .filter((read) => read.ok && read.balance !== undefined)
      .map((read) => read.balance!);
    const usd = balances.reduce((sum, balance) => sum + (balance.usd ?? 0), 0);

    const [wallet] = selectVerifiedWallets([
      {
        id: 1,
        address: ADDRESS,
        // A stored row on Arbitrum One, as the signature proof would leave it.
        chain: ARBITRUM_CHAIN_ID,
        provider: null,
        verifiedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    const aggregate = await aggregateHoldings({
      wallets: [wallet!],
      readBalances: async () => ({ chains: balances, usd, failures: [] }),
    });

    // The Arbitrum amount is part of the total the tier is computed from.
    expect(aggregate.total).toBeCloseTo(ARBITRUM_TOTAL_USD);
    expect(aggregate.valuedCount).toBe(1);
    expect(
      aggregate.wallets[0]?.chains.map((chain) => chain.chainId),
    ).toContain(ARBITRUM_CHAIN_ID);
  });
});
