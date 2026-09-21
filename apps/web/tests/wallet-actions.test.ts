import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  EVM_PROVIDER,
  MAX_WALLET_ADDRESSES,
} from '@/lib/wealth/types';
import { EVM_READ_CHAINS, EvmReadError } from '@/lib/wealth/evm';

/**
 * The pasted EVM address write/read path, server-side.
 *
 * The provider and the Supabase client are mocked, so these tests pin the
 * wiring: authentication is required, one row is written per chain the address
 * is read on (with the pasted-address provider), the distinct-address cap is
 * enforced, and a provider failure becomes a record with a `readError` rather
 * than losing the address or failing a list.
 */

const hoisted = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  normalizeEvmAddress: vi.fn(),
  readEvmBalances: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: hoisted.createSupabaseServerClient,
}));
vi.mock('@/lib/wealth/bitcoin', () => ({
  isBitcoinAddress: vi.fn(),
  normalizeBitcoinAddress: vi.fn(),
  readBitcoinBalance: vi.fn(),
}));
vi.mock('@/lib/wealth/evm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/wealth/evm')>();
  return {
    ...actual,
    normalizeEvmAddress: hoisted.normalizeEvmAddress,
    readEvmBalances: hoisted.readEvmBalances,
  };
});

import {
  addWalletAddress,
  listWalletAddresses,
  removeWalletAddress,
} from '@/app/onboarding/wallet-actions';

const ADDRESS = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';

interface WalletRow {
  readonly id: number;
  readonly address: string;
}

interface RpcCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

interface FakeOptions {
  readonly user?: { id: string } | null;
  readonly wallets?: readonly WalletRow[];
  readonly listError?: { message: string } | null;
  readonly rpcError?: { message: string } | null;
}

function createFakeClient(options: FakeOptions = {}): {
  readonly client: SupabaseClient;
  readonly rpcCalls: RpcCall[];
} {
  const rpcCalls: RpcCall[] = [];
  const rows = options.wallets ?? [];
  const client = {
    auth: {
      async getUser() {
        const user =
          options.user === undefined ? { id: 'user-1' } : options.user;
        return { data: { user }, error: null };
      },
    },
    from() {
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        // Only EVM rows (chain <> 0) are ever selected.
        neq(_column: string, _value: number) {
          return builder;
        },
        order() {
          return Promise.resolve({
            data: options.listError ? null : rows,
            error: options.listError ?? null,
          });
        },
      };
      return builder;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (options.rpcError) {
        return { data: null, error: options.rpcError };
      }
      return { data: 7, error: null };
    },
  };
  return { client: client as unknown as SupabaseClient, rpcCalls };
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.normalizeEvmAddress.mockImplementation((value: string) =>
    value.trim(),
  );
  hoisted.readEvmBalances.mockResolvedValue([
    {
      chainId: 1,
      name: 'Ethereum',
      symbol: 'ETH',
      amount: '1.000000000000000000',
      usd: 3000,
    },
    {
      chainId: 8453,
      name: 'Base',
      symbol: 'ETH',
      amount: '0.500000000000000000',
      usd: 1500,
    },
  ]);
});

describe('addWalletAddress', () => {
  it('requires an authenticated session', async () => {
    const { client, rpcCalls } = createFakeClient({ user: null });
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    await expect(addWalletAddress(ADDRESS)).rejects.toThrow(
      /signed-in session/i,
    );
    expect(rpcCalls).toHaveLength(0);
  });

  it('writes one row per chain with the chain id and the pasted provider', async () => {
    const { client, rpcCalls } = createFakeClient();
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    const record = await addWalletAddress(ADDRESS);

    expect(rpcCalls).toHaveLength(EVM_READ_CHAINS.length);
    expect(rpcCalls.map((call) => call.name)).toEqual(
      EVM_READ_CHAINS.map(() => 'record_wallet_address'),
    );
    expect(rpcCalls.map((call) => call.args.p_chain)).toEqual(
      EVM_READ_CHAINS.map((chain) => chain.chainId),
    );
    for (const call of rpcCalls) {
      expect(call.args.p_address).toBe(ADDRESS);
      expect(call.args.p_provider).toBe(EVM_PROVIDER);
    }
    expect(record.address).toBe(ADDRESS);
    expect(record.chains).toHaveLength(EVM_READ_CHAINS.length);
    expect(record.usd).toBe(4500);
    expect(record.readError).toBeNull();
  });

  it('refuses an address that is not a recognised EVM address', async () => {
    hoisted.normalizeEvmAddress.mockImplementation(() => {
      throw new EvmReadError('nope');
    });
    const { client, rpcCalls } = createFakeClient();
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    await expect(addWalletAddress('not-an-address')).rejects.toThrow(
      /not a recognised EVM address/i,
    );
    expect(rpcCalls).toHaveLength(0);
  });

  it('enforces the distinct-address cap', async () => {
    const wallets = Array.from({ length: MAX_WALLET_ADDRESSES }, (_, i) => ({
      id: i + 1,
      address: `0x${String(i).padStart(40, '0')}`,
    }));
    const { client, rpcCalls } = createFakeClient({ wallets });
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    await expect(addWalletAddress(ADDRESS)).rejects.toThrow(
      new RegExp(`at most ${MAX_WALLET_ADDRESSES}`, 'i'),
    );
    expect(rpcCalls).toHaveLength(0);
  });

  it('lets a repeat of an address already at the cap pass', async () => {
    const wallets = [
      { id: 1, address: ADDRESS },
      ...Array.from({ length: MAX_WALLET_ADDRESSES - 1 }, (_, i) => ({
        id: i + 2,
        address: `0x${String(i).padStart(40, '0')}`,
      })),
    ];
    const { client, rpcCalls } = createFakeClient({ wallets });
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    await addWalletAddress(ADDRESS);

    expect(rpcCalls.length).toBeGreaterThan(0);
  });

  it('survives a provider failure with a record carrying readError and still persists', async () => {
    hoisted.readEvmBalances.mockRejectedValue(new Error('provider down'));
    const { client, rpcCalls } = createFakeClient();
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    const record = await addWalletAddress(ADDRESS);

    expect(rpcCalls).toHaveLength(EVM_READ_CHAINS.length);
    expect(record.address).toBe(ADDRESS);
    expect(record.chains).toEqual([]);
    expect(record.usd).toBeNull();
    expect(record.readAt).toBeNull();
    expect(record.readError).toMatch(/provider down/);
  });
});

describe('removeWalletAddress', () => {
  it('requires an authenticated session', async () => {
    const { client, rpcCalls } = createFakeClient({ user: null });
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    await expect(removeWalletAddress(ADDRESS)).rejects.toThrow(
      /signed-in session/i,
    );
    expect(rpcCalls).toHaveLength(0);
  });

  it('calls delete_wallet_addresses with the address', async () => {
    const { client, rpcCalls } = createFakeClient();
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    await removeWalletAddress(ADDRESS);

    const call = rpcCalls[0];
    if (!call) throw new Error('the RPC was not called');
    expect(call.name).toBe('delete_wallet_addresses');
    expect(call.args).toEqual({ p_address: ADDRESS });
  });
});

describe('listWalletAddresses', () => {
  it('groups rows by address and isolates a per-address failure', async () => {
    const wallets = [
      { id: 1, address: ADDRESS },
      { id: 2, address: ADDRESS },
      { id: 3, address: OTHER },
    ];
    hoisted.readEvmBalances.mockImplementation(async (address: string) => {
      if (address === ADDRESS) throw new Error('provider down');
      return [
        {
          chainId: 1,
          name: 'Ethereum',
          symbol: 'ETH',
          amount: '1.000000000000000000',
          usd: 3000,
        },
      ];
    });
    const { client } = createFakeClient({ wallets });
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    const records = await listWalletAddresses();

    expect(records).toHaveLength(2);
    expect(records[0]?.address).toBe(ADDRESS);
    expect(records[0]?.readError).toMatch(/provider down/);
    expect(records[0]?.chains).toEqual([]);
    expect(records[1]?.address).toBe(OTHER);
    expect(records[1]?.readError).toBeNull();
    expect(records[1]?.chains).toHaveLength(1);
  });

  it('returns an empty list for an unauthenticated caller', async () => {
    const { client } = createFakeClient({ user: null });
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    await expect(listWalletAddresses()).resolves.toEqual([]);
  });
});
