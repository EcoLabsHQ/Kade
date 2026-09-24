import { describe, expect, it, vi } from 'vitest';
import {
  aggregateHoldings,
  classifyWalletRows,
  selectVerifiedWallets,
  type WalletLinkRow,
} from '@/lib/wealth/holdings';
import { CONNECTED_WALLET_PROVIDER, type EvmChainBalance } from '@/lib/wealth/types';

/**
 * Holdings counts **only** signature-verified wallets in its total.
 *
 * The structural guarantee under test is that a row without a usable
 * `verified_at` can never become a `VerifiedWallet`, so it can never contribute
 * a holding. A connected wallet or a pasted EVM address (`verified_at` NULL) is
 * a distinct unverified class, shown separately and never added to the total,
 * while a pasted Bitcoin address is excluded from both classes.
 */

const VERIFIED = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const VERIFIED_LOWER = VERIFIED.toLowerCase();
const PASTED = '0x2222222222222222222222222222222222222222';
const CONNECTED = '0x3333333333333333333333333333333333333333';
const BITCOIN = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

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

function connectedRow(overrides: Partial<WalletLinkRow> = {}): WalletLinkRow {
  return {
    id: 3,
    address: CONNECTED,
    chain: 1,
    provider: CONNECTED_WALLET_PROVIDER,
    verifiedAt: null,
    ...overrides,
  };
}

function bitcoinRow(overrides: Partial<WalletLinkRow> = {}): WalletLinkRow {
  return {
    id: 4,
    address: BITCOIN,
    chain: 0,
    provider: 'bitcoin-address',
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

describe('classifyWalletRows — the exact partition', () => {
  it('(a) puts any row with a usable verified_at in the verified class', () => {
    const { verified, unverifiedWallets } = classifyWalletRows([
      verifiedRow({ provider: 'siwe' }),
    ]);

    expect(verified).toHaveLength(1);
    expect(verified[0]!.address).toBe(VERIFIED);
    expect(unverifiedWallets).toEqual([]);
  });

  it('(b) puts a connected row with verified_at NULL in the unverified class', () => {
    const { verified, unverifiedWallets } = classifyWalletRows([
      connectedRow(),
    ]);

    expect(verified).toEqual([]);
    expect(unverifiedWallets).toHaveLength(1);
    expect(unverifiedWallets[0]!.address).toBe(CONNECTED);
    expect(unverifiedWallets[0]!.provider).toBe(CONNECTED_WALLET_PROVIDER);
  });

  it('(c) puts a pasted EVM row with verified_at NULL in the unverified class', () => {
    const { verified, unverifiedWallets } = classifyWalletRows([pastedRow()]);

    expect(verified).toEqual([]);
    expect(unverifiedWallets).toHaveLength(1);
    expect(unverifiedWallets[0]!.address).toBe(PASTED);
    // Provenance is carried so the UI can label the row.
    expect(unverifiedWallets[0]!.provider).toBe('pasted-address');
  });

  it('(d) keeps a pasted Bitcoin row out of both classes', () => {
    const { verified, unverifiedWallets } = classifyWalletRows([
      bitcoinRow(),
    ]);

    expect(verified).toEqual([]);
    expect(unverifiedWallets).toEqual([]);
  });

  it('prefers the verified class when one address has both kinds of row', () => {
    const { verified, unverifiedWallets } = classifyWalletRows([
      connectedRow({ id: 1, address: VERIFIED, chain: 1 }),
      verifiedRow({ id: 2, address: VERIFIED, chain: 8453 }),
    ]);

    expect(verified).toHaveLength(1);
    // The verified class is built from verified rows only, so it keeps that
    // row's chains; the connected row is not duplicated into it. Critically, the
    // address is not shown unverified as well.
    expect(verified[0]!.chainIds).toEqual([8453]);
    expect(unverifiedWallets).toEqual([]);
  });

  it('prefers the verified class over a pasted row for the same address', () => {
    const { verified, unverifiedWallets } = classifyWalletRows([
      pastedRow({ id: 1, address: VERIFIED, chain: 1 }),
      verifiedRow({ id: 2, address: VERIFIED, chain: 8453 }),
    ]);

    expect(verified).toHaveLength(1);
    expect(verified[0]!.chainIds).toEqual([8453]);
    // The address is never shown twice: the pasted row is not also unverified.
    expect(unverifiedWallets).toEqual([]);
  });

  it('groups a connected address across chains and drops duplicate addresses', () => {
    const { unverifiedWallets } = classifyWalletRows([
      connectedRow({ id: 1, chain: 1 }),
      connectedRow({ id: 2, chain: 8453 }),
      connectedRow({ id: 3, chain: 1, address: CONNECTED.toLowerCase() }),
    ]);

    expect(unverifiedWallets).toHaveLength(1);
    expect(unverifiedWallets[0]!.chainIds).toEqual([1, 8453]);
  });

  it('groups a pasted EVM address across chains and keeps its provider', () => {
    const { unverifiedWallets } = classifyWalletRows([
      pastedRow({ id: 1, chain: 1 }),
      pastedRow({ id: 2, chain: 8453 }),
      pastedRow({ id: 3, chain: 1, address: PASTED.toLowerCase() }),
    ]);

    expect(unverifiedWallets).toHaveLength(1);
    expect(unverifiedWallets[0]!.chainIds).toEqual([1, 8453]);
    expect(unverifiedWallets[0]!.provider).toBe('pasted-address');
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
      unverifiedWallets: [],
      unverifiedCount: 0,
    });
    expect(readBalances).not.toHaveBeenCalled();
  });
});

describe('aggregateHoldings — unverified wallets are separate and never in the total', () => {
  it('shows the connected wallet but does not add its value to the total', async () => {
    const readBalances = vi.fn(async (address: string) => ({
      chains: chains(address === VERIFIED ? 2500 : 1250),
      usd: address === VERIFIED ? 2500 : 1250,
    }));

    const { verified, unverifiedWallets } = classifyWalletRows([
      verifiedRow(),
      connectedRow(),
    ]);
    const aggregate = await aggregateHoldings({
      wallets: verified,
      unverifiedWallets: unverifiedWallets,
      readBalances,
    });

    // Only the verified $2,500 is in the total; the connected $1,250 is shown
    // separately and excluded, so the verified counts describe verified only.
    expect(aggregate.total).toBe(2500);
    expect(aggregate.walletCount).toBe(1);
    expect(aggregate.valuedCount).toBe(1);
    expect(aggregate.unvaluedCount).toBe(0);
    expect(aggregate.unverifiedCount).toBe(1);
    expect(aggregate.unverifiedWallets).toHaveLength(1);
    expect(aggregate.unverifiedWallets[0]!.usd).toBe(1250);
    expect(aggregate.unverifiedWallets[0]!.provider).toBe(
      CONNECTED_WALLET_PROVIDER,
    );
  });

  it('shows a pasted EVM wallet unverified and excludes it from the total', async () => {
    const readBalances = vi.fn(async (address: string) => ({
      chains: chains(address === VERIFIED ? 2500 : 700),
      usd: address === VERIFIED ? 2500 : 700,
    }));

    const { verified, unverifiedWallets } = classifyWalletRows([
      verifiedRow(),
      pastedRow(),
    ]);
    const aggregate = await aggregateHoldings({
      wallets: verified,
      unverifiedWallets,
      readBalances,
    });

    // The pasted EVM balance is read and shown, but only the signature-verified
    // $2,500 reaches the total and the verified counts.
    expect(aggregate.total).toBe(2500);
    expect(aggregate.walletCount).toBe(1);
    expect(aggregate.valuedCount).toBe(1);
    expect(aggregate.unverifiedCount).toBe(1);
    expect(aggregate.unverifiedWallets[0]!.address).toBe(PASTED);
    expect(aggregate.unverifiedWallets[0]!.provider).toBe('pasted-address');
    expect(aggregate.unverifiedWallets[0]!.usd).toBe(700);
  });

  it('keeps a failed connected read as a readError, not a fabricated zero', async () => {
    const readBalances = vi.fn(async (address: string) => {
      if (address === CONNECTED) throw new Error('The provider returned 503.');
      return { chains: chains(100), usd: 100 };
    });

    const aggregate = await aggregateHoldings({
      wallets: [],
      unverifiedWallets: classifyWalletRows([connectedRow()]).unverifiedWallets,
      readBalances,
    });

    expect(aggregate.total).toBe(0);
    expect(aggregate.unverifiedCount).toBe(1);
    expect(aggregate.unverifiedWallets[0]!.usd).toBeNull();
    expect(aggregate.unverifiedWallets[0]!.readError).toMatch(/503/);
  });

  it('reads a Bitcoin row under neither class', async () => {
    const readBalances = vi.fn(async () => ({
      chains: chains(999),
      usd: 999,
    }));

    const aggregate = await aggregateHoldings({
      wallets: selectVerifiedWallets([bitcoinRow()]),
      unverifiedWallets: classifyWalletRows([bitcoinRow()]).unverifiedWallets,
      readBalances,
    });

    expect(readBalances).not.toHaveBeenCalled();
    expect(aggregate.total).toBe(0);
    expect(aggregate.unverifiedCount).toBe(0);
  });
});
