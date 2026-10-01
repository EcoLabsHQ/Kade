import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { InvestScreen } from '@/components/invest/InvestScreen';
import type { InvestVaultSummary } from '@/app/invest/actions';
import type { VaultHoldingRow } from '@/lib/wealth/vault-holdings';
import { shortAddress } from '@/lib/wealth/format';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

/**
 * The Invest allocate modal's **contract details** disclosure (QF3).
 *
 * The owner found the modal overwhelming because the long hex addresses
 * dominated it, and asked for the contract information to sit behind a
 * "ver más"-style disclosure with truncated addresses, a copy button and an
 * explorer link. These focused offline tests pin the presentation:
 *
 *   - the contract block is collapsed by default and expands on activation
 *     (a real `<button>` with `aria-expanded`, asserting its visible state);
 *   - each address renders truncated, the copy control carries the full value,
 *     and the explorer link points at that value's own chain;
 *   - the summary box keeps its derived figures (and its honest "Not quoted"),
 *     so the layout change did not quietly replace a derived value with a
 *     literal.
 *
 * No network is touched: the two server actions are mocked and the position is
 * injected as the rows the route would have read.
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
const BASE_VAULT = '0x2222222222222222222222222222222222222222';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const ETHEREUM_RAIL: InvestVaultSummary = {
  configured: true,
  chainId: 1,
  chainName: 'Ethereum',
  vault: VAULT,
  usdc: USDC,
};
const BASE_RAIL: InvestVaultSummary = {
  configured: true,
  chainId: 8453,
  chainName: 'Base',
  vault: BASE_VAULT,
  usdc: BASE_USDC,
};

const MORPHO_ETHEREUM = 'Morpho USDC vault · Ethereum';
const MORPHO_BASE = 'Morpho USDC vault · Base';

/** The Safe's free USDC on Ethereum, as the reader would produce it. */
function usdcRow(usd: number): VaultHoldingRow {
  return {
    key: '1:usdc',
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

function renderScreen(
  vaults: readonly InvestVaultSummary[],
  holdings: readonly VaultHoldingRow[] = [],
) {
  return render(
    <InvestScreen vaults={vaults} safeAddress={SAFE} holdings={holdings} />,
  );
}

function openDialog(name: string): HTMLElement {
  fireEvent.click(
    screen.getByRole('button', {
      name: new RegExp(`allocate into ${name}`, 'i'),
    }),
  );
  return screen.getByRole('dialog');
}

function contractToggle(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole('button', { name: /contract details/i });
}

function contractDetails(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByTestId('invest-contract-details');
}

/** Capture what the copy buttons write to the clipboard. */
function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

beforeEach(() => {
  hoisted.promptPasskeyAssertionParts.mockResolvedValue({
    authenticatorData: 'AQIDBA',
    signature: 'MAYCAQECAQI',
    clientDataJSON: 'e30',
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('InvestScreen contract details disclosure', () => {
  it('is collapsed by default and expands on activation', () => {
    renderScreen([ETHEREUM_RAIL]);
    const dialog = openDialog(MORPHO_ETHEREUM);

    // Collapsed: the control says so and the block is not visible.
    const toggle = contractToggle(dialog);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(contractDetails(dialog)).not.toBeVisible();

    fireEvent.click(toggle);

    // Expanded: the same control now reports it and the block is visible.
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(contractDetails(dialog)).toBeVisible();
    expect(within(dialog).getByTitle(VAULT)).toBeInTheDocument();
  });

  it('truncates each address and its copy control holds the full value', async () => {
    const writeText = stubClipboard();
    renderScreen([ETHEREUM_RAIL]);
    const dialog = openDialog(MORPHO_ETHEREUM);
    fireEvent.click(contractToggle(dialog));

    // The vault address renders shortened, not as the whole hex string.
    const vaultCode = within(dialog).getByTitle(VAULT);
    expect(vaultCode).toHaveTextContent(shortAddress(VAULT));
    expect(vaultCode.textContent).not.toBe(VAULT);
    expect(vaultCode.textContent?.length ?? 0).toBeLessThan(VAULT.length);

    // The copy affordance is icon-only and writes the full value.
    const vaultCopy = within(dialog).getByRole('button', {
      name: /copy MetaMorpho vault address/i,
    });
    expect(vaultCopy.textContent).toBe('');
    fireEvent.click(vaultCopy);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(VAULT));
    expect(
      within(dialog).getByRole('button', {
        name: 'Copied MetaMorpho vault address',
      }),
    ).toBeInTheDocument();

    // The underlying USDC address is handled the same way.
    const usdcCode = within(dialog).getByTitle(USDC);
    expect(usdcCode).toHaveTextContent(shortAddress(USDC));
    fireEvent.click(
      within(dialog).getByRole('button', { name: /copy USDC address/i }),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(USDC));
  });

  it('links each address on its own chain, not a hard-coded host', () => {
    // Ethereum mainnet: Etherscan.
    renderScreen([ETHEREUM_RAIL]);
    const ethereumDialog = openDialog(MORPHO_ETHEREUM);
    fireEvent.click(contractToggle(ethereumDialog));
    expect(
      within(ethereumDialog).getByRole('link', {
        name: /MetaMorpho vault address on the block explorer/i,
      }),
    ).toHaveAttribute('href', `https://etherscan.io/address/${VAULT}`);
    expect(
      within(ethereumDialog).getByRole('link', {
        name: /USDC address on the block explorer/i,
      }),
    ).toHaveAttribute('href', `https://etherscan.io/address/${USDC}`);

    cleanup();

    // Base: Basescan, never Etherscan.
    renderScreen([BASE_RAIL]);
    const baseDialog = openDialog(MORPHO_BASE);
    fireEvent.click(contractToggle(baseDialog));
    expect(
      within(baseDialog).getByRole('link', {
        name: /MetaMorpho vault address on the block explorer/i,
      }),
    ).toHaveAttribute('href', `https://basescan.org/address/${BASE_VAULT}`);
    expect(
      within(baseDialog).getByRole('link', {
        name: /USDC address on the block explorer/i,
      }),
    ).toHaveAttribute('href', `https://basescan.org/address/${BASE_USDC}`);
  });

  it('keeps the summary box’s derived figures and honest unknowns', () => {
    renderScreen([ETHEREUM_RAIL], [usdcRow(12500)]);
    const dialog = openDialog(MORPHO_ETHEREUM);
    const summary = within(dialog).getByTestId('invest-allocate-summary');

    // Minimum: the instrument's own minimum, from the rail config.
    expect(within(summary).getByText('$1')).toBeInTheDocument();
    // Estimated income: no live yield source, so it stays "Not quoted".
    expect(within(summary).getByText('Not quoted')).toBeInTheDocument();
    // Vault USDC after: the injected free USDC (12,500) less the default
    // amount (10,000) — a real derivation, not a literal.
    expect(within(summary).getByText('$2,500')).toBeInTheDocument();
    // Qualifying balance is unchanged by design.
    expect(within(summary).getByText('unchanged')).toBeInTheDocument();
  });

  it('says the vault-USDC preview is unknown, never a fabricated figure', () => {
    renderScreen(
      [ETHEREUM_RAIL],
      [unreadRow('the balance provider is rate limiting this read (HTTP 429).')],
    );
    const dialog = openDialog(MORPHO_ETHEREUM);
    const summary = within(dialog).getByTestId('invest-allocate-summary');

    const vaultAfter = within(summary).getByText('Vault USDC after');
    expect(vaultAfter.parentElement).toHaveTextContent('Vault USDC after—');
    expect(
      within(vaultAfter.parentElement as HTMLElement).queryByText(/\$/),
    ).toBeNull();
  });
});
