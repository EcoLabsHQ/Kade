import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

/**
 * The Card & Banking screen (D21), a declared presentational mock.
 *
 * jsdom does not compute layout, so this proves the reference's structure and
 * the mock's local interactions, not the pixels: the header chip, the pre-order
 * layout and its gated order control, the "Altitude banking" banner and its
 * one-way early-access toggle, the pre-order → active mock transition, and the
 * top-up dialog with its deposit address. A reviewer must still confirm the
 * rendering in a browser.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/card',
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { CardScreen } from '@/components/finance/card/CardScreen';

describe('Card & Banking screen', () => {
  it('renders the header with the review chip and subhead', () => {
    render(<CardScreen />);

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Onchain Island Card',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Unlocks after review')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Spend from your vault in XCG anywhere on the island. Ordering unlocks once intake review completes.',
      ),
    ).toBeInTheDocument();
  });

  it('renders the pre-order layout with the gated order control', () => {
    render(<CardScreen />);

    expect(
      screen.getByRole('heading', { name: 'How it works' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Order card · after intake review',
      }),
    ).toBeInTheDocument();
    // The active layout is not present before the mock transition.
    expect(screen.queryByText('Transactions')).not.toBeInTheDocument();
  });

  it('applies to the early-access list locally', () => {
    render(<CardScreen />);

    expect(
      screen.getByRole('heading', { name: 'Altitude banking' }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Apply for early access' }),
    );
    expect(
      screen.getByRole('button', { name: 'On the early-access list ✓' }),
    ).toBeInTheDocument();
  });

  it('advances to the active layout from the order control', () => {
    render(<CardScreen />);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Order card · after intake review',
      }),
    );

    expect(screen.getByText('XCG 8,946')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Transactions' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Van den Tweel Supermarket')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'Order card · after intake review',
      }),
    ).not.toBeInTheDocument();
  });

  it('opens the top-up dialog and shows the card deposit address', () => {
    render(<CardScreen />);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Order card · after intake review',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Top up' }));

    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText('Onchain Island Card · 4821'),
    ).toBeInTheDocument();

    fireEvent.click(
      within(dialog).getByRole('button', {
        name: /Deposit from another source/,
      }),
    );

    expect(
      within(dialog).getByText('0x5Af1c4E9a7B2dD0341fE88b6C0937aA5d2e1c09D'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'I have sent the funds' }),
    ).toBeInTheDocument();
  });
});
