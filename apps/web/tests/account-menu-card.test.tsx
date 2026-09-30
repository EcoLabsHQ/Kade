import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';

/**
 * The Safe card as the account-menu trigger (QF10).
 *
 * The owner moved the account menu off the avatar-only circle and onto the Safe
 * card, removing the card's own gear. These tests are offline and assert the
 * owner's acceptance criteria directly:
 *
 *   1. clicking the Safe card opens the account menu;
 *   2. the gear is gone, but `Account settings` is still reachable in the menu;
 *   3. the avatar-only circle is gone, leaving exactly one trigger in the
 *      sidebar — the card;
 *   4. the trigger is keyboard reachable and the menu closes on an outside click
 *      and on Escape;
 *   5. `Sign out` still posts to `/auth/signout`.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ refresh: vi.fn() }),
}));

// Defensive: keeps the browser bundle's server-only dependencies out of jsdom.
vi.mock('@/app/onboarding/deploy-actions', () => ({ deployAccount: vi.fn() }));

import { Sidebar } from '@/components/shell/Sidebar';

const SAFE = '0x3e8cD8C29a32912f7E6e659c6f8645e4f178A9bb';
const NAV = [{ items: [{ href: '/', label: 'Overview' }] }];

function renderSidebar(isReviewer = false) {
  render(
    <Sidebar
      nav={NAV}
      network="Ethereum Sepolia"
      safeAddress={SAFE}
      isReviewer={isReviewer}
    />,
  );
  return screen.getByRole('complementary');
}

/** The card's own trigger, proving the control is the card itself. */
function cardTrigger(): HTMLButtonElement {
  const card = screen.getByTestId('safe-address-card');
  return within(card).getByRole('button', { name: 'Account' });
}

afterEach(() => {
  cleanup();
});

describe('the Safe card as the account-menu trigger', () => {
  it('opens the account menu when the Safe card is clicked', () => {
    renderSidebar();

    const card = screen.getByTestId('safe-address-card');
    const trigger = cardTrigger();

    // The trigger is the card's own control, not a separate avatar elsewhere.
    expect(trigger.parentElement).toBe(card);
    expect(card).toHaveTextContent(SAFE);

    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(trigger);

    const menu = screen.getByRole('menu');
    expect(
      within(menu).getByRole('menuitem', { name: 'Account settings' }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole('menuitem', { name: 'Sign out' }),
    ).toBeInTheDocument();
  });

  it('removes the gear while keeping Account settings reachable in the menu', () => {
    renderSidebar();

    const card = screen.getByTestId('safe-address-card');
    // The gear was a link on the card labelled `Account settings`; it is gone.
    expect(
      within(card).queryByRole('link', { name: 'Account settings' }),
    ).toBeNull();
    expect(card.querySelector('[aria-label="Account settings"]')).toBeNull();

    // The route to `/account` survives behind the card's menu.
    fireEvent.click(cardTrigger());
    expect(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: 'Account settings',
      }),
    ).toHaveAttribute('href', '/account');
  });

  it('leaves exactly one account trigger in the sidebar, and it is the card', () => {
    const sidebar = renderSidebar();

    const triggers = within(sidebar).getAllByRole('button', {
      name: 'Account',
    });
    // The avatar-only circle that used to sit in the footer is gone, so only the
    // card's trigger remains.
    expect(triggers).toHaveLength(1);
    const trigger = triggers[0]!;
    expect(screen.getByTestId('safe-address-card').contains(trigger)).toBe(
      true,
    );
  });

  it('is keyboard reachable, and closes on an outside click and on Escape', () => {
    const sidebar = renderSidebar();
    const trigger = within(sidebar).getByRole('button', { name: 'Account' });

    trigger.focus();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('posts sign-out to /auth/signout', () => {
    renderSidebar();

    fireEvent.click(cardTrigger());
    const signOut = within(screen.getByRole('menu')).getByRole('menuitem', {
      name: 'Sign out',
    });
    const form = signOut.closest('form');

    expect(form).toHaveAttribute('action', '/auth/signout');
    expect(form).toHaveAttribute('method', 'post');
  });
});
