import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The Holdings loader.
 *
 * `loadVerifiedHoldings` is the only place the screen reads the database. These
 * tests pin two things: it asks Supabase for signature-verified rows, connected
 * rows and pasted-EVM rows, and it re-applies the structural predicate so a
 * pasted Bitcoin row — even one the query somehow returned — is still dropped
 * before the aggregate.
 */

const hoisted = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  readEvmChainBalances: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: hoisted.createSupabaseServerClient,
}));
vi.mock('@/lib/wealth/evm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/wealth/evm')>();
  return { ...actual, readEvmChainBalances: hoisted.readEvmChainBalances };
});

import { loadVerifiedHoldings } from '@/app/holdings/data';

const VERIFIED = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const PASTED = '0x2222222222222222222222222222222222222222';
const CONNECTED = '0x3333333333333333333333333333333333333333';
const BITCOIN = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const CONNECTED_PROVIDER = 'connected-wallet';
const PASTED_PROVIDER = 'pasted-address';

interface Row {
  readonly id: number;
  readonly address: string;
  readonly chain: number;
  readonly provider: string | null;
  readonly verified_at: string | null;
}

function createFakeClient(rows: readonly Row[], listError = false) {
  const filters: Array<[string, string]> = [];
  const builder = {
    select() {
      return builder;
    },
    eq() {
      return builder;
    },
    or(expression: string) {
      filters.push(['or', expression]);
      return builder;
    },
    order() {
      return Promise.resolve({
        data: listError ? null : rows,
        error: listError ? { message: 'database down' } : null,
      });
    },
  };
  const client = { from: () => builder };
  return { client: client as unknown as SupabaseClient, filters };
}

function chain(usd: number) {
  const balance = {
    chainId: 1,
    name: 'Ethereum',
    nativeSymbol: 'ETH',
    nativeAmount: '1.000000',
    nativeUsd: usd,
    usdc: null,
    usd,
  };
  return {
    chain: {
      chainId: 1,
      name: 'Ethereum',
      symbol: 'ETH',
      baseUrl: 'https://test.invalid',
      usdcAddress: '0x0000000000000000000000000000000000000000',
    },
    ok: true as const,
    balance,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.readEvmChainBalances.mockResolvedValue([chain(2500)]);
});

describe('loadVerifiedHoldings', () => {
  it('selects verified, connected-wallet and pasted-address rows in one query', async () => {
    const { client, filters } = createFakeClient([]);
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    await loadVerifiedHoldings('user-1');

    // The widened predicate: a signature proof, the connected encoding, or the
    // pasted-EVM encoding. Bitcoin is deliberately absent.
    const or = filters.find(([kind]) => kind === 'or');
    expect(or).toBeDefined();
    expect(String(or?.[1])).toContain('verified_at.not.is.null');
    expect(String(or?.[1])).toContain(`provider.eq.${CONNECTED_PROVIDER}`);
    expect(String(or?.[1])).toContain(`provider.eq.${PASTED_PROVIDER}`);
    expect(String(or?.[1])).not.toContain('bitcoin-address');
  });

  it('shows a pasted EVM row unverified and drops a Bitcoin row the query returned', async () => {
    const { client } = createFakeClient([
      {
        id: 1,
        address: VERIFIED,
        chain: 1,
        provider: 'siwe',
        verified_at: '2026-09-22T10:00:00.000Z',
      },
      {
        id: 2,
        address: PASTED,
        chain: 1,
        provider: PASTED_PROVIDER,
        verified_at: null,
      },
      {
        id: 3,
        address: BITCOIN,
        chain: 0,
        provider: 'bitcoin-address',
        verified_at: null,
      },
    ]);
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    const aggregate = await loadVerifiedHoldings('user-1');

    expect(aggregate.walletCount).toBe(1);
    expect(aggregate.wallets[0]!.address).toBe(VERIFIED);
    expect(aggregate.unverifiedCount).toBe(1);
    expect(aggregate.unverifiedWallets[0]!.address).toBe(PASTED);
    expect(aggregate.unverifiedWallets[0]!.provider).toBe(PASTED_PROVIDER);
    expect(hoisted.readEvmChainBalances).toHaveBeenCalledWith(PASTED);
    expect(hoisted.readEvmChainBalances).not.toHaveBeenCalledWith(BITCOIN);
  });

  it('shows a connected row unverified and excludes it from the total', async () => {
    const { client } = createFakeClient([
      {
        id: 1,
        address: VERIFIED,
        chain: 1,
        provider: 'siwe',
        verified_at: '2026-09-22T10:00:00.000Z',
      },
      {
        id: 2,
        address: CONNECTED,
        chain: 1,
        provider: CONNECTED_PROVIDER,
        verified_at: null,
      },
    ]);
    hoisted.createSupabaseServerClient.mockResolvedValue(client);
    hoisted.readEvmChainBalances.mockImplementation(async (address: string) => [
      chain(address === VERIFIED ? 2500 : 1250),
    ]);

    const aggregate = await loadVerifiedHoldings('user-1');

    // The connected wallet is read and shown, but the total and the verified
    // counts stay on the signature-verified wallet alone.
    expect(aggregate.total).toBe(2500);
    expect(aggregate.walletCount).toBe(1);
    expect(aggregate.unverifiedCount).toBe(1);
    expect(aggregate.unverifiedWallets[0]!.address).toBe(CONNECTED);
    expect(aggregate.unverifiedWallets[0]!.usd).toBe(1250);
  });

  it('totals the balances the shared provider returns', async () => {
    const { client } = createFakeClient([
      {
        id: 1,
        address: VERIFIED,
        chain: 1,
        provider: 'siwe',
        verified_at: '2026-09-22T10:00:00.000Z',
      },
    ]);
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    const aggregate = await loadVerifiedHoldings('user-1');

    expect(aggregate.total).toBe(2500);
    expect(aggregate.valuedCount).toBe(1);
  });

  it('carries a specific per-chain reason into the wallet aggregate', async () => {
    const { client } = createFakeClient([
      {
        id: 1,
        address: VERIFIED,
        chain: 1,
        provider: 'siwe',
        verified_at: '2026-09-22T10:00:00.000Z',
      },
    ]);
    hoisted.createSupabaseServerClient.mockResolvedValue(client);
    hoisted.readEvmChainBalances.mockResolvedValue([
      chain(2500),
      {
        chain: {
          chainId: 8453,
          name: 'Base',
          symbol: 'ETH',
          baseUrl: 'https://base.invalid',
          usdcAddress: '0x0000000000000000000000000000000000000000',
        },
        ok: false,
        failure: {
          chainId: 8453,
          chainName: 'Base',
          reason: 'rejected',
          message: 'Base (chain 8453): the balance provider is rate limiting this read (HTTP 429).',
        },
      },
    ]);

    const aggregate = await loadVerifiedHoldings('user-1');

    // Ethereum is counted; Base is unread with a specific reason and no zero.
    expect(aggregate.total).toBe(2500);
    expect(aggregate.wallets[0]!.failures).toEqual([
      expect.objectContaining({
        chainId: 8453,
        reason: 'rejected',
      }),
    ]);
    expect(aggregate.wallets[0]!.failures?.[0]?.message).toMatch(/rate limit/i);
  });

  it('carries a failed token sub-read on the chain, with its specific reason', async () => {
    const { client } = createFakeClient([
      {
        id: 1,
        address: VERIFIED,
        chain: 1,
        provider: 'siwe',
        verified_at: '2026-09-22T10:00:00.000Z',
      },
    ]);
    hoisted.createSupabaseServerClient.mockResolvedValue(client);
    const tokenFailure = {
      chainId: 8453,
      chainName: 'Base',
      reason: 'rejected' as const,
      message:
        'Base (chain 8453): the balance provider is rate limiting this read (HTTP 429).',
    };
    hoisted.readEvmChainBalances.mockResolvedValue([
      {
        chain: {
          chainId: 8453,
          name: 'Base',
          symbol: 'ETH',
          baseUrl: 'https://base.invalid',
          usdcAddress: '0x0000000000000000000000000000000000000000',
        },
        ok: true,
        balance: {
          chainId: 8453,
          name: 'Base',
          nativeSymbol: 'ETH',
          nativeAmount: '1.000000',
          nativeUsd: 3000,
          usdc: null,
          tokenFailure,
          usd: 3000,
        },
      },
    ]);

    const aggregate = await loadVerifiedHoldings('user-1');
    const wallet = aggregate.wallets[0]!;

    // The chain's token sub-read reason survives the loader, on the chain.
    expect(wallet.chains[0]!.tokenFailure).toEqual(tokenFailure);
    // A token sub-read failure is not a whole-chain failure and does not land in
    // the per-wallet whole-chain failure list.
    expect(wallet.failures).toEqual([]);
    // The native value is counted; the unread token is not turned into a zero.
    expect(aggregate.total).toBe(3000);
  });

  it('returns an empty aggregate with no verified rows and no reads', async () => {
    const { client } = createFakeClient([]);
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    const aggregate = await loadVerifiedHoldings('user-1');

    expect(aggregate.walletCount).toBe(0);
    expect(aggregate.total).toBe(0);
    expect(hoisted.readEvmChainBalances).not.toHaveBeenCalled();
  });

  it('throws rather than showing a partial total when the read fails', async () => {
    const { client } = createFakeClient([], true);
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    await expect(loadVerifiedHoldings('user-1')).rejects.toThrow(
      /database down/,
    );
  });
});
