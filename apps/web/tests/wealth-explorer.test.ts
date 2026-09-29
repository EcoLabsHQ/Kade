import { describe, expect, it } from 'vitest';
import {
  addressExplorerUrl,
  explorerBase,
  transactionExplorerUrl,
} from '@/lib/wealth/explorer';

/**
 * The per-chain explorer helper.
 *
 * The link must point at the explorer for the chain the value lives on, and an
 * unknown chain must yield no link rather than a guessed host. This is the
 * offline proof behind the transaction links in the invest modal and the
 * move-to-vault dialog.
 */
describe('wealth explorer URLs', () => {
  it('maps each configured chain to its own block explorer', () => {
    expect(explorerBase(1)).toBe('https://etherscan.io');
    expect(explorerBase(11155111)).toBe('https://sepolia.etherscan.io');
    expect(explorerBase(8453)).toBe('https://basescan.org');
  });

  it('builds a transaction link on the requested chain', () => {
    expect(transactionExplorerUrl(1, '0xabc')).toBe(
      'https://etherscan.io/tx/0xabc',
    );
    expect(transactionExplorerUrl(8453, '0xabc')).toBe(
      'https://basescan.org/tx/0xabc',
    );
    expect(transactionExplorerUrl(11155111, '0xabc')).toBe(
      'https://sepolia.etherscan.io/tx/0xabc',
    );
  });

  it('builds an address link on the requested chain', () => {
    expect(addressExplorerUrl(1, '0xdef')).toBe(
      'https://etherscan.io/address/0xdef',
    );
    expect(addressExplorerUrl(8453, '0xdef')).toBe(
      'https://basescan.org/address/0xdef',
    );
  });

  it('returns null for an unknown chain instead of guessing a host', () => {
    expect(explorerBase(999999)).toBeNull();
    expect(transactionExplorerUrl(999999, '0xabc')).toBeNull();
    expect(addressExplorerUrl(999999, '0xdef')).toBeNull();
  });
});
