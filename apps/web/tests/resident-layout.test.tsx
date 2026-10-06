import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * The resident route group's layout.
 *
 * The layout is the one place the resident shell is resolved and rendered now.
 * These tests pin that:
 *
 *   1. it renders the shell exactly once around the page content, with the
 *      session, Safe and review state it resolved;
 *   2. it still redirects an unauthenticated request to `/login` before
 *      rendering anything; and
 *   3. its two shell reads (the Safe and the review bar) are issued together,
 *      not staged one after the other.
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

const SAFE = '0x5Af1000000000000000000000000000000000c09D';

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
  hoisted.loadReviewBar.mockResolvedValue({
    show: false,
    reference: null,
    reviewed: false,
    isReviewer: false,
  });
});

describe('resident layout', () => {
  it('renders the shell once around the page content with the resolved state', async () => {
    const { container } = render(
      await ResidentLayout({ children: <div>page content</div> }),
    );

    // The page content is rendered inside the shell.
    expect(screen.getByText('page content')).toBeInTheDocument();
    expect(container.querySelector('.kade-shell')).not.toBeNull();
    expect(container.querySelector('.kade-sidebar')).not.toBeNull();

    // The global footer lives in the shell, so it renders exactly once.
    expect(container.querySelectorAll('footer')).toHaveLength(1);

    // The resolved Safe reaches the sidebar; the active chain is named.
    expect(screen.getByText(SAFE)).toBeInTheDocument();
    expect(screen.getByText('Ethereum Sepolia')).toBeInTheDocument();

    // Each shell source is read exactly once, for this session.
    expect(hoisted.loadShellSafe).toHaveBeenCalledTimes(1);
    expect(hoisted.loadShellSafe).toHaveBeenCalledWith('user-1');
    expect(hoisted.loadReviewBar).toHaveBeenCalledTimes(1);
    expect(hoisted.loadReviewBar).toHaveBeenCalledWith('user-1');

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
      tracked('review', {
        show: false,
        reference: null,
        reviewed: false,
        isReviewer: false,
      }),
    );

    render(await ResidentLayout({ children: <div>page content</div> }));

    // The old per-page shell staged these serially; the layout starts both
    // before awaiting either, so a moment contains both tags.
    expect(
      hoisted.moments.some((m) => m.includes('safe') && m.includes('review')),
    ).toBe(true);

    cleanup();
  });
});
