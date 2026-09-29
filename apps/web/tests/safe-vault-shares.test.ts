import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Address } from 'viem';
import {
  checkSafeWithdrawShares,
  readSafeVaultSharesFromRpc,
  type SafeVaultShareInput,
  type SafeVaultShareRead,
} from '@/lib/invest/safe-vault-shares';

/**
 * The Safe-share pre-flight gate (the inverse of the deposit funding gate).
 *
 * A MetaMorpho un-allocate burns shares the Safe already holds, so a Safe whose
 * position is worth less than the requested USDC can never execute. These tests
 * prove the gate refuses **before** anything is built, names the chain and the
 * shortfall, and treats a failed read as a refusal with the real reason rather
 * than as a sufficient (or zero) balance. Every read is injected, so nothing
 * touches the network.
 */

const SAFE = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed' as Address;
const VAULT = '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB' as Address;
const OTHER_VAULT = '0x1111222233334444555566667777888899990000' as Address;

const INPUT = {
  safeAddress: SAFE,
  vault: VAULT,
  chainId: 1,
  chainName: 'Ethereum',
  // 1 USDC at 6 decimals, the amount requested.
  amountUnits: 1_000_000n,
} as const;

describe('checkSafeWithdrawShares — stated amount', () => {
  it('refuses when the shares are worth less than requested, naming the chain and the shortfall', async () => {
    const reader = vi.fn(
      async (): Promise<SafeVaultShareRead> => ({
        status: 'read',
        shares: 250_000_000_000_000_000n,
        // 0.5 USDC — half of the requested 1 USDC.
        assetsUsdc: 500_000n,
      }),
    );

    const result = await checkSafeWithdrawShares(INPUT, reader);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.gate).toBe('safe-insufficient-shares');
      expect(result.reason).toMatch(/worth 0\.5 USDC on Ethereum/);
      expect(result.reason).toMatch(/needs 1 USDC/);
      expect(result.reason).toMatch(/short by 0\.5 USDC/);
      expect(result.reason).toMatch(/not hold enough shares/);
    }
    // The read targets the vault and chain the un-allocate uses, not a copy.
    expect(reader).toHaveBeenCalledWith({
      safeAddress: SAFE,
      vault: VAULT,
      chainId: 1,
      chainName: 'Ethereum',
      amountUnits: 1_000_000n,
    });
  });

  it('allows an un-allocate the shares value exactly covers', async () => {
    const reader = vi.fn(
      async (): Promise<SafeVaultShareRead> => ({
        status: 'read',
        shares: 1_000_000_000_000_000_000n,
        assetsUsdc: 1_000_000n,
      }),
    );

    const result = await checkSafeWithdrawShares(INPUT, reader);

    expect(result).toEqual({
      ok: true,
      shares: 1_000_000_000_000_000_000n,
      assetsUsdc: 1_000_000n,
    });
  });

  it('allows an un-allocate the shares value more than covers', async () => {
    const reader = vi.fn(
      async (): Promise<SafeVaultShareRead> => ({
        status: 'read',
        shares: 5n,
        assetsUsdc: 5_000_000n,
      }),
    );

    const result = await checkSafeWithdrawShares(INPUT, reader);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.shares).toBe(5n);
  });
});

describe('checkSafeWithdrawShares — all', () => {
  it('refuses "all" of an empty position, naming the chain', async () => {
    const reader = vi.fn(
      async (): Promise<SafeVaultShareRead> => ({
        status: 'read',
        shares: 0n,
        assetsUsdc: 0n,
      }),
    );

    const result = await checkSafeWithdrawShares(
      { ...INPUT, amountUnits: null },
      reader,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.gate).toBe('safe-insufficient-shares');
      expect(result.reason).toMatch(/no MetaMorpho shares on Ethereum/);
    }
  });

  it('allows "all" whenever the Safe holds any shares, returning the redeem amount', async () => {
    const reader = vi.fn(
      async (): Promise<SafeVaultShareRead> => ({
        status: 'read',
        shares: 7n,
        // Even a dust position valued below one USDC unit is redeemable in full.
        assetsUsdc: 0n,
      }),
    );

    const result = await checkSafeWithdrawShares(
      { ...INPUT, amountUnits: null },
      reader,
    );

    expect(result).toEqual({ ok: true, shares: 7n, assetsUsdc: 0n });
  });
});

describe('checkSafeWithdrawShares — failed reads never pass', () => {
  it('refuses an unreadable share balance with the real reason, never a pass or a zero', async () => {
    const reader = vi.fn(
      async (): Promise<SafeVaultShareRead> => ({
        status: 'failed',
        reason: 'the vault share balance read failed: connection refused',
      }),
    );

    const result = await checkSafeWithdrawShares(INPUT, reader);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.gate).toBe('safe-shares-unreadable');
      expect(result.reason).toMatch(/could not be read/);
      expect(result.reason).toMatch(/connection refused/);
      expect(result.reason).not.toMatch(/worth/);
    }
  });

  it('refuses when the reader throws, rather than assuming sufficiency', async () => {
    const reader = vi.fn(async (): Promise<SafeVaultShareRead> => {
      throw new Error('ETHEREUM_RPC_URL is not set');
    });

    const result = await checkSafeWithdrawShares(INPUT, reader);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.gate).toBe('safe-shares-unreadable');
      expect(result.reason).toMatch(/ETHEREUM_RPC_URL/);
    }
  });

  it('reads the vault the caller resolved, with no second hard-coded address', async () => {
    const seen: SafeVaultShareInput[] = [];
    const reader = vi.fn(async (input: SafeVaultShareInput) => {
      seen.push(input);
      return { status: 'read', shares: 1n, assetsUsdc: 0n } as SafeVaultShareRead;
    });

    await checkSafeWithdrawShares({ ...INPUT, vault: OTHER_VAULT }, reader);

    expect(seen[0]?.vault).toBe(OTHER_VAULT);
  });

  it('derives the chain name from the chain id, ignoring a mislabelled caller', async () => {
    const reader = vi.fn(
      async (): Promise<SafeVaultShareRead> => ({
        status: 'read',
        shares: 1n,
        assetsUsdc: 0n,
      }),
    );

    const result = await checkSafeWithdrawShares(
      {
        safeAddress: SAFE,
        vault: VAULT,
        chainId: 42161,
        // A caller may mislabel the chain; the refusal must still name where
        // the shares actually are.
        chainName: 'Ethereum',
        amountUnits: 1_000_000n,
      },
      reader,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.gate).toBe('safe-insufficient-shares');
      expect(result.reason).toMatch(/on Arbitrum One/);
    }
    expect(reader).toHaveBeenCalledWith({
      safeAddress: SAFE,
      vault: VAULT,
      chainId: 42161,
      chainName: 'Arbitrum One',
      amountUnits: 1_000_000n,
    });
  });
});

describe('readSafeVaultSharesFromRpc', () => {
  const previous = process.env.ETHEREUM_RPC_URL;

  afterEach(() => {
    if (previous === undefined) delete process.env.ETHEREUM_RPC_URL;
    else process.env.ETHEREUM_RPC_URL = previous;
  });

  it('reports a failed read when the mainnet RPC is not configured, without a network call', async () => {
    delete process.env.ETHEREUM_RPC_URL;

    const result = await readSafeVaultSharesFromRpc({
      safeAddress: SAFE,
      vault: VAULT,
      chainId: 1,
    });

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toMatch(/ETHEREUM_RPC_URL/);
    }
  });

  it('does not fall back to the mainnet RPC when the vault chain has none', async () => {
    delete process.env.BASE_RPC_URL;
    process.env.ETHEREUM_RPC_URL = 'https://mainnet.example';

    const result = await readSafeVaultSharesFromRpc({
      safeAddress: SAFE,
      vault: OTHER_VAULT,
      chainId: 8453,
    });

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toMatch(/BASE_RPC_URL/);
      expect(result.reason).not.toMatch(/ETHEREUM_RPC_URL/);
      expect(result.reason).toMatch(/Base/);
    }
  });
});
