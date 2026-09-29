import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * Both Holdings entry points MUST disconnect the connected wallet **before**
 * they open their modal, so a carried-over session is never reused and the
 * modal always starts in its "Not connected" state (owner requirement:
 * "primero se me desconecte la wallet y luego se abra el modal", and the modal
 * "te obligue a reconectar cada vez").
 *
 * The ordering is asserted, not just co-occurrence: the disconnect is made to
 * hang on a promise this test controls, and the modal must be absent while it
 * is pending and present only once it resolves. A failed disconnect must still
 * open the modal, so a resident is never dead-ended.
 *
 * Only the AppKit/wagmi hooks and the router are mocked; the screen, the
 * dialog and the verify modal are the real components, and the disconnect
 * sequencing is the real `useDisconnectThenAct` hook.
 */

const hoisted = vi.hoisted(() => ({
  open: vi.fn(),
  connections: [] as Array<{
    accounts: string[];
    connector: { uid: string; id: string; name: string };
  }>,
  disconnect: vi.fn(),
  disconnectAsync: vi.fn(),
  writeContract: vi.fn(),
  sendTransaction: vi.fn(),
  reset: vi.fn(),
  switchChainAsync: vi.fn(),
  chainId: 1,
  account: {
    isConnected: false,
    address: undefined as string | undefined,
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@reown/appkit/react', () => ({
  useAppKit: () => ({ open: hoisted.open }),
  useAppKitAccount: () => hoisted.account,
}));
vi.mock('wagmi', () => ({
  useConnections: () => hoisted.connections,
  useSignMessage: () => ({ signMessageAsync: vi.fn() }),
  useDisconnect: () => ({
    disconnect: hoisted.disconnect,
    disconnectAsync: hoisted.disconnectAsync,
  }),
  useChainId: () => hoisted.chainId,
  useSwitchChain: () => ({ switchChainAsync: hoisted.switchChainAsync }),
  useWriteContract: () => ({
    data: undefined,
    writeContract: hoisted.writeContract,
    isPending: false,
    error: null,
    reset: hoisted.reset,
  }),
  useSendTransaction: () => ({
    data: undefined,
    sendTransaction: hoisted.sendTransaction,
    isPending: false,
    error: null,
    reset: hoisted.reset,
  }),
  useWaitForTransactionReceipt: () => ({ isLoading: false, isSuccess: false }),
}));

import { HoldingsScreen } from '@/components/holdings/HoldingsScreen';
import { HoldingsView } from '@/components/holdings/HoldingsView';
import { VerifyWalletsModal } from '@/components/holdings/VerifyWalletsModal';
import type {
  HoldingsAggregate,
  UnverifiedHoldingWallet,
} from '@/lib/wealth/holdings';

const ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const SAFE_ADDRESS = '0x2222222222222222222222222222222222222222';

/** A verified wallet with one movable USDC holding, so the row's action is live. */
const AGGREGATE: HoldingsAggregate = {
  total: 3280,
  walletCount: 1,
  valuedCount: 1,
  unvaluedCount: 0,
  wallets: [
    {
      address: ADDRESS,
      verifiedAt: '2026-09-22T10:00:00.000Z',
      chainIds: [1],
      chains: [
        {
          chainId: 1,
          name: 'Ethereum',
          nativeSymbol: 'ETH',
          nativeAmount: '1.000000',
          nativeUsd: 2500,
          usdc: { symbol: 'USDC', amount: '780.000000', usd: 780 },
          usd: 3280,
        },
      ],
      usd: 3280,
      readError: null,
    },
  ],
  unverifiedWallets: [],
  unverifiedCount: 0,
};

const UNVERIFIED: UnverifiedHoldingWallet = {
  address: ADDRESS,
  provider: 'connected-wallet',
  chainIds: [1],
  chains: [],
  usd: null,
  readError: null,
};

function connector(uid: string) {
  return { uid, id: 'injected', name: 'MetaMask' };
}

/** A promise this test settles by hand, so ordering can be observed. */
function deferred() {
  let resolve!: () => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** The live connection the row's wallet machinery would otherwise carry over. */
function connectOneWallet(uid: string) {
  hoisted.connections = [{ accounts: [ADDRESS], connector: connector(uid) }];
  hoisted.account.isConnected = true;
  hoisted.account.address = ADDRESS;
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.connections = [];
  hoisted.account.isConnected = false;
  hoisted.account.address = undefined;
  hoisted.disconnectAsync.mockResolvedValue(undefined);
});

describe('Move to vault — disconnect before the dialog opens', () => {
  it('disconnects the wallet, then opens the dialog (ordering, not a race)', async () => {
    connectOneWallet('mm-move');
    const gate = deferred();
    // The disconnect hangs until this test lets it settle.
    hoisted.disconnectAsync.mockReturnValueOnce(gate.promise);

    render(
      <HoldingsView
        aggregate={AGGREGATE}
        safeAddress={SAFE_ADDRESS}
        configured
        onBegin={vi.fn()}
        onComplete={vi.fn()}
        onAddConnectedWallet={vi.fn()}
      />,
    );

    const usdcButton = screen
      .getAllByRole('button', { name: 'Move to vault' })
      .find((button) =>
        (button.getAttribute('title') ?? '').includes('Move USDC from'),
      );
    expect(usdcButton).toBeDefined();

    fireEvent.click(usdcButton!);

    // The wallet is being torn down; the dialog has NOT opened yet.
    await waitFor(() =>
      expect(hoisted.disconnectAsync).toHaveBeenCalledWith({
        connector: connector('mm-move'),
      }),
    );
    expect(
      screen.queryByRole('dialog', { name: /move to vault/i }),
    ).toBeNull();

    // Only once the disconnect settles does the dialog open.
    gate.resolve();
    await waitFor(() =>
      expect(
        screen.getByRole('dialog', { name: /move to vault/i }),
      ).toBeInTheDocument(),
    );
  });

  it('still opens the dialog when the disconnect fails', async () => {
    connectOneWallet('mm-fail');
    hoisted.disconnectAsync.mockRejectedValueOnce(
      new Error('the connector refused to disconnect'),
    );

    render(
      <HoldingsView
        aggregate={AGGREGATE}
        safeAddress={SAFE_ADDRESS}
        configured
        onBegin={vi.fn()}
        onComplete={vi.fn()}
        onAddConnectedWallet={vi.fn()}
      />,
    );

    const usdcButton = screen
      .getAllByRole('button', { name: 'Move to vault' })
      .find((button) =>
        (button.getAttribute('title') ?? '').includes('Move USDC from'),
      );
    fireEvent.click(usdcButton!);

    // A failed disconnect must never dead-end the resident.
    await waitFor(() =>
      expect(
        screen.getByRole('dialog', { name: /move to vault/i }),
      ).toBeInTheDocument(),
    );
  });

  it('opens the dialog in its Not connected state after the disconnect', async () => {
    connectOneWallet('mm-state');
    // The real disconnect updates the shared wallet store, which is what makes
    // the dialog render its "Not connected" state. Mirror that here: the
    // teardown clears the account, as wagmi's store would.
    hoisted.disconnectAsync.mockImplementation(async () => {
      hoisted.account.isConnected = false;
      hoisted.account.address = undefined;
      hoisted.connections = [];
    });
    render(
      <HoldingsView
        aggregate={AGGREGATE}
        safeAddress={SAFE_ADDRESS}
        configured
        onBegin={vi.fn()}
        onComplete={vi.fn()}
        onAddConnectedWallet={vi.fn()}
      />,
    );

    const usdcButton = screen
      .getAllByRole('button', { name: 'Move to vault' })
      .find((button) =>
        (button.getAttribute('title') ?? '').includes('Move USDC from'),
      );
    fireEvent.click(usdcButton!);

    await waitFor(() =>
      expect(
        screen.getByRole('dialog', { name: /move to vault/i }),
      ).toBeInTheDocument(),
    );

    // The dialog's connect affordance is offered: the resident reconnects
    // inside the modal to finish the transfer, so the flow stays completable.
    expect(
      screen.getByRole('button', { name: /connect wallet/i }),
    ).toBeInTheDocument();
  });
});

describe('Link & verify wallets — disconnect before the modal opens', () => {
  function renderModal() {
    render(
      <VerifyWalletsModal
        configured
        wallets={[UNVERIFIED]}
        onAddConnectedWallet={vi.fn(async () => ({}))}
        onBegin={vi.fn(async (address: string) => ({
          message: `challenge:${address}`,
        }))}
        onComplete={vi.fn(async () => ({ ok: true }))}
        onLinked={vi.fn()}
      />,
    );
  }

  it('disconnects the wallet, then opens the modal (ordering, not a race)', async () => {
    connectOneWallet('mm-link');
    const gate = deferred();
    hoisted.disconnectAsync.mockReturnValueOnce(gate.promise);

    renderModal();
    fireEvent.click(
      screen.getByRole('button', { name: 'Link & verify wallets' }),
    );

    await waitFor(() =>
      expect(hoisted.disconnectAsync).toHaveBeenCalledWith({
        connector: connector('mm-link'),
      }),
    );
    // Not open while the disconnect is still in flight.
    expect(screen.queryByRole('dialog')).toBeNull();

    gate.resolve();
    await waitFor(() =>
      expect(screen.getByRole('dialog')).toBeInTheDocument(),
    );
  });

  it('still opens the modal when the disconnect fails', async () => {
    connectOneWallet('mm-link-fail');
    hoisted.disconnectAsync.mockRejectedValueOnce(new Error('nope'));

    renderModal();
    fireEvent.click(
      screen.getByRole('button', { name: 'Link & verify wallets' }),
    );

    await waitFor(() =>
      expect(screen.getByRole('dialog')).toBeInTheDocument(),
    );
  });

  it('offers the connect-and-sign affordance inside the opened modal', async () => {
    connectOneWallet('mm-link-affordance');
    renderModal();
    fireEvent.click(
      screen.getByRole('button', { name: 'Link & verify wallets' }),
    );

    expect(
      await screen.findByRole('button', { name: 'Link & sign a wallet' }),
    ).toBeInTheDocument();
  });
});

describe('HoldingsScreen without wallet machinery', () => {
  it('renders with no wallet and reaches no disconnect hook', () => {
    // The unconfigured path must not touch wagmi: `HoldingsView` renders the
    // bare screen when the wallet is not configured.
    render(
      <HoldingsView
        aggregate={AGGREGATE}
        safeAddress={SAFE_ADDRESS}
        configured={false}
        onBegin={vi.fn()}
        onComplete={vi.fn()}
        onAddConnectedWallet={vi.fn()}
      />,
    );

    expect(hoisted.disconnectAsync).not.toHaveBeenCalled();
    expect(screen.getByText('In linked wallets')).toBeInTheDocument();
  });

  it('keeps the unconfigured dialog path intact (no disconnect, honest markup)', async () => {
    render(
      <HoldingsView
        aggregate={AGGREGATE}
        safeAddress={SAFE_ADDRESS}
        configured={false}
        onBegin={vi.fn()}
        onComplete={vi.fn()}
        onAddConnectedWallet={vi.fn()}
      />,
    );

    // The row action is still wired in the unconfigured environment, exactly as
    // before this change; there is simply no wallet to disconnect.
    const usdcButton = screen
      .getAllByRole('button', { name: 'Move to vault' })
      .find((button) =>
        (button.getAttribute('title') ?? '').includes('Move USDC from'),
      );
    fireEvent.click(usdcButton!);

    expect(hoisted.disconnectAsync).not.toHaveBeenCalled();
    expect(
      await screen.findByText(
        /wallet connection is not configured in this environment/i,
      ),
    ).toBeInTheDocument();
  });

  it('disconnects nothing when no wallet is connected, and still opens', async () => {
    render(
      <HoldingsView
        aggregate={AGGREGATE}
        safeAddress={SAFE_ADDRESS}
        configured
        onBegin={vi.fn()}
        onComplete={vi.fn()}
        onAddConnectedWallet={vi.fn()}
      />,
    );

    const usdcButton = screen
      .getAllByRole('button', { name: 'Move to vault' })
      .find((button) =>
        (button.getAttribute('title') ?? '').includes('Move USDC from'),
      );
    fireEvent.click(usdcButton!);

    // Nothing to disconnect: the dialog opens without a disconnect call.
    expect(hoisted.disconnectAsync).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByRole('dialog', { name: /move to vault/i }),
      ).toBeInTheDocument(),
    );
  });
});

// `HoldingsScreen` is imported so the module under test is the real one, not a
// stub: the sequencing lives in the client half, and the screen stays
// wallet-free.
void HoldingsScreen;
