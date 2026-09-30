import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

/**
 * The account menu.
 *
 * The trigger used to be an avatar-only button in the sidebar footer. The owner
 * moved it onto the Safe card — the resident's own account — so the card is now
 * the control. The menu must still open on click, contain sign-out and the
 * shell's other user-level actions, and close on an outside click or Escape.
 * Escape also returns focus to the trigger, so the control is usable from the
 * keyboard.
 */

import { SafeAddressCard } from '@/components/shell/SafeAddressCard';

const SAFE = '0x3e8cD8C29a32912f7E6e659c6f8645e4f178A9bb';

function renderMenu(isReviewer = false) {
  render(
    <SafeAddressCard
      address={SAFE}
      deployed={false}
      status="predicted"
      isReviewer={isReviewer}
    />,
  );
  return screen.getByRole('button', { name: 'Account' });
}

afterEach(() => {
  cleanup();
});

describe('UserMenu', () => {
  it('keeps the menu closed until the card is clicked', () => {
    const trigger = renderMenu();

    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Sign out' })).toBeNull();
  });

  it('opens on click and offers sign-out among the account actions', () => {
    const trigger = renderMenu();
    fireEvent.click(trigger);

    const menu = screen.getByRole('menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(
      within(menu).getByRole('menuitem', { name: 'Sign out' }),
    ).toBeInTheDocument();
    // The shell's other user-level action stays reachable from the menu.
    expect(
      within(menu).getByRole('menuitem', { name: 'Account settings' }),
    ).toHaveAttribute('href', '/account');
    // A plain resident is not offered the reviewer queue.
    expect(
      within(menu).queryByRole('menuitem', { name: 'Admin' }),
    ).toBeNull();
  });

  it('offers the reviewer queue to a reviewer', () => {
    const trigger = renderMenu(true);
    fireEvent.click(trigger);

    expect(
      within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Admin' }),
    ).toHaveAttribute('href', '/admin');
  });

  it('closes on Escape and returns focus to the card trigger', () => {
    const trigger = renderMenu();
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on an outside click', () => {
    const trigger = renderMenu();
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('does not close when the click is inside the menu', () => {
    const trigger = renderMenu();
    fireEvent.click(trigger);

    fireEvent.mouseDown(screen.getByRole('menu'));

    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
});
