import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { VaultHoldingRow } from '@/lib/wealth/vault-holdings';

/**
 * The Holdings page computes the qualified total **once**, from the on-chain
 * rows it already read, and hands that one value to the card. The residency
 * snapshot reduces the same Safe's rows with the same function, so the page is
 * where the single value originates.
 */

const SAFE = '0x5Af1000000000000000000000000000000000c09D';

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
];

const hoisted = vi.hoisted(() => ({
  viewProps: null as Record<string, unknown> | null,
}));

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
// The page now also reads the resident's tier through the residency surface's
// own read. That read is orthogonal to the qualified total this test pins, so
// none recorded keeps the assertion focused (see `holdings-page-tier.test.tsx`).
vi.mock('@/lib/residency/server', () => ({
  loadApplicationResidencyRow: vi.fn(async () => null),
}));
vi.mock('@/lib/safe/shell', () => ({
  loadShellSafe: vi.fn(async () => ({
    address: SAFE,
    deployed: true,
    status: 'deployed',
    explorerUrl: null,
  })),
}));
vi.mock('@/lib/review/review-bar', () => ({
  loadReviewBar: vi.fn(async () => ({ show: false, reference: null, isReviewer: false })),
}));
vi.mock('@/lib/env', () => ({
  readWalletConnectProjectId: () => null,
}));
vi.mock('@/lib/wealth/vault-holdings', () => ({
  loadVaultHoldings: vi.fn(async () => ROWS),
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
  HoldingsView: (props: Record<string, unknown>) => {
    hoisted.viewProps = props;
    return null;
  },
}));
vi.mock('@/app/holdings/data', () => ({
  loadVerifiedHoldings: vi.fn(async () => ({
    total: 0,
    walletCount: 0,
    valuedCount: 0,
    unvaluedCount: 0,
    wallets: [],
    unverifiedWallets: [],
    unverifiedCount: 0,
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

describe('HoldingsPage qualified total', () => {
  it('reduces the on-chain rows once and passes the single value to the view', async () => {
    render(await HoldingsPage());

    expect(hoisted.viewProps?.vaultHoldings).toEqual(ROWS);
    expect(hoisted.viewProps?.qualified).toEqual({ status: 'known', usd: 7500 });
  });
});
