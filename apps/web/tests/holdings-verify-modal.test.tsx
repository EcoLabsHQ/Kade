import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { UnverifiedHoldingWallet } from '@/lib/wealth/holdings';

/**
 * The "Verify wallets" modal.
 *
 * One control opens it; inside, every unverified wallet is listed and a single
 * action **connects, persists and signs**. These tests pin the behaviour the
 * resident depends on:
 *
 *  - the modal lists the unverified wallets, with their provenance;
 *  - connecting an address that is NOT already listed still persists it (via
 *    `onAddConnectedWallet`) before signing, so "link another wallet" and
 *    "verify" are one gesture;
 *  - the address signed is always the connected one;
 *  - the server callback result decides success: a `{ ok: false }` is a failure;
 *  - the connection is torn down after the attempt, success or failure;
 *  - a failure is reported on the modal and changes nothing else.
 *
 * The server half (front 03's challenge/verification) is injected, so no test
 * needs the 03 module or a real wallet.
 */

const hoisted = vi.hoisted(() => ({
  open: vi.fn(),
  connections: [] as Array<{
    accounts: string[];
    connector: { uid: string; id: string; name: string };
  }>,
  disconnect: vi.fn(),
  disconnectAsync: vi.fn(),
  signMessageAsync: vi.fn(),
}));

vi.mock('@reown/appkit/react', () => ({
  useAppKit: () => ({ open: hoisted.open }),
}));

vi.mock('wagmi', () => ({
  useConnections: () => hoisted.connections,
  useDisconnect: () => ({
    disconnect: hoisted.disconnect,
    disconnectAsync: hoisted.disconnectAsync,
  }),
  useSignMessage: () => ({ signMessageAsync: hoisted.signMessageAsync }),
}));

import { VerifyWalletsModal } from '@/components/holdings/VerifyWalletsModal';

const CONNECTED = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const PASTED = '0x1234567890AbCdEf1234567890aBcDeF12345678';

function wallet(
  address: string,
  provider: string,
): UnverifiedHoldingWallet {
  return {
    address,
    provider,
    chainIds: [1, 8453],
    chains: [],
    usd: null,
    readError: null,
  };
}

function connector(uid: string) {
  return { uid, id: 'injected', name: 'MetaMask' };
}

function renderModal(overrides: Partial<{
  configured: boolean;
  wallets: readonly UnverifiedHoldingWallet[];
  onAddConnectedWallet: (address: string) => Promise<unknown>;
  onBegin: (address: string) => Promise<{ message: string }>;
  onComplete: (input: {
    address: string;
    message: string;
    signature: string;
  }) => Promise<{ ok: boolean }>;
  onLinked: () => void;
}> = {}) {
  const onAddConnectedWallet =
    overrides.onAddConnectedWallet ?? vi.fn(async () => ({}));
  const onBegin =
    overrides.onBegin ??
    vi.fn(async (address: string) => ({ message: `challenge:${address}` }));
  const onComplete = overrides.onComplete ?? vi.fn(async () => ({ ok: true }));
  const onLinked = overrides.onLinked ?? vi.fn();

  const utils = render(
    <VerifyWalletsModal
      configured={overrides.configured ?? true}
      wallets={
        overrides.wallets ?? [
          wallet(CONNECTED, 'connected-wallet'),
          wallet(PASTED, 'pasted-address'),
        ]
      }
      onAddConnectedWallet={onAddConnectedWallet}
      onBegin={onBegin}
      onComplete={onComplete}
      onLinked={onLinked}
    />,
  );

  return { utils, onAddConnectedWallet, onBegin, onComplete, onLinked };
}

/** Open the modal from its control. Opening now disconnects first, so it is async. */
async function openModal() {
  fireEvent.click(
    screen.getByRole('button', { name: 'Link & verify wallets' }),
  );
  await screen.findByRole('dialog');
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.connections = [];
  hoisted.disconnectAsync.mockResolvedValue(undefined);
  hoisted.signMessageAsync.mockResolvedValue('0xsignature');
});

describe('VerifyWalletsModal', () => {
  it('lists every unverified wallet with its provenance', async () => {
    renderModal();
    await openModal();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Connected wallet/)).toBeInTheDocument();
    expect(screen.getByText(/Pasted address/)).toBeInTheDocument();
  });

  it('names a failed USDC sub-read instead of a silent native-only total', async () => {
    const message =
      'Base (chain 8453): the balance provider is rate limiting this read (HTTP 429).';
    renderModal({
      wallets: [
        {
          ...wallet(CONNECTED, 'connected-wallet'),
          chains: [
            {
              chainId: 8453,
              name: 'Base',
              nativeSymbol: 'ETH',
              nativeAmount: '1.000000',
              nativeUsd: 3000,
              usdc: null,
              tokenFailure: {
                chainId: 8453,
                chainName: 'Base',
                reason: 'rejected',
                message,
              },
              usd: 3000,
            },
          ],
          usd: 3000,
        },
      ],
    });
    await openModal();

    // The native total is real and kept; the unread token is named with its
    // specific reason rather than silently omitted.
    expect(screen.getByText('$3,000')).toBeInTheDocument();
    expect(screen.getByText(/rate limiting this read/)).toBeInTheDocument();
    // No fabricated zero for the token that could not be read.
    expect(screen.queryByText('$0')).toBeNull();
  });

  it('names a whole-chain failure instead of leaving only a dash', async () => {
    const message =
      'Ethereum (chain 1): the balance provider did not respond in time. The endpoint may be overloaded.';
    renderModal({
      wallets: [
        {
          ...wallet(CONNECTED, 'connected-wallet'),
          // The whole chain failed: the reason lives on `failures` (the
          // holdings aggregate leaves `readError` null unless the read threw).
          chainIds: [1],
          chains: [],
          usd: null,
          readError: null,
          failures: [
            {
              chainId: 1,
              chainName: 'Ethereum',
              reason: 'timeout',
              message,
            },
          ],
        },
      ],
    });
    await openModal();

    // The specific reason is named rather than the resident seeing a dead dash.
    expect(screen.getByText(/did not respond in time/)).toBeInTheDocument();
    // The value stays the honest dash, never a fabricated zero.
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('$0')).toBeNull();
  });

  it('leaves a successful wallet unchanged and shows no reason', async () => {
    renderModal({
      wallets: [
        {
          ...wallet(CONNECTED, 'connected-wallet'),
          chainIds: [1],
          chains: [
            {
              chainId: 1,
              name: 'Ethereum',
              nativeSymbol: 'ETH',
              nativeAmount: '1.000000',
              nativeUsd: 2000,
              usdc: null,
              usd: 2000,
            },
          ],
          usd: 2000,
          readError: null,
        },
      ],
    });
    await openModal();

    expect(screen.getByText('$2,000')).toBeInTheDocument();
    expect(screen.queryByText(/USDC —/)).toBeNull();
    expect(screen.queryByText(/did not respond|rate limiting/)).toBeNull();
  });

  it('persists an address that is not listed yet, then signs it', async () => {
    const newAddress = '0x9E4b00000000000000000000000000000000c113';
    hoisted.connections = [
      { accounts: [newAddress], connector: connector('mm-1') },
    ];
    const onAddConnectedWallet = vi.fn(async () => ({}));
    const onBegin = vi.fn(async (address: string) => ({
      message: `challenge:${address}`,
    }));
    const onComplete = vi.fn(async () => ({ ok: true }));
    const onLinked = vi.fn();
    renderModal({ onAddConnectedWallet, onBegin, onComplete, onLinked });

    await openModal();
    fireEvent.click(screen.getByRole('button', { name: 'Link & sign a wallet' }));

    // Persist happens before the sign, and for the connected address.
    await waitFor(() =>
      expect(onAddConnectedWallet).toHaveBeenCalledWith(newAddress),
    );
    await waitFor(() => expect(onBegin).toHaveBeenCalledWith(newAddress));
    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith({
        address: newAddress,
        message: `challenge:${newAddress}`,
        signature: '0xsignature',
      }),
    );
    expect(onLinked).toHaveBeenCalledTimes(1);

    // Persist ran before sign.
    const persistOrder = onAddConnectedWallet.mock.invocationCallOrder[0]!;
    const signOrder = onBegin.mock.invocationCallOrder[0]!;
    expect(persistOrder).toBeLessThan(signOrder);
  });

  it('disconnects after a successful verification', async () => {
    hoisted.connections = [
      { accounts: [CONNECTED], connector: connector('mm-2') },
    ];
    renderModal();

    await openModal();
    fireEvent.click(screen.getByRole('button', { name: 'Link & sign a wallet' }));

    await waitFor(() =>
      expect(hoisted.disconnect).toHaveBeenCalledWith({
        connector: connector('mm-2'),
      }),
    );
  });

  it('reports a failed verification and disconnects anyway', async () => {
    hoisted.connections = [
      { accounts: [CONNECTED], connector: connector('mm-3') },
    ];
    const onLinked = vi.fn();
    renderModal({
      onComplete: vi.fn(async () => ({ ok: false })),
      onLinked,
    });

    await openModal();
    fireEvent.click(screen.getByRole('button', { name: 'Link & sign a wallet' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /did not verify/i,
    );
    expect(onLinked).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(hoisted.disconnect).toHaveBeenCalledWith({
        connector: connector('mm-3'),
      }),
    );
  });

  it('relays a persistence failure verbatim and does not sign', async () => {
    hoisted.connections = [
      { accounts: [CONNECTED], connector: connector('mm-4') },
    ];
    const onBegin = vi.fn(async () => ({ message: 'never' }));
    renderModal({
      onAddConnectedWallet: vi.fn(async () => {
        throw new Error('You can save at most 5 EVM addresses.');
      }),
      onBegin,
    });

    await openModal();
    fireEvent.click(screen.getByRole('button', { name: 'Link & sign a wallet' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You can save at most 5 EVM addresses.',
    );
    expect(onBegin).not.toHaveBeenCalled();
  });

  it('renders static markup with no wallet hook when not configured', async () => {
    renderModal({ configured: false });

    await openModal();

    expect(
      screen.getByText(/Wallet connection is not configured here/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Link & sign a wallet' }),
    ).toBeNull();
  });
});
