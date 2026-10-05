import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HoldingsScreen } from '@/components/holdings/HoldingsScreen';
import { deriveChecks, type ResidencyFacts } from '@/lib/residency/checks';
import type { HoldingsAggregate } from '@/lib/wealth/holdings';
import {
  NO_SAFE_QUALIFIED_REASON,
  summarizeQualifiedPosition,
  type QualifiedPosition,
} from '@/lib/wealth/qualified-position';
import type { EvmChainBalance } from '@/lib/wealth/types';
import {
  loadVaultHoldings,
  type VaultHoldingRow,
} from '@/lib/wealth/vault-holdings';

/**
 * The qualified total is **one** value read from the Safe's real on-chain
 * position, and both surfaces that show it — the Holdings `QUALIFIED` card and
 * the residency tier check — consume that one computation.
 *
 * These tests are offline: the on-chain read is injected through
 * `loadVaultHoldings`'s own seams, so they prove the card renders the real total
 * immediately, with no database row, no persistence step and no refresh worker.
 * `container_balances` has no writer and is not involved at all.
 */

const SAFE = '0x5Af1000000000000000000000000000000000c09D';
const CHAINS = [{ chainId: 1, name: 'Ethereum', symbol: 'ETH' }] as const;

const EMPTY_AGGREGATE: HoldingsAggregate = {
  total: 0,
  walletCount: 0,
  valuedCount: 0,
  unvaluedCount: 0,
  wallets: [],
  unverifiedWallets: [],
  unverifiedCount: 0,
};

/** A linked-wallet aggregate whose verified total is `usd`. */
function aggregateWithLinked(usd: number): HoldingsAggregate {
  return {
    total: usd,
    walletCount: 1,
    valuedCount: 1,
    unvaluedCount: 0,
    wallets: [
      {
        address: '0x1111111111111111111111111111111111111111',
        verifiedAt: '2026-09-22T10:00:00.000Z',
        chainIds: [1],
        chains: [],
        usd,
        readError: null,
      },
    ],
    unverifiedWallets: [],
    unverifiedCount: 0,
  };
}

/** One real native holding in the Safe, as the reader emits it. */
function nativeRow(usd: number): VaultHoldingRow {
  return {
    key: `${SAFE}:1:native`,
    kind: 'native',
    chainId: 1,
    chainName: 'Ethereum',
    symbol: 'ETH',
    name: 'Ether',
    amount: '2.000000 ETH',
    usd,
    readError: null,
  };
}

/** The rendered value of the summary card with `label`. */
function cardValue(label: string): string {
  const labelNode = screen.getByText(label);
  return labelNode.parentElement?.children[1]?.textContent ?? '';
}

/** The rendered sub line of the summary card with `label`. */
function cardSub(label: string): string {
  const labelNode = screen.getByText(label);
  return labelNode.parentElement?.children[2]?.textContent ?? '';
}

/** Residency facts carrying the given qualified position. */
function facts(qualified: QualifiedPosition): ResidencyFacts {
  return {
    tier: '3-year',
    identity: {
      provider: 'self',
      status: 'valid',
      verifiedAt: '2026-09-20T00:00:00Z',
      selfNullifier: 'n',
    },
    qualified,
    review: 'cleared',
    serviceFee: { recorded: true, verified: true, amountUsdc: 10 },
    permit: { issued: false, uid: null },
  };
}

function fundsDetail(qualified: QualifiedPosition): string {
  const funds = deriveChecks(facts(qualified)).find((c) => c.id === 'funds');
  if (!funds) throw new Error('no funds check');
  return funds.detail;
}

describe('the qualified total', () => {
  it('reads the Safe’s real on-chain position and renders it in the QUALIFIED card, with no persistence', async () => {
    // The reader is the existing one, with its network seam injected: this is
    // the same call Holdings makes, pointed at the Safe.
    const rows = await loadVaultHoldings(SAFE, {
      chains: CHAINS,
      morphoConfigs: null,
      readBalances: async (): Promise<readonly EvmChainBalance[]> => [
        {
          chainId: 1,
          name: 'Ethereum',
          nativeSymbol: 'ETH',
          nativeAmount: '2.000000',
          nativeUsd: 7500,
          // A successful USDC sub-read that found nothing: `null` here would
          // mean the sub-read *failed* and the reader would emit an unread row.
          usdc: { symbol: 'USDC', amount: '0.000000', usd: 0 },
          usd: 7500,
        },
      ],
    });

    // The one reduction, computed once from those rows.
    const qualified = summarizeQualifiedPosition({ safeAddress: SAFE, rows });
    expect(qualified).toEqual({ status: 'known', usd: 7500 });

    render(
      <HoldingsScreen
        aggregate={EMPTY_AGGREGATE}
        safeAddress={SAFE}
        vaultHoldings={rows}
        qualified={qualified}
      />,
    );

    expect(cardValue('Qualified')).toBe('$7,500');
    // The same figure is the section's real holding, so the card and the table
    // below it cannot disagree.
    expect(screen.getByText('2.000000 ETH')).toBeInTheDocument();
  });

  it('reads one value in both surfaces: the card and the residency tier check consume the same QualifiedPosition', () => {
    // The rows reduce to $5,000, but the page passes a deliberately different
    // single result. If either surface recomputed from the rows instead of
    // consuming that one value, it would show $5,000 and this test would fail.
    const rows = [nativeRow(5000)];
    const position: QualifiedPosition = { status: 'known', usd: 7777 };

    render(
      <HoldingsScreen
        aggregate={EMPTY_AGGREGATE}
        safeAddress={SAFE}
        vaultHoldings={rows}
        qualified={position}
      />,
    );

    expect(cardValue('Qualified')).toBe('$7,777');
    expect(fundsDetail(position)).toBe('$7,777.00 of $280,000.');
  });

  it('reports unknown with its specific reason — and never a fabricated $0 — when the position read failed', () => {
    const unread: VaultHoldingRow = {
      key: `${SAFE}:1:unread`,
      kind: 'unread',
      chainId: 1,
      chainName: 'Ethereum',
      symbol: '—',
      name: 'Ethereum',
      amount: '—',
      usd: null,
      readError: 'The vault balance on Ethereum could not be read.',
    };
    const qualified = summarizeQualifiedPosition({ safeAddress: SAFE, rows: [unread] });
    expect(qualified.status).toBe('unknown');

    render(
      <HoldingsScreen
        aggregate={EMPTY_AGGREGATE}
        safeAddress={SAFE}
        vaultHoldings={[unread]}
        qualified={qualified}
      />,
    );

    expect(cardValue('Qualified')).toBe('—');
    // The card is never a mute `—`: it carries the real reason.
    expect(cardSub('Qualified')).toBe(
      'Ethereum: The vault balance on Ethereum could not be read.',
    );
    // And the unknown never collapses to a fabricated figure on the card.
    expect(cardValue('Qualified')).not.toBe('$0');

    // The tier check refuses the same way, with the same reason.
    const detail = fundsDetail(qualified);
    expect(detail).toContain('The vault balance on Ethereum could not be read.');
    expect(detail).not.toContain('$0');
  });

  it('does not include what is inside the vault in Not qualified; the cards partition the total', () => {
    const linked = 9000;
    const position: QualifiedPosition = { status: 'known', usd: 5000 };

    render(
      <HoldingsScreen
        aggregate={aggregateWithLinked(linked)}
        safeAddress={SAFE}
        vaultHoldings={[nativeRow(5000)]}
        qualified={position}
      />,
    );

    // Qualified is the vault alone; Not qualified is the linked wallets alone,
    // so the vault's $5,000 is not claimed by both cards...
    expect(cardValue('Qualified')).toBe('$5,000');
    expect(cardValue('Not qualified')).toBe('$9,000');
    // ...and the two partition the total truthfully.
    expect(cardValue('Total holdings')).toBe('$14,000');
  });

  it('treats a genuinely empty vault as a real $0, and no recorded vault as unknown with its reason', () => {
    // A successful read of an empty Safe is a real, known zero.
    const empty = summarizeQualifiedPosition({ safeAddress: SAFE, rows: [] });
    expect(empty).toEqual({ status: 'known', usd: 0 });
    expect(fundsDetail(empty)).toBe('$0.00 of $280,000.');

    render(
      <HoldingsScreen
        aggregate={aggregateWithLinked(1000)}
        safeAddress={SAFE}
        vaultHoldings={[]}
        qualified={empty}
      />,
    );
    expect(cardValue('Qualified')).toBe('$0');
    expect(cardValue('Total holdings')).toBe('$1,000');

    // No recorded Safe is honestly unknown, not a fabricated $0.
    const none = summarizeQualifiedPosition({ safeAddress: null, rows: [] });
    expect(none).toEqual({ status: 'unknown', reason: NO_SAFE_QUALIFIED_REASON });
    expect(fundsDetail(none)).toContain(NO_SAFE_QUALIFIED_REASON);
    expect(fundsDetail(none)).not.toContain('$0');
  });
});
