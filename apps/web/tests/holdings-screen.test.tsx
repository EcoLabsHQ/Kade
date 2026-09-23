import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HoldingsScreen } from '@/components/holdings/HoldingsScreen';
import type { HoldingsAggregate } from '@/lib/wealth/holdings';

/**
 * The Holdings screen renders the aggregate over signed wallets and is explicit
 * that pasted addresses are excluded. It takes a fully-built aggregate, so the
 * pasted-exclusion proof lives in the aggregation tests; here we pin what the
 * resident actually sees for a verified wallet, an unvalued wallet and no
 * wallets at all.
 */

const ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const ADDRESS_2 = '0x2222222222222222222222222222222222222222';

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
        chains: [
          {
            chainId: 1,
            name: 'Ethereum',
            nativeSymbol: 'ETH',
            nativeAmount: '1.000000',
            nativeUsd: 2500,
            usdc: { symbol: 'USDC', amount: '780.000000', usd: 780 },
            usd: 3280,
          },
        ],
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

const CONNECTED_ADDRESS = '0x9999999999999999999999999999999999999999';

/** An aggregate whose only extra is one connected, unverified wallet. */
function aggregateWithConnectedWallet(): HoldingsAggregate {
  return aggregate({
    unverifiedWallets: [
      {
        address: CONNECTED_ADDRESS,
        provider: 'connected-wallet',
        chainIds: [1],
        chains: [
          {
            chainId: 1,
            name: 'Ethereum',
            nativeSymbol: 'ETH',
            nativeAmount: '0.500000',
            nativeUsd: 1250,
            usdc: null,
            usd: 1250,
          },
        ],
        usd: 1250,
        readError: null,
      },
    ],
    unverifiedCount: 1,
  });
}

describe('HoldingsScreen', () => {
  it('shows the signed total and the per-wallet breakdown', () => {
    render(<HoldingsScreen aggregate={aggregate()} />);

    expect(screen.getByText('Holdings')).toBeInTheDocument();
    // The total, the first wallet's value and its Ethereum chain all read $3,280.
    expect(screen.getAllByText('$3,280').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Signature-verified').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Signed')).toHaveLength(2);
    expect(screen.getByText(/Ethereum · 1\.000000 ETH · 780\.000000 USDC/)).toBeInTheDocument();
    expect(screen.getByTitle(ADDRESS)).toBeInTheDocument();
    expect(screen.getByTitle(ADDRESS_2)).toBeInTheDocument();
  });

  it('shows an unvalued wallet as a dash with its read error, never a zero', () => {
    render(<HoldingsScreen aggregate={aggregate()} />);

    expect(screen.getByText('The explorer returned HTTP 503.')).toBeInTheDocument();
    expect(screen.queryByText('$0')).toBeNull();
  });

  it('states that pasted addresses are excluded from the aggregate', () => {
    render(<HoldingsScreen aggregate={aggregate()} />);

    expect(screen.getByText('Pasted addresses')).toBeInTheDocument();
    expect(screen.getByText('Excluded')).toBeInTheDocument();
    expect(
      screen.getByText(/structurally excluded from/i),
    ).toBeInTheDocument();
  });

  it('invites linking when nothing is verified yet', () => {
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

    expect(screen.getByText('Link a wallet to begin')).toBeInTheDocument();
    expect(
      screen.getByText(/No signed wallet is linked yet/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/will not appear here/i)).toBeInTheDocument();
  });

  it('renders the injected link panel', () => {
    render(
      <HoldingsScreen
        aggregate={aggregate()}
        linkPanel={<div>link panel slot</div>}
      />,
    );

    expect(screen.getByText('link panel slot')).toBeInTheDocument();
  });

  it('shows a connected wallet in a separate unverified section, outside the total', () => {
    render(<HoldingsScreen aggregate={aggregateWithConnectedWallet()} />);

    // Its own labelled section, honestly marked unverified.
    expect(
      screen.getByText('Unverified connected wallets'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Unverified').length).toBeGreaterThan(0);
    expect(screen.getByTitle(CONNECTED_ADDRESS)).toBeInTheDocument();
    expect(
      screen.getAllByText(/not evidence of control/i).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/excluded from the total/i).length,
    ).toBeGreaterThan(0);

    // The verified total is unchanged: the connected $1,250 is not added, so
    // neither the sum nor the verified counts move.
    expect(screen.getAllByText('$3,280').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('$4,530')).toBeNull();
    expect(screen.getByText('2 signed wallets')).toBeInTheDocument();
  });

  it('omits the unverified section when no wallet is connected', () => {
    render(<HoldingsScreen aggregate={aggregate()} />);

    expect(screen.queryByText('Unverified connected wallets')).toBeNull();
    expect(screen.queryByText('Unverified')).toBeNull();
  });
});
