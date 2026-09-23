import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

/**
 * The Residency page's server-side wiring.
 *
 * The page must not render a step built on records it could not read: no
 * session goes to login, and a resident with no application goes back to
 * onboarding. When there is a snapshot, it is handed to the step with the
 * server-resolved payment configuration.
 */

const hoisted = vi.hoisted(() => ({
  redirect: vi.fn(),
  getSessionUser: vi.fn(),
  loadResidencySnapshot: vi.fn(),
  loadShellSafe: vi.fn(),
  stepProps: null as Record<string, unknown> | null,
}));

vi.mock('next/navigation', () => ({ redirect: hoisted.redirect }));
vi.mock('@/lib/supabase/server', () => ({
  getSessionUser: hoisted.getSessionUser,
}));
vi.mock('@/lib/residency/server', () => ({
  loadResidencySnapshot: hoisted.loadResidencySnapshot,
}));
vi.mock('@/lib/safe/shell', () => ({
  loadShellSafe: hoisted.loadShellSafe,
}));
vi.mock('@/lib/review/review-bar', () => ({
  loadReviewBar: vi.fn(async () => ({ show: false, reference: null, isReviewer: false })),
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
}));
vi.mock('@/components/shell/AppShell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/shell/ContentContainer', () => ({
  ContentContainer: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/shell/SiteFooter', () => ({ SiteFooter: () => null }));
vi.mock('@/components/wallet/WalletProvider', () => ({
  WalletProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/residency/ResidencyStep', () => ({
  ResidencyStep: (props: Record<string, unknown>) => {
    hoisted.stepProps = props;
    return null;
  },
}));

import ResidencyPage from '@/app/residency/page';

const SNAPSHOT = {
  applicationId: 'app-1',
  applicationRef: 'CW-2026-0409',
  tier: '3-year',
  status: 'pre_approved',
  view: {
    checks: [],
    tracker: [],
    serviceFeeUnlocked: false,
    permitIssued: false,
    permitUid: null,
  },
  preapprovalPaid: true,
  serviceFeeAmountUsdc: 10,
  preapprovalUsdc: 447,
  serviceFeeConfigured: true,
  selfConfigured: false,
  permit: { status: 'not-configured', reason: 'no gate' },
};

beforeEach(() => {
  hoisted.stepProps = null;
  hoisted.getSessionUser.mockResolvedValue({
    userId: 'user-1',
    email: 'resident@example.com',
    provider: 'email',
  });
  hoisted.loadResidencySnapshot.mockResolvedValue(SNAPSHOT);
  hoisted.loadShellSafe.mockResolvedValue({
    address: null,
    deployed: false,
    status: null,
    explorerUrl: null,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ResidencyPage', () => {
  it('redirects to login when there is no session', async () => {
    hoisted.getSessionUser.mockResolvedValue(null);
    hoisted.redirect.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT');
    });

    await expect(ResidencyPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(hoisted.loadResidencySnapshot).not.toHaveBeenCalled();
  });

  it('redirects to onboarding when there is no application', async () => {
    hoisted.loadResidencySnapshot.mockResolvedValue(null);
    hoisted.redirect.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT');
    });

    await expect(ResidencyPage()).rejects.toThrow('NEXT_REDIRECT');
  });

  it('hands the snapshot and payment configuration to the step', async () => {
    render((await ResidencyPage()) as ReactElement);

    expect(hoisted.stepProps).not.toBeNull();
    expect(hoisted.stepProps?.snapshot).toEqual(SNAPSHOT);
    expect(hoisted.stepProps?.paymentConfigured).toBe(true);
    expect(hoisted.stepProps?.treasuryAddress).toBe(
      '0x37d9Bcb63118cbD2cdE1d0E24379a876d687738A',
    );
  });
});
