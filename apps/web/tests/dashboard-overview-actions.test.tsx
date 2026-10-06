import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';

/**
 * The Overview dashboard's header and card actions.
 *
 * The dashboard used to render its own "Start Residency" link because the nav
 * entry did not exist yet. It does now (`@/components/shell/nav`), so the
 * redundant *header* link was removed — but only the link: the sibling "Replay
 * setup" link must survive, or the removal would have been a blind deletion of
 * the whole action row.
 *
 * The two tracker cards keep their own `Open →` affordances. Those point at the
 * Residency step (`/residency`), not at `/onboarding`: they open the step the
 * card is about. "Replay setup" is the only header action that deliberately
 * returns to onboarding.
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
  loadIdentityFact: vi.fn(),
  loadResidencyServiceFeePayment: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: hoisted.redirect }));
vi.mock('@/lib/supabase/server', () => ({
  getSessionUser: hoisted.getSessionUser,
  createSupabaseServerClient: vi.fn(),
}));
vi.mock('@/lib/residency/server', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/residency/server')>();
  return { ...actual, loadIdentityFact: hoisted.loadIdentityFact };
});
vi.mock('@/lib/residency/service-fee-server', () => ({
  loadResidencyServiceFeePayment: hoisted.loadResidencyServiceFeePayment,
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
    applicationId: null,
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
vi.mock('@/components/shell/ContentContainer', () => ({
  ContentContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import OverviewPage from '@/app/(resident)/page';

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
  hoisted.loadIdentityFact.mockResolvedValue(null);
  hoisted.loadResidencyServiceFeePayment.mockResolvedValue({ status: 'none' });
});

describe('Overview dashboard header actions', () => {
  it('removed the redundant header Start Residency link but keeps the Replay setup link', async () => {
    render(await OverviewPage());

    // The redundant "Start Residency" header link is gone…
    expect(
      screen.queryByRole('link', { name: 'Start Residency' }),
    ).toBeNull();

    // …but the sibling action survives, so the row was not deleted wholesale.
    const replay = screen.getByRole('link', { name: 'Replay setup' });
    expect(replay).toHaveAttribute('href', '/onboarding');

    cleanup();
  });

  it('points both tracker card Open → affordances at /residency, not /onboarding', async () => {
    render(await OverviewPage());

    // The "Getting ready for residency" card contains the OverviewTracker; its
    // `Open →` must open the Residency step, where the tracker rows are actioned.
    const residencyHeading = screen.getByRole('heading', {
      name: /getting ready for residency/i,
    });
    const trackerLink = within(
      residencyHeading.parentElement as HTMLElement,
    ).getByRole('link', { name: /open/i });
    expect(trackerLink).toHaveAttribute('href', '/residency');

    // The "Qualified holdings" card opens the same step.
    const holdingsHeading = screen.getByRole('heading', {
      name: /qualified holdings/i,
    });
    const holdingsLink = within(
      holdingsHeading.parentElement as HTMLElement,
    ).getByRole('link', { name: /open/i });
    expect(holdingsLink).toHaveAttribute('href', '/residency');

    // Exactly the two card affordances leave for /residency; nothing else does.
    expect(
      screen
        .getAllByRole('link')
        .filter((link) => link.getAttribute('href') === '/residency'),
    ).toHaveLength(2);

    cleanup();
  });
});
