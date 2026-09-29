import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Address } from 'viem';
import {
  checkSafeDepositFunding,
  readSafeUsdcBalanceFromRpc,
  type SafeUsdcBalanceInput,
  type SafeUsdcBalanceRead,
} from '@/lib/invest/safe-usdc-balance';

/**
 * The Safe-funding gate (T19, D18 / EXE-014).
 *
 * The deposit pulls exactly its USDC amount from the Safe, so an under-funded
 * Safe can never execute. These tests prove the gate refuses **before** anything
 * is built, names the chain and the held/needed amounts, and treats a failed
 * read as a refusal with the real reason rather than as a sufficient (or zero)
 * balance. Every read is injected, so nothing touches the network.
 */

const SAFE = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed' as Address;
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address;
const OTHER_USDC = '0x1111222233334444555566667777888899990000' as Address;

const INPUT = {
  safeAddress: SAFE,
  usdc: USDC,
  chainId: 1,
  chainName: 'Ethereum',
  // 1 USDC at 6 decimals, the amount from the reported deposit.
  amountUnits: 1_000_000n,
} as const;

describe('checkSafeDepositFunding', () => {
  it('refuses when the Safe holds less than the deposit, naming the chain and the shortfall', async () => {
    const reader = vi.fn(
      async (): Promise<SafeUsdcBalanceRead> => ({ status: 'read', balance: 0n }),
    );

    const result = await checkSafeDepositFunding(INPUT, reader);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.gate).toBe('safe-insufficient-usdc');
      // The chain, what the Safe holds, what is needed and the shortfall.
      expect(result.reason).toMatch(/holds 0 USDC on Ethereum/);
      expect(result.reason).toMatch(/needs 1 USDC/);
      expect(result.reason).toMatch(/at least 1 USDC/);
    }
    // The read targets the token and chain the deposit uses, not a copy.
    expect(reader).toHaveBeenCalledWith({
      safeAddress: SAFE,
      usdc: USDC,
      chainId: 1,
      chainName: 'Ethereum',
      amountUnits: 1_000_000n,
    });
  });

  it('reports the exact shortfall for a partially funded Safe', async () => {
    const reader = vi.fn(
      async (): Promise<SafeUsdcBalanceRead> => ({ status: 'read', balance: 250_000n }),
    );

    const result = await checkSafeDepositFunding(INPUT, reader);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.gate).toBe('safe-insufficient-usdc');
      expect(result.reason).toMatch(/holds 0\.25 USDC/);
      expect(result.reason).toMatch(/at least 0\.75 USDC/);
    }
  });

  it('allows a deposit the Safe holds exactly enough for', async () => {
    const reader = vi.fn(
      async (): Promise<SafeUsdcBalanceRead> => ({
        status: 'read',
        balance: 1_000_000n,
      }),
    );

    const result = await checkSafeDepositFunding(INPUT, reader);

    expect(result).toEqual({ ok: true, balance: 1_000_000n });
  });

  it('allows a deposit the Safe holds more than enough for', async () => {
    const reader = vi.fn(
      async (): Promise<SafeUsdcBalanceRead> => ({
        status: 'read',
        balance: 5_000_000n,
      }),
    );

    const result = await checkSafeDepositFunding(INPUT, reader);

    expect(result).toEqual({ ok: true, balance: 5_000_000n });
  });

  it('refuses an unreadable balance with the real reason, never a pass or a zero', async () => {
    const reader = vi.fn(
      async (): Promise<SafeUsdcBalanceRead> => ({
        status: 'failed',
        reason: 'the balance read failed: connection refused',
      }),
    );

    const result = await checkSafeDepositFunding(INPUT, reader);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Distinguished from "too little": this is the unreadable gate, and the
      // real reason survives to the message.
      expect(result.gate).toBe('safe-balance-unreadable');
      expect(result.reason).toMatch(/could not be read/);
      expect(result.reason).toMatch(/connection refused/);
      expect(result.reason).not.toMatch(/holds/);
    }
  });

  it('refuses when the reader throws, rather than assuming sufficiency', async () => {
    const reader = vi.fn(async (): Promise<SafeUsdcBalanceRead> => {
      throw new Error('ETHEREUM_RPC_URL is not set');
    });

    const result = await checkSafeDepositFunding(INPUT, reader);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.gate).toBe('safe-balance-unreadable');
      expect(result.reason).toMatch(/ETHEREUM_RPC_URL/);
    }
  });

  it('reads the USDC the caller resolved, with no second hard-coded address', async () => {
    const seen: SafeUsdcBalanceInput[] = [];
    const reader = vi.fn(async (input: SafeUsdcBalanceInput) => {
      seen.push(input);
      return { status: 'read', balance: 0n } as SafeUsdcBalanceRead;
    });

    await checkSafeDepositFunding({ ...INPUT, usdc: OTHER_USDC }, reader);

    expect(seen[0]?.usdc).toBe(OTHER_USDC);
  });
});

describe('readSafeUsdcBalanceFromRpc', () => {
  const previous = process.env.ETHEREUM_RPC_URL;

  afterEach(() => {
    if (previous === undefined) delete process.env.ETHEREUM_RPC_URL;
    else process.env.ETHEREUM_RPC_URL = previous;
  });

  it('reports a failed read when the mainnet RPC is not configured, without a network call', async () => {
    delete process.env.ETHEREUM_RPC_URL;

    const result = await readSafeUsdcBalanceFromRpc({
      safeAddress: SAFE,
      usdc: USDC,
      chainId: 1,
    });

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toMatch(/ETHEREUM_RPC_URL/);
    }
  });
});
