import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { InvestScreen } from '@/components/invest/InvestScreen';
import type { InvestVaultSummary } from '@/app/invest/actions';
import type { VaultHoldingRow } from '@/lib/wealth/vault-holdings';

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

function unallocateButton() {
  return screen.getByRole('button', {
    name: /un-allocate from morpho usdc vault · ethereum/i,
  });
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

    // Each failed read carries its own reason to the screen.
    expect(screen.getByText(/rate limiting this read/i)).toBeInTheDocument();
    expect(screen.getByText(/execution reverted/i)).toBeInTheDocument();
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
    // Both directions stay reachable on a held row.
    expect(allocateButton()).toBeEnabled();
    expect(unallocateButton()).toBeEnabled();

    fireEvent.click(unallocateButton());
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
    expect(within(summary).getByText('$100')).toBeInTheDocument();
    // Estimated income: no live yield source is connected, so it is not quoted
    // rather than invented.
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
