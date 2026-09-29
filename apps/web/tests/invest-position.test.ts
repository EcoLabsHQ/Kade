import { describe, expect, it } from 'vitest';
import {
  NO_SAFE_POSITION_REASON,
  summarizeInvestPosition,
} from '@/lib/invest/invest-position';
import type { InvestVaultSummary } from '@/app/invest/actions';
import type { VaultHoldingRow } from '@/lib/wealth/vault-holdings';

/**
 * The Invest screen's one position read, reduced for the screen.
 *
 * The screen has a single source of truth — the rows from `loadVaultHoldings` —
 * and this module is the pure reduction from those rows to the stat figures,
 * each row's state and the allocate preview. These tests pin the honesty rules
 * the rest of the surface follows: a real read yields a real figure, an empty
 * read yields a truthful zero, and a failed read yields its **specific reason**
 * and never a fabricated `0`.
 */

const SAFE = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';

const RAILS: readonly InvestVaultSummary[] = [
  {
    configured: true,
    chainId: 1,
    chainName: 'Ethereum',
    vault: '0x1111111111111111111111111111111111111111',
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  },
  {
    configured: true,
    chainId: 8453,
    chainName: 'Base',
    vault: '0x2222222222222222222222222222222222222222',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
  // Pinned but not configured: it must never become a selectable investment,
  // so it never appears in `byChain`.
  {
    configured: false,
    chainId: 42161,
    chainName: 'Arbitrum One',
    vault: null,
    usdc: null,
  },
];

function row(
  override: Partial<VaultHoldingRow> &
    Pick<VaultHoldingRow, 'kind' | 'chainId' | 'chainName'>,
): VaultHoldingRow {
  return {
    key: `${override.chainId}:${override.kind}`,
    symbol: override.kind === 'morpho' ? 'MM' : 'USDC',
    name:
      override.kind === 'morpho'
        ? 'MetaMorpho USDC vault'
        : override.chainName,
    amount: '0.000000 USDC',
    usd: null,
    readError: null,
    ...override,
  };
}

describe('summarizeInvestPosition', () => {
  it('sums free USDC and allocated from the one read and states each rail', () => {
    const position = summarizeInvestPosition({
      safeAddress: SAFE,
      vaults: RAILS,
      holdings: [
        row({ kind: 'usdc', chainId: 1, chainName: 'Ethereum', usd: 12500 }),
        row({
          kind: 'morpho',
          chainId: 1,
          chainName: 'Ethereum',
          usd: 10000,
          amount: '10000.000000 USDC',
        }),
        // Base was read and holds nothing, so the reader emitted no row.
      ],
    });

    expect(position.freeUsdc).toEqual({ status: 'known', usd: 12500 });
    expect(position.allocated).toEqual({ status: 'known', usd: 10000 });
    expect(position.heldCount).toBe(1);
    expect(position.byChain.get(1)).toEqual({ status: 'held', usd: 10000 });
    expect(position.byChain.get(8453)).toEqual({ status: 'empty' });
    // An unconfigured rail is never claimed as a position.
    expect(position.byChain.has(42161)).toBe(false);
  });

  it('reports a truthful zero when the read succeeded and the Safe holds nothing', () => {
    const position = summarizeInvestPosition({
      safeAddress: SAFE,
      vaults: RAILS,
      holdings: [],
    });

    expect(position.freeUsdc).toEqual({ status: 'known', usd: 0 });
    expect(position.allocated).toEqual({ status: 'known', usd: 0 });
    expect(position.heldCount).toBe(0);
    for (const rail of [1, 8453]) {
      expect(position.byChain.get(rail)).toEqual({ status: 'empty' });
    }
  });

  it('turns an unread chain into an unknown free-USDC figure with its reason', () => {
    const position = summarizeInvestPosition({
      safeAddress: SAFE,
      vaults: RAILS,
      holdings: [
        row({
          kind: 'unread',
          chainId: 8453,
          chainName: 'Base',
          amount: '—',
          readError:
            'Base (chain 8453): the balance provider is rate limiting this read (HTTP 429).',
        }),
      ],
    });

    expect(position.freeUsdc.status).toBe('unknown');
    if (position.freeUsdc.status === 'unknown') {
      expect(position.freeUsdc.reason).toMatch(/rate limiting/);
    }
    // The specific reason, never a zero.
    expect(JSON.stringify(position.freeUsdc)).not.toContain('"usd":0');
    expect(position.freeByChain.get(8453)?.status).toBe('unknown');
    // The vault read was independent of the balance read, so it stays known.
    expect(position.allocated).toEqual({ status: 'known', usd: 0 });
  });

  it('turns a failed vault read into an unknown allocated figure with its reason', () => {
    const reason = 'The vault position could not be read: execution reverted.';
    const position = summarizeInvestPosition({
      safeAddress: SAFE,
      vaults: RAILS,
      holdings: [
        row({
          kind: 'morpho',
          chainId: 1,
          chainName: 'Ethereum',
          amount: '—',
          readError: reason,
        }),
      ],
    });

    expect(position.allocated).toEqual({
      status: 'unknown',
      reason: `Ethereum: ${reason}`,
    });
    expect(position.heldCount).toBe(0);
    expect(position.byChain.get(1)).toEqual({
      status: 'unknown',
      reason,
    });
    // The failed rail is never reported as a zero.
    expect(JSON.stringify(position.allocated)).not.toContain('"usd":0');
  });

  it('claims nothing and fabricates nothing when there is no Safe', () => {
    const position = summarizeInvestPosition({
      safeAddress: null,
      vaults: RAILS,
      holdings: [],
    });

    expect(position.freeUsdc).toEqual({
      status: 'unknown',
      reason: NO_SAFE_POSITION_REASON,
    });
    expect(position.allocated).toEqual({
      status: 'unknown',
      reason: NO_SAFE_POSITION_REASON,
    });
    expect(position.heldCount).toBe(0);
    expect(position.byChain.get(1)).toEqual({
      status: 'unknown',
      reason: NO_SAFE_POSITION_REASON,
    });
    expect(JSON.stringify(position)).not.toContain('"usd":0');
  });

  it('sums the free USDC per configured chain for the allocate preview', () => {
    const position = summarizeInvestPosition({
      safeAddress: SAFE,
      vaults: RAILS,
      holdings: [
        row({ kind: 'usdc', chainId: 1, chainName: 'Ethereum', usd: 150000 }),
        row({
          kind: 'unread',
          chainId: 8453,
          chainName: 'Base',
          amount: '—',
          readError: 'Base: the USDC balance could not be read.',
        }),
      ],
    });

    expect(position.freeByChain.get(1)).toEqual({ status: 'known', usd: 150000 });
    expect(position.freeByChain.get(8453)).toEqual({
      status: 'unknown',
      reason: 'Base: the USDC balance could not be read.',
    });
    expect(position.freeByChain.has(42161)).toBe(false);
  });
});
