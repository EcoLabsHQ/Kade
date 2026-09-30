import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { VaultHoldingRow } from '@/lib/wealth/vault-holdings';

/**
 * The dashboard's qualified figure comes from the **same** reduction the rest of
 * the app uses, structurally (T43, acceptance criterion 2).
 *
 * `summarizeInvestPosition` is mocked here to return a sentinel that does not
 * match the injected rows. If the dashboard ever inlined its own sum over the
 * rows — the two-truths defect this repository has spent the week eliminating —
 * the sentinel would not be shown and this test would fail. It also pins that
 * the page reads the Safe once and hands those exact rows to the reduction.
 */

const hoisted = vi.hoisted(() => ({
  redirect: vi.fn(),
  getSessionUser: vi.fn(),
  hasCompletedOnboarding: vi.fn(),
  loadShellSafe: vi.fn(),
  loadReviewBar: vi.fn(),
  loadResidentReviewState: vi.fn(),
  loadVaultHoldings: vi.fn(),
  loadFeePayment: vi.fn(),
  summarizeInvestPosition: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: hoisted.redirect }));
vi.mock('@/lib/supabase/server', () => ({
  getSessionUser: hoisted.getSessionUser,
  createSupabaseServerClient: vi.fn(),
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
vi.mock('@/components/shell/AppShell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
vi.mock('@/lib/invest/invest-position', () => ({
  summarizeInvestPosition: hoisted.summarizeInvestPosition,
}));

import OverviewPage from '@/app/page';

const SAFE = '0x5Af1000000000000000000000000000000000c09D';

const ROWS: readonly VaultHoldingRow[] = [
  {
    key: `${SAFE}:1:usdc`,
    kind: 'usdc',
    chainId: 1,
    chainName: 'Ethereum',
    symbol: 'USDC',
    name: 'USDC',
    amount: '999999.000000 USDC',
    usd: 999999,
    readError: null,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.getSessionUser.mockResolvedValue({
    userId: 'user-1',
    email: 'resident@example.com',
    provider: 'email',
  });
  hoisted.hasCompletedOnboarding.mockResolvedValue(true);
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
  hoisted.loadResidentReviewState.mockResolvedValue({
    status: 'pre_approved',
    tier: '3-year',
    preapprovalUsdc: 1.75,
    reviewUid: null,
    serviceUid: null,
    latestReview: null,
  });
  hoisted.loadVaultHoldings.mockResolvedValue(ROWS);
  hoisted.loadFeePayment.mockResolvedValue({ status: 'none' });
});

describe('the dashboard consumes the app-wide position reduction', () => {
  it('renders the reduction output and hands it the exact read rows', async () => {
    hoisted.summarizeInvestPosition.mockReturnValue({
      freeUsdc: { status: 'known', usd: 111111 },
      allocated: { status: 'known', usd: 222222 },
      byChain: new Map(),
      freeByChain: new Map(),
      heldCount: 1,
    });

    render(await OverviewPage());

    // 111,111 + 222,222 — the sentinel from the shared reduction, not the
    // injected rows' 999,999.
    expect(screen.getAllByText('$333,333').length).toBeGreaterThan(0);
    expect(screen.queryByText('$999,999')).toBeNull();

    expect(hoisted.summarizeInvestPosition).toHaveBeenCalledTimes(1);
    const call = hoisted.summarizeInvestPosition.mock.calls[0]?.[0];
    expect(call?.safeAddress).toBe(SAFE);
    expect(call?.holdings).toEqual(ROWS);

    cleanup();
  });
});
