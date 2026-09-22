import { describe, expect, it } from 'vitest';
import { summarizeWealth } from '@/lib/wealth/summary';
import type {
  BitcoinAddressRecord,
  EvmAddressRecord,
} from '@/lib/wealth/types';

/**
 * The proof-of-wealth total deduplicates by address, whichever path an address
 * arrived through. These tests pin the counting rule independently of the
 * components that render it.
 */

const ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';

function evm(address: string, usd: number | null): EvmAddressRecord {
  return {
    address,
    chains: [],
    usd,
    readAt: '2026-09-21T00:00:00Z',
    readError: null,
  };
}

function bitcoin(address: string, usd: number | null): BitcoinAddressRecord {
  return {
    id: 1,
    address,
    btc: null,
    usd,
    readAt: '2026-09-21T00:00:00Z',
    readError: null,
  };
}

describe('summarizeWealth', () => {
  it('counts an address connected and pasted exactly once', () => {
    const summary = summarizeWealth({
      connectedWallets: [{ address: ADDRESS, usd: 2510 }],
      evmAddresses: [evm(ADDRESS, 2380)],
      bitcoinAddresses: [],
    });

    expect(summary.total).toBe(2510);
    expect(summary.connectedCount).toBe(1);
    expect(summary.walletAddressCount).toBe(0);
  });

  it('counts the same address connected twice once', () => {
    const summary = summarizeWealth({
      connectedWallets: [
        { address: ADDRESS, usd: 2510 },
        { address: ADDRESS, usd: 2510 },
      ],
      evmAddresses: [],
      bitcoinAddresses: [],
    });

    expect(summary.total).toBe(2510);
    expect(summary.connectedCount).toBe(1);
  });

  it('compares addresses case-insensitively', () => {
    const summary = summarizeWealth({
      connectedWallets: [{ address: ADDRESS, usd: 2510 }],
      evmAddresses: [evm(ADDRESS.toLowerCase(), 2380)],
      bitcoinAddresses: [],
    });

    expect(summary.total).toBe(2510);
    expect(summary.walletAddressCount).toBe(0);
  });

  it('adds a Bitcoin address separately, since it is a different address space', () => {
    const summary = summarizeWealth({
      connectedWallets: [{ address: ADDRESS, usd: 2510 }],
      evmAddresses: [evm(ADDRESS, 2380)],
      bitcoinAddresses: [bitcoin('bc1qexample', 812.34)],
    });

    expect(summary.total).toBeCloseTo(2510 + 812.34);
    expect(summary.bitcoinCount).toBe(1);
  });

  it('does not collapse two distinct pasted addresses', () => {
    const summary = summarizeWealth({
      connectedWallets: [],
      evmAddresses: [
        evm(ADDRESS, 1000),
        evm('0x2222222222222222222222222222222222222222', 500),
      ],
      bitcoinAddresses: [],
    });

    expect(summary.total).toBe(1500);
    expect(summary.walletAddressCount).toBe(2);
  });
});
