import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

/**
 * The Safe overview on the account / passkey screen.
 *
 * Two things must hold, offline and without a network:
 *   1. with a recorded Safe — deployed or counterfactual — the overview shows the
 *      address and both links, and the Safe{Wallet} URL carries the chain's
 *      short-name prefix;
 *   2. with no recorded Safe it says so and renders no broken link.
 *
 * The exact URLs are pinned here because a wrong explorer or a wrong Safe{Wallet}
 * chain prefix is a user-visible defect, not a cosmetic one.
 */

const hoisted = vi.hoisted(() => ({
  redirect: vi.fn(),
  getSessionUser: vi.fn(),
  loadPasskeyCredential: vi.fn(),
  loadShellSafe: vi.fn(),
  loadReviewBar: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: hoisted.redirect }));
vi.mock('@/lib/supabase/server', () => ({
  getSessionUser: hoisted.getSessionUser,
}));
vi.mock('@/lib/safe/shell', () => ({
  loadShellSafe: hoisted.loadShellSafe,
}));
vi.mock('@/lib/review/review-bar', () => ({
  loadReviewBar: hoisted.loadReviewBar,
}));
vi.mock('@/app/account/passkey-actions', () => ({
  loadPasskeyCredential: hoisted.loadPasskeyCredential,
}));
vi.mock('@/lib/env', () => ({
  isAuthConfigured: () => true,
  readAuthEnv: () => ({
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: 'anon-key',
    siteUrl: 'http://localhost:3000',
    callbackPath: '/auth/callback',
  }),
}));
vi.mock('@/components/passkey/PasskeyEnrolmentPanel', () => ({
  PasskeyEnrolmentPanel: () => null,
}));
vi.mock('@/components/shell/AppShell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/shell/ContentContainer', () => ({
  ContentContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { safeAppUrl } from '@/app/account/safe-overview';
import { SafeOverviewCard } from '@/app/account/SafeOverviewCard';
import AccountPage from '@/app/account/page';

const SAFE = '0x3e8cD8C29a32912f7E6e659c6f8645e4f178A9bb';
const SEPOLIA = 'https://sepolia.etherscan.io';
const MAINNET = 'https://etherscan.io';
const BASE = 'https://basescan.org';
const BASE_SEPOLIA = 'https://sepolia.basescan.org';
const ARBITRUM = 'https://arbiscan.io';
const ARBITRUM_SEPOLIA = 'https://sepolia.arbiscan.io';

const SAFE_APP = 'https://app.safe.global';

describe('safeAppUrl', () => {
  it('prefixes the address with the chain\u2019s Safe{Wallet} short name', () => {
    // Short names come from the Safe Client Gateway chain config and the
    // registry mirrors them in @kade/shared.
    expect(safeAppUrl(SEPOLIA, SAFE)).toBe(`${SAFE_APP}/home?safe=sep:${SAFE}`);
    expect(safeAppUrl(MAINNET, SAFE)).toBe(`${SAFE_APP}/home?safe=eth:${SAFE}`);
    expect(safeAppUrl(BASE, SAFE)).toBe(`${SAFE_APP}/home?safe=base:${SAFE}`);
    expect(safeAppUrl(BASE_SEPOLIA, SAFE)).toBe(
      `${SAFE_APP}/home?safe=basesep:${SAFE}`,
    );
    expect(safeAppUrl(ARBITRUM, SAFE)).toBe(
      `${SAFE_APP}/home?safe=arb1:${SAFE}`,
    );
  });

  it('returns null instead of a broken link', () => {
    expect(safeAppUrl(null, SAFE)).toBeNull();
    expect(safeAppUrl(SEPOLIA, null)).toBeNull();
    expect(safeAppUrl('https://explorer.example.invalid', SAFE)).toBeNull();
    // Safe{Wallet} does not list Arbitrum Sepolia, so there is no prefix to use.
    expect(safeAppUrl(ARBITRUM_SEPOLIA, SAFE)).toBeNull();
  });

  it('identifies the chain from the explorer, so Sepolia is never confused with mainnet', () => {
    // The engine records the Safe on Sepolia even under a mainnet environment;
    // the recorded explorer, not the active chain, picks the prefix.
    expect(safeAppUrl(SEPOLIA, SAFE)).toContain('safe=sep:');
    expect(safeAppUrl(SEPOLIA, SAFE)).not.toContain('safe=eth:');
  });
});

describe('SafeOverviewCard', () => {
  it('shows a deployed Safe with the address and both working links', () => {
    render(
      <SafeOverviewCard
        address={SAFE}
        deployed
        status="deployed"
        explorerUrl={SEPOLIA}
      />,
    );

    expect(screen.getByText('Deployed')).toBeInTheDocument();
    // The full value is available even though the label is truncated.
    expect(
      screen.getByRole('button', { name: 'Copy Safe address' }),
    ).toBeInTheDocument();

    const explorer = screen.getByRole('link', {
      name: 'View Safe address on the block explorer',
    });
    expect(explorer).toHaveAttribute('href', `${SEPOLIA}/address/${SAFE}`);
    expect(explorer).toHaveAttribute('target', '_blank');
    expect(explorer).toHaveAttribute('rel', 'noopener noreferrer');

    const app = screen.getByRole('link', {
      name: 'Open your Safe in Safe{Wallet}',
    });
    expect(app).toHaveAttribute('href', `${SAFE_APP}/home?safe=sep:${SAFE}`);
    expect(app).toHaveAttribute('target', '_blank');
    expect(app).toHaveAttribute('rel', 'noopener noreferrer');

    cleanup();
  });

  it('keeps both links for a counterfactual Safe that is not deployed yet', () => {
    render(
      <SafeOverviewCard
        address={SAFE}
        deployed={false}
        status="predicted"
        explorerUrl={SEPOLIA}
      />,
    );

    expect(screen.getByText('Predicted · not deployed yet')).toBeInTheDocument();
    expect(screen.getByText(/It is not deployed yet/i)).toBeInTheDocument();

    // The whole point: neither link is gated on deployment.
    expect(
      screen.getByRole('link', {
        name: 'View Safe address on the block explorer',
      }),
    ).toHaveAttribute('href', `${SEPOLIA}/address/${SAFE}`);
    expect(
      screen.getByRole('link', { name: 'Open your Safe in Safe{Wallet}' }),
    ).toHaveAttribute('href', `${SAFE_APP}/home?safe=sep:${SAFE}`);

    cleanup();
  });

  it('reports a failed deployment honestly while still linking the address', () => {
    render(
      <SafeOverviewCard
        address={SAFE}
        deployed={false}
        status="failed"
        explorerUrl={SEPOLIA}
      />,
    );

    expect(screen.getByText('Deployment did not finish')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Open your Safe in Safe{Wallet}' }),
    ).toBeInTheDocument();

    cleanup();
  });

  it('says there is no Safe and renders no link when no address is recorded', () => {
    render(
      <SafeOverviewCard
        address={null}
        deployed={false}
        status={null}
        explorerUrl={SEPOLIA}
      />,
    );

    expect(screen.getByText(/No Safe account yet/i)).toBeInTheDocument();
    // No fake address, no broken explorer link, no Safe{Wallet} link.
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.queryByText(SAFE)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy Safe address' })).toBeNull();

    cleanup();
  });
});

describe('AccountPage Safe overview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.getSessionUser.mockResolvedValue({
      userId: 'user-1',
      email: 'resident@example.com',
      provider: 'email',
    });
    hoisted.loadPasskeyCredential.mockResolvedValue(null);
    hoisted.loadReviewBar.mockResolvedValue({
      show: false,
      reference: null,
      isReviewer: false,
    });
  });

  it('renders the overview with the recorded Safe address and both links', async () => {
    hoisted.loadShellSafe.mockResolvedValue({
      address: SAFE,
      deployed: false,
      status: 'predicted',
      explorerUrl: SEPOLIA,
    });

    render(await AccountPage());

    expect(screen.getByText('Your Safe')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Open your Safe in Safe{Wallet}' }),
    ).toHaveAttribute('href', `${SAFE_APP}/home?safe=sep:${SAFE}`);
    expect(
      screen.getByRole('link', {
        name: 'View Safe address on the block explorer',
      }),
    ).toHaveAttribute('href', `${SEPOLIA}/address/${SAFE}`);

    cleanup();
  });

  it('says there is no Safe and renders no link when none is recorded', async () => {
    hoisted.loadShellSafe.mockResolvedValue({
      address: null,
      deployed: false,
      status: null,
      explorerUrl: null,
    });

    render(await AccountPage());

    expect(screen.getByText(/No Safe account yet/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);

    cleanup();
  });

  it('shows the signed-in email in the account configuration', async () => {
    // The address left the sidebar; it must not have left the app with it.
    hoisted.loadShellSafe.mockResolvedValue({
      address: null,
      deployed: false,
      status: null,
      explorerUrl: null,
    });

    render(await AccountPage());

    expect(screen.getByText('resident@example.com')).toBeInTheDocument();

    cleanup();
  });
});
