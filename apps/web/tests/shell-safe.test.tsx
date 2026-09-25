import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * The shell must be honest about whether the resident's Safe exists, and the
 * link must point at the chain the Safe is actually on.
 *
 * `loadShellSafe` reads the deployment record — the same row the deployment
 * writes to — so these tests seed the record and assert what the shell derives
 * from it. The explorer is derived from the record's `deploymentChainId`, not the
 * app's active chain environment, because the engine deploys on Sepolia even
 * under a mainnet `KADE_CHAIN_ENV`.
 */

const hoisted = vi.hoisted(() => ({
  getForProfile: vi.fn(),
  deployAccount: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('@/lib/safe/manifest', () => ({
  safeDeploymentStore: () => ({ getForProfile: hoisted.getForProfile }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: hoisted.refresh }),
}));

// The retry button imports the server action lazily; mocking it keeps the
// browser bundle's server-only dependencies out of jsdom.
vi.mock('@/app/onboarding/deploy-actions', () => ({
  deployAccount: hoisted.deployAccount,
}));

import { loadShellSafe } from '@/lib/safe/shell';
import { SafeAddressCard } from '@/components/shell/SafeAddressCard';

const SAFE = '0x3e8cD8C29a32912f7E6e659c6f8645e4f178A9bb';
const SEPOLIA_EXPLORER = 'https://sepolia.etherscan.io';

function record(status: 'predicted' | 'failed' | 'deployed', chainId = 11155111) {
  return {
    profileId: 'user-1',
    safeAddress: SAFE,
    status,
    manifest: { deploymentChainId: chainId },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.getForProfile.mockResolvedValue(null);
  hoisted.deployAccount.mockResolvedValue({ status: 'deployed', safeAddress: SAFE });
});

afterEach(() => {
  delete process.env.KADE_CHAIN_ENV;
});

describe('loadShellSafe', () => {
  it('reports a deployed record as deployed, on the record\u2019s explorer', async () => {
    hoisted.getForProfile.mockResolvedValue(record('deployed'));

    const shell = await loadShellSafe('user-1');

    expect(shell).toEqual({
      address: SAFE,
      deployed: true,
      explorerUrl: SEPOLIA_EXPLORER,
      status: 'deployed',
    });
  });

  it('reports a failed record as not deployed, keeping the failure status', async () => {
    hoisted.getForProfile.mockResolvedValue(record('failed'));

    const shell = await loadShellSafe('user-1');

    expect(shell.deployed).toBe(false);
    expect(shell.status).toBe('failed');
    expect(shell.address).toBe(SAFE);
  });

  it('reports a predicted record as not deployed', async () => {
    hoisted.getForProfile.mockResolvedValue(record('predicted'));

    const shell = await loadShellSafe('user-1');

    expect(shell.deployed).toBe(false);
    expect(shell.status).toBe('predicted');
  });

  it('reports no account at all when there is no record', async () => {
    hoisted.getForProfile.mockResolvedValue(null);

    expect(await loadShellSafe('user-1')).toEqual({
      address: null,
      deployed: false,
      explorerUrl: null,
      status: null,
    });
  });

  it('uses the record\u2019s chain for the explorer, not the active chain environment', async () => {
    // The engine deploys on Sepolia. Under a mainnet environment the active
    // chain is Ethereum, whose explorer would be wrong for a Sepolia address.
    process.env.KADE_CHAIN_ENV = 'mainnet';
    hoisted.getForProfile.mockResolvedValue(record('deployed', 11155111));

    const shell = await loadShellSafe('user-1');

    expect(shell.explorerUrl).toBe(SEPOLIA_EXPLORER);
    expect(shell.explorerUrl).not.toBe('https://etherscan.io');
  });

  it('degrades to no account when the record cannot be read', async () => {
    hoisted.getForProfile.mockRejectedValue(new Error('database down'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect((await loadShellSafe('user-1')).address).toBeNull();
  });
});

describe('SafeAddressCard', () => {
  it('shows a created account without a link until it is on chain', () => {
    render(
      <SafeAddressCard
        address={SAFE}
        deployed={false}
        status="predicted"
        explorerUrl={SEPOLIA_EXPLORER}
      />,
    );

    // The account is created the moment the passkey is: a counterfactual
    // address is the resident's account, not a fault.
    expect(screen.getByText(/Safe · created/)).toBeInTheDocument();
    // It is not a contract yet, so there is nothing to open in the explorer.
    expect(screen.queryByRole('link', { name: SAFE })).toBeNull();
    // And there is no retry: nothing in this step can fail to deploy.
    expect(screen.queryByRole('button', { name: /retry setup/i })).toBeNull();
  });

  it('links the address once the account is on chain', () => {
    render(
      <SafeAddressCard
        address={SAFE}
        deployed
        status="deployed"
        explorerUrl={SEPOLIA_EXPLORER}
      />,
    );

    expect(screen.getByText(/Safe · created/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: SAFE });
    expect(link).toHaveAttribute('href', `${SEPOLIA_EXPLORER}/address/${SAFE}`);
  });

  it('explains on hover why a not-yet-deployed address is not a link', () => {
    render(<SafeAddressCard address={SAFE} deployed={false} status="predicted" />);

    // The tooltip is the resident's explanation for the missing link.
    expect(
      screen.getByText(SAFE).closest('[title]')?.getAttribute('title'),
    ).toMatch(/first operation/i);
  });

  it('shows no account yet, and no retry, when there is no address', () => {
    render(<SafeAddressCard address={null} />);

    expect(screen.getByText(/no account yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry setup/i })).toBeNull();
  });
});
