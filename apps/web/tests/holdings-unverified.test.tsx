import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * The per-row Verify action for an unverified Holdings row.
 *
 * v1.3 lets a pasted EVM address (and a connected wallet) be verified from
 * Holdings by connecting the controlling wallet and signing. This component
 * holds only the browser half and calls the injected `onBegin` / `onComplete`
 * (front 03's ownership interface), so these tests prove the wiring — including
 * the case-insensitive controlling-address check — without front 03 or a real
 * wallet.
 */

const hoisted = vi.hoisted(() => ({
  connections: [] as Array<{ accounts: string[] }>,
  signMessageAsync: vi.fn(),
  useConnectionsCalls: 0,
}));

vi.mock('wagmi', () => ({
  useConnections: () => {
    hoisted.useConnectionsCalls += 1;
    return hoisted.connections;
  },
  useSignMessage: () => ({ signMessageAsync: hoisted.signMessageAsync }),
}));

import { VerifyUnverifiedWallet } from '@/components/holdings/VerifyUnverifiedWallet';
import type { UnverifiedHoldingWallet } from '@/lib/wealth/holdings';
import { shortAddress } from '@/lib/wealth/format';

const ROW = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const OTHER = '0x9999999999999999999999999999999999999999';

function wallet(provider = 'pasted-address'): UnverifiedHoldingWallet {
  return {
    address: ROW,
    provider,
    chainIds: [1],
    chains: [],
    usd: 100,
    readError: null,
  };
}

function renderVerify(overrides: {
  onBegin?: (address: string) => Promise<{ message: string }>;
  onComplete?: (input: {
    address: string;
    message: string;
    signature: string;
  }) => Promise<{ ok: boolean }>;
  onLinked?: () => void;
  provider?: string;
} = {}) {
  const onBegin = overrides.onBegin ?? vi.fn(async () => ({ message: 'm' }));
  const onComplete = overrides.onComplete ?? vi.fn(async () => ({ ok: true }));
  const onLinked = overrides.onLinked ?? vi.fn();
  render(
    <VerifyUnverifiedWallet
      wallet={wallet(overrides.provider)}
      configured
      onBegin={onBegin}
      onComplete={onComplete}
      onLinked={onLinked}
    />,
  );
  return { onBegin, onComplete, onLinked };
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.connections = [];
  hoisted.useConnectionsCalls = 0;
  hoisted.signMessageAsync.mockResolvedValue('0xsignature');
});

describe('VerifyUnverifiedWallet', () => {
  it('renders a locked Verify and reaches no wagmi hook when unconfigured', () => {
    render(
      <VerifyUnverifiedWallet
        wallet={wallet()}
        configured={false}
        onBegin={vi.fn()}
        onComplete={vi.fn()}
        onLinked={vi.fn()}
      />,
    );

    const button = screen.getByRole('button', { name: 'Verify' });
    expect(button).toBeDisabled();
    expect(button.getAttribute('title')).toMatch(
      /wallet connection is not configured/i,
    );
    expect(hoisted.useConnectionsCalls).toBe(0);
  });

  it('guides the resident to the controlling wallet when a different one is connected', () => {
    hoisted.connections = [{ accounts: [OTHER] }];
    const { onBegin } = renderVerify();

    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/connect the wallet that controls/i);
    expect(alert.textContent).toContain(shortAddress(ROW));
    // It does not ask the wrong wallet to sign.
    expect(onBegin).not.toHaveBeenCalled();
    expect(hoisted.signMessageAsync).not.toHaveBeenCalled();
  });

  it('guides connecting when no wallet is connected at all', () => {
    renderVerify();

    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      /connect the wallet that controls/i,
    );
  });

  it('signs with the controlling wallet, matched case-insensitively, and reports success', async () => {
    // The live connection reports the same address in lower case; it must still
    // count as the controller of the stored, checksummed row.
    hoisted.connections = [{ accounts: [ROW.toLowerCase()] }];
    const onBegin = vi.fn(async (address: string) => ({
      message: `challenge:${address}`,
    }));
    const onComplete = vi.fn(async () => ({ ok: true }));
    const onLinked = vi.fn();
    renderVerify({ onBegin, onComplete, onLinked });

    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(onBegin).toHaveBeenCalledTimes(1));
    expect(onBegin.mock.calls[0]![0].toLowerCase()).toBe(ROW.toLowerCase());
    await waitFor(() =>
      expect(hoisted.signMessageAsync).toHaveBeenCalledWith({
        account: ROW.toLowerCase(),
        message: `challenge:${ROW.toLowerCase()}`,
      }),
    );
    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith({
        address: ROW.toLowerCase(),
        message: `challenge:${ROW.toLowerCase()}`,
        signature: '0xsignature',
      }),
    );
    expect(onLinked).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Verified/)).toBeInTheDocument();
  });

  it('surfaces a failed verification and does not report a link', async () => {
    hoisted.connections = [{ accounts: [ROW] }];
    const onLinked = vi.fn();
    renderVerify({
      onBegin: vi.fn(async () => ({ message: 'challenge' })),
      onComplete: vi.fn(async () => {
        throw new Error('The signature did not verify.');
      }),
      onLinked,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The signature did not verify.',
    );
    expect(onLinked).not.toHaveBeenCalled();
  });
});
