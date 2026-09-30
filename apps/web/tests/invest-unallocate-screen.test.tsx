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

/**
 * The Invest screen's **Un-allocate** direction (the inverse of Allocate).
 *
 * These tests pin the owner's requirement and the screen's honesty: each
 * MetaMorpho rail carries both directions, an un-allocate runs the same
 * build → passkey → submit flow through `beginWithdraw` / `completeWithdraw`,
 * the "all" case is the default and is sent as `{ kind: 'all' }` (the server
 * resolves the shares), a partial sends a stated USDC amount, and the resident
 * is told **before signing** that un-allocating lowers the qualified tier. A
 * deposit is still never claimed unless the server confirmed it.
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
const HASH = `0x${'ab'.repeat(32)}`;
const CREDENTIAL_ID = 'abcdef';
const TOKEN = 'tok-1';

const ETHEREUM_RAIL: InvestVaultSummary = {
  configured: true,
  chainId: 1,
  chainName: 'Ethereum',
  vault: VAULT,
  usdc: USDC,
};
const RAILS: InvestVaultSummary[] = [ETHEREUM_RAIL];

const MORPHO_ETHEREUM = 'Morpho USDC vault · Ethereum';
const RETAINED_INSTRUMENT = 'Ondo USDY';

const READY = {
  status: 'ready' as const,
  token: TOKEN,
  hash: HASH,
  credentialId: CREDENTIAL_ID,
  chainId: 1,
};

const ASSERTION = {
  authenticatorData: 'AQIDBA',
  signature: 'MAYCAQECAQI',
  clientDataJSON: 'e30',
};

/** A real held position on Ethereum, as the reader would produce it. */
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

/**
 * Render a screen whose Ethereum rail holds a real position, so the row shows
 * the amount as its control.
 */
function renderHeld() {
  return render(
    <InvestScreen
      vaults={RAILS}
      safeAddress={SAFE}
      holdings={[morphoRow(10000)]}
    />,
  );
}

/**
 * The un-allocate path from a held row is one interaction in: open the
 * position menu, then take Un-allocate.
 */
function openUnallocate(): HTMLElement {
  fireEvent.click(screen.getByTestId('invest-held-1'));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Un-allocate' }));
  return screen.getByRole('dialog');
}

function confirmButton(dialog: HTMLElement) {
  return within(dialog).getByRole('button', { name: /build the un-allocate/i });
}

async function clickUnallocate(dialog: HTMLElement) {
  fireEvent.click(confirmButton(dialog));
  await waitFor(() => expect(hoisted.beginWithdraw).toHaveBeenCalled());
}

beforeEach(() => {
  hoisted.promptPasskeyAssertionParts.mockResolvedValue(ASSERTION);
  hoisted.beginWithdraw.mockResolvedValue(READY);
  hoisted.completeWithdraw.mockResolvedValue({
    status: 'sent',
    sent: true,
    userOperationHash: `0x${'fe'.repeat(32)}`,
    transactionHash: '0xfeed',
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('InvestScreen un-allocate availability', () => {
  it('offers both directions from a held rail, and none on the unwired instrument', () => {
    renderHeld();
    // The held amount is the control; opening it exposes both directions.
    const trigger = screen.getByTestId('invest-held-1');
    expect(trigger).toHaveTextContent('$10,000 held');
    fireEvent.click(trigger);
    expect(
      screen.getByRole('menuitem', { name: 'Allocate more' }),
    ).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: 'Un-allocate' })).toBeEnabled();

    // The retained instrument has no execution path, so it has no position
    // trigger and its one Allocate action stays locked.
    const usdyRow = screen.getByTestId('invest-row-usdy');
    expect(usdyRow.querySelector('[aria-haspopup="menu"]')).toBeNull();
    expect(
      within(usdyRow).getByRole('button', { name: /allocate into ondo usdy/i }),
    ).toBeDisabled();
  });

  it('does not offer an un-allocate for an unconfigured rail', () => {
    render(
      <InvestScreen
        vaults={RAILS.map((rail) => ({ ...rail, configured: false }))}
        safeAddress={SAFE}
        holdings={[]}
      />,
    );
    expect(screen.queryByText(MORPHO_ETHEREUM)).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(
      screen.queryByRole('menuitem', { name: 'Un-allocate' }),
    ).toBeNull();
    expect(screen.getByText(RETAINED_INSTRUMENT)).toBeInTheDocument();
  });
});

describe('InvestScreen un-allocate flow', () => {
  it('defaults to the whole position and states the tier warning before signing', () => {
    renderHeld();
    const dialog = openUnallocate();

    // The warning is present before the confirm button is ever pressed.
    const warning = within(dialog).getByTestId('invest-unallocate-tier-warning');
    expect(warning).toHaveTextContent(/lowers your qualified tier/i);
    expect(warning).toHaveTextContent(/total across all three/i);

    // "All" is on by default, so the amount field is disabled and the button
    // offers the whole position.
    expect(
      within(dialog).getByLabelText(/amount to un-allocate/i),
    ).toBeDisabled();
    expect(
      within(dialog).getByText('Un-allocate all USDC'),
    ).toBeInTheDocument();
  });

  it('runs beginWithdraw → passkey → completeWithdraw for "all"', async () => {
    renderHeld();
    const dialog = openUnallocate();

    await clickUnallocate(dialog);
    await waitFor(() => expect(hoisted.completeWithdraw).toHaveBeenCalledTimes(1));

    expect(hoisted.beginWithdraw).toHaveBeenCalledWith({
      safeAddress: SAFE,
      amount: { kind: 'all' },
      chainId: 1,
    });
    expect(hoisted.promptPasskeyAssertionParts).toHaveBeenCalledWith({
      credentialId: CREDENTIAL_ID,
      challenge: HASH,
      rpId: window.location.hostname,
    });
    expect(hoisted.completeWithdraw).toHaveBeenCalledWith({
      token: TOKEN,
      assertion: ASSERTION,
      chainId: 1,
    });
    expect(
      await within(dialog).findByText(/un-allocate submitted/i),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/receipt confirmed on Ethereum/i),
    ).toBeInTheDocument();
  });

  it('sends a stated amount when "all" is unset', async () => {
    renderHeld();
    const dialog = openUnallocate();

    fireEvent.click(
      within(dialog).getByLabelText(/un-allocate everything/i),
    );
    fireEvent.change(within(dialog).getByLabelText(/amount to un-allocate/i), {
      target: { value: '1500.5' },
    });

    await clickUnallocate(dialog);
    await waitFor(() => expect(hoisted.completeWithdraw).toHaveBeenCalledTimes(1));

    expect(hoisted.beginWithdraw).toHaveBeenCalledWith({
      safeAddress: SAFE,
      amount: { kind: 'partial', amountUsdc: '1500.5' },
      chainId: 1,
    });
  });

  it('reports a gated pre-flight with the server reason and never prompts the passkey', async () => {
    hoisted.beginWithdraw.mockResolvedValue({
      status: 'gated',
      gate: 'safe-insufficient-shares',
      reason:
        'The Safe’s MetaMorpho shares are worth 0 USDC on Ethereum, but this ' +
        'un-allocate needs 10 USDC. The Safe does not hold enough shares to ' +
        'cover it — short by 10 USDC.',
    });
    renderHeld();
    const dialog = openUnallocate();

    await clickUnallocate(dialog);

    expect(
      await within(dialog).findByText(/un-allocate gated/i),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/short by 10 USDC/i)).toBeInTheDocument();
    expect(hoisted.promptPasskeyAssertionParts).not.toHaveBeenCalled();
    expect(hoisted.completeWithdraw).not.toHaveBeenCalled();
  });

  it('reports a failed submission with its stage and no false success', async () => {
    hoisted.completeWithdraw.mockResolvedValue({
      status: 'failed',
      sent: false,
      stage: 'sign',
      reason: 'The passkey attached no signature to the operation.',
    });
    renderHeld();
    const dialog = openUnallocate();

    await clickUnallocate(dialog);

    expect(
      await within(dialog).findByText(/un-allocate failed/i),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('sign')).toBeInTheDocument();
    expect(within(dialog).queryByText(/un-allocate submitted/i)).toBeNull();
  });
});
