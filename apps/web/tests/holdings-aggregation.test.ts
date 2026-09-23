import { describe, expect, it, vi } from 'vitest';
import {
  aggregateHoldings,
  selectVerifiedWallets,
  type WalletLinkRow,
} from '@/lib/wealth/holdings';
import type { EvmChainBalance } from '@/lib/wealth/types';

/**
 * Holdings counts **only** signature-verified wallets.
 *
 * The structural guarantee under test is that a pasted row — `verified_at` NULL,
 * the documented "unverified" meaning — can never become a `VerifiedWallet`, so
 * it can never contribute a holding. That is proven here at the predicate, not
 * at the screen.
 */

const VERIFIED = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const VERIFIED_LOWER = VERIFIED.toLowerCase();
const PASTED = '0x2222222222222222222222222222222222222222';

function verifiedRow(overrides: Partial<WalletLinkRow> = {}): WalletLinkRow {
  return {
    id: 1,
    address: VERIFIED,
    chain: 1,
    provider: 'pasted-address',
    verifiedAt: '2026-09-22T10:00:00.000Z',
    ...overrides,
  };
}

function pastedRow(overrides: Partial<WalletLinkRow> = {}): WalletLinkRow {
  return {
    id: 2,
    address: PASTED,
    chain: 1,
    provider: 'pasted-address',
    verifiedAt: null,
    ...overrides,
  };
}

function chains(usd: number | null, chainId = 1): EvmChainBalance[] {
  return [
    {
      chainId,
      name: 'Ethereum',
      nativeSymbol: 'ETH',
      nativeAmount: '1.000000',
      nativeUsd: usd,
      usdc: null,
      usd,
    },
  ];
}

describe('selectVerifiedWallets — pasted rows are excluded by construction', () => {
  it('drops a pasted row with verified_at NULL and keeps only the verified one', () => {
    const wallets = selectVerifiedWallets([pastedRow(), verifiedRow()]);

    expect(wallets).toHaveLength(1);
    expect(wallets[0]!.address).toBe(VERIFIED);
  });

  it('produces no wallet at all when every row is pasted', () => {
    const wallets = selectVerifiedWallets([
      pastedRow({ id: 1, chain: 1 }),
      pastedRow({ id: 2, address: PASTED.toLowerCase(), chain: 8453 }),
    ]);

    expect(wallets).toEqual([]);
  });

  it('treats a blank or unparseable verified_at as unverified', () => {
    const wallets = selectVerifiedWallets([
      verifiedRow({ verifiedAt: '' }),
      verifiedRow({ id: 2, verifiedAt: '   ' }),
      verifiedRow({ id: 3, verifiedAt: 'not-a-date' }),
    ]);

    expect(wallets).toEqual([]);
  });

  it('groups the chain rows of one verified address and keeps the earliest proof', () => {
    const wallets = selectVerifiedWallets([
      verifiedRow({ id: 1, chain: 8453, verifiedAt: '2026-09-22T12:00:00.000Z' }),
      verifiedRow({ id: 2, chain: 1, verifiedAt: '2026-09-22T10:00:00.000Z' }),
      verifiedRow({ id: 3, address: VERIFIED_LOWER, chain: 1 }),
    ]);

    expect(wallets).toHaveLength(1);
    expect(wallets[0]!.chainIds).toEqual([1, 8453]);
    expect(wallets[0]!.verifiedAt).toBe('2026-09-22T10:00:00.000Z');
  });
});

describe('aggregateHoldings — total and per-wallet breakdown', () => {
  it('sums the readable wallets and reports the count', async () => {
    const readBalances = vi.fn(async (address: string) => ({
      chains: chains(address === VERIFIED ? 2500 : 780),
      usd: address === VERIFIED ? 2500 : 780,
    }));

    const aggregate = await aggregateHoldings({
      wallets: selectVerifiedWallets([
        verifiedRow({ address: VERIFIED }),
        verifiedRow({ id: 2, address: PASTED, chain: 8453 }),
      ]),
      readBalances,
    });

    expect(aggregate.total).toBe(2500 + 780);
    expect(aggregate.walletCount).toBe(2);
    expect(aggregate.valuedCount).toBe(2);
    expect(aggregate.unvaluedCount).toBe(0);
    expect(aggregate.wallets.map((wallet) => wallet.address)).toEqual([
      VERIFIED,
      PASTED,
    ]);
  });

  it('never reads a pasted address, because it is not in the input', async () => {
    const readBalances = vi.fn(async () => ({
      chains: chains(2500),
      usd: 2500,
    }));

    await aggregateHoldings({
      wallets: selectVerifiedWallets([pastedRow(), verifiedRow()]),
      readBalances,
    });

    expect(readBalances).toHaveBeenCalledTimes(1);
    expect(readBalances).toHaveBeenCalledWith(VERIFIED);
    expect(readBalances).not.toHaveBeenCalledWith(PASTED);
  });

  it('reads each distinct verified address once even when the input repeats it', async () => {
    const readBalances = vi.fn(async () => ({
      chains: chains(100),
      usd: 100,
    }));

    const aggregate = await aggregateHoldings({
      wallets: selectVerifiedWallets([
        verifiedRow({ id: 1 }),
        verifiedRow({ id: 2 }),
      ]),
      readBalances,
    });

    expect(readBalances).toHaveBeenCalledTimes(1);
    expect(aggregate.walletCount).toBe(1);
    expect(aggregate.total).toBe(100);
  });

  it('reports a failed read honestly instead of fabricating a zero', async () => {
    const readBalances = vi.fn(async () => {
      throw new Error('The explorer returned HTTP 503.');
    });

    const aggregate = await aggregateHoldings({
      wallets: selectVerifiedWallets([verifiedRow()]),
      readBalances,
    });

    expect(aggregate.total).toBe(0);
    expect(aggregate.walletCount).toBe(1);
    expect(aggregate.valuedCount).toBe(0);
    expect(aggregate.unvaluedCount).toBe(1);
    expect(aggregate.wallets[0]!.usd).toBeNull();
    expect(aggregate.wallets[0]!.readError).toMatch(/HTTP 503/);
  });

  it('treats a null USD figure as unvalued and adds nothing to the total', async () => {
    const readBalances = vi.fn(async () => ({
      chains: chains(null),
      usd: null,
    }));

    const aggregate = await aggregateHoldings({
      wallets: selectVerifiedWallets([verifiedRow()]),
      readBalances,
    });

    expect(aggregate.total).toBe(0);
    expect(aggregate.unvaluedCount).toBe(1);
    expect(aggregate.wallets[0]!.usd).toBeNull();
  });

  it('returns an empty aggregate when no wallet is verified', async () => {
    const readBalances = vi.fn();

    const aggregate = await aggregateHoldings({
      wallets: selectVerifiedWallets([pastedRow()]),
      readBalances,
    });

    expect(aggregate).toEqual({
      total: 0,
      walletCount: 0,
      valuedCount: 0,
      unvaluedCount: 0,
      wallets: [],
    });
    expect(readBalances).not.toHaveBeenCalled();
  });
});
