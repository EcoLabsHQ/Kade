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
 */

const hoisted = vi.hoisted(() => ({
  open: vi.fn(),
  account: { isConnected: false, address: undefined as string | undefined },
  connector: undefined as { id?: string; name?: string } | undefined,
  disconnect: vi.fn(),
  readAddressBalances: vi.fn(),
}));

vi.mock('@reown/appkit/react', () => ({
  useAppKit: () => ({ open: hoisted.open }),
  useAppKitAccount: () => hoisted.account,
}));
vi.mock('wagmi', () => ({
  useAccount: () => ({ connector: hoisted.connector }),
  useDisconnect: () => ({ disconnect: hoisted.disconnect }),
}));
vi.mock('@/app/onboarding/wallet-actions', () => ({
  readAddressBalances: hoisted.readAddressBalances,
}));

import { ConnectedWalletPanel } from '@/components/wallet/ConnectedWalletPanel';

const ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';

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

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.account.isConnected = false;
  hoisted.account.address = undefined;
  hoisted.connector = undefined;
  hoisted.readAddressBalances.mockResolvedValue(RECORD);
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
    hoisted.account.isConnected = true;
    hoisted.account.address = ADDRESS;
    hoisted.connector = { id: 'metaMask', name: 'MetaMask' };
    const onChange = vi.fn();

    render(<ConnectedWalletPanel configured onChange={onChange} />);

    await waitFor(() =>
      expect(hoisted.readAddressBalances).toHaveBeenCalledWith(ADDRESS),
    );
    expect(await screen.findByText(/Ethereum · 1\.000000 ETH · 10\.000000 USDC/)).toBeInTheDocument();
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ address: ADDRESS, usd: 2510 }),
      ),
    );
    // The row that matches the connector is the connected one.
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
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
