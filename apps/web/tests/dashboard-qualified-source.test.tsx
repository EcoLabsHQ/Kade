import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { VaultHoldingRow } from '@/lib/wealth/vault-holdings';

/**
 * The dashboard's qualified figure comes from the **one** reduction the rest of
 * the app uses, structurally (QF8).
 *
 * The dashboard used to reduce the Safe's rows a second way — through
 * `summarizeInvestPosition`'s free-USDC + MetaMorpho buckets — which ignored the
 * native coin and so disagreed with the Holdings `QUALIFIED` card and the
 * residency tier check the moment the Safe held any. Both functions are mocked
 * here:
 *
 *   - `summarizeQualifiedPosition` returns a sentinel that does not match the
 *     injected rows, and we assert it is called exactly once with exactly those
 *     rows; if the dashboard ever inlined its own sum, the sentinel would not be
 *     shown and this test would fail;
 *   - `summarizeInvestPosition` is a spy that must **never** be called, so a
 *     later edit cannot quietly reintroduce the second reduction.
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
  summarizeQualifiedPosition: vi.fn(),
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
vi.mock('@/components/shell/ContentContainer', () => ({
  ContentContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/lib/wealth/vault-holdings', () => ({
  loadVaultHoldings: hoisted.loadVaultHoldings,
}));
vi.mock('@/lib/payments/server', () => ({
  loadFeePayment: hoisted.loadFeePayment,
}));
vi.mock('@/lib/wealth/qualified-position', () => ({
  summarizeQualifiedPosition: hoisted.summarizeQualifiedPosition,
}));
vi.mock('@/lib/invest/invest-position', () => ({
  summarizeInvestPosition: hoisted.summarizeInvestPosition,
}));

import OverviewPage from '@/app/(resident)/page';

const SAFE = '0x5Af1000000000000000000000000000000000c09D';

/** Native coin *and* USDC, so a native-ignoring reduction would sum 2,000. */
const ROWS: readonly VaultHoldingRow[] = [
  {
    key: `${SAFE}:1:native`,
    kind: 'native',
    chainId: 1,
    chainName: 'Ethereum',
    symbol: 'ETH',
    name: 'Ether',
    amount: '2.000000 ETH',
    usd: 7500,
    readError: null,
  },
  {
    key: `${SAFE}:1:usdc`,
    kind: 'usdc',
    chainId: 1,
    chainName: 'Ethereum',
    symbol: 'USDC',
    name: 'USDC',
    amount: '2000.000000 USDC',
    usd: 2000,
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

describe('the dashboard consumes the one qualified reduction', () => {
  it('renders the reduction output, hands it the exact read rows, and never runs the old one', async () => {
    hoisted.summarizeQualifiedPosition.mockReturnValue({
      status: 'known',
      usd: 333333,
    });

    render(await OverviewPage());

    // The sentinel from the one reduction, not the injected rows' 9,500 — and
    // certainly not the native-excluding 2,000 the old composition would give.
    expect(screen.getAllByText('$333,333').length).toBeGreaterThan(0);
    expect(screen.queryByText('$9,500')).toBeNull();
    expect(screen.queryByText('$2,000')).toBeNull();

    expect(hoisted.summarizeQualifiedPosition).toHaveBeenCalledTimes(1);
    const call = hoisted.summarizeQualifiedPosition.mock.calls[0]?.[0];
    expect(call?.safeAddress).toBe(SAFE);
    expect(call?.rows).toEqual(ROWS);

    // The second reduction has no place in the dashboard path.
    expect(hoisted.summarizeInvestPosition).not.toHaveBeenCalled();

    cleanup();
  });
});
