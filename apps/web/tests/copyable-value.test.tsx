import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CopyableValue } from '@/components/ui/CopyableValue';

/**
 * The copy and explorer affordances are icon-only (the owner asked for icons,
 * not text). These tests pin that contract directly, independently of the two
 * screens that embed the component:
 *
 * - neither control renders visible text, and each still exposes an accessible
 *   name so a screen reader can find it;
 * - both remain real, keyboard-reachable elements (a `<button>` and an `<a>`)
 *   with the link's new-tab hardening intact;
 * - activating copy writes the *full* value — never the shortened display form
 *   — and the resulting state is announced by renaming the accessible label to
 *   "Copied …" and swapping the glyph, not by colour alone.
 *
 * No network is touched.
 */

const FULL = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const EXPLORER = `https://etherscan.io/address/${FULL}`;

function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

afterEach(() => {
  cleanup();
});

describe('CopyableValue icon affordances', () => {
  it('renders the copy control as an icon-only button with an accessible name', () => {
    render(
      <CopyableValue value={FULL} label="vault address" explorerUrl={EXPLORER} />,
    );

    const button = screen.getByRole('button', { name: 'Copy vault address' });
    // Icon only: no visible text, exactly the copy glyph.
    expect(button.textContent).toBe('');
    expect(button).toContainElement(screen.getByTestId('copy-glyph'));
    // The full value stays recoverable even though it is displayed shortened.
    expect(screen.getByTitle(FULL)).toBeInTheDocument();
  });

  it('renders the explorer link as an icon-only new-tab link', () => {
    render(
      <CopyableValue value={FULL} label="vault address" explorerUrl={EXPLORER} />,
    );

    const link = screen.getByRole('link', {
      name: 'View vault address on the block explorer',
    });
    expect(link).toHaveAttribute('href', EXPLORER);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    // Icon only: no visible text, exactly the external-link glyph.
    expect(link.textContent).toBe('');
    expect(link).toContainElement(screen.getByTestId('external-link-glyph'));
  });

  it('copies the full value and announces the copied state', async () => {
    const writeText = stubClipboard();
    render(
      <CopyableValue value={FULL} label="vault address" explorerUrl={EXPLORER} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy vault address' }));

    // The clipboard receives the full value, not the shortened display form.
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(FULL));

    // The state is announced by the accessible name, and shown by a glyph swap.
    const copied = await screen.findByRole('button', {
      name: 'Copied vault address',
    });
    expect(copied).toContainElement(screen.getByTestId('check-glyph'));
    expect(screen.queryByTestId('copy-glyph')).not.toBeInTheDocument();
    // Still icon-only: the confirmation does not fall back to visible text.
    expect(copied.textContent).toBe('');
  });

  it('renders no explorer link when no URL is supplied', () => {
    render(<CopyableValue value={FULL} label="vault address" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Copy vault address' }),
    ).toBeInTheDocument();
  });
});
