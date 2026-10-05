import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { InvestScreen } from '@/components/invest/InvestScreen';
import { HoldingsScreen } from '@/components/holdings/HoldingsScreen';
import type { InvestVaultSummary } from '@/app/invest/actions';
import type { HoldingsAggregate } from '@/lib/wealth/holdings';
import type { VaultHoldingRow } from '@/lib/wealth/vault-holdings';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

/**
 * The Invest screen's **real position** (T40).
 *
 * The screen has one source of truth for the Safe's position: the rows the route
 * reads once through `loadVaultHoldings` and passes in. These tests inject those
 * rows directly — no network — and pin the owner's requirements and the
 * repository's honesty rules:
 *
 *   - each wired row shows `Allocate` when the Safe holds nothing and the real
 *     held amount when it does;
 *   - `Vault USDC available` and `Currently allocated` render from that read;
 *   - a failed read surfaces its **specific reason** and never a `$0`;
 *   - un-allocate stays reachable from a row that shows a held amount;
 *   - the allocate modal's summary box derives each figure from real data (and
 *     says "not quoted" where no source exists).
 */

const hoisted = vi.hoisted(() => ({
  beginDeposit: vi.fn(),
  completeDeposit: vi.fn(),
  beginWithdraw: vi.fn(),
  completeWithdraw: vi.fn(),
  promptPasskeyAssertionParts: vi.fn(),
}));

vi.mock('@/app/invest/actions', () => ({
  beginDeposit: hoisted.beginDeposit,
  completeDeposit: hoisted.completeDeposit,
  beginWithdraw: hoisted.beginWithdraw,
  completeWithdraw: hoisted.completeWithdraw,
}));

vi.mock('@/lib/passkey/assertion', () => ({
  promptPasskeyAssertionParts: hoisted.promptPasskeyAssertionParts,
}));

const SAFE = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const VAULT = '0x1111222233334444555566667777888899990000';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

const RAILS: readonly InvestVaultSummary[] = [
  {
    configured: true,
    chainId: 1,
    chainName: 'Ethereum',
    vault: VAULT,
    usdc: USDC,
  },
];

/** The Safe's free USDC on Ethereum, as the reader would produce it. */
function usdcRow(usd: number): VaultHoldingRow {
  return {
    key: `1:usdc`,
    kind: 'usdc',
    chainId: 1,
    chainName: 'Ethereum',
    symbol: 'USDC',
    name: 'USDC',
    amount: `${usd}.000000 USDC`,
    usd,
    readError: null,
  };
}

/** A real MetaMorpho position on Ethereum, converted to USDC by the vault. */
function morphoRow(usd: number): VaultHoldingRow {
  return {
    key: '1:morpho',
    kind: 'morpho',
    chainId: 1,
    chainName: 'Ethereum',
    symbol: 'MM',
    name: 'MetaMorpho USDC vault',
    amount: `${usd}.000000 USDC`,
    usd,
    readError: null,
  };
}

/** A real native holding in the Safe (the coin that counts but is not an
 * Invest instrument). */
function nativeRow(usd: number): VaultHoldingRow {
  return {
    key: '1:native',
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

/** A chain whose balance read failed, carrying the real reason. */
function unreadRow(reason: string): VaultHoldingRow {
  return {
    key: '1:usdc-unread',
    kind: 'unread',
    chainId: 1,
    chainName: 'Ethereum',
    symbol: '—',
    name: 'USDC',
    amount: '—',
    usd: null,
    readError: reason,
  };
}

/** A vault read that failed, carrying the real reason. */
function failedMorphoRow(reason: string): VaultHoldingRow {
  return {
    key: '1:morpho',
    kind: 'morpho',
    chainId: 1,
    chainName: 'Ethereum',
    symbol: 'MM',
    name: 'MetaMorpho USDC vault',
    amount: '—',
    usd: null,
    readError: reason,
  };
}

function allocateButton() {
  return screen.getByRole('button', {
    name: /allocate into morpho usdc vault · ethereum/i,
  });
}

/**
 * On a held row the amount is the control, so the un-allocate path is one
 * interaction in: open the position menu, then take Un-allocate. This helper
 * performs the open and returns the item, so the test still proves that the
 * withdraw path is reachable from the row that shows a position.
 */
function openHeldUnallocate() {
  fireEvent.click(screen.getByTestId('invest-held-1'));
  return screen.getByRole('menuitem', { name: 'Un-allocate' });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('InvestScreen real position', () => {
  it('shows Allocate with no position and the real held amount with one', () => {
    render(<InvestScreen vaults={RAILS} safeAddress={SAFE} holdings={[]} />);
    expect(allocateButton()).toBeEnabled();
    expect(screen.queryByTestId('invest-held-1')).toBeNull();
    cleanup();

    render(
      <InvestScreen
        vaults={RAILS}
        safeAddress={SAFE}
        holdings={[morphoRow(10000)]}
      />,
    );
    expect(screen.getByTestId('invest-held-1')).toHaveTextContent(
      '$10,000 held',
    );
  });

  it('renders both stat figures from the one injected read', () => {
    render(
      <InvestScreen
        vaults={RAILS}
        safeAddress={SAFE}
        holdings={[usdcRow(12500), morphoRow(10000)]}
      />,
    );

    expect(screen.getByTestId('invest-stat-vault-usdc')).toHaveTextContent(
      '$12,500',
    );
    expect(screen.getByTestId('invest-stat-allocated')).toHaveTextContent(
      '$10,000',
    );
    expect(
      screen.getByText(/1 instrument · shown in Holdings/),
    ).toBeInTheDocument();
  });

  it('shows the specific reason, never a $0 fact, when the read failed', () => {
    render(
      <InvestScreen
        vaults={RAILS}
        safeAddress={SAFE}
        holdings={[
          unreadRow('the balance provider is rate limiting this read (HTTP 429).'),
          failedMorphoRow(
            'The vault position could not be read: execution reverted.',
          ),
        ]}
      />,
    );

    // The figures are explicitly unknown, not a fabricated zero.
    expect(screen.getByTestId('invest-stat-vault-usdc')).toHaveTextContent('—');
    expect(screen.getByTestId('invest-stat-allocated')).toHaveTextContent('—');
    expect(screen.queryByText('$0')).toBeNull();

    // Each failed read carries its own reason to the screen. The qualified
    // card carries the same reason as the USDC/Morpho cards (one reduction), so
    // each reason can legitimately appear more than once.
    expect(
      screen.getAllByText(/rate limiting this read/i).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/execution reverted/i).length,
    ).toBeGreaterThan(0);
    // The row's own state is unknown, not empty.
    expect(screen.getByTestId('invest-position-unknown-1')).toBeInTheDocument();
  });

  it('does not present a fabricated $0 when there is no Safe to read', () => {
    render(<InvestScreen vaults={RAILS} safeAddress={null} holdings={[]} />);

    expect(screen.getByTestId('invest-stat-vault-usdc')).toHaveTextContent('—');
    expect(screen.getByTestId('invest-stat-allocated')).toHaveTextContent('—');
    expect(screen.queryByText('$0')).toBeNull();
    expect(screen.getAllByText(/No Safe is recorded/i).length).toBeGreaterThan(0);
  });

  it('keeps un-allocate reachable from a row that shows a held amount', () => {
    render(
      <InvestScreen
        vaults={RAILS}
        safeAddress={SAFE}
        holdings={[morphoRow(10000)]}
      />,
    );

    expect(screen.getByTestId('invest-held-1')).toHaveTextContent(
      '$10,000 held',
    );
    // Both directions stay reachable on a held row: the held amount is the
    // control, and opening it exposes Allocate more and Un-allocate.
    const unallocate = openHeldUnallocate();
    expect(
      screen.getByRole('menuitem', { name: 'Allocate more' }),
    ).toBeEnabled();
    expect(unallocate).toBeEnabled();

    fireEvent.click(unallocate);
    const dialog = screen.getByRole('dialog', { name: 'UN-ALLOCATE' });
    expect(
      within(dialog).getByLabelText(/amount to un-allocate/i),
    ).toBeInTheDocument();
    // The un-allocate offers the whole position by default.
    expect(
      within(dialog).getByText('Un-allocate all USDC'),
    ).toBeInTheDocument();
  });
});

const EMPTY_AGGREGATE: HoldingsAggregate = {
  total: 0,
  walletCount: 0,
  valuedCount: 0,
  unvaluedCount: 0,
  wallets: [],
  unverifiedWallets: [],
  unverifiedCount: 0,
};

/** The rendered value of the Holdings summary card with `label`. */
function holdingsCardValue(label: string): string {
  const labelNode = screen.getByText(label);
  return labelNode.parentElement?.children[1]?.textContent ?? '';
}

/** The rendered sub line of the Holdings summary card with `label`. */
function holdingsCardSub(label: string): string {
  const labelNode = screen.getByText(label);
  return labelNode.parentElement?.children[2]?.textContent ?? '';
}

/**
 * The qualified total is **one** figure over the Safe's rows — native coin
 * included — and Invest and Holdings must render it identically. These pin the
 * exact case that used to diverge: a Safe holding native ETH, which counts
 * toward the qualified total but is not an Invest instrument.
 */
describe('InvestScreen qualified position parity with Holdings', () => {
  it('renders the same native-inclusive total on both screens', () => {
    const rows = [nativeRow(7500), usdcRow(2000), morphoRow(1000)];

    render(<InvestScreen vaults={RAILS} safeAddress={SAFE} holdings={rows} />);
    // Two decimals, the shared helper, and the whole qualified total (10,500),
    // not the USDC-only Invest position (3,000).
    expect(screen.getByTestId('invest-stat-qualified')).toHaveTextContent(
      '$10,500.00',
    );
    cleanup();

    render(
      <HoldingsScreen
        aggregate={EMPTY_AGGREGATE}
        safeAddress={SAFE}
        vaultHoldings={rows}
      />,
    );
    expect(holdingsCardValue('Qualified')).toBe('$10,500.00');
  });

  it('shows a non-zero qualified figure for a native-ETH-only Safe on both screens', () => {
    const rows = [nativeRow(7500)];

    render(<InvestScreen vaults={RAILS} safeAddress={SAFE} holdings={rows} />);
    expect(screen.getByTestId('invest-stat-qualified')).toHaveTextContent(
      '$7,500.00',
    );
    cleanup();

    render(
      <HoldingsScreen
        aggregate={EMPTY_AGGREGATE}
        safeAddress={SAFE}
        vaultHoldings={rows}
      />,
    );
    expect(holdingsCardValue('Qualified')).toBe('$7,500.00');
  });

  it('keeps an unread position unknown with its reason on both screens, never $0', () => {
    const reason = 'the balance provider is rate limiting this read (HTTP 429).';
    const rows = [unreadRow(reason)];
    const expectedReason = `Ethereum: ${reason}`;

    render(<InvestScreen vaults={RAILS} safeAddress={SAFE} holdings={rows} />);
    expect(screen.getByTestId('invest-stat-qualified')).toHaveTextContent('—');
    expect(screen.getByTestId('invest-stat-qualified')).not.toHaveTextContent('$0');
    // The qualified card carries the same reduction's reason as the USDC card.
    expect(screen.getAllByText(expectedReason).length).toBeGreaterThan(0);
    cleanup();

    render(
      <HoldingsScreen
        aggregate={EMPTY_AGGREGATE}
        safeAddress={SAFE}
        vaultHoldings={rows}
      />,
    );
    expect(holdingsCardValue('Qualified')).toBe('—');
    expect(holdingsCardSub('Qualified')).toBe(expectedReason);
  });

  it('keeps the qualified card distinct from the USDC-only cards', () => {
    // Native + USDC + Morpho: the qualified card is 10,500, while the free-USDC
    // and allocated cards stay USDC/Morpho only (2,000 and 1,000). A reader
    // cannot mistake native coin for an Invest instrument.
    render(
      <InvestScreen
        vaults={RAILS}
        safeAddress={SAFE}
        holdings={[nativeRow(7500), usdcRow(2000), morphoRow(1000)]}
      />,
    );

    expect(screen.getByTestId('invest-stat-qualified')).toHaveTextContent(
      '$10,500.00',
    );
    expect(screen.getByTestId('invest-stat-vault-usdc')).toHaveTextContent(
      '$2,000',
    );
    expect(screen.getByTestId('invest-stat-allocated')).toHaveTextContent(
      '$1,000',
    );
    // Native ETH is not an instrument row and cannot be allocated.
    expect(screen.queryByText('Ether')).toBeNull();
  });
});

describe('InvestScreen allocate modal summary', () => {
  it('renders the reference shape: eyebrow, instrument, Settles-on chip and summary', () => {
    render(
      <InvestScreen
        vaults={RAILS}
        safeAddress={SAFE}
        holdings={[usdcRow(12500)]}
      />,
    );

    fireEvent.click(allocateButton());
    const dialog = screen.getByRole('dialog', { name: 'NEW ALLOCATION' });

    // The instrument with its venue, and the row's own chain as a chip.
    expect(
      within(dialog).getByText('Morpho USDC vault · Ethereum'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Settles on')).toBeInTheDocument();
    expect(within(dialog).getByText('Ethereum')).toBeInTheDocument();
    expect(
      within(dialog).getByLabelText(/amount to allocate/i),
    ).toBeInTheDocument();
  });

  it('derives each summary figure from real data and marks the unknown one', () => {
    render(
      <InvestScreen
        vaults={RAILS}
        safeAddress={SAFE}
        holdings={[usdcRow(12500)]}
      />,
    );

    fireEvent.click(allocateButton());
    const dialog = screen.getByRole('dialog', { name: 'NEW ALLOCATION' });
    const summary = within(dialog).getByTestId('invest-allocate-summary');

    // Minimum: the instrument's own minimum.
    expect(within(summary).getByText('$1')).toBeInTheDocument();
    // Estimated income: no yield was injected for this rail, so it is not
    // quoted rather than invented.
    expect(within(summary).getByText('Not quoted')).toBeInTheDocument();
    // Vault USDC after: the Safe's free USDC on the deposit chain (12,500)
    // less the default amount (10,000).
    expect(within(summary).getByText('$2,500')).toBeInTheDocument();
    // Qualifying balance is unchanged by design.
    expect(within(summary).getByText('unchanged')).toBeInTheDocument();
  });

  it('says the vault-USDC preview is unknown when that chain could not be read', () => {
    render(
      <InvestScreen
        vaults={RAILS}
        safeAddress={SAFE}
        holdings={[unreadRow('the balance provider is rate limiting this read (HTTP 429).')]}
      />,
    );

    fireEvent.click(allocateButton());
    const dialog = screen.getByRole('dialog', { name: 'NEW ALLOCATION' });
    const summary = within(dialog).getByTestId('invest-allocate-summary');

    // No invented balance: the preview is `—` and the reason is on hover.
    const vaultAfter = within(summary).getByText('Vault USDC after');
    expect(vaultAfter.parentElement).toHaveTextContent('Vault USDC after—');
    expect(
      within(vaultAfter.parentElement as HTMLElement).queryByText(/\$/),
    ).toBeNull();
  });
});
