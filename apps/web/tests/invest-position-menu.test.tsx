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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

/**
 * The Invest row's **one control** (QF5).
 *
 * The row used to stack the held amount above two equal-weight pills, in a
 * narrow column, so the state and both actions competed for the same space. The
 * owner's chosen design is "the amount is the control": a row with no position
 * renders a single `Allocate` button, and a row that has a position renders the
 * real held amount as a trigger whose menu holds both directions.
 *
 * These tests pin the design *and* the guarantee that made the change safe: the
 * withdraw path must stay reachable from every state that has a position —
 * including a failed read — so money can always come out of the vault.
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

function renderScreen(
  holdings: readonly VaultHoldingRow[],
  safeAddress: string | null = SAFE,
) {
  return render(
    <InvestScreen vaults={RAILS} safeAddress={safeAddress} holdings={holdings} />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Invest row: one action when there is no position', () => {
  it('renders exactly one Allocate action and no menu trigger', () => {
    renderScreen([]);
    const row = screen.getByTestId('invest-row-morpho-1');

    // One action, and it is Allocate.
    const actions = within(row).getAllByRole('button');
    expect(actions).toHaveLength(1);
    expect(actions[0]).toHaveAccessibleName(/allocate into morpho usdc vault/i);

    // No position state and no menu trigger anywhere in the row.
    expect(screen.queryByTestId('invest-held-1')).toBeNull();
    expect(screen.queryByTestId('invest-position-unknown-1')).toBeNull();
    expect(row.querySelector('[aria-haspopup="menu"]')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('Invest row: the amount is the control', () => {
  it('renders the held amount as the control and exposes both directions', () => {
    renderScreen([morphoRow(10000)]);

    const trigger = screen.getByTestId('invest-held-1');
    // The single thing the row shows is the real held amount, as the control.
    expect(trigger).toHaveTextContent('$10,000 held');
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu');
    expect(
      within(menu).getByRole('menuitem', { name: 'Allocate more' }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole('menuitem', { name: 'Un-allocate' }),
    ).toBeInTheDocument();
  });

  it('opens the allocate modal from Allocate more', () => {
    renderScreen([morphoRow(10000)]);
    fireEvent.click(screen.getByTestId('invest-held-1'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Allocate more' }));

    expect(
      screen.getByRole('dialog', { name: 'NEW ALLOCATION' }),
    ).toBeInTheDocument();
  });

  it('renders the injected position, not a literal amount', () => {
    renderScreen([morphoRow(7777)]);

    expect(screen.getByTestId('invest-held-1')).toHaveTextContent('$7,777 held');
    // The old hardcoded-looking reference figure never appears.
    expect(screen.queryByText('$10,000 held')).toBeNull();
  });
});

describe('Invest row: un-allocate is reachable from every position state', () => {
  const states = [
    {
      name: 'a held position',
      holdings: [morphoRow(10000)],
      safeAddress: SAFE,
      triggerId: 'invest-held-1',
      label: '$10,000 held',
    },
    {
      name: 'a failed read',
      holdings: [
        failedMorphoRow(
          'The vault position could not be read: execution reverted.',
        ),
      ],
      safeAddress: SAFE,
      triggerId: 'invest-position-unknown-1',
      label: 'Position unread',
    },
    {
      name: 'no Safe to read from',
      holdings: [],
      safeAddress: null,
      triggerId: 'invest-position-unknown-1',
      label: 'Position unread',
    },
  ] as const;

  for (const state of states) {
    it(`keeps Un-allocate one interaction away with ${state.name}`, () => {
      renderScreen(state.holdings, state.safeAddress);

      const trigger = screen.getByTestId(state.triggerId);
      expect(trigger).toHaveTextContent(state.label);
      fireEvent.click(trigger);

      const unallocate = screen.getByRole('menuitem', { name: 'Un-allocate' });
      expect(unallocate).toBeEnabled();
      fireEvent.click(unallocate);

      expect(
        screen.getByRole('dialog', { name: 'UN-ALLOCATE' }),
      ).toBeInTheDocument();
    });
  }

  it('keeps the failed read honest: its specific reason stays on the control', () => {
    renderScreen([
      failedMorphoRow(
        'The vault position could not be read: execution reverted.',
      ),
    ]);

    // The state is announced as unread, never as a fabricated $0, and the
    // real reason is carried by the control.
    expect(
      screen.getByTestId('invest-position-unknown-1').getAttribute('title'),
    ).toMatch(/execution reverted/i);
    expect(screen.queryByText(/\$0 held/)).toBeNull();
  });
});

describe('Invest row: the menu closes like the app’s other menu', () => {
  it('closes on an outside click', () => {
    renderScreen([morphoRow(10000)]);
    const trigger = screen.getByTestId('invest-held-1');
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('does not close when the click is inside the menu', () => {
    renderScreen([morphoRow(10000)]);
    fireEvent.click(screen.getByTestId('invest-held-1'));

    fireEvent.mouseDown(screen.getByRole('menu'));

    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('closes on Escape and returns focus to the trigger', () => {
    renderScreen([morphoRow(10000)]);
    const trigger = screen.getByTestId('invest-held-1');
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('Invest row: the declared menu role is fully implemented', () => {
  it('moves focus into the menu and roves it with the arrow keys', () => {
    renderScreen([morphoRow(10000)]);
    fireEvent.click(screen.getByTestId('invest-held-1'));

    const menu = screen.getByRole('menu');
    const allocateMore = within(menu).getByRole('menuitem', {
      name: 'Allocate more',
    });
    const unallocate = within(menu).getByRole('menuitem', {
      name: 'Un-allocate',
    });

    // A declared role="menu" puts focus inside itself.
    expect(allocateMore).toHaveFocus();

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(unallocate).toHaveFocus();

    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(allocateMore).toHaveFocus();

    fireEvent.keyDown(menu, { key: 'End' });
    expect(unallocate).toHaveFocus();

    fireEvent.keyDown(menu, { key: 'Home' });
    expect(allocateMore).toHaveFocus();
  });
});
