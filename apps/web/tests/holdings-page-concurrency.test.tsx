import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

/**
 * The Holdings route issues its session-only reads in one stage.
 *
 * The shell Safe, the signature-verified wallet aggregate and the resident's
 * recorded tier depend only on the session, not on one another. They are issued
 * with `Promise.all` rather than one after another, so a navigation does not pay
 * each read's latency in sequence. This test records when each loader is in
 * flight and fails unless all three overlap.
 *
 * The review-bar read used to be part of the page's second stage; it now lives
 * in the shared `(resident)/layout.tsx`, so it is not read here.
 */

const hoisted = vi.hoisted(() => ({
  moments: [] as string[][],
  inFlight: new Set<string>(),
  loadShellSafe: vi.fn(),
  loadVerifiedHoldings: vi.fn(),
  loadResidentTier: vi.fn(),
  loadVaultHoldings: vi.fn(),
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
 * a stage that invokes every loader before awaiting any records a moment with
 * all tags; a serial stage cannot.
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
  loadApplicationResidencyRow: hoisted.loadResidentTier,
}));
vi.mock('@/lib/safe/shell', () => ({
  loadShellSafe: hoisted.loadShellSafe,
}));
vi.mock('@/lib/wealth/vault-holdings', () => ({
  loadVaultHoldings: hoisted.loadVaultHoldings,
}));
vi.mock('@/lib/env', () => ({
  readWalletConnectProjectId: () => 'project-id',
}));
vi.mock('@/components/wallet/WalletProvider', () => ({
  WalletProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/shell/ContentContainer', () => ({
  ContentContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/holdings/HoldingsView', () => ({
  HoldingsView: () => null,
}));
vi.mock('@/app/holdings/data', () => ({
  loadVerifiedHoldings: hoisted.loadVerifiedHoldings,
}));
vi.mock('@/app/holdings/link-actions', () => ({
  beginWalletLink: vi.fn(),
  completeWalletLink: vi.fn(),
}));
vi.mock('@/app/onboarding/wallet-actions', () => ({
  addConnectedWallet: vi.fn(),
}));

import HoldingsPage from '@/app/(resident)/holdings/page';

beforeEach(() => {
  hoisted.moments.length = 0;
  hoisted.inFlight.clear();
  hoisted.loadShellSafe.mockReset();
  hoisted.loadShellSafe.mockImplementation(() =>
    tracked('safe', {
      address: '0x5Af1000000000000000000000000000000000c09D',
      deployed: true,
      status: 'deployed',
      explorerUrl: null,
    }),
  );
  hoisted.loadVerifiedHoldings.mockReset();
  hoisted.loadVerifiedHoldings.mockImplementation(() =>
    tracked('wallets', { totalUsd: 0, wallets: [], readErrors: 0 }),
  );
  hoisted.loadResidentTier.mockReset();
  hoisted.loadResidentTier.mockImplementation(() => tracked('tier', null));
  hoisted.loadVaultHoldings.mockReset();
  hoisted.loadVaultHoldings.mockImplementation(() => tracked('vault', []));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('HoldingsPage — independent session reads are concurrent', () => {
  it('has the Safe, wallet aggregate and tier reads in flight at the same time', async () => {
    render((await HoldingsPage()) as ReactElement);

    // A serial staging could only ever have one tag in flight at a time.
    expect(
      hoisted.moments.some(
        (m) => m.includes('safe') && m.includes('wallets') && m.includes('tier'),
      ),
    ).toBe(true);
    // Each read is still issued exactly once.
    expect(hoisted.loadShellSafe).toHaveBeenCalledTimes(1);
    expect(hoisted.loadVerifiedHoldings).toHaveBeenCalledTimes(1);
    expect(hoisted.loadResidentTier).toHaveBeenCalledTimes(1);
  });
});
