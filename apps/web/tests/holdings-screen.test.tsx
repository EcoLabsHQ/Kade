import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { getAddress } from 'viem';
import { HoldingsScreen } from '@/components/holdings/HoldingsScreen';
import type {
  HoldingsAggregate,
  UnverifiedHoldingWallet,
} from '@/lib/wealth/holdings';
import type { EvmChainBalance } from '@/lib/wealth/types';
import { shortAddress } from '@/lib/wealth/format';

/**
 * The Holdings screen renders the aggregate over signed wallets and the
 * reference's "In linked wallets" table. It takes a fully-built aggregate, so
 * the exclusion proof lives in the aggregation tests; here we pin what the
 * resident actually sees.
 *
 * This iteration the owner overrode the copy-honesty rule: every visible string
 * is the reference's, verbatim, even where it describes a future state. The
 * arithmetic is unchanged — the total comes from the real aggregate, an
 * unverified wallet is excluded from it, and a failed read stays an explicit
 * `—`. These tests pin that split: reference copy, real numbers.
 */

const ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const ADDRESS_2 = '0x2222222222222222222222222222222222222222';
const CONNECTED_ADDRESS = '0x9999999999999999999999999999999999999999';
const PASTED_ADDRESS = '0x7777777777777777777777777777777777777777';
const SAFE_ADDRESS = '0x5Af1000000000000000000000000000000000c09D';

/** A native-only Ethereum read; no USDC row. */
function ethereum(usd: number | null): EvmChainBalance {
  return {
    chainId: 1,
    name: 'Ethereum',
    nativeSymbol: 'ETH',
    nativeAmount: '1.000000',
    nativeUsd: usd,
    usdc: null,
    usd,
  };
}

/** A chain read that produced both a native and a USDC holding. */
function ethereumWithUsdc(
  nativeUsd: number,
  usdcUsd: number,
): EvmChainBalance {
  return {
    chainId: 1,
    name: 'Ethereum',
    nativeSymbol: 'ETH',
    nativeAmount: '1.000000',
    nativeUsd,
    usdc: { symbol: 'USDC', amount: '780.000000', usd: usdcUsd },
    usd: nativeUsd + usdcUsd,
  };
}

function aggregate(overrides: Partial<HoldingsAggregate> = {}): HoldingsAggregate {
  return {
    total: 3280,
    walletCount: 2,
    valuedCount: 1,
    unvaluedCount: 1,
    wallets: [
      {
        address: ADDRESS,
        verifiedAt: '2026-09-22T10:00:00.000Z',
        chainIds: [1],
        chains: [ethereum(3280)],
        usd: 3280,
        readError: null,
      },
      {
        address: ADDRESS_2,
        verifiedAt: '2026-09-22T11:00:00.000Z',
        chainIds: [1, 8453],
        chains: [],
        usd: null,
        readError: 'The explorer returned HTTP 503.',
      },
    ],
    unverifiedWallets: [],
    unverifiedCount: 0,
    ...overrides,
  };
}

function unverified(
  overrides: Partial<UnverifiedHoldingWallet> & {
    address: string;
    provider: string;
  },
): UnverifiedHoldingWallet {
  return {
    chainIds: [1],
    chains: [],
    usd: null,
    readError: null,
    ...overrides,
  };
}

/** One connected-wallet row and one pasted-address row, both unsigned. */
function aggregateWithUnverified(): HoldingsAggregate {
  return aggregate({
    unverifiedWallets: [
      unverified({
        address: CONNECTED_ADDRESS,
        provider: 'connected-wallet',
        chainIds: [1],
        chains: [ethereum(1250)],
        usd: 1250,
      }),
      unverified({
        address: PASTED_ADDRESS,
        provider: 'pasted-address',
        chainIds: [1],
        chains: [ethereum(700)],
        usd: 700,
      }),
    ],
    unverifiedCount: 2,
  });
}

/** The rendered value of the summary card with `label`, e.g. "Total holdings". */
function cardValue(label: string): string {
  const labelNode = screen.getByText(label);
  return labelNode.parentElement?.children[1]?.textContent ?? '';
}

/** A resident whose every verified wallet's read failed entirely. */
function aggregateAllUnread(): HoldingsAggregate {
  return aggregate({
    total: 0,
    walletCount: 2,
    valuedCount: 0,
    unvaluedCount: 2,
    wallets: [
      {
        address: ADDRESS,
        verifiedAt: '2026-09-22T10:00:00.000Z',
        chainIds: [1],
        chains: [],
        usd: null,
        readError: 'The explorer returned HTTP 503.',
      },
      {
        address: ADDRESS_2,
        verifiedAt: '2026-09-22T11:00:00.000Z',
        chainIds: [1, 8453],
        chains: [],
        usd: null,
        readError: 'The explorer returned HTTP 503.',
      },
    ],
  });
}

/** A resident whose only linked wallets are unverified: no verified rows at all. */
function aggregateOnlyUnverified(): HoldingsAggregate {
  return aggregate({
    total: 0,
    walletCount: 0,
    valuedCount: 0,
    unvaluedCount: 0,
    wallets: [],
    unverifiedWallets: [
      unverified({
        address: CONNECTED_ADDRESS,
        provider: 'connected-wallet',
        chainIds: [1],
        chains: [ethereum(1250)],
        usd: 1250,
      }),
    ],
    unverifiedCount: 1,
  });
}

describe('HoldingsScreen', () => {
  it('shows the reference header copy verbatim', () => {
    render(<HoldingsScreen aggregate={aggregate()} />);

    expect(screen.getByText('Holdings')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Everything you hold in one place. Only assets inside the qualified vault count toward your permit — move funds in to qualify them.',
      ),
    ).toBeInTheDocument();
  });

  it('shows the signed total and the per-holding rows', () => {
    render(
      <HoldingsScreen
        aggregate={aggregate()}
        safeAddress={SAFE_ADDRESS}
        vaultHoldings={[]}
      />,
    );

    // The total, with a genuinely empty vault, is the linked aggregate; the
    // "Not qualified" card reads the same real aggregate.
    expect(screen.getAllByText('$3,280').length).toBeGreaterThanOrEqual(2);
    // The one readable holding is a row; both stored-but-unread chains get a
    // row rather than disappearing.
    expect(screen.getAllByTitle(ADDRESS)).toHaveLength(1);
    expect(screen.getAllByTitle(ADDRESS_2)).toHaveLength(2);
    expect(screen.getByText('1.000000 ETH')).toBeInTheDocument();
    // Owner-directed: a verified wallet's provenance is its address alone.
    // The old "· signature-verified" suffix is gone; the contract requires the
    // row to be listed, not any particular label.
    expect(screen.queryByText(/signature-verified/)).toBeNull();
  });

  it('renders a USDC holding as its own row when the read produced one', () => {
    render(
      <HoldingsScreen
        aggregate={aggregate({
          total: 3280,
          walletCount: 1,
          valuedCount: 1,
          unvaluedCount: 0,
          wallets: [
            {
              address: ADDRESS,
              verifiedAt: '2026-09-22T10:00:00.000Z',
              chainIds: [1],
              chains: [ethereumWithUsdc(2500, 780)],
              usd: 3280,
              readError: null,
            },
          ],
        })}
      />,
    );

    expect(screen.getByText('1.000000 ETH')).toBeInTheDocument();
    expect(screen.getByText('780.000000 USDC')).toBeInTheDocument();
    expect(screen.getByText('$2,500')).toBeInTheDocument();
    expect(screen.getByText('$780')).toBeInTheDocument();
  });

  it('shows an unvalued wallet as a dash with its read error, never a zero', () => {
    render(<HoldingsScreen aggregate={aggregate()} />);

    expect(
      screen.getByText('The explorer returned HTTP 503.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('$0')).toBeNull();
  });

  it('renders the total as — when every verified wallet is unread, never $0', () => {
    render(<HoldingsScreen aggregate={aggregateAllUnread()} />);

    // Both cards that read the aggregate show the honest unknown, not a figure
    // the read never produced.
    expect(cardValue('Total holdings')).toBe('—');
    expect(cardValue('Not qualified')).toBe('—');
    expect(screen.queryByText('$0')).toBeNull();
  });

  it('renders the real total when at least one verified wallet is readable', () => {
    render(
      <HoldingsScreen
        aggregate={aggregate()}
        safeAddress={SAFE_ADDRESS}
        vaultHoldings={[]}
      />,
    );

    // One readable wallet ($3,280) and one unread: the readable figure stands,
    // and the unread wallet does not blank the total to a dash. With a known
    // empty vault the total is the linked aggregate.
    expect(cardValue('Total holdings')).toBe('$3,280');
    expect(cardValue('Not qualified')).toBe('$3,280');
  });

  it('shows a failed USDC sub-read as a — row with its specific reason, never a zero', () => {
    const message =
      'Base (chain 8453): the balance provider is rate limiting this read (HTTP 429).';
    render(
      <HoldingsScreen
        aggregate={aggregate({
          total: 3000,
          walletCount: 1,
          valuedCount: 1,
          unvaluedCount: 0,
          wallets: [
            {
              address: ADDRESS,
              verifiedAt: '2026-09-22T10:00:00.000Z',
              chainIds: [8453],
              chains: [
                {
                  chainId: 8453,
                  name: 'Base',
                  nativeSymbol: 'ETH',
                  nativeAmount: '1.000000',
                  nativeUsd: 3000,
                  usdc: null,
                  tokenFailure: {
                    chainId: 8453,
                    chainName: 'Base',
                    reason: 'rejected',
                    message,
                  },
                  usd: 3000,
                },
              ],
              usd: 3000,
              readError: null,
            },
          ],
        })}
      />,
    );

    // The native row is still real, and the unread token is its own row carrying
    // the specific reason rather than disappearing.
    expect(screen.getByText('1.000000 ETH')).toBeInTheDocument();
    expect(screen.getByText(/rate limiting this read/)).toBeInTheDocument();
    // No fabricated zero: no USDC amount and no $0 value.
    expect(screen.queryByText('0.000000 USDC')).toBeNull();
    expect(screen.queryByText('$0')).toBeNull();

    // The unread USDC row is not movable; it carries the honest "nothing to
    // move" reason rather than being offered as a real holding.
    const unread = screen
      .getAllByRole('button', { name: 'Move to vault' })
      .find((button) =>
        (button.getAttribute('title') ?? '').includes('could not be read'),
      );
    expect(unread).toBeDefined();
    expect(unread).toBeDisabled();
  });

  it('uses the reference card labels and the reference vault figures', () => {
    render(
      <HoldingsScreen
        aggregate={aggregate()}
        safeAddress={SAFE_ADDRESS}
        vaultHoldings={[]}
      />,
    );

    expect(screen.getByText('Total holdings')).toBeInTheDocument();
    expect(screen.getByText('vault + linked wallets')).toBeInTheDocument();
    expect(screen.getByText('Qualified')).toBeInTheDocument();
    expect(
      screen.getByText('Below 3-year tier — $280,000 to go'),
    ).toBeInTheDocument();
    expect(screen.getByText('Not qualified')).toBeInTheDocument();
    expect(screen.getByText('proof of wealth · not counted')).toBeInTheDocument();
    expect(screen.getByText('Vault lock')).toBeInTheDocument();
    // The reference's own lock date, threshold and yield.
    expect(screen.getByText('Nov 2031')).toBeInTheDocument();
    expect(screen.getByText('2-of-2 · 3.4% on USDY')).toBeInTheDocument();
    // The qualified figure itself still comes from the real state.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('renders Fund from bank as a locked feature, not a working control', () => {
    render(<HoldingsScreen aggregate={aggregate()} />);

    expect(screen.getByRole('button', { name: 'Fund from bank' })).toBeDisabled();
  });

  it("renders the reference's five chain cards and the reference note", () => {
    render(<HoldingsScreen aggregate={aggregate()} />);

    expect(screen.getByText('Balances by chain')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Read from Ethereum, Base, Arbitrum, Optimism and Celo',
      ),
    ).toBeInTheDocument();
    // The chains we read are real cards, labelled with the registry's real
    // names: Arbitrum One is read now, so its card is one of them.
    expect(screen.getAllByText('Ethereum').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Base').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Arbitrum One').length).toBeGreaterThan(0);
    // Only the chains we genuinely do not read keep the reference's cards, and
    // only as an explicit `—`: no fabricated figure for an unread chain.
    expect(screen.getByText('Optimism')).toBeInTheDocument();
    expect(screen.getByText('Celo')).toBeInTheDocument();
    expect(screen.queryByText('$25,540')).toBeNull();
    expect(screen.queryByText('$6,182')).toBeNull();
    expect(screen.queryByText('$1,910')).toBeNull();
  });

  it('shows the Safe address and the reference qualified-vaults note', () => {
    render(
      <HoldingsScreen aggregate={aggregate()} safeAddress={SAFE_ADDRESS} />,
    );

    expect(
      screen.getByText(`Qualified vaults · Safe ${shortAddress(SAFE_ADDRESS)}`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Ethereum · Base · Arbitrum · KadeLock · locked to Nov 2031',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Nothing qualified yet — move assets from your wallets below/,
      ),
    ).toBeInTheDocument();
  });

  it('uses the reference "In linked wallets" note', () => {
    render(<HoldingsScreen aggregate={aggregateWithUnverified()} />);

    expect(screen.getByText('In linked wallets')).toBeInTheDocument();
    expect(
      screen.getByText('Proof of wealth · not counted until moved'),
    ).toBeInTheDocument();
  });

  it('counts only the signed wallets in the table and the footer', () => {
    render(<HoldingsScreen aggregate={aggregateWithUnverified()} />);

    expect(screen.getByText('In linked wallets')).toBeInTheDocument();
    // Only the signed wallet has rows; the pending ones are not rendered here.
    expect(screen.getAllByTitle(ADDRESS).length).toBeGreaterThan(0);
    expect(screen.queryAllByTitle(CONNECTED_ADDRESS)).toHaveLength(0);
    expect(screen.queryAllByTitle(PASTED_ADDRESS)).toHaveLength(0);
    expect(
      screen.getByText('2 wallets signed · balances read-only across 5 chains'),
    ).toBeInTheDocument();
  });

  it('excludes the pending wallets from the total', () => {
    render(<HoldingsScreen aggregate={aggregateWithUnverified()} />);

    // The signed wallet's own figure is present; neither pending balance is
    // added, so neither the sum nor the count moves.
    expect(screen.getAllByText('$3,280').length).toBeGreaterThan(0);
    expect(screen.queryByText('$4,530')).toBeNull();
    expect(screen.queryByText('$3,980')).toBeNull();
    expect(screen.queryByText('$5,230')).toBeNull();
  });

  it('locks every row with a true reason when no Safe or wallet is supplied', () => {
    render(<HoldingsScreen aggregate={aggregate()} />);

    // ADDRESS has one readable native holding; ADDRESS_2 has two unread rows.
    const move = screen.getAllByRole('button', { name: 'Move to vault' });
    expect(move).toHaveLength(3);
    for (const button of move) {
      expect(button).toBeDisabled();
      const title = button.getAttribute('title') ?? '';
      // No removed internals leak into a disabled control's reason.
      expect(title).not.toMatch(/EXE-011|KadeLock|Week 2/);
    }
    // The readable native row is movable in principle but has no vault here,
    // so it carries the honest "vault address is not ready" reason — not a
    // claim that the native coin itself is locked.
    expect(
      move.some((button) =>
        (button.getAttribute('title') ?? '').includes('vault address is not ready'),
      ),
    ).toBe(true);
    expect(
      move.some((button) =>
        (button.getAttribute('title') ?? '').includes('native coin'),
      ),
    ).toBe(false);
  });

  it('enables the native holding’s action and hands up a native target', () => {
    const onMoveToVault = vi.fn();
    render(
      <HoldingsScreen
        aggregate={aggregate()}
        safeAddress={SAFE_ADDRESS}
        onMoveToVault={onMoveToVault}
      />,
    );

    const native = screen
      .getAllByRole('button', { name: 'Move to vault' })
      .find((button) =>
        (button.getAttribute('title') ?? '').includes('Move ETH from'),
      );
    expect(native).toBeDefined();
    expect(native).not.toBeDisabled();
    fireEvent.click(native!);

    expect(onMoveToVault).toHaveBeenCalledTimes(1);
    expect(onMoveToVault).toHaveBeenCalledWith({
      key: `${ADDRESS}:1:native`,
      kind: 'native',
      symbol: 'ETH',
      name: 'Ether',
      address: ADDRESS,
      chainId: 1,
      chainName: 'Ethereum',
      // The native coin has no ERC-20 contract.
      tokenAddress: null,
      decimals: 18,
      amount: '1.000000',
    });
  });

  it('locks an unread balance with the real "nothing to move" reason', () => {
    render(<HoldingsScreen aggregate={aggregate()} />);

    const unread = screen
      .getAllByRole('button', { name: 'Move to vault' })
      .find((button) =>
        (button.getAttribute('title') ?? '').includes('could not be read'),
      );
    expect(unread).toBeDefined();
    expect(unread).toBeDisabled();
  });

  it('enables Move to vault on a verified USDC row and hands up that row only', () => {
    const onMoveToVault = vi.fn();
    render(
      <HoldingsScreen
        aggregate={aggregate({
          total: 3280,
          walletCount: 1,
          valuedCount: 1,
          unvaluedCount: 0,
          wallets: [
            {
              address: ADDRESS,
              verifiedAt: '2026-09-22T10:00:00.000Z',
              chainIds: [1],
              chains: [ethereumWithUsdc(2500, 780)],
              usd: 3280,
              readError: null,
            },
          ],
        })}
        safeAddress={SAFE_ADDRESS}
        onMoveToVault={onMoveToVault}
      />,
    );

    const buttons = screen.getAllByRole('button', { name: 'Move to vault' });
    // Both the native ETH row and the USDC row are movable now; this pins that
    // the USDC click hands up exactly the USDC row.
    const usdcButton = buttons.find((button) =>
      (button.getAttribute('title') ?? '').includes('Move USDC from'),
    );
    expect(usdcButton).toBeDefined();
    expect(usdcButton).not.toBeDisabled();
    fireEvent.click(usdcButton!);

    expect(onMoveToVault).toHaveBeenCalledTimes(1);
    expect(onMoveToVault).toHaveBeenCalledWith({
      key: `${ADDRESS}:1:usdc`,
      kind: 'erc20',
      symbol: 'USDC',
      name: 'USDC',
      address: ADDRESS,
      chainId: 1,
      chainName: 'Ethereum',
      // The row's own token contract, resolved from the shared chain table.
      tokenAddress: getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
      decimals: 6,
      amount: '780.000000',
    });
  });

  it('locks Move to vault when no Safe address is known', () => {
    render(
      <HoldingsScreen
        aggregate={aggregate({
          total: 3280,
          walletCount: 1,
          valuedCount: 1,
          unvaluedCount: 0,
          wallets: [
            {
              address: ADDRESS,
              verifiedAt: '2026-09-22T10:00:00.000Z',
              chainIds: [1],
              chains: [ethereumWithUsdc(2500, 780)],
              usd: 3280,
              readError: null,
            },
          ],
        })}
        onMoveToVault={vi.fn()}
      />,
    );

    const usdc = screen
      .getAllByRole('button', { name: 'Move to vault' })
      .find((button) =>
        (button.getAttribute('title') ?? '').includes('vault address is not ready'),
      );
    expect(usdc).toBeDefined();
    expect(usdc).toBeDisabled();
  });

  it('locks Move to vault when no wallet machinery is injected', () => {
    render(
      <HoldingsScreen
        aggregate={aggregate({
          total: 3280,
          walletCount: 1,
          valuedCount: 1,
          unvaluedCount: 0,
          wallets: [
            {
              address: ADDRESS,
              verifiedAt: '2026-09-22T10:00:00.000Z',
              chainIds: [1],
              chains: [ethereumWithUsdc(2500, 780)],
              usd: 3280,
              readError: null,
            },
          ],
        })}
        safeAddress={SAFE_ADDRESS}
      />,
    );

    const usdc = screen
      .getAllByRole('button', { name: 'Move to vault' })
      .find((button) =>
        (button.getAttribute('title') ?? '').includes('Wallet connection is not available'),
      );
    expect(usdc).toBeDefined();
    expect(usdc).toBeDisabled();
  });

  it('locks a USDC row whose chain has no configured token contract', () => {
    render(
      <HoldingsScreen
        aggregate={aggregate({
          total: 0,
          walletCount: 1,
          valuedCount: 0,
          unvaluedCount: 1,
          wallets: [
            {
              address: ADDRESS,
              verifiedAt: '2026-09-22T10:00:00.000Z',
              chainIds: [999],
              chains: [
                {
                  chainId: 999,
                  name: 'Unknown',
                  nativeSymbol: 'ETH',
                  nativeAmount: '1.000000',
                  nativeUsd: null,
                  usdc: { symbol: 'USDC', amount: '5.000000', usd: 5 },
                  usd: 5,
                },
              ],
              usd: 5,
              readError: null,
            },
          ],
        })}
        safeAddress={SAFE_ADDRESS}
        onMoveToVault={vi.fn()}
      />,
    );

    const usdc = screen
      .getAllByRole('button', { name: 'Move to vault' })
      .find((button) =>
        (button.getAttribute('title') ?? '').includes('not supported yet'),
      );
    expect(usdc).toBeDefined();
    expect(usdc).toBeDisabled();
  });

  it('does not render pending wallets as rows; verification is the modal’s job', () => {
    render(<HoldingsScreen aggregate={aggregateWithUnverified()} />);

    // A pending wallet is not a table row: the table shows what counts.
    expect(screen.queryByText(/Pasted address/)).toBeNull();
    expect(screen.queryByText(/Connected wallet/)).toBeNull();
    // No per-row action on the unverified side, and no chip either.
    expect(screen.queryByRole('button', { name: /Connect & sign/ })).toBeNull();
    expect(screen.queryByText('Unverified')).toBeNull();
  });

  it('renders the injected Link & verify wallets control when supplied', () => {
    render(
      <HoldingsScreen
        aggregate={aggregateWithUnverified()}
        renderVerifyWallets={() => (
          <button type="button">Link &amp; verify wallets</button>
        )}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Link & verify wallets' }),
    ).toBeInTheDocument();
  });

  it('shows the reference empty state and footer when nothing is linked', () => {
    render(
      <HoldingsScreen
        aggregate={aggregate({
          total: 0,
          walletCount: 0,
          valuedCount: 0,
          unvaluedCount: 0,
          wallets: [],
        })}
      />,
    );

    expect(
      screen.getByText('All linked assets are in the qualified vault.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('0 wallets signed · balances read-only across 5 chains'),
    ).toBeInTheDocument();
  });

  it('never claims the vault holds assets that are merely unverified', () => {
    // The state v1.2-v1.4 create: a linked wallet, not verified. The table has
    // no rows, but the reference's "all in the vault" line would be false —
    // nothing is verified and no vault exists.
    render(<HoldingsScreen aggregate={aggregateOnlyUnverified()} />);

    expect(
      screen.queryByText('All linked assets are in the qualified vault.'),
    ).toBeNull();
    // The sentence is split by a <strong>, so match on the paragraph's text.
    const note = screen
      .getAllByText((_, element) => element?.tagName === 'P')
      .find((element) =>
        /linked wallets are not verified yet/i.test(element.textContent ?? ''),
      );
    expect(note).toBeDefined();
  });

  it('renders the Reflect card with the reference figures and a demo marker, without touching the total', () => {
    render(<HoldingsScreen aggregate={aggregate()} />);

    expect(screen.getByText('Default USD vault · Reflect')).toBeInTheDocument();
    expect(screen.getByText('Hold dollars as USDT+')).toBeInTheDocument();
    expect(screen.getByText('Current APY')).toBeInTheDocument();
    expect(screen.getByText('4.15%')).toBeInTheDocument();
    expect(screen.getByText('T-bills')).toBeInTheDocument();
    expect(screen.getByText('1:1 · daily')).toBeInTheDocument();
    expect(screen.getByText('Available to convert')).toBeInTheDocument();
    expect(screen.getByText('$150,000')).toBeInTheDocument();
    expect(screen.getByText('$6,225 / yr')).toBeInTheDocument();
    // A small inline demo marker stays, and the CTA stays disabled.
    expect(screen.getByText('Demo')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Convert to USDT+' }),
    ).toBeDisabled();
    // The mocked figure never flows into a real number.
    expect(screen.queryByText('$153,280')).toBeNull();
  });

  it('renders the reference closing paragraph inside a card', () => {
    render(<HoldingsScreen aggregate={aggregate()} />);

    const paragraph = screen.getByText(
      /Qualified vaults run on Ethereum, Base and Arbitrum at the same address/,
    );
    expect(paragraph).toBeInTheDocument();
    // It sits in a bordered surface card, not bare on the page.
    expect(paragraph.parentElement).not.toBeNull();
    expect(paragraph.parentElement?.style.background).toBe('rgb(250, 250, 250)');
    expect(paragraph.parentElement?.style.borderRadius).toBe('14px');
  });
});
