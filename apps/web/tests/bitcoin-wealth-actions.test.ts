import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  BITCOIN_CHAIN_ID,
  BITCOIN_PROVIDER,
  MAX_BITCOIN_ADDRESSES,
} from '@/lib/wealth/types';

/**
 * The Bitcoin address write/read path, server-side.
 *
 * The provider and the Supabase client are mocked, so these tests pin the
 * wiring: authentication is required, the RPC is called with the Bitcoin
 * sentinel and provider, the cap is enforced, and a provider failure becomes a
 * record with a `readError` rather than losing the address or failing a list.
 */

const hoisted = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  isBitcoinAddress: vi.fn(),
  readBitcoinBalance: vi.fn(),
  readBitcoinApiBase: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: hoisted.createSupabaseServerClient,
}));
vi.mock('@/lib/wealth/bitcoin', () => ({
  isBitcoinAddress: hoisted.isBitcoinAddress,
  readBitcoinBalance: hoisted.readBitcoinBalance,
}));
vi.mock('@/lib/env', () => ({
  readBitcoinApiBase: hoisted.readBitcoinApiBase,
}));

import {
  addBitcoinAddress,
  listBitcoinAddresses,
  removeBitcoinAddress,
} from '@/app/onboarding/wealth-actions';

const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const BASE = 'https://mempool.space';

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
  readonly rpcResult?: unknown;
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
      return { data: options.rpcResult ?? 7, error: null };
    },
  };
  return { client: client as unknown as SupabaseClient, rpcCalls };
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.isBitcoinAddress.mockReturnValue(true);
  hoisted.readBitcoinApiBase.mockReturnValue(BASE);
  hoisted.readBitcoinBalance.mockResolvedValue({
    address: ADDRESS,
    satoshis: 100_000,
    btc: '0.00100000',
    usd: 60,
  });
});

describe('addBitcoinAddress', () => {
  it('requires an authenticated session', async () => {
    const { client, rpcCalls } = createFakeClient({ user: null });
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    await expect(addBitcoinAddress(ADDRESS)).rejects.toThrow(
      /signed-in session/i,
    );
    expect(rpcCalls).toHaveLength(0);
  });

  it('sends the Bitcoin sentinel and provider to the RPC', async () => {
    const { client, rpcCalls } = createFakeClient();
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    await addBitcoinAddress(ADDRESS);

    const call = rpcCalls[0];
    if (!call) throw new Error('the RPC was not called');
    expect(call.name).toBe('record_wallet_address');
    expect(call.args.p_address).toBe(ADDRESS);
    expect(call.args.p_chain).toBe(BITCOIN_CHAIN_ID);
    expect(call.args.p_provider).toBe(BITCOIN_PROVIDER);
  });

  it('enforces the address cap', async () => {
    const wallets = Array.from({ length: MAX_BITCOIN_ADDRESSES }, (_, i) => ({
      id: i + 1,
      address: `bc1-not-${i}`,
    }));
    const { client, rpcCalls } = createFakeClient({ wallets });
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    await expect(addBitcoinAddress(ADDRESS)).rejects.toThrow(
      new RegExp(`at most ${MAX_BITCOIN_ADDRESSES}`, 'i'),
    );
    expect(rpcCalls).toHaveLength(0);
  });

  it('survives a provider failure with a record carrying readError', async () => {
    hoisted.readBitcoinBalance.mockRejectedValue(new Error('provider down'));
    const { client, rpcCalls } = createFakeClient();
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    const record = await addBitcoinAddress(ADDRESS);

    expect(rpcCalls).toHaveLength(1);
    expect(record.id).toBe(7);
    expect(record.address).toBe(ADDRESS);
    expect(record.btc).toBeNull();
    expect(record.usd).toBeNull();
    expect(record.readAt).toBeNull();
    expect(record.readError).toMatch(/provider down/);
  });
});

describe('removeBitcoinAddress', () => {
  it('calls the delete RPC with the id', async () => {
    const { client, rpcCalls } = createFakeClient();
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    await removeBitcoinAddress(42);

    const call = rpcCalls[0];
    if (!call) throw new Error('the RPC was not called');
    expect(call.name).toBe('delete_wallet_address');
    expect(call.args).toEqual({ p_id: 42 });
  });
});

describe('listBitcoinAddresses', () => {
  it('reads each balance fresh and isolates a per-address failure', async () => {
    const wallets = [
      { id: 1, address: 'bc1-first' },
      { id: 2, address: 'bc1-second' },
    ];
    hoisted.readBitcoinBalance
      .mockResolvedValueOnce({
        address: 'bc1-first',
        satoshis: 100_000,
        btc: '0.00100000',
        usd: 60,
      })
      .mockRejectedValueOnce(new Error('provider down'));
    const { client } = createFakeClient({ wallets });
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    const records = await listBitcoinAddresses();

    expect(records).toHaveLength(2);
    expect(records[0]?.readError).toBeNull();
    expect(records[0]?.btc).toBe('0.00100000');
    expect(records[1]?.readError).toMatch(/provider down/);
    expect(records[1]?.btc).toBeNull();
  });

  it('returns an empty list for an unauthenticated caller', async () => {
    const { client } = createFakeClient({ user: null });
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    await expect(listBitcoinAddresses()).resolves.toEqual([]);
  });
});
