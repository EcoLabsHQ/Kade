import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HoldingsScreen } from '@/components/holdings/HoldingsScreen';
import { EVM_READ_CHAINS } from '@/lib/wealth/evm';
import { usd } from '@/lib/wealth/format';
import type { HoldingsAggregate } from '@/lib/wealth/holdings';
import type { EvmChainBalance } from '@/lib/wealth/types';

/**
 * The per-chain presentation must derive from the same chain set the reads use.
 *
 * `EVM_READ_CHAINS` is the source of truth for which balances are read. This
 * screen used to hardcode its own two-chain list and a stale "Arbitrum is not
 * read" card, so the "Balances by chain" Arbitrum card rendered `—` while the
 * total already included Arbitrum's real balance, and a stored-but-unread
 * Arbitrum row was labelled `Chain 42161`. These tests pin, offline, that:
 *
 *   1. the per-chain card lists exactly `EVM_READ_CHAINS`, each with its real
 *      figure;
 *   2. Arbitrum One renders its **real** balance rather than `—` when the read
 *      produced one, and a stored-but-unread Arbitrum row is labelled
 *      `Arbitrum One` (never `Chain 42161`);
 *   3. an unread chain stays an explicit `—` with its specific reason and is
 *      never turned into a fabricated `0`.
 *
 * Everything is a prop; no network, wallet or environment is touched.
 */

const ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const ADDRESS_2 = '0x2222222222222222222222222222222222222222';
const ARBITRUM_CHAIN_ID = 42161;

/** The registry entry the app reads for Arbitrum One. */
const ARBITRUM = EVM_READ_CHAINS.find(
  (chain) => chain.chainId === ARBITRUM_CHAIN_ID,
);

/** One native-only chain read with the given USD value. */
function nativeBalance(
  chainId: number,
  name: string,
  value: number,
): EvmChainBalance {
  return {
    chainId,
    name,
    nativeSymbol: 'ETH',
    nativeAmount: '1.000000',
    nativeUsd: value,
    usdc: null,
    usd: value,
  };
}

function aggregate(overrides: Partial<HoldingsAggregate> = {}): HoldingsAggregate {
  return {
    total: 0,
    walletCount: 0,
    valuedCount: 0,
    unvaluedCount: 0,
    wallets: [],
    unverifiedWallets: [],
    unverifiedCount: 0,
    ...overrides,
  };
}

interface ChainCard {
  readonly name: string;
  readonly value: string;
  readonly sub: string;
}

/**
 * Parse the "Balances by chain" cards straight from the rendered DOM.
 *
 * The section heading's ancestor card is the only place the chain grid lives;
 * each card is `[name row, value, sub-line]`. Reading it structurally is what
 * lets the test assert the card set and each card's value, rather than a loose
 * "the text exists somewhere".
 */
function chainCards(): ChainCard[] {
  const heading = screen.getByText('Balances by chain');
  const section = heading.parentElement?.parentElement;
  if (!section) throw new Error('The "Balances by chain" section was not rendered.');
  const grid = Array.from(section.querySelectorAll<HTMLElement>('div')).find(
    (element) => element.style.gridTemplateColumns !== '',
  );
  if (!grid) throw new Error('The "Balances by chain" grid was not rendered.');

  return Array.from(grid.children).map((card) => {
    const element = card as HTMLElement;
    return {
      name: element.children[0]?.children[1]?.textContent ?? '',
      value: element.children[1]?.textContent ?? '',
      sub: element.children[2]?.textContent ?? '',
    };
  });
}

describe('HoldingsScreen per-chain cards', () => {
  it('lists exactly the chains EVM_READ_CHAINS reads, each with its real figure', () => {
    // A distinct value per chain, derived from EVM_READ_CHAINS order.
    const values = EVM_READ_CHAINS.map((_, index) => (index + 1) * 1111);
    const total = values.reduce((sum, value) => sum + value, 0);

    render(
      <HoldingsScreen
        aggregate={aggregate({
          total,
          walletCount: 1,
          valuedCount: 1,
          wallets: [
            {
              address: ADDRESS,
              verifiedAt: '2026-09-22T10:00:00.000Z',
              chainIds: EVM_READ_CHAINS.map((chain) => chain.chainId),
              chains: EVM_READ_CHAINS.map((chain, index) =>
                nativeBalance(chain.chainId, chain.name, values[index]!),
              ),
              usd: total,
              readError: null,
            },
          ],
        })}
      />,
    );

    const cards = chainCards();
    const readCards = cards.filter((card) => card.sub === 'Vault available');

    // The read cards are exactly EVM_READ_CHAINS, in registry order.
    expect(readCards.map((card) => card.name)).toEqual(
      EVM_READ_CHAINS.map((chain) => chain.name),
    );
    // And each carries its real figure, never the unread dash.
    expect(readCards.map((card) => card.value)).toEqual(
      values.map((value) => usd(value)),
    );
    expect(readCards.every((card) => card.value !== '—')).toBe(true);

    // The reference's genuinely unread chains are still rendered, as `—`.
    const unreadCards = cards.filter((card) => card.sub === 'Read-only');
    expect(unreadCards.map((card) => card.name)).toEqual(['Optimism', 'Celo']);
    expect(unreadCards.every((card) => card.value === '—')).toBe(true);
  });

  it('renders Arbitrum One’s real balance on its card when the read produced one', () => {
    expect(ARBITRUM).toBeDefined();

    render(
      <HoldingsScreen
        aggregate={aggregate({
          total: 4242,
          walletCount: 1,
          valuedCount: 1,
          wallets: [
            {
              address: ADDRESS,
              verifiedAt: '2026-09-22T10:00:00.000Z',
              chainIds: [ARBITRUM_CHAIN_ID],
              chains: [nativeBalance(ARBITRUM_CHAIN_ID, 'Arbitrum One', 4242)],
              usd: 4242,
              readError: null,
            },
          ],
        })}
      />,
    );

    const arbitrum = chainCards().find((card) => card.name === 'Arbitrum One');
    expect(arbitrum).toBeDefined();
    expect(arbitrum?.value).toBe('$4,242');
    expect(arbitrum?.value).not.toBe('—');
  });

  it('labels a stored-but-unread Arbitrum row “Arbitrum One”, never “Chain 42161”', () => {
    render(
      <HoldingsScreen
        aggregate={aggregate({
          walletCount: 1,
          wallets: [
            {
              address: ADDRESS,
              verifiedAt: '2026-09-22T10:00:00.000Z',
              chainIds: [ARBITRUM_CHAIN_ID],
              chains: [],
              usd: null,
              readError: null,
              failures: [
                {
                  chainId: ARBITRUM_CHAIN_ID,
                  chainName: 'Arbitrum One',
                  reason: 'rejected',
                  message:
                    'Arbitrum One (chain 42161): the balance provider is rate limiting this read (HTTP 429).',
                },
              ],
            },
          ],
        })}
      />,
    );

    expect(screen.getAllByText('Arbitrum One').length).toBeGreaterThan(0);
    expect(screen.queryByText('Chain 42161')).toBeNull();
  });

  it('keeps an unread chain as an explicit dash with its specific reason, never a zero', () => {
    const reason =
      'Arbitrum One (chain 42161): the balance provider is rate limiting this read (HTTP 429).';

    render(
      <HoldingsScreen
        aggregate={aggregate({
          total: 2500,
          walletCount: 2,
          valuedCount: 1,
          unvaluedCount: 1,
          wallets: [
            {
              address: ADDRESS,
              verifiedAt: '2026-09-22T10:00:00.000Z',
              chainIds: [1],
              chains: [nativeBalance(1, 'Ethereum', 2500)],
              usd: 2500,
              readError: null,
            },
            {
              address: ADDRESS_2,
              verifiedAt: '2026-09-22T11:00:00.000Z',
              chainIds: [ARBITRUM_CHAIN_ID],
              chains: [],
              usd: null,
              readError: null,
              failures: [
                {
                  chainId: ARBITRUM_CHAIN_ID,
                  chainName: 'Arbitrum One',
                  reason: 'rejected',
                  message: reason,
                },
              ],
            },
          ],
        })}
      />,
    );

    // The real reason reaches the resident on the unread row.
    expect(screen.getByText(/rate limiting this read/)).toBeInTheDocument();
    // The per-chain card for the stored-but-unread Arbitrum shows `—`, not `0`.
    const arbitrum = chainCards().find((card) => card.name === 'Arbitrum One');
    expect(arbitrum?.value).toBe('—');
    // Nothing fabricates a zero: no zero balance and no `$0` figure.
    expect(screen.queryByText('$0')).toBeNull();
    expect(screen.queryByText('0.000000 ETH')).toBeNull();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
