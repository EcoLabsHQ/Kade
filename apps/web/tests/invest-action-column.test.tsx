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
 * The Invest row's **action column** (QF9).
 *
 * The owner asked for the allocate/held control to lose its dead space — the
 * last column was widened to `210px` while the row briefly carried two
 * buttons, and the row now carries one. The reference's own Invest table
 * (`reference/design-handoff/kade-mvp.dc.html`) uses `110px`, and the control
 * must keep rendering its full state at that width, measured against the
 * reference's button metrics (`height: 32px`, `border-radius: 999px`,
 * `font-size: 12px`, `font-weight: 600`). Against Plus Jakarta Sans at
 * `wght 600 / 12px`, `$10,000 held` measures 78.2px and `Position unread`
 * 90.2px; the control adds 31px of chrome (2px border, 18px padding, 3px gap,
 * 8px chevron), so `$10,000 held` fits inside the 110px track and the longer
 * unread label stays uncapped and bleeds only into the free inter-column
 * gutter rather than truncating.
 *
 * These tests pin that width, prove the label is not truncated, and re-prove
 * the interaction a previous review verified (open, both directions, outside
 * click and Escape) so the visual change did not regress the path that keeps
 * the resident's money reachable.
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

/** The reference's Invest table: the last column is `110px`. */
const REFERENCE_GRID = '1.9fr .9fr 1fr 1.2fr .9fr .9fr 110px';

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

function renderScreen(holdings: readonly VaultHoldingRow[]) {
  return render(
    <InvestScreen vaults={RAILS} safeAddress={SAFE} holdings={holdings} />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Invest action column: the reference width', () => {
  it('renders the row’s last column at the reference’s 110px', () => {
    renderScreen([morphoRow(10000)]);

    const row = screen.getByTestId('invest-row-morpho-1');
    // An assertion on the rendered style, not a comment: the widened 210px is
    // gone and the column is exactly the reference's.
    expect(row.style.gridTemplateColumns).toBe(REFERENCE_GRID);
    expect(row.style.gridTemplateColumns).not.toContain('210px');

    // The control sits in that last cell.
    const actionCell = row.children[row.children.length - 1];
    expect(actionCell).toContainElement(screen.getByTestId('invest-held-1'));
  });
});

describe('Invest action column: the state survives the narrower cell', () => {
  const cases = [
    {
      name: 'a held amount',
      holdings: [morphoRow(10000)],
      testId: 'invest-held-1',
      label: '$10,000 held',
    },
    {
      name: 'an unread position',
      holdings: [failedMorphoRow('execution reverted.')],
      testId: 'invest-position-unknown-1',
      label: 'Position unread',
    },
  ] as const;

  for (const item of cases) {
    it(`shows the full “${item.label}” state, uncapped and untruncated`, () => {
      renderScreen(item.holdings);
      const trigger = screen.getByTestId(item.testId);

      // The whole state is rendered, character for character.
      expect(trigger).toHaveTextContent(item.label);
      expect(trigger.textContent).toBe(item.label);

      // Nothing on the control can clip or ellipsise it: no fixed/capped width
      // and no overflow trap, so the label cannot be silently truncated.
      expect(trigger.style.whiteSpace).toBe('nowrap');
      expect(trigger.style.overflow).toBe('');
      expect(trigger.style.textOverflow).toBe('');
      expect(trigger.style.width).toBe('');
      expect(trigger.style.maxWidth).toBe('');
    });
  }
});

describe('Invest action column: the menu’s behaviour is unchanged', () => {
  it('opens on click and exposes both directions', () => {
    renderScreen([morphoRow(10000)]);
    const trigger = screen.getByTestId('invest-held-1');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu');
    expect(
      within(menu).getByRole('menuitem', { name: 'Allocate more' }),
    ).toBeEnabled();
    expect(
      within(menu).getByRole('menuitem', { name: 'Un-allocate' }),
    ).toBeEnabled();
  });

  it('exposes the unread variant’s items from the narrower cell', () => {
    renderScreen([failedMorphoRow('execution reverted.')]);
    fireEvent.click(screen.getByTestId('invest-position-unknown-1'));

    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Allocate' })).toBeEnabled();
    expect(
      within(menu).getByRole('menuitem', { name: 'Un-allocate' }),
    ).toBeEnabled();
  });

  it('closes on an outside click', () => {
    renderScreen([morphoRow(10000)]);
    const trigger = screen.getByTestId('invest-held-1');
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
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

describe('Invest action column: the animation is progressive enhancement', () => {
  it('declares the enter animation and suppresses it for reduced motion', () => {
    const { container } = renderScreen([morphoRow(10000)]);

    // The keyframes and the reduced-motion override ship with the control.
    const styles = Array.from(container.ownerDocument.querySelectorAll('style'))
      .map((node) => node.textContent ?? '')
      .join('\n');
    expect(styles).toContain('@keyframes kade-position-menu-in');
    expect(styles).toContain('prefers-reduced-motion: reduce');

    const trigger = screen.getByTestId('invest-held-1');
    // The collapsed control carries the stable class the stylesheet targets.
    expect(trigger).toHaveClass('kade-position-trigger');

    fireEvent.click(trigger);
    const menu = screen.getByRole('menu');
    expect(menu).toHaveClass('kade-position-menu');
    // The caret turns with the menu; its transition lives in the stylesheet.
    const caret = trigger.querySelector('.kade-position-caret') as HTMLElement;
    expect(caret).not.toBeNull();
    expect(caret.style.transform).toBe('rotate(180deg)');
  });
});
