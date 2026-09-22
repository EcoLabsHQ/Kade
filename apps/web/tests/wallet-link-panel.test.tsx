import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * The link/verify panel.
 *
 * The panel performs the browser half of the ownership proof: request the
 * challenge, sign the exact message, submit the signature. The server half (03's
 * `issueOwnershipChallenge` / `verifyWalletOwnership`) is injected as callbacks,
 * so these tests prove the wiring without the 03 module — which is not on this
 * branch yet — and without a real wallet.
 */

const hoisted = vi.hoisted(() => ({
  open: vi.fn(),
  connections: [] as Array<{ accounts: string[]; connector: { uid: string } }>,
  signMessageAsync: vi.fn(),
}));

vi.mock('@reown/appkit/react', () => ({
  useAppKit: () => ({ open: hoisted.open }),
}));
vi.mock('wagmi', () => ({
  useConnections: () => hoisted.connections,
  useSignMessage: () => ({ signMessageAsync: hoisted.signMessageAsync }),
}));

import { WalletLinkPanel } from '@/components/holdings/WalletLinkPanel';

const ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const MESSAGE =
  'kade.example wants you to sign in with your Ethereum account:\n' + ADDRESS;

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.connections = [];
  hoisted.signMessageAsync.mockResolvedValue('0xsignature');
});

describe('WalletLinkPanel', () => {
  it('degrades honestly when wallet connection is not configured', () => {
    render(
      <WalletLinkPanel
        configured={false}
        onBegin={vi.fn()}
        onComplete={vi.fn()}
        onLinked={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Link a wallet' })).toBeDisabled();
    expect(
      screen.getByText(/wallet connection is not configured/i),
    ).toBeInTheDocument();
    expect(hoisted.open).not.toHaveBeenCalled();
  });

  it('opens the connector view when no wallet is connected', () => {
    render(
      <WalletLinkPanel
        configured
        onBegin={vi.fn()}
        onComplete={vi.fn()}
        onLinked={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Connect wallet' }));
    expect(hoisted.open).toHaveBeenCalledWith({ view: 'Connect' });
  });

  it('requests a challenge, signs it, and submits the signature', async () => {
    hoisted.connections = [{ accounts: [ADDRESS], connector: { uid: 'uid-1' } }];
    hoisted.signMessageAsync.mockResolvedValue('0xsigned');
    const onBegin = vi.fn(async () => ({ message: MESSAGE }));
    const onComplete = vi.fn(async () => ({
      verifiedAt: '2026-09-22T10:00:00.000Z',
    }));
    const onLinked = vi.fn();

    render(
      <WalletLinkPanel
        configured
        onBegin={onBegin}
        onComplete={onComplete}
        onLinked={onLinked}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sign to link' }));

    await waitFor(() => expect(onBegin).toHaveBeenCalledWith(ADDRESS));
    await waitFor(() =>
      expect(hoisted.signMessageAsync).toHaveBeenCalledWith({
        account: ADDRESS,
        message: MESSAGE,
      }),
    );
    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith({
        address: ADDRESS,
        message: MESSAGE,
        signature: '0xsigned',
      }),
    );
    expect(onLinked).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText(/Linked · verified signature/),
    ).toBeInTheDocument();
  });

  it('shows an error and does not report a link when verification fails', async () => {
    hoisted.connections = [{ accounts: [ADDRESS], connector: { uid: 'uid-1' } }];
    const onBegin = vi.fn(async () => ({ message: MESSAGE }));
    const onComplete = vi.fn(async () => {
      throw new Error('The signature did not verify.');
    });
    const onLinked = vi.fn();

    render(
      <WalletLinkPanel
        configured
        onBegin={onBegin}
        onComplete={onComplete}
        onLinked={onLinked}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sign to link' }));

    expect(
      await screen.findByText('The signature did not verify.'),
    ).toBeInTheDocument();
    expect(onLinked).not.toHaveBeenCalled();
    expect(screen.queryByText(/Linked · verified signature/)).toBeNull();
  });
});
