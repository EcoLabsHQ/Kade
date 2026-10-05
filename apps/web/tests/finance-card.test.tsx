import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

/**
 * The Card & Banking screen (D21), rendered to the reference.
 *
 * jsdom does not compute layout, so this proves the reference's structure and
 * the screen's local interactions, not the pixels: the header chip, the
 * pre-order layout with the gated order control that does not advance, the
 * "Banking" banner and its early-access mailto, and — rendered
 * directly, because the default in-review state cannot reach them — the active
 * layout and the top-up dialog with its address and focus handling. A reviewer
 * must still confirm the rendering in a browser.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/card',
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { ActiveLayout, CardScreen } from '@/components/finance/card/CardScreen';

/** The reference's card deposit address (kade-mvp.dc.html 844). */
const DEPOSIT_ADDRESS = '0x5Af1c4E9a7B2dD0341fE88b6C0937aA5d2e1c09D';

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
    // The struck subtitle tail ("Ordering unlocks once intake review
    // completes.") is gone; the remaining sentence is unchanged.
    expect(
      screen.getByText(
        'Spend from your vault in XCG anywhere on the island.',
      ),
    ).toBeInTheDocument();
    // The reference screen carries no disclosure banner above the header.
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('renders the pre-order layout with a gated order control that does not advance', () => {
    render(<CardScreen />);

    expect(
      screen.getByRole('heading', { name: 'How it works' }),
    ).toBeInTheDocument();

    const order = screen.getByRole('button', {
      name: 'Order card · after intake review',
    });
    // The prototype keeps the control clickable but no-ops under review.
    expect(order).not.toBeDisabled();
    fireEvent.click(order);

    // Nothing advances: the active layout stays unreachable from this state.
    expect(screen.queryByText('XCG 8,946')).not.toBeInTheDocument();
    expect(screen.queryByText('Transactions')).not.toBeInTheDocument();
  });

  it('opens the early-access mailto and applies locally', () => {
    render(<CardScreen />);

    // The banner heading was shortened from "Altitude banking" to "Banking".
    expect(
      screen.getByRole('heading', { name: 'Banking' }),
    ).toBeInTheDocument();

    // "Apply for early access" is a mailto: link carrying the exact,
    // URL-encoded subject — not a bare button and not a "#" placeholder.
    const apply = screen.getByRole('link', { name: 'Apply for early access' });
    expect(apply).toHaveAttribute(
      'href',
      'mailto:info@labs.eco?subject=Please%20keep%20me%20up%20to%20date%20on%20Banking%20opportunities.',
    );

    // Stop jsdom's (unimplemented) document navigation; the React handler must
    // still run, exactly as a real mailto click would open the mail client.
    apply.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(apply);
    expect(
      screen.getByRole('button', { name: 'On the early-access list ✓' }),
    ).toBeInTheDocument();
  });

  it('renders the active layout and its transactions when rendered directly', () => {
    render(<ActiveLayout />);

    expect(screen.getByText('XCG 8,946')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Transactions' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Van den Tweel Supermarket')).toBeInTheDocument();
  });

  it('opens the top-up dialog, focuses it, and shows the reference address', () => {
    render(<ActiveLayout />);

    fireEvent.click(screen.getByRole('button', { name: 'Top up' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveFocus();
    expect(
      within(dialog).getByText('Onchain Island Card · 4821'),
    ).toBeInTheDocument();
    // The vault source shows the reference Safe.
    expect(
      within(dialog).getByText('Safe 0x5Af1…c09D · vault USDC'),
    ).toBeInTheDocument();

    fireEvent.click(
      within(dialog).getByRole('button', {
        name: /Deposit from another source/,
      }),
    );

    expect(within(dialog).getByText(DEPOSIT_ADDRESS)).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'I have sent the funds' }),
    ).toBeInTheDocument();
  });
});
