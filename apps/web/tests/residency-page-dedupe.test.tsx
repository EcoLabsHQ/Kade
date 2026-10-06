import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';

/**
 * The Residency route resolves the shell Safe **once**.
 *
 * `loadResidencySnapshot` used to resolve the Safe internally for the qualified
 * position while the page resolved it *again* for the shell chrome — two reads
 * of the same deployment record. The page now resolves it once and hands it to
 * the snapshot. This test drives the **real** snapshot (not a stub) through the
 * page, so the call count on `loadShellSafe` is the end-to-end proof of the
 * dedupe.
 *
 * The shell itself (and its review-bar read) now comes from the shared
 * `(resident)/layout.tsx`, so this page test only covers the page's own reads.
 */

const hoisted = vi.hoisted(() => ({
  redirect: vi.fn(),
  getSessionUser: vi.fn(),
  loadShellSafe: vi.fn(),
  loadVaultHoldings: vi.fn(),
  stepProps: null as Record<string, unknown> | null,
}));

vi.mock('next/navigation', () => ({ redirect: hoisted.redirect }));
vi.mock('@/lib/supabase/server', () => ({
  getSessionUser: hoisted.getSessionUser,
  createSupabaseServerClient: vi.fn(async () => ({
    from(table: string) {
      const result =
        table === 'applications'
          ? {
              data: {
                id: 'app-1',
                ref: 'CW-2026-0409',
                tier: '3-year',
                status: 'pre_approved',
                service_tx: null,
                service_uid: null,
                preapproval_usdc: 447,
              },
              error: null,
            }
          : { data: null, error: null };
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => result,
      };
      return chain;
    },
  })),
}));
vi.mock('@/lib/safe/shell', () => ({ loadShellSafe: hoisted.loadShellSafe }));
vi.mock('@/lib/wealth/vault-holdings', () => ({
  loadVaultHoldings: hoisted.loadVaultHoldings,
}));
vi.mock('@/lib/payments/server', () => ({
  loadFeePayment: vi.fn(async () => ({ status: 'none' })),
}));
vi.mock('@/lib/env', () => ({
  readChainEnv: () => 'testnet',
  readFeeMode: () => 'demo',
  readWalletConnectProjectId: () => 'wallet-project',
}));
vi.mock('@/lib/residency/service-fee-server', () => ({
  isResidencyServiceFeeConfigured: () => true,
  readResidencyServiceFeeConfig: () => ({
    treasury: '0x37d9Bcb63118cbD2cdE1d0E24379a876d687738A',
    token: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    chainId: 11155111,
    rpcUrl: 'https://sepolia.example',
  }),
  resolveResidencyServiceFeeAmount: vi.fn(async () => 10),
  loadResidencyServiceFeePayment: vi.fn(async () => ({ status: 'none' })),
}));
vi.mock('@/lib/residency/self', () => ({
  isSelfVerificationConfigured: () => false,
}));
vi.mock('@/lib/residency/permit', () => ({
  issuePermit: () => ({ status: 'not-configured', reason: 'no gate' }),
  readPermitIssuanceGate: () => null,
}));
vi.mock('@/components/shell/ContentContainer', () => ({
  ContentContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/wallet/WalletProvider', () => ({
  WalletProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/residency/ResidencyStep', () => ({
  ResidencyStep: (props: Record<string, unknown>) => {
    hoisted.stepProps = props;
    return null;
  },
}));

import ResidencyPage from '@/app/(resident)/residency/page';

const SAFE = {
  address: '0x5Af1000000000000000000000000000000000c09D',
  deployed: true,
  status: 'deployed',
  explorerUrl: null,
};

beforeEach(() => {
  hoisted.stepProps = null;
  hoisted.getSessionUser.mockResolvedValue({
    userId: 'user-1',
    email: 'resident@example.com',
    provider: 'email',
  });
  hoisted.loadShellSafe.mockReset();
  hoisted.loadShellSafe.mockResolvedValue(SAFE);
  hoisted.loadVaultHoldings.mockReset();
  hoisted.loadVaultHoldings.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ResidencyPage — one Safe read', () => {
  it('resolves the shell Safe once and hands it to the snapshot', async () => {
    render((await ResidencyPage()) as ReactElement);

    // The page resolves the Safe once; the real snapshot reuses that value
    // instead of reading the deployment record a second time. Before the
    // dedupe this count was 2.
    expect(hoisted.loadShellSafe).toHaveBeenCalledTimes(1);
    expect(hoisted.loadShellSafe).toHaveBeenCalledWith('user-1');
    // The reused Safe is the one the qualified read points at.
    expect(hoisted.loadVaultHoldings).toHaveBeenCalledWith(SAFE.address);

    // The snapshot still reaches the step, with its returned shape intact.
    expect(hoisted.stepProps?.snapshot).toMatchObject({
      applicationId: 'app-1',
      tier: '3-year',
      preapprovalUsdc: 447,
    });
  });
});
