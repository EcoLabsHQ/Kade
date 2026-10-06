import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { VaultHoldingRow } from '@/lib/wealth/vault-holdings';

/**
 * The Overview dashboard over the resident's **real** state (T43).
 *
 * The route reads the Safe through `loadVaultHoldings` and reduces the rows with
 * the one `summarizeQualifiedPosition` reduction (the same one the Holdings card
 * and the residency tier check call); these tests inject the rows and the other
 * record reads offline, so they prove:
 *
 *   - the qualified figure is the real reduced value, never a source literal;
 *   - a failed read is `—` with its specific reason, never a fabricated `$0`;
 *   - a genuine empty Safe is a real `$0`;
 *   - no "Demo data" chip is rendered because nothing is demo data.
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

import OverviewPage from '@/app/(resident)/page';

const SAFE = '0x5Af1000000000000000000000000000000000c09D';

/** The Safe's free USDC on Ethereum, as the reader would emit it. */
function usdcRow(usd: number): VaultHoldingRow {
  return {
    key: `${SAFE}:1:usdc`,
    kind: 'usdc',
    chainId: 1,
    chainName: 'Ethereum',
    symbol: 'USDC',
    name: 'USDC',
    amount: `${usd}.000000 USDC`,
    usd,
    readError: null,
  };
}

/** A chain whose balance read failed, carrying the real reason. */
function unreadRow(reason: string): VaultHoldingRow {
  return {
    key: `${SAFE}:1:unread`,
    kind: 'unread',
    chainId: 1,
    chainName: 'Ethereum',
    symbol: '—',
    name: 'Ethereum',
    amount: '—',
    usd: null,
    readError: reason,
  };
}

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
  hoisted.loadVaultHoldings.mockResolvedValue([]);
  hoisted.loadFeePayment.mockResolvedValue({ status: 'none' });
});

describe('Overview dashboard real state', () => {
  it('renders the real qualified figure from the injected Safe read, with no literal dollars', async () => {
    hoisted.loadVaultHoldings.mockResolvedValue([usdcRow(403216)]);

    render(await OverviewPage());

    // The figure comes from the injected read (the shared reduction sums it),
    // shown on both the stat and the holdings card from the one computation.
    expect(screen.getAllByText('$403,216').length).toBeGreaterThan(0);
    // The reference's literals are gone.
    expect(screen.queryByText('$0')).toBeNull();
    expect(screen.queryByText(/\$425,000/)).toBeNull();
    expect(screen.queryByText(/\$280,000/)).toBeNull();
    expect(screen.queryByText(/1.75 USDC/)).toBeNull();
    // Nothing on the screen is demo data any more.
    expect(screen.queryByText(/Demo data/)).toBeNull();

    cleanup();
  });

  it('shows an unknown read as — with the specific reason, never a fabricated $0', async () => {
    hoisted.loadVaultHoldings.mockResolvedValue([
      unreadRow('The vault balance on Ethereum could not be read.'),
    ]);

    render(await OverviewPage());

    expect(
      screen.getAllByText(/The vault balance on Ethereum could not be read\./).length,
    ).toBeGreaterThan(0);
    // The stat and the card show the unknown marker.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText('$0')).toBeNull();
    expect(screen.queryByText(/Demo data/)).toBeNull();

    cleanup();
  });

  it('shows the specific reason when no Safe is recorded', async () => {
    hoisted.loadShellSafe.mockResolvedValue({
      address: null,
      deployed: false,
      status: null,
      explorerUrl: null,
    });

    render(await OverviewPage());

    expect(screen.getAllByText(/No Safe is recorded/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText('$0')).toBeNull();

    cleanup();
  });

  it('renders a genuine empty Safe as a real $0', async () => {
    hoisted.loadVaultHoldings.mockResolvedValue([]);

    render(await OverviewPage());

    expect(screen.getAllByText('$0').length).toBeGreaterThan(0);
    expect(screen.getByText(/no qualified holdings yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/Demo data/)).toBeNull();

    cleanup();
  });

  it('says the identity stage has no source here instead of inventing a status', async () => {
    render(await OverviewPage());

    expect(
      screen.getAllByText(/Not read on this screen/i).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(/open Residency for the live check/i),
    ).toBeInTheDocument();

    cleanup();
  });
});
