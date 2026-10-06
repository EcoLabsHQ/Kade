import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * Regression: `/holdings` must render inside the wallet context.
 *
 * The per-row "Connect & sign" and "+ Link another wallet" actions use
 * AppKit/wagmi hooks, which throw "useConfig must be used within WagmiProvider"
 * when no provider is mounted. This pins that the page wraps its tree in
 * `WalletProvider`, so the context cannot be dropped again.
 *
 * `HoldingsView` now also reads wagmi state at its entry points (it disconnects
 * the wallet before opening a modal). The wagmi hooks are stubbed here so the
 * page renders without a real provider; the provider assertion below is what
 * still fails if `WalletProvider` is dropped from the page.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('wagmi', () => ({
  useConnections: () => [],
  useDisconnect: () => ({ disconnect: vi.fn(), disconnectAsync: vi.fn() }),
  useSignMessage: () => ({ signMessageAsync: vi.fn() }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getSessionUser: vi.fn(async () => ({ userId: 'resident-1', email: 'r@example.com' })),
}));
// The page reads the resident's tier through the residency surface's own read;
// none recorded keeps this test on the no-tier path (tier wiring is covered in
// `holdings-page-tier.test.tsx`).
vi.mock('@/lib/residency/server', () => ({
  loadApplicationResidencyRow: vi.fn(async () => null),
}));
vi.mock('@/lib/safe/shell', () => ({
  loadShellSafe: vi.fn(async () => ({
    address: null,
    deployed: false,
    status: null,
    explorerUrl: null,
  })),
}));
vi.mock('@/lib/review/review-bar', () => ({
  loadReviewBar: vi.fn(async () => ({ show: false, reference: null, isReviewer: false })),
}));
vi.mock('@/lib/env', () => ({
  readWalletConnectProjectId: () => 'project-id',
}));
vi.mock('@/components/wallet/WalletProvider', () => ({
  WalletProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="wallet-provider">{children}</div>
  ),
}));
vi.mock('@/components/shell/ContentContainer', () => ({
  ContentContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('@/components/holdings/HoldingsScreen', () => ({
  HoldingsScreen: () => <div>holdings screen</div>,
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
// Imported read-only by the page and passed through as a prop; mocked so the
// page test does not pull in the onboarding server module.
vi.mock('@/app/onboarding/wallet-actions', () => ({
  addConnectedWallet: vi.fn(),
}));

import HoldingsPage from '@/app/(resident)/holdings/page';

describe('HoldingsPage', () => {
  it('provides the wallet context to the holdings view', async () => {
    render(await HoldingsPage());
    expect(screen.getByTestId('wallet-provider')).toBeInTheDocument();
    expect(screen.getByText('holdings screen')).toBeInTheDocument();
    cleanup();
  });
});
