import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * The proof-of-wealth wallet rows.
 *
 * Browser extension and WalletConnect are the two real connection routes: each
 * must open the AppKit modal (the extension opens the connector list, while
 * WalletConnect opens the dedicated `ConnectingWalletConnectBasic` QR view), and
 * the connected account's balance must be
 * read through the server action and reported upward. Nothing here is mocked
 * except the AppKit/wagmi hooks and the server action, which is what makes the
 * assertions about the wiring meaningful.
 *
 * The list is read from wagmi's connection map (`useConnections`), not the
 * single active `useAppKitAccount`, so two methods connected at once both stay
 * live. A wallet leaves the list only when its Disconnect button is clicked.
 */

const hoisted = vi.hoisted(() => ({
  open: vi.fn(),
  connections: [] as Array<{
    connector: { uid: string; id?: string; name?: string };
    accounts: string[];
  }>,
  disconnect: vi.fn(),
  readAddressBalances: vi.fn(),
}));

vi.mock('@reown/appkit/react', () => ({
  useAppKit: () => ({ open: hoisted.open }),
}));
vi.mock('wagmi', () => ({
  useConnections: () => hoisted.connections,
  useDisconnect: () => ({ disconnect: hoisted.disconnect }),
}));
vi.mock('@/app/onboarding/wallet-actions', () => ({
  readAddressBalances: hoisted.readAddressBalances,
}));

import { ConnectedWalletPanel } from '@/components/wallet/ConnectedWalletPanel';

const ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const ADDRESS_2 = '0x2222222222222222222222222222222222222222';

const META_MASK = { uid: 'uid-metaMask', id: 'metaMask', name: 'MetaMask' };
const WALLET_CONNECT = {
  uid: 'uid-walletconnect',
  id: 'walletConnect',
  name: 'WalletConnect',
};

const RECORD = {
  address: ADDRESS,
  chains: [
    {
      chainId: 1,
      name: 'Ethereum',
      nativeSymbol: 'ETH',
      nativeAmount: '1.000000',
      nativeUsd: 2500,
      usdc: { symbol: 'USDC', amount: '10.000000', usd: 10 },
      usd: 2510,
    },
  ],
  usd: 2510,
  readAt: '2026-09-21T00:00:00Z',
  readError: null,
};

const RECORD_2 = {
  address: ADDRESS_2,
  chains: [
    {
      chainId: 1,
      name: 'Ethereum',
      nativeSymbol: 'ETH',
      nativeAmount: '0.250000',
      nativeUsd: 780,
      usdc: null,
      usd: 780,
    },
  ],
  usd: 780,
  readAt: '2026-09-21T00:00:00Z',
  readError: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.connections = [];
  hoisted.readAddressBalances.mockImplementation(async (address: string) =>
    address === ADDRESS_2 ? RECORD_2 : RECORD,
  );
});

afterEach(cleanup);

describe('ConnectedWalletPanel', () => {
  it('offers both connection routes', () => {
    render(<ConnectedWalletPanel configured onChange={() => {}} />);

    expect(screen.getByText('Browser extension')).toBeInTheDocument();
    expect(screen.getByText('WalletConnect')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Connect' })).toHaveLength(2);
  });

  it('opens the connector list for the browser extension and the WalletConnect QR for WalletConnect', () => {
    render(<ConnectedWalletPanel configured onChange={() => {}} />);

    const [extension, walletConnect] = screen.getAllByRole('button', {
      name: 'Connect',
    });
    fireEvent.click(extension!);
    expect(hoisted.open).toHaveBeenCalledWith({ view: 'Connect' });

    fireEvent.click(walletConnect!);
    expect(hoisted.open).toHaveBeenCalledWith({
      view: 'ConnectingWalletConnectBasic',
    });
    expect(hoisted.open).not.toHaveBeenCalledWith({ view: 'AllWallets' });
  });

  it('reads the connected account balance and reports it upward', async () => {
    hoisted.connections = [{ connector: META_MASK, accounts: [ADDRESS] }];
    const onChange = vi.fn();

    render(<ConnectedWalletPanel configured onChange={onChange} />);

    await waitFor(() =>
      expect(hoisted.readAddressBalances).toHaveBeenCalledWith(ADDRESS),
    );
    expect(await screen.findByText(/Ethereum · 1\.000000 ETH · 10\.000000 USDC/)).toBeInTheDocument();
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ address: ADDRESS, usd: 2510 }),
        ]),
      ),
    );
    // The row that matches the connector is the connected one.
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
  });

  it('adds a second method instead of replacing the first', async () => {
    hoisted.connections = [
      { connector: META_MASK, accounts: [ADDRESS] },
      { connector: WALLET_CONNECT, accounts: [ADDRESS_2] },
    ];
    const onChange = vi.fn();

    render(<ConnectedWalletPanel configured onChange={onChange} />);

    expect(await screen.findByTitle(ADDRESS)).toBeInTheDocument();
    expect(await screen.findByTitle(ADDRESS_2)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Disconnect' })).toHaveLength(2);
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ address: ADDRESS, usd: 2510 }),
          expect.objectContaining({ address: ADDRESS_2, usd: 780 }),
        ]),
      ),
    );
  });

  it('counts one address once when it is connected through two methods', async () => {
    hoisted.connections = [
      { connector: META_MASK, accounts: [ADDRESS] },
      { connector: WALLET_CONNECT, accounts: [ADDRESS] },
    ];
    const onChange = vi.fn();

    render(<ConnectedWalletPanel configured onChange={onChange} />);

    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith([
        expect.objectContaining({ address: ADDRESS, usd: 2510 }),
      ]),
    );
  });

  it('keeps a wallet after the underlying connector drops, until Disconnect is clicked', async () => {
    hoisted.connections = [{ connector: META_MASK, accounts: [ADDRESS] }];
    const onChange = vi.fn();
    const view = render(<ConnectedWalletPanel configured onChange={onChange} />);

    expect(
      await screen.findByRole('button', { name: 'Disconnect' }),
    ).toBeInTheDocument();

    // The browser wallet drops on its own.
    hoisted.connections = [];
    view.rerender(<ConnectedWalletPanel configured onChange={onChange} />);

    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
    expect(screen.getByTitle(ADDRESS)).toBeInTheDocument();
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith([
        expect.objectContaining({ address: ADDRESS }),
      ]),
    );
  });

  it('disconnects only the method whose button was clicked', async () => {
    hoisted.connections = [
      { connector: META_MASK, accounts: [ADDRESS] },
      { connector: WALLET_CONNECT, accounts: [ADDRESS_2] },
    ];

    render(<ConnectedWalletPanel configured onChange={() => {}} />);

    const buttons = await screen.findAllByRole('button', { name: 'Disconnect' });
    expect(buttons).toHaveLength(2);

    // The extension row is first; the WalletConnect row is second.
    fireEvent.click(buttons[0]!);

    expect(hoisted.disconnect).toHaveBeenCalledTimes(1);
    expect(hoisted.disconnect).toHaveBeenCalledWith({ connector: META_MASK });
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Disconnect' })).toHaveLength(1),
    );
    expect(screen.getByTitle(ADDRESS_2)).toBeInTheDocument();
    expect(screen.queryByTitle(ADDRESS)).toBeNull();
  });

  it('degrades honestly when no project id is configured', () => {
    const onChange = vi.fn();
    render(<ConnectedWalletPanel configured={false} onChange={onChange} />);

    for (const button of screen.getAllByRole('button', { name: 'Connect' })) {
      expect(button).toBeDisabled();
    }
    expect(
      screen.getByText(/wallet connection is not configured/i),
    ).toBeInTheDocument();
    expect(hoisted.open).not.toHaveBeenCalled();
  });
});
