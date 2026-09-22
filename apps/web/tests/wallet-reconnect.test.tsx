import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

/**
 * Wallet reconnection is opt-in, without ever tearing down a live connection.
 *
 * A returning resident must start disconnected and stay disconnected until
 * they click Connect. Two tempting switches are wrong, and this file pins both
 * so neither comes back:
 *
 *  - `createAppKit({ enableReconnect: false })` does not merely skip the
 *    reconnect; AppKit's `initialize()` calls `unSyncExistingConnection()`
 *    when it is false, which *disconnects* any existing connection
 *    (`@reown/appkit/dist/esm/src/client/appkit-base-client.js:224-230`,
 *    `:1133-1141`). A resident who had just connected was dropped mid-payment.
 *
 *  - `<WagmiProvider reconnectOnMount={false}>` clears
 *    `config.state.connections` on *every* mount
 *    (`node_modules/wagmi/dist/esm/hydrate.js`), so a provider remount during
 *    the payment flow tears down a live connection.
 *
 * The chosen mechanism is to hand wagmi no persisted connection at all: no
 * `initialState`, and `reconnectOnMount` at its default. The panel test below
 * mounts with no user action and reports disconnected, and the remount test
 * proves an explicit connect survives the provider being remounted.
 */

const hoisted = vi.hoisted(() => ({
  createAppKit: vi.fn(),
  wagmiProps: undefined as
    | { initialState?: unknown; reconnectOnMount?: boolean }
    | undefined,
  open: vi.fn(),
  readAddressBalances: vi.fn(),
  disconnect: vi.fn(),
  account: { isConnected: false, address: undefined as string | undefined },
  connector: undefined as { id?: string; name?: string } | undefined,
}));

vi.mock('@reown/appkit/react', () => ({
  createAppKit: hoisted.createAppKit,
  useAppKit: () => ({ open: hoisted.open }),
  useAppKitAccount: () => hoisted.account,
}));

vi.mock('@reown/appkit-adapter-wagmi', () => ({
  WagmiAdapter: class {
    readonly wagmiConfig = { id: 'wagmi-config' };
  },
}));

vi.mock('@reown/appkit/networks', () => ({
  sepolia: {
    id: 11155111,
    caipNetworkId: 'eip155:11155111',
    chainNamespace: 'eip155',
  },
}));

vi.mock('wagmi', () => ({
  WagmiProvider: ({
    children,
    initialState,
    reconnectOnMount,
  }: {
    children: ReactNode;
    initialState?: unknown;
    reconnectOnMount?: boolean;
  }) => {
    hoisted.wagmiProps = { initialState, reconnectOnMount };
    // Emulate wagmi's Hydrate (node_modules/wagmi/dist/esm/hydrate.js):
    // `reconnectOnMount === false` clears `config.state.connections` on every
    // mount, so a live connection is dropped when the provider remounts.
    if (reconnectOnMount === false) {
      hoisted.account.isConnected = false;
      hoisted.account.address = undefined;
    }
    return <div>{children}</div>;
  },
  useAccount: () => ({ connector: hoisted.connector }),
  useDisconnect: () => ({ disconnect: hoisted.disconnect }),
}));

vi.mock('@/app/onboarding/wallet-actions', () => ({
  readAddressBalances: hoisted.readAddressBalances,
}));

const ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';

const RECORD = {
  address: ADDRESS,
  chains: [],
  usd: null,
  readAt: '2026-09-21T00:00:00Z',
  readError: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID', 'test-project-id');
  hoisted.wagmiProps = undefined;
  hoisted.account.isConnected = false;
  hoisted.account.address = undefined;
  hoisted.connector = undefined;
  hoisted.readAddressBalances.mockResolvedValue(RECORD);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('wallet reconnection is opt-in', () => {
  it('never disables AppKit reconnect and never hands wagmi a persisted connection', async () => {
    const { WalletProvider } = await import(
      '@/components/wallet/WalletProvider'
    );

    render(
      <WalletProvider>
        <span>child</span>
      </WalletProvider>,
    );

    const options = hoisted.createAppKit.mock.calls[0]?.[0];
    expect(options).toBeDefined();
    // `enableReconnect: false` disconnects an existing connection; it must not
    // be how the no-auto-connect behaviour is enforced.
    expect(options).not.toHaveProperty('enableReconnect');
    // With no persisted state there is nothing for wagmi to hydrate.
    expect(hoisted.wagmiProps?.initialState).toBeUndefined();
    // And wagmi must not be told to clear a live connection on mount.
    expect(hoisted.wagmiProps?.reconnectOnMount).not.toBe(false);
  });

  it('reports the panel disconnected on mount with no user action', async () => {
    const { ConnectedWalletPanel } = await import(
      '@/components/wallet/ConnectedWalletPanel'
    );
    const onChange = vi.fn();

    render(<ConnectedWalletPanel configured onChange={onChange} />);

    expect(hoisted.readAddressBalances).not.toHaveBeenCalled();
    expect(hoisted.open).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: 'Disconnect' }),
    ).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('keeps an explicitly connected wallet across a provider remount', async () => {
    const { WalletProvider } = await import(
      '@/components/wallet/WalletProvider'
    );
    const { ConnectedWalletPanel } = await import(
      '@/components/wallet/ConnectedWalletPanel'
    );

    // The resident has clicked Connect and the wallet is live.
    hoisted.account.isConnected = true;
    hoisted.account.address = ADDRESS;
    hoisted.connector = { id: 'metaMask', name: 'MetaMask' };

    const onChange = vi.fn();
    const tree = () => (
      <WalletProvider>
        <ConnectedWalletPanel configured onChange={onChange} />
      </WalletProvider>
    );

    const first = render(tree());
    expect(
      screen.getByRole('button', { name: 'Disconnect' }),
    ).toBeInTheDocument();

    // Remount the whole provider, as a route change or modal can.
    first.unmount();
    render(tree());

    expect(
      screen.getByRole('button', { name: 'Disconnect' }),
    ).toBeInTheDocument();
  });
});
