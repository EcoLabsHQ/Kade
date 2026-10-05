import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { HoldingsScreen } from '@/components/holdings/HoldingsScreen';
import { summarizeInvestPosition } from '@/lib/invest/invest-position';
import { deriveChecks, type ResidencyFacts } from '@/lib/residency/checks';
import type { HoldingsAggregate } from '@/lib/wealth/holdings';
import {
  summarizeQualifiedPosition,
  type QualifiedPosition,
} from '@/lib/wealth/qualified-position';
import type { VaultHoldingRow } from '@/lib/wealth/vault-holdings';

/**
 * One qualified figure, three surfaces, one reduction (QF8).
 *
 * T42 reduced the Safe's on-chain rows with `summarizeQualifiedPosition` (every
 * row, including the native coin) and became the Holdings `QUALIFIED` card and
 * the residency tier check. T43 made the dashboard real but reduced the same rows
 * a second way — free USDC + MetaMorpho through `summarizeInvestPosition` — which
 * ignored native coin. The moment a Safe held any, the dashboard and the other
 * two disagreed. These tests render all three surfaces from the **same** rows and
 * assert they agree on the same value, with native coin present, which is exactly
 * the case that used to diverge.
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

import OverviewPage from '@/app/page';

const SAFE = '0x5Af1000000000000000000000000000000000c09D';

const EMPTY_AGGREGATE: HoldingsAggregate = {
  total: 0,
  walletCount: 0,
  valuedCount: 0,
  unvaluedCount: 0,
  wallets: [],
  unverifiedWallets: [],
  unverifiedCount: 0,
};

function nativeRow(usd: number): VaultHoldingRow {
  return {
    key: `${SAFE}:1:native`,
    kind: 'native',
    chainId: 1,
    chainName: 'Ethereum',
    symbol: 'ETH',
    name: 'Ether',
    amount: '2.000000 ETH',
    usd,
    readError: null,
  };
}

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

function morphoRow(usd: number): VaultHoldingRow {
  return {
    key: `${SAFE}:1:morpho`,
    kind: 'morpho',
    chainId: 1,
    chainName: 'Ethereum',
    symbol: 'MM',
    name: 'MetaMorpho USDC vault',
    amount: `${usd}.000000 USDC`,
    usd,
    readError: null,
  };
}

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

/** The rendered value of the Holdings summary card with `label`. */
function cardValue(label: string): string {
  const labelNode = screen.getByText(label);
  return labelNode.parentElement?.children[1]?.textContent ?? '';
}

/** The rendered sub line of the Holdings summary card with `label`. */
function cardSub(label: string): string {
  const labelNode = screen.getByText(label);
  return labelNode.parentElement?.children[2]?.textContent ?? '';
}

/** Residency facts carrying the given qualified position. */
function facts(qualified: QualifiedPosition): ResidencyFacts {
  return {
    tier: '3-year',
    identity: {
      provider: 'self',
      status: 'valid',
      verifiedAt: '2026-09-20T00:00:00Z',
      selfNullifier: 'n',
    },
    qualified,
    review: 'cleared',
    serviceFee: { recorded: true, verified: true, amountUsdc: 10 },
    permit: { issued: false, uid: null },
  };
}

/** The rendered "Qualified holdings" residency check's detail line. */
function fundsDetail(position: QualifiedPosition): string {
  const funds = deriveChecks(facts(position)).find((c) => c.id === 'funds');
  if (!funds) throw new Error('no funds check');
  return funds.detail;
}

function renderCard(rows: readonly VaultHoldingRow[], qualified?: QualifiedPosition) {
  render(
    <HoldingsScreen
      aggregate={EMPTY_AGGREGATE}
      safeAddress={SAFE}
      vaultHoldings={rows}
      qualified={qualified}
    />,
  );
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

describe('the dashboard, the Holdings card and the residency check agree', () => {
  it('all report the same native-inclusive figure, where the old composition diverged', async () => {
    // Native coin *and* USDC *and* a vault position: the old USDC+MetaMorpho
    // composition would report 2,000 + 1,000 = 3,000 and drop the 7,500 ETH.
    const rows: readonly VaultHoldingRow[] = [
      nativeRow(7500),
      usdcRow(2000),
      morphoRow(1000),
    ];
    hoisted.loadVaultHoldings.mockResolvedValue(rows);

    // The one reduction, over these rows: it counts the native coin.
    const qualified = summarizeQualifiedPosition({ safeAddress: SAFE, rows });
    expect(qualified).toEqual({ status: 'known', usd: 10500 });

    // The old dashboard path, for contrast: it produced 3,000 from the same
    // rows. This is the divergence the single reduction removes.
    const oldPosition = summarizeInvestPosition({
      holdings: rows,
      safeAddress: SAFE,
      vaults: [],
    });
    expect(oldPosition.freeUsdc).toEqual({ status: 'known', usd: 2000 });
    expect(oldPosition.allocated).toEqual({ status: 'known', usd: 1000 });

    // 1. The dashboard renders the one reduction's value.
    render(await OverviewPage());
    expect(screen.getAllByText('$10,500').length).toBeGreaterThan(0);
    expect(screen.queryByText('$3,000')).toBeNull();
    cleanup();

    // 2. The Holdings card consumes that exact value when passed in, rendered
    // with the shared two-decimal helper...
    renderCard(rows, qualified);
    expect(cardValue('Qualified')).toBe('$10,500.00');
    cleanup();

    // ...and reduces the same rows with the same function when it is not.
    renderCard(rows);
    expect(cardValue('Qualified')).toBe('$10,500.00');
    cleanup();

    // 3. The residency tier check reads the same value.
    expect(fundsDetail(qualified)).toBe('$10,500.00 of $280,000.');
  });

  it('keeps unknown unknown with its reason on every surface — never a fabricated $0', async () => {
    const reason = 'The vault balance on Ethereum could not be read.';
    const rows: readonly VaultHoldingRow[] = [unreadRow(reason)];
    hoisted.loadVaultHoldings.mockResolvedValue(rows);

    const qualified = summarizeQualifiedPosition({ safeAddress: SAFE, rows });
    expect(qualified.status).toBe('unknown');

    // The dashboard shows the marker and the real reason (the reduction names
    // the chain), not a zero.
    render(await OverviewPage());
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/The vault balance on Ethereum could not be read\./).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText('$0')).toBeNull();
    cleanup();

    // The card shows the same reason on the same reduction.
    renderCard(rows, qualified);
    expect(cardValue('Qualified')).toBe('—');
    expect(cardSub('Qualified')).toBe(`Ethereum: ${reason}`);
    cleanup();

    // The residency check stays pending with the reason and never claims the tier.
    const detail = fundsDetail(qualified);
    expect(detail).toContain(reason);
    expect(detail).not.toContain('$0');
    expect(detail).not.toContain('meets the tier');
  });

  it('treats a genuinely empty Safe as a real $0 on every surface', async () => {
    hoisted.loadVaultHoldings.mockResolvedValue([]);
    const qualified = summarizeQualifiedPosition({ safeAddress: SAFE, rows: [] });
    expect(qualified).toEqual({ status: 'known', usd: 0 });

    render(await OverviewPage());
    expect(screen.getAllByText('$0').length).toBeGreaterThan(0);
    expect(screen.getByText(/no qualified holdings yet/i)).toBeInTheDocument();
    cleanup();

    renderCard([], qualified);
    expect(cardValue('Qualified')).toBe('$0.00');
    cleanup();

    expect(fundsDetail(qualified)).toBe('$0.00 of $280,000.');
  });
});
