import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

/**
 * The sidebar no longer shows the resident's email.
 *
 * The owner asked for the address to live only in the account configuration.
 * These tests prove both halves of that move, offline:
 *   1. the sidebar renders no trace of the address *value* (asserting on the
 *      literal, so a differently-styled email would still fail), and
 *   2. the account menu survives the removal — its trigger is present and
 *      opens, and sign-out is still behind it, so the exit was not lost with
 *      the email.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ refresh: vi.fn() }),
}));

// SafeRetryButton imports the server action lazily; mocking it keeps the
// browser bundle's server-only dependencies out of jsdom.
vi.mock('@/app/onboarding/deploy-actions', () => ({ deployAccount: vi.fn() }));

import { AppShell } from '@/components/shell/AppShell';

const EMAIL = 'resident@example.com';

function renderShell(isReviewer = false) {
  render(
    <AppShell email={EMAIL} network="Ethereum Sepolia" isReviewer={isReviewer}>
      <div>content</div>
    </AppShell>,
  );
  return screen.getByRole('complementary');
}

afterEach(() => {
  cleanup();
});

describe('sidebar identity', () => {
  it('renders no part of the resident email address in the sidebar', () => {
    const sidebar = renderShell();

    // Assert on the actual value: a reworded or differently-styled address
    // would still be caught here, because the address itself must be absent.
    expect(within(sidebar).queryByText(EMAIL)).toBeNull();
    expect(sidebar.textContent ?? '').not.toContain(EMAIL);
    // Nor may it hide behind the trigger's accessible name.
    expect(screen.queryByRole('button', { name: EMAIL })).toBeNull();
  });

  it('keeps the avatar-only account trigger, and it opens the menu with sign-out', () => {
    renderShell();

    const trigger = screen.getByRole('button', { name: 'Account' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);

    const menu = screen.getByRole('menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(
      within(menu).getByRole('menuitem', { name: 'Sign out' }),
    ).toBeInTheDocument();
    // The route to the account configuration — where the email now lives —
    // must not have travelled out with the email.
    expect(
      within(menu).getByRole('menuitem', { name: 'Account settings' }),
    ).toHaveAttribute('href', '/account');
  });

  it('still offers the reviewer queue to a reviewer', () => {
    renderShell(true);

    fireEvent.click(screen.getByRole('button', { name: 'Account' }));

    expect(
      within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Admin' }),
    ).toHaveAttribute('href', '/admin');
  });
});
