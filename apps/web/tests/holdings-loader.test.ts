import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The Holdings loader.
 *
 * `loadVerifiedHoldings` is the only place the screen reads the database. These
 * tests pin two things: it asks Supabase for rows where `verified_at` is set
 * (03's column, the signature proof), and it re-applies the structural predicate
 * so a pasted row — even one the query somehow returned — is still dropped
 * before the aggregate.
 */

const hoisted = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  readEvmBalances: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: hoisted.createSupabaseServerClient,
}));
vi.mock('@/lib/wealth/evm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/wealth/evm')>();
  return { ...actual, readEvmBalances: hoisted.readEvmBalances };
});

import { loadVerifiedHoldings } from '@/app/holdings/data';

const VERIFIED = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const PASTED = '0x2222222222222222222222222222222222222222';
const CONNECTED = '0x3333333333333333333333333333333333333333';
const CONNECTED_PROVIDER = 'connected-wallet';

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
  return {
    chainId: 1,
    name: 'Ethereum',
    nativeSymbol: 'ETH',
    nativeAmount: '1.000000',
    nativeUsd: usd,
    usdc: null,
    usd,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.readEvmBalances.mockResolvedValue([chain(2500)]);
});

describe('loadVerifiedHoldings', () => {
  it('selects verified rows and connected-wallet rows in one query', async () => {
    const { client, filters } = createFakeClient([]);
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    await loadVerifiedHoldings('user-1');

    // The widened predicate: a signature proof OR the connected encoding.
    const or = filters.find(([kind]) => kind === 'or');
    expect(or).toBeDefined();
    expect(String(or?.[1])).toContain('verified_at.not.is.null');
    expect(String(or?.[1])).toContain(`provider.eq.${CONNECTED_PROVIDER}`);
  });

  it('drops a pasted row even when the query returns one', async () => {
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
        provider: 'pasted-address',
        verified_at: null,
      },
    ]);
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    const aggregate = await loadVerifiedHoldings('user-1');

    expect(aggregate.walletCount).toBe(1);
    expect(aggregate.wallets[0]!.address).toBe(VERIFIED);
    expect(aggregate.unverifiedCount).toBe(0);
    expect(hoisted.readEvmBalances).toHaveBeenCalledTimes(1);
    expect(hoisted.readEvmBalances).toHaveBeenCalledWith(VERIFIED);
    expect(hoisted.readEvmBalances).not.toHaveBeenCalledWith(PASTED);
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
    hoisted.readEvmBalances.mockImplementation(async (address: string) => [
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

  it('returns an empty aggregate with no verified rows and no reads', async () => {
    const { client } = createFakeClient([]);
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    const aggregate = await loadVerifiedHoldings('user-1');

    expect(aggregate.walletCount).toBe(0);
    expect(aggregate.total).toBe(0);
    expect(hoisted.readEvmBalances).not.toHaveBeenCalled();
  });

  it('throws rather than showing a partial total when the read fails', async () => {
    const { client } = createFakeClient([], true);
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    await expect(loadVerifiedHoldings('user-1')).rejects.toThrow(
      /database down/,
    );
  });
});
