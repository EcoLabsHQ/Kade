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
import { shortAddress } from '@/lib/wealth/format';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

/**
 * The Invest modal's **confirmed-transaction detail** disclosure (QF6).
 *
 * The owner was happy with the deposit finish state but found its four
 * always-visible rows (transaction, user operation, vault, Safe) a lot to take
 * in, and asked for them behind a "ver más", exactly like the contract details.
 * These focused offline tests pin the presentation and prove nothing was lost:
 *
 *   - the detail rows are collapsed by default after a confirmed deposit and
 *     become visible on activation (a real `<button>` with `aria-expanded`,
 *     asserting the block's *visible* state, not merely its presence);
 *   - every value survives the move: the transaction hash, the user operation
 *     hash, the vault address and the Safe address each render truncated with a
 *     copy control carrying the full value and an explorer link on the right
 *     chain;
 *   - a missing transaction hash still renders "Not reported" with no link; and
 *   - a fresh finish starts collapsed — opening the panel, closing the modal
 *     and confirming a new deposit never exposes a stale, already-open panel.
 *
 * No network is touched: the server actions are mocked and the passkey prompt
 * resolves a fixture assertion.
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
const BASE_VAULT = '0x2222222222222222222222222222222222222222';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const HASH = `0x${'ab'.repeat(32)}`;
const USER_OP = `0x${'fe'.repeat(32)}`;
const TOKEN = 'tok-1';
const CREDENTIAL_ID = 'abcdef';

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

function renderScreen(vaults: readonly InvestVaultSummary[]) {
  return render(
    <InvestScreen vaults={vaults} safeAddress={SAFE} holdings={[]} />,
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

/** Build, sign and confirm a deposit, returning the confirmed finish block. */
async function confirmDeposit(dialog: HTMLElement): Promise<HTMLElement> {
  fireEvent.click(
    within(dialog).getByRole('button', { name: /build the deposit/i }),
  );
  return within(dialog).findByTestId('invest-deposit-complete');
}

/** The disclosure control that folds the confirmed-transaction rows away. */
function detailsToggle(finish: HTMLElement): HTMLElement {
  return within(finish).getByRole('button', { name: /deposit details/i });
}

function detailsBlock(finish: HTMLElement): HTMLElement {
  return within(finish).getByTestId('invest-deposit-details');
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
  hoisted.beginDeposit.mockResolvedValue(READY);
  hoisted.beginWithdraw.mockResolvedValue(READY);
  hoisted.promptPasskeyAssertionParts.mockResolvedValue(ASSERTION);
  hoisted.completeDeposit.mockResolvedValue({
    status: 'sent',
    sent: true,
    userOperationHash: USER_OP,
    transactionHash: HASH,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('InvestScreen confirmed-deposit details disclosure', () => {
  it('is collapsed by default and expands on activation', async () => {
    renderScreen([ETHEREUM_RAIL]);
    const dialog = openDialog(MORPHO_ETHEREUM);
    const finish = await confirmDeposit(dialog);

    // Collapsed: the control says so and the row block is not visible.
    const toggle = detailsToggle(finish);
    const block = detailsBlock(finish);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', block.id);
    expect(block).not.toBeVisible();

    // The success notice itself leads the panel and stays outside the fold.
    expect(
      within(finish).getByText(/was submitted and its receipt confirmed/i),
    ).toBeVisible();

    fireEvent.click(toggle);

    // Expanded: the same control now reports it and the block is visible.
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(block).toBeVisible();
  });

  it('keeps every value: truncated display, full-value copy, and a chain-correct link', async () => {
    const writeText = stubClipboard();
    renderScreen([ETHEREUM_RAIL]);
    const dialog = openDialog(MORPHO_ETHEREUM);
    const finish = await confirmDeposit(dialog);
    fireEvent.click(detailsToggle(finish));

    // Truncated display: the full string is never the visible label.
    for (const full of [HASH, USER_OP, VAULT, SAFE]) {
      const code = within(finish).getByTitle(full);
      expect(code).toHaveTextContent(shortAddress(full));
      expect(code.textContent).not.toBe(full);
      expect(code.textContent?.length ?? 0).toBeLessThan(full.length);
    }

    // Copy affordances carry the full value, one per row.
    const copies: ReadonlyArray<readonly [RegExp, string]> = [
      [/copy transaction hash/i, HASH],
      [/copy user operation hash/i, USER_OP],
      [/copy MetaMorpho vault address/i, VAULT],
      [/copy Safe address/i, SAFE],
    ];
    for (const [name, full] of copies) {
      fireEvent.click(within(finish).getByRole('button', { name }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(full));
    }

    // Explorer links point at the value's own chain — Etherscan for Ethereum.
    expect(
      within(finish).getByRole('link', {
        name: /transaction hash on the block explorer/i,
      }),
    ).toHaveAttribute('href', `https://etherscan.io/tx/${HASH}`);
    expect(
      within(finish).getByRole('link', {
        name: /MetaMorpho vault address on the block explorer/i,
      }),
    ).toHaveAttribute('href', `https://etherscan.io/address/${VAULT}`);
    expect(
      within(finish).getByRole('link', {
        name: /Safe address on the block explorer/i,
      }),
    ).toHaveAttribute('href', `https://etherscan.io/address/${SAFE}`);
    // The user operation was never linked; the move must not invent one.
    expect(
      within(finish).queryByRole('link', { name: /user operation/i }),
    ).toBeNull();
  });

  it('points the links at the chain the deposit landed on, not a hard-coded host', async () => {
    hoisted.beginDeposit.mockResolvedValue({ ...READY, chainId: 8453 });
    renderScreen([BASE_RAIL]);
    const dialog = openDialog(MORPHO_BASE);
    const finish = await confirmDeposit(dialog);
    fireEvent.click(detailsToggle(finish));

    expect(
      within(finish).getByRole('link', {
        name: /transaction hash on the block explorer/i,
      }),
    ).toHaveAttribute('href', `https://basescan.org/tx/${HASH}`);
    expect(
      within(finish).getByRole('link', {
        name: /MetaMorpho vault address on the block explorer/i,
      }),
    ).toHaveAttribute('href', `https://basescan.org/address/${BASE_VAULT}`);
    expect(
      within(finish).queryByRole('link', {
        name: /transaction hash on the block explorer/i,
      })?.getAttribute('href'),
    ).not.toContain('etherscan.io');
  });

  it('renders "Not reported" with no link when no transaction hash was reported', async () => {
    hoisted.completeDeposit.mockResolvedValue({
      status: 'sent',
      sent: true,
      userOperationHash: USER_OP,
      transactionHash: null,
    });
    renderScreen([ETHEREUM_RAIL]);
    const dialog = openDialog(MORPHO_ETHEREUM);
    const finish = await confirmDeposit(dialog);
    fireEvent.click(detailsToggle(finish));

    // The block is genuinely open, so an absence here is an absence, not a
    // hidden descendant passing vacuously.
    expect(detailsBlock(finish)).toBeVisible();
    expect(within(finish).getByText(/not reported/i)).toBeVisible();
    expect(
      within(finish).queryByRole('link', { name: /transaction hash/i }),
    ).toBeNull();
    // The other values still survive the honest unknown.
    expect(
      within(finish).getByRole('link', {
        name: /MetaMorpho vault address on the block explorer/i,
      }),
    ).toBeInTheDocument();
  });

  it('starts a fresh finish collapsed after opening, closing and reopening', async () => {
    renderScreen([ETHEREUM_RAIL]);
    const firstDialog = openDialog(MORPHO_ETHEREUM);
    const firstFinish = await confirmDeposit(firstDialog);

    // Open the panel on the first finish...
    fireEvent.click(detailsToggle(firstFinish));
    expect(detailsBlock(firstFinish)).toBeVisible();

    // ...close the modal, then confirm a brand-new deposit.
    fireEvent.click(
      within(firstDialog).getByRole('button', { name: /^cancel$/i }),
    );
    const secondDialog = openDialog(MORPHO_ETHEREUM);
    const secondFinish = await confirmDeposit(secondDialog);

    // The fresh finish leads with the notice and carries no stale open panel.
    const toggle = detailsToggle(secondFinish);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(detailsBlock(secondFinish)).not.toBeVisible();
  });
});
