import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

/**
 * The Bank ↔ Crypto screen — a disclosed presentational mock.
 *
 * These tests pin the reference layout and, above all, the mock's honesty: the
 * demo notice is visible on the screen and repeated in each dialog, the demo
 * transfer history renders, the fabricated credit-target address is marked
 * unusable, and both dialogs open and close as local UI state while no action
 * claims a real transfer succeeded.
 *
 * `next/navigation` is mocked as `sidebar-layout.test.tsx` does, because the
 * resident shell imports it.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/bank',
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { BankScreen } from '@/components/finance/bank/BankScreen';
import { RESIDENT_NAV } from '@/components/shell/nav';

describe('BankScreen reference layout', () => {
  it('renders the header, subhead and the powered-by-GOS chip', () => {
    render(<BankScreen />);
    expect(
      screen.getByRole('heading', { name: 'Bank ↔ Crypto' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Fund your vault from a bank account, or cash out to one\./,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('powered by GOS')).toBeInTheDocument();
    cleanup();
  });

  it('renders both direction cards', () => {
    render(<BankScreen />);
    expect(screen.getByTestId('bank-direction-bank-crypto')).toHaveTextContent(
      'Bank → Crypto',
    );
    expect(
      screen.getByRole('heading', { name: 'Fund your vault' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('bank-direction-crypto-bank')).toHaveTextContent(
      'Crypto → Bank',
    );
    expect(screen.getByText('After review')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cash out' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Unlocks after review' }),
    ).toBeInTheDocument();
    cleanup();
  });

  it('renders the three KPI values', () => {
    render(<BankScreen />);
    const funded = screen.getByTestId('bank-kpi-funded');
    expect(within(funded).getByText('Funded in')).toBeInTheDocument();
    expect(within(funded).getByText('$62,500')).toBeInTheDocument();
    expect(
      within(funded).getByText('3 transfers · last 90 days'),
    ).toBeInTheDocument();

    const cashed = screen.getByTestId('bank-kpi-cashed');
    expect(within(cashed).getByText('$4,200')).toBeInTheDocument();
    expect(within(cashed).getByText('1 payout · XCG')).toBeInTheDocument();

    const progress = screen.getByTestId('bank-kpi-progress');
    expect(within(progress).getByText('$15,000')).toBeInTheDocument();
    expect(
      within(progress).getByText('SWIFT · expected 16 Sep'),
    ).toBeInTheDocument();
    cleanup();
  });

  it('renders all five transfer-history rows', () => {
    render(<BankScreen />);
    for (const ref of [
      'GOS-9012',
      'GOS-8841',
      'GOS-8703',
      'GOS-8620',
      'GOS-8455',
    ]) {
      expect(screen.getByTestId(`bank-history-${ref}`)).toBeInTheDocument();
    }
    expect(screen.getByText('23,795 USDC')).toBeInTheDocument();
    expect(screen.getByText('Settled')).toBeInTheDocument();
    expect(screen.getByText('14,062 USDC')).toBeInTheDocument();
    cleanup();
  });
});

describe('BankScreen demo disclosure', () => {
  it('shows the demo notice on the screen, before any figure', () => {
    render(<BankScreen />);
    const notice = screen.getByRole('note');
    expect(notice).toBeVisible();
    expect(notice).toHaveTextContent(
      'Preview · demo data. This screen is a visual mock. The balances, accounts, addresses and transfers shown are illustrative examples, not real records — no funds move, and none of the addresses should be used.',
    );
    // The notice is the first thing in the screen content, above the header.
    expect(notice.compareDocumentPosition(screen.getByRole('heading', { name: 'Bank ↔ Crypto' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    cleanup();
  });
});

describe('BankScreen dialogs', () => {
  it('opens the Fund vault dialog and closes it again', () => {
    render(<BankScreen />);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Fund vault' }));

    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText('Demo data — illustrative only; no funds move.'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('GOS Payments B.V. (for Marcus Feldt)'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('OI-0409-MF')).toBeInTheDocument();

    // The fabricated credit target is marked unusable, not presented as a real
    // Safe the resident could send funds to.
    expect(
      within(dialog).getByText(/Demo — USDC in Safe 0xDemo…0000/),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/do not send funds/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/0x5Af1…c09D/)).toBeNull();

    fireEvent.click(
      within(dialog).getByRole('button', { name: /copy details & close/i }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();
  });

  it('opens the Cash out dialog from the locked-looking button', () => {
    render(<BankScreen />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Unlocks after review' }),
    );

    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText('Demo data — illustrative only; no funds move.'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('Vault USDC → bank account'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('Bank payouts unlock once intake review completes.'),
    ).toBeInTheDocument();
    cleanup();
  });

  it('never claims a transfer happened when the cash-out action is clicked', () => {
    render(<BankScreen />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Unlocks after review' }),
    );
    const dialog = screen.getByRole('dialog');
    fireEvent.click(
      within(dialog).getByRole('button', { name: /review & sign transfer/i }),
    );
    // The mock closes; it does not announce a sent or settled transfer.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(/transfer sent/i)).toBeNull();
    expect(screen.queryByText(/settled to the account/i)).toBeNull();
    cleanup();
  });
});

describe('Finance navigation', () => {
  it('renders the Finance items as plain links', () => {
    const finance = RESIDENT_NAV.find((group) => group.label === 'Finance');
    expect(finance).toBeDefined();

    const bank = finance?.items.find((item) => item.href === '/bank');
    const card = finance?.items.find((item) => item.href === '/card');
    expect(bank).toBeDefined();
    expect(card).toBeDefined();
    expect(bank?.locked).toBeUndefined();
    expect(bank?.lockReason).toBeUndefined();
    expect(card?.locked).toBeUndefined();
    expect(card?.lockReason).toBeUndefined();
  });

  it('leaves Vote locked', () => {
    const vote = RESIDENT_NAV.flatMap((group) => group.items).find(
      (item) => item.href === '/vote',
    );
    expect(vote?.locked).toBe(true);
  });
});
