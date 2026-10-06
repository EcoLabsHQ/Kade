import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * The resident route group's layout.
 *
 * The layout is the one place the resident shell is resolved and rendered now.
 * These tests pin that:
 *
 *   1. it renders the shell frame immediately after the session check, without
 *      waiting for the Safe or review reads — the frame must not be blocked by
 *      the per-resident data;
 *   2. it still redirects an unauthenticated request to `/login` before
 *      rendering anything;
 *   3. its two shell reads are issued together, not staged one after the other;
 *   4. the streamed fallbacks fabricate no Safe, balance, status or name; and
 *   5. the resolved slot components do reach the shell with the resolved state.
 */

const hoisted = vi.hoisted(() => ({
  redirect: vi.fn(),
  getSessionUser: vi.fn(),
  loadShellSafe: vi.fn(),
  loadReviewBar: vi.fn(),
  moments: [] as string[][],
  inFlight: new Set<string>(),
}));

function enter(tag: string) {
  hoisted.inFlight.add(tag);
  hoisted.moments.push([...hoisted.inFlight]);
}
function leave(tag: string) {
  hoisted.inFlight.delete(tag);
}
function tracked<T>(tag: string, value: T): Promise<T> {
  enter(tag);
  return new Promise((resolve) => {
    setTimeout(() => {
      leave(tag);
      resolve(value);
    }, 0);
  });
}

vi.mock('next/navigation', () => ({
  redirect: hoisted.redirect,
  usePathname: () => '/',
  useRouter: () => ({ refresh: vi.fn() }),
}));

// SafeRetryButton imports the server action lazily; mocking it keeps the
// browser bundle's server-only dependencies out of jsdom.
vi.mock('@/app/onboarding/deploy-actions', () => ({ deployAccount: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  getSessionUser: hoisted.getSessionUser,
}));
vi.mock('@/lib/safe/shell', () => ({ loadShellSafe: hoisted.loadShellSafe }));
vi.mock('@/lib/review/review-bar', () => ({
  loadReviewBar: hoisted.loadReviewBar,
}));
vi.mock('@/lib/env', () => ({ readChainEnv: () => 'testnet' }));

import ResidentLayout from '@/app/(resident)/layout';
import { ShellAdminSwitch } from '@/components/shell/ShellAdminSwitch';
import { ShellSafeCard } from '@/components/shell/ShellSafeCard';
import { ShellReviewBanner } from '@/components/shell/ShellReviewBanner';
import { ShellReviewNotice } from '@/components/shell/ShellReviewNotice';

const SAFE = '0x5Af1000000000000000000000000000000000c09D';

const REVIEW = {
  show: false,
  reference: null,
  reviewed: false,
  isReviewer: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.moments.length = 0;
  hoisted.inFlight.clear();
  hoisted.getSessionUser.mockResolvedValue({
    userId: 'user-1',
    email: 'resident@example.com',
    provider: 'email',
  });
  hoisted.loadShellSafe.mockResolvedValue({
    address: SAFE,
    deployed: true,
    status: 'deployed',
    explorerUrl: null,
  });
  hoisted.loadReviewBar.mockResolvedValue(REVIEW);
});

describe('resident layout', () => {
  it('renders the shell frame immediately, without waiting for the shell reads', async () => {
    // The reads never settle. The old layout awaited both before rendering
    // anything, so it could not resolve at all; the new one returns the frame
    // first and lets the slots stream in.
    hoisted.loadShellSafe.mockImplementation(() => new Promise(() => {}));
    hoisted.loadReviewBar.mockImplementation(() => new Promise(() => {}));

    const { container } = render(
      await ResidentLayout({ children: <div>page content</div> }),
    );

    // The page content is rendered inside the shell.
    expect(screen.getByText('page content')).toBeInTheDocument();
    expect(container.querySelector('.kade-shell')).not.toBeNull();
    expect(container.querySelector('.kade-sidebar')).not.toBeNull();

    // The global footer lives in the shell, so it renders exactly once.
    expect(container.querySelectorAll('footer')).toHaveLength(1);

    // The active chain is named from configuration, with no database read.
    expect(screen.getByText('Ethereum Sepolia')).toBeInTheDocument();

    // The Safe card is still streaming, so the resolved address is absent.
    expect(screen.queryByText(SAFE)).toBeNull();

    cleanup();
  });

  it('redirects an unauthenticated request to /login without rendering the shell', async () => {
    hoisted.getSessionUser.mockResolvedValue(null);
    hoisted.redirect.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT');
    });

    await expect(
      ResidentLayout({ children: <div>page content</div> }),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(hoisted.redirect).toHaveBeenCalledWith('/login');
    // The shell state is never read for a request with no session.
    expect(hoisted.loadShellSafe).not.toHaveBeenCalled();
    expect(hoisted.loadReviewBar).not.toHaveBeenCalled();

    cleanup();
  });

  it('issues the Safe and review-bar reads together, not one after the other', async () => {
    hoisted.loadShellSafe.mockReset();
    hoisted.loadShellSafe.mockImplementation(() =>
      tracked('safe', {
        address: SAFE,
        deployed: true,
        status: 'deployed',
        explorerUrl: null,
      }),
    );
    hoisted.loadReviewBar.mockReset();
    hoisted.loadReviewBar.mockImplementation(() =>
      tracked('review', REVIEW),
    );

    render(await ResidentLayout({ children: <div>page content</div> }));

    // The old per-page shell staged these serially; the Safe card slot starts
    // both before awaiting either, so a moment contains both tags.
    expect(
      hoisted.moments.some((m) => m.includes('safe') && m.includes('review')),
    ).toBe(true);

    cleanup();
  });

  it('streams the resolved Safe into the sidebar card', async () => {
    render(await ShellSafeCard({ userId: 'user-1', network: 'Ethereum Sepolia' }));

    expect(screen.getByText(SAFE)).toBeInTheDocument();
    expect(hoisted.loadShellSafe).toHaveBeenCalledWith('user-1');
    expect(hoisted.loadReviewBar).toHaveBeenCalledWith('user-1');

    cleanup();
  });

  it('streams the resolved review state into the notice and the banner', async () => {
    hoisted.loadReviewBar.mockResolvedValue({
      show: true,
      reference: 'CW-2026-0409',
      reviewed: false,
      isReviewer: false,
    });

    render(await ShellReviewNotice({ userId: 'user-1' }));
    expect(screen.getByTestId('sidebar-review-notice')).toHaveTextContent(
      'Pre-approved · in review',
    );
    cleanup();

    render(await ShellReviewBanner({ userId: 'user-1' }));
    expect(screen.getByText(/Use the platform now/)).toBeInTheDocument();
    cleanup();
  });

  it('streams the resolved reviewer state into the Admin affordance', async () => {
    hoisted.loadReviewBar.mockResolvedValue({
      show: false,
      reference: null,
      reviewed: false,
      isReviewer: true,
    });

    render(await ShellAdminSwitch({ userId: 'user-1' }));
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute(
      'href',
      '/admin',
    );

    cleanup();
  });

  it('renders no fabricated Safe, balance or account state in the fallbacks', async () => {
    const { container } = render(
      await ResidentLayout({ children: <div>page content</div> }),
    );

    // The Safe card is an empty, decorative shape while it streams.
    const safeFallback = screen.getByTestId('shell-safe-card-fallback');
    expect((safeFallback.textContent ?? '').trim()).toBe('');
    expect(safeFallback).toHaveAttribute('aria-hidden');

    // The Admin affordance is an empty shape too — never the disabled
    // "not a reviewer" state, which would be a fabricated claim.
    const adminFallback = screen.getByTestId('shell-admin-fallback');
    expect((adminFallback.textContent ?? '').trim()).toBe('');
    expect(adminFallback).toHaveAttribute('aria-hidden');

    // The conditional regions announce nothing until they know they apply.
    expect(screen.queryByTestId('sidebar-review-notice')).toBeNull();
    expect(container.textContent ?? '').not.toContain('no account yet');
    expect(container.textContent ?? '').not.toMatch(/0x/i);

    cleanup();
  });
});
