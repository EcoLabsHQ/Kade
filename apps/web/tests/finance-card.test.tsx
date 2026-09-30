import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

/**
 * The Card & Banking screen (D21), a declared presentational mock.
 *
 * jsdom does not compute layout, so this proves the reference's structure, the
 * mock's disclosure and its local interactions, not the pixels: the amber demo
 * notice, the header chip, the genuinely-gated order control, the separately
 * labelled demo-preview control, the "Altitude banking" banner and its
 * early-access toggle, and the top-up dialog with its demo-labelled address and
 * focus handling. A reviewer must still confirm the rendering in a browser.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/card',
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { CardScreen } from '@/components/finance/card/CardScreen';

/** Open the active layout through the honest demo-preview control. */
function openActivePreview() {
  fireEvent.click(
    screen.getByRole('button', { name: 'Preview active card (demo)' }),
  );
}

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

  it('discloses the demo mock as the first element of the screen', () => {
    render(<CardScreen />);

    const notice = screen.getByRole('note');
    expect(notice).toHaveTextContent(
      'Preview · demo data. This screen is a visual mock. The balances, transactions, card and addresses shown are illustrative examples, not real records — no funds move, and none of the addresses should be used.',
    );
    // It sits above the h1 header block.
    const heading = screen.getByRole('heading', {
      level: 1,
      name: 'Onchain Island Card',
    });
    expect(
      notice.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders the pre-order layout with a genuinely gated order control', () => {
    render(<CardScreen />);

    expect(
      screen.getByRole('heading', { name: 'How it works' }),
    ).toBeInTheDocument();

    const order = screen.getByRole('button', {
      name: 'Order card · after intake review',
    });
    expect(order).toBeDisabled();

    // The active layout is reachable only through the labelled demo preview.
    expect(
      screen.getByRole('button', { name: 'Preview active card (demo)' }),
    ).toBeInTheDocument();
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

  it('advances to the active layout through the demo-preview control', () => {
    render(<CardScreen />);

    openActivePreview();

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

  it('opens the top-up dialog, focuses it, and shows demo-labelled data', () => {
    render(<CardScreen />);

    openActivePreview();
    fireEvent.click(screen.getByRole('button', { name: 'Top up' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveFocus();
    expect(
      within(dialog).getByText('Onchain Island Card · 4821'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('Demo data — illustrative only; no funds move.'),
    ).toBeInTheDocument();
    // The vault source is honest about being a demo Safe.
    expect(
      within(dialog).getByText('Demo Safe · vault USDC'),
    ).toBeInTheDocument();
  });

  it('labels the deposit address as a demo, never a usable address', () => {
    render(<CardScreen />);

    openActivePreview();
    fireEvent.click(screen.getByRole('button', { name: 'Top up' }));

    const dialog = screen.getByRole('dialog');
    fireEvent.click(
      within(dialog).getByRole('button', {
        name: /Deposit from another source/,
      }),
    );

    expect(
      within(dialog).getByText('Demo address — do not send funds'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('0x0000…DEMO')).toBeInTheDocument();
    // No fabricated, usable-looking address may remain.
    expect(within(dialog).queryByText(/0x5Af1/)).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'I have sent the funds' }),
    ).toBeInTheDocument();
  });
});
