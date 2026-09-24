import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HoldingsScreen } from '@/components/holdings/HoldingsScreen';
import type {
  HoldingsAggregate,
  UnverifiedHoldingWallet,
} from '@/lib/wealth/holdings';
import type { EvmChainBalance } from '@/lib/wealth/types';
import { shortAddress } from '@/lib/wealth/format';

/**
 * The Holdings screen renders the aggregate over signed wallets and the
 * reference's single "In linked wallets" list. It takes a fully-built aggregate,
 * so the exclusion proof lives in the aggregation tests; here we pin what the
 * resident actually sees: the reference's summary cards, the honest
 * qualified-vault state, the Ethereum/Base-only chain totals, and one list where
 * each wallet carries its own state, provenance and action.
 */

const ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const ADDRESS_2 = '0x2222222222222222222222222222222222222222';
const CONNECTED_ADDRESS = '0x9999999999999999999999999999999999999999';
const PASTED_ADDRESS = '0x7777777777777777777777777777777777777777';
const SAFE_ADDRESS = '0x5Af1000000000000000000000000000000000c09D';

function ethereum(usd: number | null): EvmChainBalance {
  return {
    chainId: 1,
    name: 'Ethereum',
    nativeSymbol: 'ETH',
    nativeAmount: '1.000000',
    nativeUsd: usd,
    usdc: usd === null ? null : { symbol: 'USDC', amount: '780.000000', usd },
    usd,
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
        chainIds: [1, 8453],
        chains: [ethereum(700)],
        usd: 700,
      }),
    ],
    unverifiedCount: 2,
  });
}

describe('HoldingsScreen', () => {
  it('shows the signed total and the signed row breakdown', () => {
    render(<HoldingsScreen aggregate={aggregate()} />);

    expect(screen.getByText('Holdings')).toBeInTheDocument();
    // The total, the first wallet's value and its Ethereum chain all read $3,280.
    expect(screen.getAllByText('$3,280').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Signed')).toHaveLength(2);
    expect(screen.getByText('2 signature-verified wallets')).toBeInTheDocument();
    expect(
      screen.getByText(/Ethereum · 1\.000000 ETH · 780\.000000 USDC/),
    ).toBeInTheDocument();
    expect(screen.getByTitle(ADDRESS)).toBeInTheDocument();
    expect(screen.getByTitle(ADDRESS_2)).toBeInTheDocument();
  });

  it('shows an unvalued wallet as a dash with its read error, never a zero', () => {
    render(<HoldingsScreen aggregate={aggregate()} />);

    expect(
      screen.getByText('The explorer returned HTTP 503.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('$0')).toBeNull();
  });

  it('uses the reference card labels and never invents a qualified value', () => {
    render(<HoldingsScreen aggregate={aggregate()} />);

    expect(screen.getByText('Total holdings')).toBeInTheDocument();
    expect(screen.getByText('Qualified')).toBeInTheDocument();
    expect(screen.getByText('Not qualified')).toBeInTheDocument();
    expect(screen.getByText('Vault lock')).toBeInTheDocument();

    // KadeLock is not deployed, so the qualified and vault-lock values are an
    // explicit unavailable state, never a plausible number.
    expect(screen.getByText('Qualified vault not deployed')).toBeInTheDocument();
    expect(
      screen.getAllByText(/KadeLock not deployed/i).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText('Nov 2031')).toBeNull();
    expect(screen.queryByText(/2-of-2/)).toBeNull();
    expect(screen.queryByText(/3\.4%/)).toBeNull();
  });

  it('renders Fund from bank as a locked feature, not a working control', () => {
    render(<HoldingsScreen aggregate={aggregate()} />);

    expect(screen.getByRole('button', { name: 'Fund from bank' })).toBeDisabled();
  });

  it('renders only the chains we actually read: Ethereum and Base', () => {
    render(<HoldingsScreen aggregate={aggregate()} />);

    expect(screen.getByText('Balances by chain')).toBeInTheDocument();
    expect(screen.getByText('Read from Ethereum and Base')).toBeInTheDocument();
    expect(screen.getByText('Ethereum')).toBeInTheDocument();
    expect(screen.getByText('Base')).toBeInTheDocument();
    expect(screen.queryByText('Arbitrum')).toBeNull();
    expect(screen.queryByText('Optimism')).toBeNull();
    expect(screen.queryByText('Celo')).toBeNull();
  });

  it('shows the Safe address and the honest not-deployed vault state', () => {
    render(
      <HoldingsScreen aggregate={aggregate()} safeAddress={SAFE_ADDRESS} />,
    );

    expect(
      screen.getByText(`Qualified vaults · Safe ${shortAddress(SAFE_ADDRESS)}`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Nothing qualified yet — move assets from your wallets below/,
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/is not deployed/i).length).toBeGreaterThan(0);
  });

  it('does not claim signed wallets are uncounted in the one list', () => {
    render(<HoldingsScreen aggregate={aggregateWithUnverified()} />);

    // The reference's "not counted until moved" would be false for a signed
    // wallet, so the section says what is actually true.
    expect(screen.getByText('In linked wallets')).toBeInTheDocument();
    expect(
      screen.getByText('Proof of wealth · signed rows count in the total'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/not counted until moved/i)).toBeNull();
  });

  it('puts a signed and an unsigned wallet in the same list', () => {
    render(<HoldingsScreen aggregate={aggregateWithUnverified()} />);

    expect(screen.getByText('In linked wallets')).toBeInTheDocument();
    // All three wallets are rows of the one list.
    expect(screen.getByTitle(ADDRESS)).toBeInTheDocument();
    expect(screen.getByTitle(CONNECTED_ADDRESS)).toBeInTheDocument();
    expect(screen.getByTitle(PASTED_ADDRESS)).toBeInTheDocument();
    expect(screen.getByText('2 wallets signed · balances read-only')).toBeInTheDocument();
  });

  it('marks the unsigned rows with their provenance and excludes them from the total', () => {
    render(<HoldingsScreen aggregate={aggregateWithUnverified()} />);

    expect(screen.getByText(/Connected wallet · chains 1/)).toBeInTheDocument();
    expect(
      screen.getByText(/Pasted address · chains 1, 8453/),
    ).toBeInTheDocument();

    // Neither unsigned balance is added, so neither the sum nor the count moves.
    expect(screen.getAllByText('$3,280').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('$4,530')).toBeNull();
    expect(screen.queryByText('$3,980')).toBeNull();
    expect(screen.queryByText('$5,230')).toBeNull();
    expect(screen.getByText('2 signature-verified wallets')).toBeInTheDocument();
  });

  it('renders Move to vault on the signed row, locked with the real reason', () => {
    render(<HoldingsScreen aggregate={aggregate()} />);

    const move = screen.getAllByRole('button', { name: 'Move to vault' });
    expect(move).toHaveLength(2); // one per signed row
    for (const button of move) {
      expect(button).toBeDisabled();
    }
    const title = move[0]!.getAttribute('title') ?? '';
    expect(title).toMatch(/EXE-011/);
    expect(title).toMatch(/not deployed/i);
  });

  it('invokes renderConnectSign once per unsigned row, whatever its provenance', () => {
    const renderConnectSign = vi.fn((wallet: UnverifiedHoldingWallet) => (
      <button type="button" aria-label={`Connect & sign ${wallet.address}`}>
        Connect &amp; sign
      </button>
    ));

    render(
      <HoldingsScreen
        aggregate={aggregateWithUnverified()}
        renderConnectSign={renderConnectSign}
      />,
    );

    expect(renderConnectSign).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole('button', { name: `Connect & sign ${CONNECTED_ADDRESS}` }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: `Connect & sign ${PASTED_ADDRESS}` }),
    ).toBeInTheDocument();
    // The signed rows never get the connect action.
    expect(
      screen.queryByRole('button', { name: `Connect & sign ${ADDRESS}` }),
    ).toBeNull();
  });

  it('renders the injected + Link another wallet control', () => {
    render(
      <HoldingsScreen
        aggregate={aggregateWithUnverified()}
        renderLinkAnother={() => (
          <button type="button">+ Link another wallet</button>
        )}
      />,
    );

    expect(
      screen.getByRole('button', { name: '+ Link another wallet' }),
    ).toBeInTheDocument();
  });

  it('invites linking when no wallet is linked at all', () => {
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
      screen.getByText(/No wallets linked yet\. Use \+ Link another wallet/),
    ).toBeInTheDocument();
    expect(screen.getByText('No wallets signed yet')).toBeInTheDocument();
  });
});
