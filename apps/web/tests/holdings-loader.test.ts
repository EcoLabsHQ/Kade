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

interface Row {
  readonly id: number;
  readonly address: string;
  readonly chain: number;
  readonly provider: string | null;
  readonly verified_at: string | null;
}

function createFakeClient(rows: readonly Row[], listError = false) {
  const filters: Array<[string, string, unknown]> = [];
  const builder = {
    select() {
      return builder;
    },
    eq() {
      return builder;
    },
    not(column: string, op: string, value: unknown) {
      filters.push([column, op, value]);
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
  it('selects only rows with a verified_at proof', async () => {
    const { client, filters } = createFakeClient([]);
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    await loadVerifiedHoldings('user-1');

    expect(filters).toContainEqual(['verified_at', 'is', null]);
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
    expect(hoisted.readEvmBalances).toHaveBeenCalledTimes(1);
    expect(hoisted.readEvmBalances).toHaveBeenCalledWith(VERIFIED);
    expect(hoisted.readEvmBalances).not.toHaveBeenCalledWith(PASTED);
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
