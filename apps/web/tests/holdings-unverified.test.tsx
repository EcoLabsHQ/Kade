import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * The per-row "Connect & sign" action for an unsigned Holdings row.
 *
 * v1.3 lets a pasted EVM address (and a connected wallet) be verified from
 * Holdings by signing the server-issued challenge. One click opens AppKit when
 * the controlling wallet is not connected, signs with it once it is, and tears
 * the connection down. This component holds only the browser half and calls the
 * injected `onBegin` / `onComplete` (front 03's ownership interface), so these
 * tests prove the wiring — including the case-insensitive controlling-address
 * check and the automatic disconnect — without front 03 or a real wallet.
 */

const hoisted = vi.hoisted(() => ({
  open: vi.fn(),
  connections: [] as Array<{
    accounts: string[];
    connector: { uid: string };
  }>,
  signMessageAsync: vi.fn(),
  disconnect: vi.fn(),
  useConnectionsCalls: 0,
}));

vi.mock('@reown/appkit/react', () => ({
  useAppKit: () => ({ open: hoisted.open }),
}));
vi.mock('wagmi', () => ({
  useConnections: () => {
    hoisted.useConnectionsCalls += 1;
    return hoisted.connections;
  },
  useSignMessage: () => ({ signMessageAsync: hoisted.signMessageAsync }),
  useDisconnect: () => ({ disconnect: hoisted.disconnect }),
}));

import { ConnectAndSignAction } from '@/components/holdings/ConnectAndSignAction';
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

function renderAction(
  overrides: {
    onBegin?: (address: string) => Promise<{ message: string }>;
    onComplete?: (input: {
      address: string;
      message: string;
      signature: string;
    }) => Promise<{ ok: boolean }>;
    onLinked?: () => void;
  } = {},
) {
  const onBegin = overrides.onBegin ?? vi.fn(async () => ({ message: 'm' }));
  const onComplete =
    overrides.onComplete ?? vi.fn(async () => ({ ok: true }));
  const onLinked = overrides.onLinked ?? vi.fn();
  render(
    <ConnectAndSignAction
      wallet={wallet()}
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

describe('ConnectAndSignAction', () => {
  it('renders a locked control and reaches no wagmi hook when unconfigured', () => {
    render(
      <ConnectAndSignAction
        wallet={wallet()}
        configured={false}
        onBegin={vi.fn()}
        onComplete={vi.fn()}
        onLinked={vi.fn()}
      />,
    );

    const button = screen.getByRole('button', { name: 'Connect & sign' });
    expect(button).toBeDisabled();
    expect(button.getAttribute('title')).toMatch(
      /wallet connection is not configured/i,
    );
    expect(hoisted.useConnectionsCalls).toBe(0);
  });

  it('guides to the controlling wallet and opens AppKit when a different wallet is connected', () => {
    hoisted.connections = [{ accounts: [OTHER], connector: { uid: 'other' } }];
    const { onBegin } = renderAction();

    fireEvent.click(screen.getByRole('button', { name: 'Connect & sign' }));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/connect the wallet that controls/i);
    expect(alert.textContent).toContain(shortAddress(ROW));
    expect(hoisted.open).toHaveBeenCalledWith({ view: 'Connect' });
    // The wrong wallet is never asked to sign.
    expect(onBegin).not.toHaveBeenCalled();
    expect(hoisted.signMessageAsync).not.toHaveBeenCalled();
  });

  it('opens AppKit and asks to connect when nothing is connected', () => {
    renderAction();

    fireEvent.click(screen.getByRole('button', { name: 'Connect & sign' }));

    expect(hoisted.open).toHaveBeenCalledWith({ view: 'Connect' });
    expect(screen.getByRole('alert')).toHaveTextContent(
      /connect the wallet that controls/i,
    );
  });

  it('signs with the wallet that controls the row, not the first connection', async () => {
    // A non-controlling wallet is connected first; the action must pick the
    // connection that matches the row, case-insensitively, and disconnect that
    // one — never connections[0].
    hoisted.connections = [
      { accounts: [OTHER], connector: { uid: 'uid-1' } },
      { accounts: [ROW.toLowerCase()], connector: { uid: 'uid-2' } },
    ];
    const onBegin = vi.fn(async (address: string) => ({
      message: `challenge:${address}`,
    }));
    const onComplete = vi.fn(async () => ({ ok: true }));
    const onLinked = vi.fn();
    renderAction({ onBegin, onComplete, onLinked });

    fireEvent.click(screen.getByRole('button', { name: 'Connect & sign' }));

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
    // The connection is torn down after proving, mirroring onboarding.
    await waitFor(() =>
      expect(hoisted.disconnect).toHaveBeenCalledWith({
        connector: { uid: 'uid-2' },
      }),
    );
    expect(hoisted.disconnect).not.toHaveBeenCalledWith({
      connector: { uid: 'uid-1' },
    });
    expect(await screen.findByText(/Signed/)).toBeInTheDocument();
    expect(hoisted.open).not.toHaveBeenCalled();
  });

  it('surfaces a failed signature on the row without reporting a link', async () => {
    hoisted.connections = [
      { accounts: [ROW], connector: { uid: 'uid-1' } },
    ];
    const onLinked = vi.fn();
    renderAction({
      onBegin: vi.fn(async () => ({ message: 'challenge' })),
      onComplete: vi.fn(async () => {
        throw new Error('User rejected the request.');
      }),
      onLinked,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Connect & sign' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'User rejected the request.',
    );
    expect(onLinked).not.toHaveBeenCalled();
    // A failed attempt still tears the connection down.
    expect(hoisted.disconnect).toHaveBeenCalledTimes(1);
  });

  it("keeps one row usable when another row's signature fails", async () => {
    const ROW_B = '0x1234567890AbCdEf1234567890aBcDeF12345678';
    hoisted.connections = [
      { accounts: [ROW], connector: { uid: 'uid-a' } },
      { accounts: [ROW_B], connector: { uid: 'uid-b' } },
    ];
    const onBegin = vi.fn(async (address: string) => ({
      message: `challenge:${address}`,
    }));
    const onComplete = vi.fn(async ({ address }: { address: string }) => {
      if (address.toLowerCase() === ROW.toLowerCase()) {
        throw new Error('User rejected the request.');
      }
      return { ok: true };
    });
    const onLinked = vi.fn();

    render(
      <>
        <ConnectAndSignAction
          wallet={wallet()}
          configured
          onBegin={onBegin}
          onComplete={onComplete}
          onLinked={onLinked}
        />
        <ConnectAndSignAction
          wallet={{ ...wallet(), address: ROW_B }}
          configured
          onBegin={onBegin}
          onComplete={onComplete}
          onLinked={onLinked}
        />
      </>,
    );

    // Fail the first row.
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Connect & sign' })[0]!,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'User rejected the request.',
    );
    expect(onLinked).not.toHaveBeenCalled();

    // The untouched row still signs successfully.
    const secondRow = screen.getAllByRole('button', {
      name: 'Connect & sign',
    })[1]!;
    expect(secondRow).toBeEnabled();
    fireEvent.click(secondRow);
    await waitFor(() => expect(onLinked).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Signed/)).toBeInTheDocument();
  });
});
