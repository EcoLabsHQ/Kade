import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

/**
 * The account button and its menu.
 *
 * The trigger is avatar-only — the resident's email is account configuration
 * and lives on `/account` — but it still owns sign-out. The menu must open on
 * click, contain sign-out (and the shell's other user-level actions), and close
 * on an outside click or Escape. Escape also returns focus to the trigger, so
 * the control is usable from the keyboard.
 */

import { SidebarFooter } from '@/components/shell/SidebarFooter';

function renderFooter(isReviewer = false) {
  render(<SidebarFooter isReviewer={isReviewer} />);
  return screen.getByRole('button', { name: 'Account' });
}

afterEach(() => {
  cleanup();
});

describe('UserMenu', () => {
  it('keeps the menu closed until the user button is clicked', () => {
    const trigger = renderFooter();

    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Sign out' })).toBeNull();
  });

  it('opens on click and offers sign-out among the account actions', () => {
    const trigger = renderFooter();
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
    const trigger = renderFooter(true);
    fireEvent.click(trigger);

    expect(
      within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Admin' }),
    ).toHaveAttribute('href', '/admin');
  });

  it('closes on Escape and returns focus to the user button', () => {
    const trigger = renderFooter();
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on an outside click', () => {
    const trigger = renderFooter();
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('does not close when the click is inside the menu', () => {
    const trigger = renderFooter();
    fireEvent.click(trigger);

    fireEvent.mouseDown(screen.getByRole('menu'));

    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
});
