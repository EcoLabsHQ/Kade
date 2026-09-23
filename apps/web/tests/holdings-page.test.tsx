import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * Regression: `/holdings` must render inside the wallet context.
 *
 * The link panel uses wagmi hooks, which throw "useConfig must be used within
 * WagmiProvider" when no provider is mounted. This pins that the page wraps its
 * tree in `WalletProvider`, so the context cannot be dropped again.
 */

vi.mock('@/lib/supabase/server', () => ({
  getSessionUser: vi.fn(async () => ({ userId: 'resident-1', email: 'r@example.com' })),
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
  loadReviewBar: vi.fn(async () => ({ show: false, reference: null })),
}));
vi.mock('@/lib/env', () => ({
  readWalletConnectProjectId: () => 'project-id',
}));
vi.mock('@/components/wallet/WalletProvider', () => ({
  WalletProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="wallet-provider">{children}</div>
  ),
}));
vi.mock('@/components/shell/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/shell/ContentContainer', () => ({
  ContentContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('@/components/holdings/HoldingsScreen', () => ({
  HoldingsScreen: () => <div>holdings screen</div>,
}));
vi.mock('@/components/holdings/LinkedWalletSection', () => ({
  LinkedWalletSection: () => <div>link panel</div>,
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

import HoldingsPage from '@/app/holdings/page';

describe('HoldingsPage', () => {
  it('provides the wallet context to the link panel', async () => {
    render(await HoldingsPage());
    expect(screen.getByTestId('wallet-provider')).toBeInTheDocument();
    expect(screen.getByText('holdings screen')).toBeInTheDocument();
    cleanup();
  });
});
