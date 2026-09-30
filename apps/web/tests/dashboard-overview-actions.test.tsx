import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

/**
 * The Overview dashboard's header actions.
 *
 * The dashboard used to render its own "Start Residency" link because the nav
 * entry did not exist yet. It does now (`@/components/shell/nav`), so the
 * redundant link was removed — but only the link: the sibling "Replay setup"
 * link must survive, or the removal would have been a blind deletion of the
 * whole action row.
 *
 * Offline: the session, the review bar and the shell's Safe read are mocked, so
 * no network is touched.
 */

const hoisted = vi.hoisted(() => ({
  redirect: vi.fn(),
  getSessionUser: vi.fn(),
  hasCompletedOnboarding: vi.fn(),
  loadShellSafe: vi.fn(),
  loadReviewBar: vi.fn(),
  loadVaultHoldings: vi.fn(),
  loadFeePayment: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: hoisted.redirect }));
vi.mock('@/lib/supabase/server', () => ({
  getSessionUser: hoisted.getSessionUser,
  createSupabaseServerClient: vi.fn(),
}));
vi.mock('@/lib/onboarding/state', () => ({
  hasCompletedOnboarding: hoisted.hasCompletedOnboarding,
}));
vi.mock('@/lib/safe/shell', () => ({
  loadShellSafe: hoisted.loadShellSafe,
}));
vi.mock('@/lib/review/review-bar', () => ({
  loadReviewBar: hoisted.loadReviewBar,
}));
vi.mock('@/lib/review/queue', () => ({
  loadResidentReviewState: vi.fn(),
  NO_RESIDENT_REVIEW_STATE: {
    status: null,
    tier: null,
    preapprovalUsdc: null,
    reviewUid: null,
    serviceUid: null,
    latestReview: null,
  },
}));
vi.mock('@/lib/wealth/vault-holdings', () => ({
  loadVaultHoldings: hoisted.loadVaultHoldings,
}));
vi.mock('@/lib/payments/server', () => ({
  loadFeePayment: hoisted.loadFeePayment,
}));
vi.mock('@/lib/env', () => ({
  isAuthConfigured: () => false,
  readAuthEnv: () => ({}),
}));
vi.mock('@/components/review/ReviewGateWatcher', () => ({
  ReviewGateWatcher: () => null,
}));
vi.mock('@/components/shell/AppShell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/shell/ContentContainer', () => ({
  ContentContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import OverviewPage from '@/app/page';

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.getSessionUser.mockResolvedValue({
    userId: 'user-1',
    email: 'resident@example.com',
    provider: 'email',
  });
  hoisted.hasCompletedOnboarding.mockResolvedValue(true);
  hoisted.loadShellSafe.mockResolvedValue({
    address: null,
    deployed: false,
    status: null,
    explorerUrl: null,
  });
  hoisted.loadReviewBar.mockResolvedValue({
    show: false,
    reference: null,
    isReviewer: false,
  });
  hoisted.loadVaultHoldings.mockResolvedValue([]);
  hoisted.loadFeePayment.mockResolvedValue({ status: 'none' });
});

describe('Overview dashboard header actions', () => {
  it('no longer links to Residency but keeps the Replay setup link', async () => {
    render(await OverviewPage());

    // The redundant "Start Residency" link is gone...
    expect(
      screen.queryByRole('link', { name: 'Start Residency' }),
    ).toBeNull();
    expect(
      screen
        .queryAllByRole('link')
        .some((link) => link.getAttribute('href') === '/residency'),
    ).toBe(false);

    // ...but the sibling action survives, so the row was not deleted wholesale.
    const replay = screen.getByRole('link', { name: 'Replay setup' });
    expect(replay).toHaveAttribute('href', '/onboarding');

    cleanup();
  });
});
