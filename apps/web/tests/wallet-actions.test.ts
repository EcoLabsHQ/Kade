import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CONNECTED_WALLET_PROVIDER,
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
  readEvmChainBalances: vi.fn(),
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
    readEvmChainBalances: hoisted.readEvmChainBalances,
  };
});

import {
  addConnectedWallet,
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

/** Wrap a balance in the `EvmChainRead` shape the reader now returns. */
function okChain(balance: Record<string, unknown>) {
  return {
    chain: {
      chainId: balance.chainId,
      name: balance.name,
      symbol: balance.nativeSymbol,
      baseUrl: 'https://test.invalid',
      usdcAddress: '0x0000000000000000000000000000000000000000',
    },
    ok: true as const,
    balance,
  };
}

/** A chain outcome whose read failed, with a specific reason. */
function failedChain(chainId: number, name: string, message: string) {
  return {
    chain: {
      chainId,
      name,
      symbol: 'ETH',
      baseUrl: 'https://test.invalid',
      usdcAddress: '0x0000000000000000000000000000000000000000',
    },
    ok: false as const,
    failure: { chainId, chainName: name, reason: 'unexpected' as const, message },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.normalizeEvmAddress.mockImplementation((value: string) =>
    value.trim(),
  );
  hoisted.readEvmChainBalances.mockResolvedValue([
    okChain({
      chainId: 1,
      name: 'Ethereum',
      symbol: 'ETH',
      nativeSymbol: 'ETH',
      nativeAmount: '1.000000000000000000',
      nativeUsd: 3000,
      usdc: null,
      usd: 3000,
    }),
    okChain({
      chainId: 8453,
      name: 'Base',
      symbol: 'ETH',
      nativeSymbol: 'ETH',
      nativeAmount: '0.500000000000000000',
      nativeUsd: 1500,
      usdc: null,
      usd: 1500,
    }),
    // One read per configured chain: a third chain means a third row, not a
    // dropped chain. A zero balance still counts as a chain the address is read
    // on, so its row is written and it contributes nothing to the total.
    okChain({
      chainId: 42161,
      name: 'Arbitrum One',
      symbol: 'ETH',
      nativeSymbol: 'ETH',
      nativeAmount: '0.000000000000000000',
      nativeUsd: 0,
      usdc: null,
      usd: 0,
    }),
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
    hoisted.readEvmChainBalances.mockResolvedValue([
      failedChain(1, 'Ethereum', 'Ethereum (chain 1): the balance provider returned HTTP 500.'),
      failedChain(8453, 'Base', 'Base (chain 8453): the balance provider returned HTTP 500.'),
    ]);
    const { client, rpcCalls } = createFakeClient();
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    const record = await addWalletAddress(ADDRESS);

    expect(rpcCalls).toHaveLength(EVM_READ_CHAINS.length);
    expect(record.address).toBe(ADDRESS);
    expect(record.chains).toEqual([]);
    expect(record.usd).toBeNull();
    // The address is still persisted, but the read error names the real reason
    // rather than collapsing to a generic message.
    expect(record.readError).toMatch(/HTTP 500/);
  });
});

describe('addConnectedWallet', () => {
  it('requires an authenticated session', async () => {
    const { client, rpcCalls } = createFakeClient({ user: null });
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    await expect(addConnectedWallet(ADDRESS)).rejects.toThrow(
      /signed-in session/i,
    );
    expect(rpcCalls).toHaveLength(0);
  });

  it('writes one row per chain with the connected-wallet provider, not the pasted one', async () => {
    const { client, rpcCalls } = createFakeClient();
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    const record = await addConnectedWallet(ADDRESS);

    expect(rpcCalls).toHaveLength(EVM_READ_CHAINS.length);
    expect(rpcCalls.map((call) => call.name)).toEqual(
      EVM_READ_CHAINS.map(() => 'record_wallet_address'),
    );
    for (const call of rpcCalls) {
      expect(call.args.p_address).toBe(ADDRESS);
      expect(call.args.p_provider).toBe(CONNECTED_WALLET_PROVIDER);
    }
    // The action never sends verified_at: only record_wallet_ownership sets it.
    const payload = JSON.stringify(rpcCalls);
    expect(payload).not.toMatch(/verified_at/);
    expect(record.address).toBe(ADDRESS);
    expect(record.usd).toBe(4500);
    expect(record.readError).toBeNull();
  });

  it('refuses an address that is not a recognised EVM address', async () => {
    hoisted.normalizeEvmAddress.mockImplementation(() => {
      throw new EvmReadError('nope');
    });
    const { client, rpcCalls } = createFakeClient();
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    await expect(addConnectedWallet('not-an-address')).rejects.toThrow(
      /not a recognised EVM address/i,
    );
    expect(rpcCalls).toHaveLength(0);
  });

  it('enforces the same distinct-address cap as the pasted path', async () => {
    const wallets = Array.from({ length: MAX_WALLET_ADDRESSES }, (_, i) => ({
      id: i + 1,
      address: `0x${String(i).padStart(40, '0')}`,
    }));
    const { client, rpcCalls } = createFakeClient({ wallets });
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    await expect(addConnectedWallet(ADDRESS)).rejects.toThrow(
      new RegExp(`at most ${MAX_WALLET_ADDRESSES}`, 'i'),
    );
    expect(rpcCalls).toHaveLength(0);
  });

  it('survives a provider failure with a record carrying readError and still persists', async () => {
    hoisted.readEvmChainBalances.mockResolvedValue([
      failedChain(1, 'Ethereum', 'Ethereum (chain 1): the balance read timed out.'),
    ]);
    const { client, rpcCalls } = createFakeClient();
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    const record = await addConnectedWallet(ADDRESS);

    expect(rpcCalls).toHaveLength(EVM_READ_CHAINS.length);
    expect(record.chains).toEqual([]);
    expect(record.usd).toBeNull();
    expect(record.readError).toMatch(/timed out/i);
  });
});

describe('token sub-read failures', () => {
  const tokenFailure = {
    chainId: 8453,
    chainName: 'Base',
    reason: 'rejected' as const,
    message:
      'Base (chain 8453): the balance provider is rate limiting this read (HTTP 429).',
  };

  it('folds a failed USDC sub-read into the record readError, never a zero', async () => {
    hoisted.readEvmChainBalances.mockResolvedValue([
      okChain({
        chainId: 8453,
        name: 'Base',
        symbol: 'ETH',
        nativeSymbol: 'ETH',
        nativeAmount: '1.000000000000000000',
        nativeUsd: 3000,
        usdc: null,
        tokenFailure,
        usd: 3000,
      }),
    ]);
    const { client, rpcCalls } = createFakeClient();
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    const record = await addWalletAddress(ADDRESS);

    // The chain read natively, so it is kept — carrying the token failure — and
    // the record's readError names the specific reason rather than silently
    // leaving the unread token unmentioned.
    expect(record.chains).toHaveLength(1);
    expect(record.chains[0]!.tokenFailure).toEqual(tokenFailure);
    expect(record.readError).toMatch(/rate limiting this read/);
    // The native figure is real; the unread token is never turned into a zero.
    expect(record.usd).toBe(3000);
    expect(rpcCalls.length).toBeGreaterThan(0);
  });

  it('carries the token reason through listWalletAddresses as well', async () => {
    hoisted.readEvmChainBalances.mockResolvedValue([
      okChain({
        chainId: 8453,
        name: 'Base',
        symbol: 'ETH',
        nativeSymbol: 'ETH',
        nativeAmount: '1.000000000000000000',
        nativeUsd: 3000,
        usdc: null,
        tokenFailure,
        usd: 3000,
      }),
    ]);
    const { client } = createFakeClient({
      wallets: [{ id: 1, address: ADDRESS }],
    });
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    const records = await listWalletAddresses();

    expect(records[0]!.readError).toMatch(/rate limiting this read/);
    expect(records[0]!.chains[0]!.tokenFailure).toEqual(tokenFailure);
    expect(records[0]!.usd).toBe(3000);
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
    hoisted.readEvmChainBalances.mockImplementation(async (address: string) => {
      if (address === ADDRESS) {
        return [
          failedChain(1, 'Ethereum', 'Ethereum (chain 1): the balance read timed out.'),
        ];
      }
      return [
        okChain({
          chainId: 1,
          name: 'Ethereum',
          symbol: 'ETH',
          nativeSymbol: 'ETH',
          nativeAmount: '1.000000000000000000',
          nativeUsd: 3000,
          usdc: null,
          usd: 3000,
        }),
      ];
    });
    const { client } = createFakeClient({ wallets });
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    const records = await listWalletAddresses();

    expect(records).toHaveLength(2);
    expect(records[0]?.address).toBe(ADDRESS);
    expect(records[0]?.readError).toMatch(/timed out/i);
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
