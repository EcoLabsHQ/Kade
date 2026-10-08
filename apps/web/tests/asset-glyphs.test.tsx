import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { HoldingsScreen } from '@/components/holdings/HoldingsScreen';
import type { HoldingsAggregate } from '@/lib/wealth/holdings';
import type { EvmChainBalance } from '@/lib/wealth/types';
import type { VaultHoldingRow } from '@/lib/wealth/vault-holdings';
import { shortAddress } from '@/lib/wealth/format';

/**
 * Asset glyphs on the holdings rows.
 *
 * The human asked that asset rows show icons (USDC, ETH) rather than only a text
 * symbol in a coloured circle. The two glyphs are the CC0 marks from
 * `spothq/cryptocurrency-icons` (see the file headers); this suite pins that the
 * real display renders them.
 *
 * Pre-fix behaviour (so the claim is falsifiable): the asset circle rendered the
 * literal symbol text — `<span aria-hidden>ETH</span>` — and no `<svg>` at all.
 * `screen.queryByTestId('eth-glyph')` was therefore `null` on every row. These
 * assertions would fail against that build.
 *
 * Accessibility: both glyphs are decorative. They sit beside the row's text name
 * (`Ether`, `USDC`), which carries the accessible name, and the enclosing circle
 * is already `aria-hidden`; the glyph itself is `aria-hidden` and
 * `focusable="false"`. No glyph is exposed as its own accessible element.
 */

const ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const SAFE_ADDRESS = '0x5Af1000000000000000000000000000000000c09D';

/** An Ethereum read with both a native ETH holding and a USDC holding. */
function ethereumWithUsdc(): EvmChainBalance {
  return {
    chainId: 1,
    name: 'Ethereum',
    nativeSymbol: 'ETH',
    nativeAmount: '1.000000',
    nativeUsd: 2500,
    usdc: { symbol: 'USDC', amount: '780.000000', usd: 780 },
    usd: 3280,
  };
}

/** A wallet whose single readable chain produced a native ETH and a USDC row. */
function aggregateWithEthAndUsdc(): HoldingsAggregate {
  return {
    total: 3280,
    walletCount: 1,
    valuedCount: 1,
    unvaluedCount: 0,
    wallets: [
      {
        address: ADDRESS,
        verifiedAt: '2026-09-22T10:00:00.000Z',
        chainIds: [1],
        chains: [ethereumWithUsdc()],
        usd: 3280,
        readError: null,
      },
    ],
    unverifiedWallets: [],
    unverifiedCount: 0,
  };
}

/** A wallet with nothing readable: its only row is the `EVM` empty-wallet row. */
function aggregateWithNothingReadable(): HoldingsAggregate {
  return {
    total: 0,
    walletCount: 1,
    valuedCount: 0,
    unvaluedCount: 1,
    wallets: [
      {
        address: ADDRESS,
        verifiedAt: '2026-09-22T10:00:00.000Z',
        chainIds: [],
        chains: [],
        usd: null,
        readError: null,
      },
    ],
    unverifiedWallets: [],
    unverifiedCount: 0,
  };
}

const EMPTY_AGGREGATE: HoldingsAggregate = {
  total: 0,
  walletCount: 0,
  valuedCount: 0,
  unvaluedCount: 0,
  wallets: [],
  unverifiedWallets: [],
  unverifiedCount: 0,
};

const VAULT_ROWS: readonly VaultHoldingRow[] = [
  {
    key: 'safe:1:native',
    kind: 'native',
    chainId: 1,
    chainName: 'Ethereum',
    symbol: 'ETH',
    name: 'Ether',
    amount: '1.500000 ETH',
    usd: 5000,
    readError: null,
  },
  {
    key: 'safe:1:usdc',
    kind: 'usdc',
    chainId: 1,
    chainName: 'Ethereum',
    symbol: 'USDC',
    name: 'USDC',
    amount: '2500.000000 USDC',
    usd: 2500,
    readError: null,
  },
  {
    key: 'safe:1:morpho',
    kind: 'morpho',
    chainId: 1,
    chainName: 'Ethereum',
    symbol: 'MM',
    name: 'MetaMorpho USDC vault',
    amount: '25000.000000 USDC',
    usd: 25000,
    readError: null,
  },
];

describe('asset glyphs — In linked wallets', () => {
  it('renders an ETH glyph on the native row and a USDC glyph on the token row', () => {
    render(<HoldingsScreen aggregate={aggregateWithEthAndUsdc()} />);

    // The real display now carries the marks, not only text.
    const eth = screen.getByTestId('eth-glyph');
    const usdc = screen.getByTestId('usdc-glyph');
    expect(eth).toBeInTheDocument();
    expect(usdc).toBeInTheDocument();

    // The accessible names the row already had are untouched. Scope to the
    // linked-wallets table: "USDC" also appears in the Reflect demo card.
    const linked = screen.getByText('In linked wallets').parentElement!
      .parentElement!;
    expect(within(linked).getByText('Ether')).toBeInTheDocument();
    expect(within(linked).getByText('USDC')).toBeInTheDocument();
  });

  it('hides each decorative glyph from assistive technology', () => {
    render(<HoldingsScreen aggregate={aggregateWithEthAndUsdc()} />);

    for (const testId of ['eth-glyph', 'usdc-glyph']) {
      const glyph = screen.getByTestId(testId);
      expect(glyph).toHaveAttribute('aria-hidden', 'true');
      expect(glyph).toHaveAttribute('focusable', 'false');
      // The enclosing circle is hidden too, so the mark is not exposed.
      expect(glyph.closest('[aria-hidden="true"]')).not.toBeNull();
    }
    // Neither glyph becomes an accessible image of its own.
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('keeps the text glyph for symbols with no mark (EVM, unread —)', () => {
    render(<HoldingsScreen aggregate={aggregateWithNothingReadable()} />);

    // The empty-wallet row still shows its `EVM` text glyph; no asset mark is
    // invented for a symbol that has no artwork.
    expect(screen.getByText('EVM')).toBeInTheDocument();
    expect(screen.queryByTestId('eth-glyph')).toBeNull();
    expect(screen.queryByTestId('usdc-glyph')).toBeNull();
  });
});

describe('asset glyphs — Qualified vaults', () => {
  it('renders the ETH and USDC marks on the Safe holdings rows', () => {
    render(
      <HoldingsScreen
        aggregate={EMPTY_AGGREGATE}
        safeAddress={SAFE_ADDRESS}
        vaultHoldings={VAULT_ROWS}
      />,
    );

    const qualified = screen.getByText(
      `Qualified vaults · Safe ${shortAddress(SAFE_ADDRESS)}`,
    ).parentElement!.parentElement!;
    expect(within(qualified).getByTestId('eth-glyph')).toBeInTheDocument();
    expect(within(qualified).getByTestId('usdc-glyph')).toBeInTheDocument();

    // The MetaMorpho instrument keeps its `MM` text glyph: it is a vault
    // instrument, not a token with a permissively-licensed mark.
    expect(within(qualified).getByText('MM')).toBeInTheDocument();
  });

  it('hides the vault glyphs from assistive technology', () => {
    render(
      <HoldingsScreen
        aggregate={EMPTY_AGGREGATE}
        safeAddress={SAFE_ADDRESS}
        vaultHoldings={VAULT_ROWS}
      />,
    );

    const eth = screen.getByTestId('eth-glyph');
    const usdc = screen.getByTestId('usdc-glyph');
    expect(eth).toHaveAttribute('aria-hidden', 'true');
    expect(usdc).toHaveAttribute('aria-hidden', 'true');
    expect(eth.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(usdc.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });
});
