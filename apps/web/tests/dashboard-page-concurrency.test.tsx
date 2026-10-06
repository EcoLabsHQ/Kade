import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

/**
 * The Overview route issues its session-only reads in one stage.
 *
 * The shell Safe, the onboarding gate and the resident review row depend only
 * on the session, not on one another. They used to be three serial awaits
 * (`loadShellSafe` → `hasCompletedOnboarding` → the review read), so every
 * dashboard navigation paid three round-trips one after another. This test
 * records when each read is in flight and fails unless all three overlap.
 */

const hoisted = vi.hoisted(() => ({
  moments: [] as string[][],
  inFlight: new Set<string>(),
  getSessionUser: vi.fn(),
  loadShellSafe: vi.fn(),
  hasCompletedOnboarding: vi.fn(),
  loadResidentReviewState: vi.fn(),
  loadReviewBar: vi.fn(),
  loadVaultHoldings: vi.fn(),
  loadFeePayment: vi.fn(),
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

vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  getSessionUser: hoisted.getSessionUser,
  createSupabaseServerClient: vi.fn(async () => ({})),
}));
vi.mock('@/lib/onboarding/state', () => ({
  hasCompletedOnboarding: hoisted.hasCompletedOnboarding,
}));
vi.mock('@/lib/safe/shell', () => ({ loadShellSafe: hoisted.loadShellSafe }));
vi.mock('@/lib/review/review-bar', () => ({
  loadReviewBar: hoisted.loadReviewBar,
}));
vi.mock('@/lib/review/queue', () => ({
  loadResidentReviewState: hoisted.loadResidentReviewState,
  NO_RESIDENT_REVIEW_STATE: {
    status: null,
    tier: null,
    preapprovalUsdc: null,
    reviewUid: null,
    serviceUid: null,
    latestReview: null,
  },
}));
vi.mock('@/lib/env', () => ({
  isAuthConfigured: () => true,
  readAuthEnv: () => ({}),
}));
vi.mock('@/components/review/ReviewGateWatcher', () => ({
  ReviewGateWatcher: () => null,
}));
vi.mock('@/components/shell/ContentContainer', () => ({
  ContentContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/lib/wealth/vault-holdings', () => ({
  loadVaultHoldings: hoisted.loadVaultHoldings,
}));
vi.mock('@/lib/payments/server', () => ({
  loadFeePayment: hoisted.loadFeePayment,
}));

import OverviewPage from '@/app/(resident)/page';

beforeEach(() => {
  hoisted.moments.length = 0;
  hoisted.inFlight.clear();
  hoisted.getSessionUser.mockResolvedValue({
    userId: 'user-1',
    email: 'resident@example.com',
    provider: 'email',
  });
  hoisted.loadShellSafe.mockReset();
  hoisted.loadShellSafe.mockImplementation(() =>
    tracked('safe', {
      address: '0x5Af1000000000000000000000000000000000c09D',
      deployed: true,
      status: 'deployed',
      explorerUrl: null,
    }),
  );
  hoisted.hasCompletedOnboarding.mockReset();
  hoisted.hasCompletedOnboarding.mockImplementation(() => tracked('onboarding', true));
  hoisted.loadResidentReviewState.mockReset();
  hoisted.loadResidentReviewState.mockImplementation(() =>
    tracked('review', {
      status: 'pre_approved',
      tier: '3-year',
      preapprovalUsdc: 1.75,
      reviewUid: null,
      serviceUid: null,
      latestReview: null,
    }),
  );
  hoisted.loadReviewBar.mockResolvedValue({
    show: false,
    reference: null,
    reviewed: false,
    isReviewer: false,
  });
  hoisted.loadVaultHoldings.mockResolvedValue([]);
  hoisted.loadFeePayment.mockResolvedValue({ status: 'none' });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('OverviewPage — independent session reads are concurrent', () => {
  it('has the Safe read, the onboarding gate and the review read in flight together', async () => {
    render((await OverviewPage()) as ReactElement);

    // The old route awaited each of these before starting the next, so no
    // recorded moment could contain more than one tag.
    expect(
      hoisted.moments.some(
        (m) =>
          m.includes('safe') &&
          m.includes('onboarding') &&
          m.includes('review'),
      ),
    ).toBe(true);
    // Each read is still issued exactly once.
    expect(hoisted.loadShellSafe).toHaveBeenCalledTimes(1);
    expect(hoisted.hasCompletedOnboarding).toHaveBeenCalledTimes(1);
    expect(hoisted.loadResidentReviewState).toHaveBeenCalledTimes(1);
  });
});
