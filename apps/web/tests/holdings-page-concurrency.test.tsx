import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

/**
 * The Holdings route issues the Safe's on-chain read and the review-bar read
 * concurrently.
 *
 * Both reads depend only on the first stage (the session and the Safe address),
 * not on each other. They used to be staged serially — `await loadVaultHoldings`
 * then `await loadReviewBar` — which added a whole read's latency to every
 * navigation. This test pins the concurrency: each loader records when it is in
 * flight, and the assertion fails if the two are never in flight together (the
 * old serial staging could only ever have one in flight at a time).
 */

const hoisted = vi.hoisted(() => ({
  moments: [] as string[][],
  inFlight: new Set<string>(),
  loadVaultHoldings: vi.fn(),
  loadReviewBar: vi.fn(),
}));

function enter(tag: string) {
  hoisted.inFlight.add(tag);
  hoisted.moments.push([...hoisted.inFlight]);
}
function leave(tag: string) {
  hoisted.inFlight.delete(tag);
}

/**
 * Resolve after a macrotask so a concurrent caller can enter while this read is
 * still in flight. The `enter` runs synchronously when the loader is invoked, so
 * a stage that invokes both loaders before awaiting either records a moment with
 * both tags; a serial stage cannot.
 */
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
  getSessionUser: vi.fn(async () => ({ userId: 'resident-1', email: 'r@example.com' })),
}));
vi.mock('@/lib/residency/server', () => ({
  loadApplicationResidencyRow: vi.fn(async () => null),
}));
vi.mock('@/lib/safe/shell', () => ({
  loadShellSafe: vi.fn(async () => ({
    address: '0x5Af1000000000000000000000000000000000c09D',
    deployed: true,
    status: 'deployed',
    explorerUrl: null,
  })),
}));
vi.mock('@/lib/wealth/vault-holdings', () => ({
  loadVaultHoldings: hoisted.loadVaultHoldings,
}));
vi.mock('@/lib/review/review-bar', () => ({
  loadReviewBar: hoisted.loadReviewBar,
}));
vi.mock('@/lib/env', () => ({
  readWalletConnectProjectId: () => 'project-id',
}));
vi.mock('@/components/wallet/WalletProvider', () => ({
  WalletProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/shell/AppShell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/shell/ContentContainer', () => ({
  ContentContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/holdings/HoldingsView', () => ({
  HoldingsView: () => null,
}));
vi.mock('@/app/holdings/data', () => ({
  loadVerifiedHoldings: vi.fn(async () => ({
    totalUsd: 0,
    wallets: [],
    readErrors: 0,
  })),
}));
vi.mock('@/app/holdings/link-actions', () => ({
  beginWalletLink: vi.fn(),
  completeWalletLink: vi.fn(),
}));
vi.mock('@/app/onboarding/wallet-actions', () => ({
  addConnectedWallet: vi.fn(),
}));

import HoldingsPage from '@/app/holdings/page';

beforeEach(() => {
  hoisted.moments.length = 0;
  hoisted.inFlight.clear();
  hoisted.loadVaultHoldings.mockReset();
  hoisted.loadVaultHoldings.mockImplementation(() => tracked('vault', []));
  hoisted.loadReviewBar.mockReset();
  hoisted.loadReviewBar.mockImplementation(() =>
    tracked('review', { show: false, reference: null, isReviewer: false }),
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('HoldingsPage — independent reads are concurrent', () => {
  it('has the vault read and the review-bar read in flight at the same time', async () => {
    render((await HoldingsPage()) as ReactElement);

    // The old staging awaited the vault read before starting the review bar, so
    // no recorded moment could ever contain both tags.
    expect(
      hoisted.moments.some((m) => m.includes('vault') && m.includes('review')),
    ).toBe(true);
    // Both reads were still issued exactly once.
    expect(hoisted.loadVaultHoldings).toHaveBeenCalledTimes(1);
    expect(hoisted.loadReviewBar).toHaveBeenCalledTimes(1);
  });
});
