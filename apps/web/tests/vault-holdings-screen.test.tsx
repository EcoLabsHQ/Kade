import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HoldingsScreen } from '@/components/holdings/HoldingsScreen';
import type { HoldingsAggregate } from '@/lib/wealth/holdings';
import type { VaultHoldingRow } from '@/lib/wealth/vault-holdings';
import { shortAddress } from '@/lib/wealth/format';

/**
 * The "Qualified vaults · Safe 0x…" section over the on-chain read.
 *
 * The screen stays presentational: it is handed the rows the server read (or an
 * empty list), and renders chain + instrument + amount. These tests pin what the
 * resident sees, including that a genuine empty state is unchanged and an unread
 * row shows its reason rather than a zero.
 */

const SAFE_ADDRESS = '0x5Af1000000000000000000000000000000000c09D';

const EMPTY_AGGREGATE: HoldingsAggregate = {
  total: 0,
  walletCount: 0,
  valuedCount: 0,
  unvaluedCount: 0,
  wallets: [],
  unverifiedWallets: [],
  unverifiedCount: 0,
};

const FUNDED_ROWS: readonly VaultHoldingRow[] = [
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
    key: 'safe:8453:native',
    kind: 'native',
    chainId: 8453,
    chainName: 'Base',
    symbol: 'ETH',
    name: 'Ether',
    amount: '0.500000 ETH',
    usd: 1500,
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

describe('HoldingsScreen qualified vaults', () => {
  it('renders each holding with its chain, instrument and amount', () => {
    render(
      <HoldingsScreen
        aggregate={EMPTY_AGGREGATE}
        safeAddress={SAFE_ADDRESS}
        vaultHoldings={FUNDED_ROWS}
      />,
    );

    expect(
      screen.getByText(`Qualified vaults · Safe ${shortAddress(SAFE_ADDRESS)}`),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Nothing qualified yet/)).toBeNull();

    // Chain + instrument + amount for a real position.
    expect(screen.getByText('2500.000000 USDC')).toBeInTheDocument();
    expect(screen.getByText('MetaMorpho USDC vault')).toBeInTheDocument();
    expect(screen.getByText('25000.000000 USDC')).toBeInTheDocument();
    // The Ethereum row says Ethereum, the Base row says Base: no cross-chain
    // implication.
    expect(screen.getAllByText('Ethereum').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Base').length).toBeGreaterThan(0);
  });

  it('renders a non-Ethereum vault position with its real chain and shows a failed read’s reason, never a 0', () => {
    const rows: readonly VaultHoldingRow[] = [
      {
        key: 'safe:8453:morpho',
        kind: 'morpho',
        chainId: 8453,
        chainName: 'Base',
        symbol: 'MM',
        name: 'MetaMorpho USDC vault',
        amount: '2500.000000 USDC',
        usd: 2500,
        readError: null,
      },
      {
        key: 'safe:42161:morpho',
        kind: 'morpho',
        chainId: 42161,
        chainName: 'Arbitrum One',
        symbol: 'MM',
        name: 'MetaMorpho USDC vault',
        amount: '—',
        usd: null,
        readError: 'The vault position could not be read: execution reverted.',
      },
    ];

    render(
      <HoldingsScreen
        aggregate={EMPTY_AGGREGATE}
        safeAddress={SAFE_ADDRESS}
        vaultHoldings={rows}
      />,
    );

    // A Base position is labelled Base; the Arbitrum failure is labelled
    // Arbitrum One with its specific reason, not a zero.
    expect(screen.getAllByText('Base').length).toBeGreaterThan(0);
    expect(screen.getByText('Arbitrum One')).toBeInTheDocument();
    expect(screen.getByText('2500.000000 USDC')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The vault position could not be read: execution reverted.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('keeps the truthful empty state when the Safe holds nothing', () => {
    render(
      <HoldingsScreen
        aggregate={EMPTY_AGGREGATE}
        safeAddress={SAFE_ADDRESS}
        vaultHoldings={[]}
      />,
    );

    expect(
      screen.getByText(
        /Nothing qualified yet — move assets from your wallets below/,
      ),
    ).toBeInTheDocument();
  });

  it('keeps the empty state when no vault read is supplied at all', () => {
    render(
      <HoldingsScreen aggregate={EMPTY_AGGREGATE} safeAddress={SAFE_ADDRESS} />,
    );

    expect(
      screen.getByText(
        /Nothing qualified yet — move assets from your wallets below/,
      ),
    ).toBeInTheDocument();
  });

  it('shows the real reason for an unread chain and never a zero', () => {
    const unread: readonly VaultHoldingRow[] = [
      {
        key: 'safe:1:unread',
        kind: 'unread',
        chainId: 1,
        chainName: 'Ethereum',
        symbol: '—',
        name: 'Ethereum',
        amount: '—',
        usd: null,
        readError: 'The vault balance on Ethereum could not be read.',
      },
    ];

    render(
      <HoldingsScreen
        aggregate={EMPTY_AGGREGATE}
        safeAddress={SAFE_ADDRESS}
        vaultHoldings={unread}
      />,
    );

    expect(
      screen.getByText('The vault balance on Ethereum could not be read.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Nothing qualified yet/)).toBeNull();
    expect(screen.queryByText('0')).toBeNull();
  });
});
