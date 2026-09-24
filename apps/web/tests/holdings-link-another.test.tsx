import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * The "+ Link another wallet" Holdings action.
 *
 * It is not a link to onboarding: one click opens AppKit, persists the connected
 * address as a `connected-wallet` watch-only row through the injected
 * `onAddConnectedWallet` (`addConnectedWallet`), and disconnects. The persisted
 * row appears unsigned; the resident must still "Connect & sign" before it can
 * move to the vault. The 5-address cap is the server's, so its refusal message
 * is surfaced verbatim.
 */

const hoisted = vi.hoisted(() => ({
  open: vi.fn(),
  connections: [] as Array<{
    accounts: string[];
    connector: { uid: string };
  }>,
  disconnect: vi.fn(),
}));

vi.mock('@reown/appkit/react', () => ({
  useAppKit: () => ({ open: hoisted.open }),
}));
vi.mock('wagmi', () => ({
  useConnections: () => hoisted.connections,
  useDisconnect: () => ({ disconnect: hoisted.disconnect }),
}));

import { LinkAnotherWalletButton } from '@/components/holdings/LinkAnotherWalletButton';

const ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const CAP_MESSAGE =
  'You can save at most 5 EVM addresses. Remove one before adding another.';

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.connections = [];
});

describe('LinkAnotherWalletButton', () => {
  it('renders a locked control when wallet connection is not configured', () => {
    render(
      <LinkAnotherWalletButton
        configured={false}
        onAddConnectedWallet={vi.fn()}
        onLinked={vi.fn()}
      />,
    );

    const button = screen.getByRole('button', { name: '+ Link another wallet' });
    expect(button).toBeDisabled();
    expect(button.getAttribute('title')).toMatch(
      /wallet connection is not configured/i,
    );
  });

  it('opens AppKit when nothing is connected', () => {
    const onAddConnectedWallet = vi.fn();
    render(
      <LinkAnotherWalletButton
        configured
        onAddConnectedWallet={onAddConnectedWallet}
        onLinked={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '+ Link another wallet' }));

    expect(hoisted.open).toHaveBeenCalledWith({ view: 'Connect' });
    expect(onAddConnectedWallet).not.toHaveBeenCalled();
  });

  it('persists a connected address, disconnects and refreshes', async () => {
    hoisted.connections = [{ accounts: [ADDRESS], connector: { uid: 'uid-1' } }];
    const onAddConnectedWallet = vi.fn(async () => ({}));
    const onLinked = vi.fn();
    render(
      <LinkAnotherWalletButton
        configured
        onAddConnectedWallet={onAddConnectedWallet}
        onLinked={onLinked}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '+ Link another wallet' }));

    await waitFor(() =>
      expect(onAddConnectedWallet).toHaveBeenCalledWith(ADDRESS),
    );
    await waitFor(() =>
      expect(hoisted.disconnect).toHaveBeenCalledWith({
        connector: { uid: 'uid-1' },
      }),
    );
    expect(onLinked).toHaveBeenCalledTimes(1);
  });

  it('persists a wallet connected after the click', async () => {
    const onAddConnectedWallet = vi.fn(async () => ({}));
    const onLinked = vi.fn();
    const { rerender } = render(
      <LinkAnotherWalletButton
        configured
        onAddConnectedWallet={onAddConnectedWallet}
        onLinked={onLinked}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '+ Link another wallet' }));
    expect(hoisted.open).toHaveBeenCalledWith({ view: 'Connect' });

    // The wallet connects a moment later.
    hoisted.connections = [{ accounts: [ADDRESS], connector: { uid: 'uid-2' } }];
    rerender(
      <LinkAnotherWalletButton
        configured
        onAddConnectedWallet={onAddConnectedWallet}
        onLinked={onLinked}
      />,
    );

    await waitFor(() =>
      expect(onAddConnectedWallet).toHaveBeenCalledWith(ADDRESS),
    );
    await waitFor(() => expect(onLinked).toHaveBeenCalledTimes(1));
  });

  it("surfaces the server's refusal message instead of inventing one", async () => {
    hoisted.connections = [{ accounts: [ADDRESS], connector: { uid: 'uid-1' } }];
    const onLinked = vi.fn();
    render(
      <LinkAnotherWalletButton
        configured
        onAddConnectedWallet={vi.fn(async () => {
          throw new Error(CAP_MESSAGE);
        })}
        onLinked={onLinked}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '+ Link another wallet' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(CAP_MESSAGE);
    expect(onLinked).not.toHaveBeenCalled();
  });
});
