import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { EvmAddressRecord } from '@/lib/wealth/types';

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
  addWalletAddress: vi.fn(),
  addConnectedWallet: vi.fn(),
  removeWalletAddress: vi.fn(),
  // Ownership signing: the server half is injected per test, the wallet half is
  // this recorded signer.
  signMessageAsync: vi.fn(),
}));

vi.mock('@reown/appkit/react', () => ({
  useAppKit: () => ({ open: hoisted.open }),
}));
vi.mock('wagmi', () => ({
  useConnections: () => hoisted.connections,
  useDisconnect: () => ({ disconnect: hoisted.disconnect }),
  useSignMessage: () => ({ signMessageAsync: hoisted.signMessageAsync }),
}));
vi.mock('@/app/onboarding/wallet-actions', () => ({
  readAddressBalances: hoisted.readAddressBalances,
  addWalletAddress: hoisted.addWalletAddress,
  addConnectedWallet: hoisted.addConnectedWallet,
  removeWalletAddress: hoisted.removeWalletAddress,
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
  hoisted.addConnectedWallet.mockImplementation(async (address: string) =>
    address === ADDRESS_2 ? RECORD_2 : RECORD,
  );
  hoisted.removeWalletAddress.mockResolvedValue(undefined);
  hoisted.signMessageAsync.mockResolvedValue('0xsignature');
});

afterEach(cleanup);

describe('ConnectedWalletPanel', () => {
  it('offers both connection routes', () => {
    render(<ConnectedWalletPanel configured onChange={() => {}} />);

    expect(screen.getByText('Browser extension')).toBeInTheDocument();
    expect(screen.getByText('WalletConnect')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Connect' })).toHaveLength(2);
    // The local "read from a public source" note was removed from the panel;
    // the step's own summary carries the disclaimer.
    expect(
      screen.queryByText(/read from a public source on Ethereum and Base/i),
    ).toBeNull();
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
    // The balance is reported upward; the panel no longer renders its own copy
    // of the per-wallet breakdown (the step's summary is the single list).
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

    // Both methods stay live, each with its own Disconnect control.
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Disconnect' })).toHaveLength(2),
    );
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
    // The row still shows the dropped wallet's short address until Disconnect.
    expect(screen.getByText('0x5aAeb6…1BeAed')).toBeInTheDocument();
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
    // Only the WalletConnect row remains, showing its own address.
    expect(screen.getByText('0x222222…222222')).toBeInTheDocument();
    expect(screen.queryByText('0x5aAeb6…1BeAed')).toBeNull();
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

/**
 * The panel with the step's save handler wired in, plus the shared saved list
 * the row lands in. The handler mirrors `OnboardingFlow.handleAddConnectedWallet`:
 * it calls the connected-wallet server action and keeps the records by address,
 * so a repeat never renders twice.
 */
function SavedAddressesHarness({ atCap = false }: { atCap?: boolean }) {
  const [addresses, setAddresses] = useState<readonly EvmAddressRecord[]>([]);

  async function add(address: string) {
    const record = await hoisted.addConnectedWallet(address);
    setAddresses((current) =>
      current.some((existing) => existing.address === record.address)
        ? current.map((existing) =>
            existing.address === record.address ? record : existing,
          )
        : [...current, record],
    );
  }

  async function remove(address: string) {
    await hoisted.removeWalletAddress(address);
    setAddresses((current) =>
      current.filter((record) => record.address !== address),
    );
  }

  return (
    <>
      <ConnectedWalletPanel
        configured
        onChange={() => {}}
        onSaveConnectedWallet={add}
        atCap={atCap}
      />
      {addresses.map((record) => (
        <div key={record.address}>
          <span title={record.address}>{record.address}</span>
          <button
            type="button"
            aria-label={`Remove wallet address ${record.address}`}
            onClick={() => void remove(record.address)}
          >
            Remove
          </button>
        </div>
      ))}
    </>
  );
}

describe('ConnectedWalletPanel saves connected wallets', () => {
  it('stores the address through addConnectedWallet and disconnects', async () => {
    hoisted.connections = [{ connector: META_MASK, accounts: [ADDRESS] }];
    render(<SavedAddressesHarness />);

    await waitFor(() =>
      expect(hoisted.addConnectedWallet).toHaveBeenCalledWith(ADDRESS),
    );
    // Saved through the connected-wallet action, distinct from the pasted one.
    await waitFor(() =>
      expect(hoisted.disconnect).toHaveBeenCalledWith({ connector: META_MASK }),
    );
    // Back to the Connect state: no live row is left, only the saved one.
    expect(
      screen.getAllByRole('button', { name: 'Connect' }),
    ).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
    expect(await screen.findByText(ADDRESS)).toBeInTheDocument();
  });

  it('adds a second row when a second wallet is connected', async () => {
    hoisted.connections = [{ connector: META_MASK, accounts: [ADDRESS] }];
    const view = render(<SavedAddressesHarness />);

    expect(await screen.findByText(ADDRESS)).toBeInTheDocument();

    hoisted.connections = [
      { connector: META_MASK, accounts: [ADDRESS] },
      { connector: WALLET_CONNECT, accounts: [ADDRESS_2] },
    ];
    view.rerender(<SavedAddressesHarness />);

    expect(await screen.findByText(ADDRESS_2)).toBeInTheDocument();
    expect(screen.getByText(ADDRESS)).toBeInTheDocument();
    expect(hoisted.addConnectedWallet).toHaveBeenCalledWith(ADDRESS_2);
    expect(
      screen.getAllByRole('button', { name: 'Connect' }),
    ).toHaveLength(2);
  });

  it('disables Connect when the shared cap is reached', () => {
    render(<SavedAddressesHarness atCap />);

    const buttons = screen.getAllByRole('button', { name: 'Connect' });
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button).toBeDisabled();
    }
  });

  it('surfaces the server cap message and keeps the live wallet on a rejected save', async () => {
    hoisted.addConnectedWallet.mockRejectedValue(
      new Error(
        'You can save at most 5 EVM addresses. Remove one before adding another.',
      ),
    );
    hoisted.connections = [{ connector: META_MASK, accounts: [ADDRESS] }];
    render(<SavedAddressesHarness />);

    expect(
      await screen.findByText(/you can save at most 5 evm addresses/i),
    ).toBeInTheDocument();
    // A failed save keeps the connection, so the resident can remove or retry
    // rather than being left with a half-saved row.
    expect(
      screen.getByRole('button', { name: 'Disconnect' }),
    ).toBeInTheDocument();
  });

  it('removes a saved row through removeWalletAddress', async () => {
    hoisted.connections = [{ connector: META_MASK, accounts: [ADDRESS] }];
    render(<SavedAddressesHarness />);

    await screen.findByText(ADDRESS);
    fireEvent.click(
      screen.getByRole('button', {
        name: `Remove wallet address ${ADDRESS}`,
      }),
    );

    await waitFor(() =>
      expect(hoisted.removeWalletAddress).toHaveBeenCalledWith(ADDRESS),
    );
    await waitFor(() => expect(screen.queryByText(ADDRESS)).toBeNull());
  });

  it('disables Connect while the wallet is read and saved, then re-enables it', async () => {
    // Hold the save open so the in-flight state is observable.
    let releaseSave: ((record: unknown) => void) | undefined;
    hoisted.addConnectedWallet.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseSave = resolve;
        }),
    );
    hoisted.connections = [{ connector: META_MASK, accounts: [ADDRESS] }];
    render(<SavedAddressesHarness />);

    // The live wallet is being handled automatically: Connect is disabled and
    // there is no manual Disconnect to press.
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('button', { name: 'Connect' })
          .some((button) => (button as HTMLButtonElement).disabled),
      ).toBe(true),
    );
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();

    releaseSave?.(RECORD);

    // Saved and disconnected: Connect is usable again.
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('button', { name: 'Connect' })
          .every((button) => !(button as HTMLButtonElement).disabled),
      ).toBe(true),
    );
  });
});

/**
 * The panel with the step's save handler AND the page's ownership callbacks
 * wired in, plus the shared saved list. This is the Step 3 shape:
 * connect → read → save → sign → disconnect, with a skippable signature.
 */
function SigningAddressesHarness({
  atCap = false,
  onBegin,
  onComplete,
  onLinked,
}: {
  atCap?: boolean;
  onBegin: (address: string) => Promise<{ message: string }>;
  onComplete: (input: {
    address: string;
    message: string;
    signature: string;
  }) => Promise<{ ok: boolean }>;
  onLinked?: () => void;
}) {
  const [addresses, setAddresses] = useState<readonly EvmAddressRecord[]>([]);

  async function add(address: string) {
    const record = await hoisted.addConnectedWallet(address);
    setAddresses((current) =>
      current.some((existing) => existing.address === record.address)
        ? current.map((existing) =>
            existing.address === record.address ? record : existing,
          )
        : [...current, record],
    );
  }

  return (
    <>
      <ConnectedWalletPanel
        configured
        onChange={() => {}}
        onSaveConnectedWallet={add}
        ownership={{ onBegin, onComplete, onLinked }}
        atCap={atCap}
      />
      {addresses.map((record) => (
        <div key={record.address}>
          <span title={record.address}>{record.address}</span>
        </div>
      ))}
    </>
  );
}

describe('ConnectedWalletPanel signs a connected wallet when asked', () => {
  it('saves, signs the server challenge, verifies and disconnects', async () => {
    hoisted.connections = [{ connector: META_MASK, accounts: [ADDRESS] }];
    const onBegin = vi.fn(async (address: string) => ({
      message: `challenge:${address}`,
    }));
    const onComplete = vi.fn(async () => ({ ok: true }));
    const onLinked = vi.fn();

    render(
      <SigningAddressesHarness
        onBegin={onBegin}
        onComplete={onComplete}
        onLinked={onLinked}
      />,
    );

    await waitFor(() =>
      expect(hoisted.addConnectedWallet).toHaveBeenCalledWith(ADDRESS),
    );
    await waitFor(() => expect(onBegin).toHaveBeenCalledWith(ADDRESS));
    expect(hoisted.signMessageAsync).toHaveBeenCalledWith({
      account: ADDRESS,
      message: `challenge:${ADDRESS}`,
    });
    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith({
        address: ADDRESS,
        message: `challenge:${ADDRESS}`,
        signature: '0xsignature',
      }),
    );
    expect(onLinked).toHaveBeenCalledTimes(1);

    // Persist runs before the signature, so the row always exists first.
    expect(
      hoisted.addConnectedWallet.mock.invocationCallOrder[0],
    ).toBeLessThan(onBegin.mock.invocationCallOrder[0]!);

    // Torn down and back to Connect; the saved row remains.
    await waitFor(() =>
      expect(hoisted.disconnect).toHaveBeenCalledWith({ connector: META_MASK }),
    );
    expect(await screen.findByText(ADDRESS)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Connect' })).toHaveLength(2),
    );
  });

  it('keeps the address saved and unverified when the signature is skipped', async () => {
    hoisted.connections = [{ connector: META_MASK, accounts: [ADDRESS] }];
    // The wallet prompt never settles, so the skip control stays available.
    hoisted.signMessageAsync.mockImplementation(() => new Promise(() => {}));
    const onComplete = vi.fn(async () => ({ ok: true }));

    render(
      <SigningAddressesHarness
        onBegin={async (address) => ({ message: `challenge:${address}` })}
        onComplete={onComplete}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Skip for now' }));

    // No verification, but the row was persisted and the connection is gone.
    await waitFor(() =>
      expect(hoisted.disconnect).toHaveBeenCalledWith({ connector: META_MASK }),
    );
    expect(onComplete).not.toHaveBeenCalled();
    expect(await screen.findByText(ADDRESS)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Connect' })).toHaveLength(2),
    );
  });

  it('keeps the address saved and unverified when the signature fails', async () => {
    hoisted.connections = [{ connector: META_MASK, accounts: [ADDRESS] }];
    hoisted.signMessageAsync.mockRejectedValue(new Error('User rejected'));
    const onComplete = vi.fn(async () => ({ ok: true }));

    render(
      <SigningAddressesHarness
        onBegin={async (address) => ({ message: `challenge:${address}` })}
        onComplete={onComplete}
      />,
    );

    await waitFor(() =>
      expect(hoisted.addConnectedWallet).toHaveBeenCalledWith(ADDRESS),
    );
    await waitFor(() =>
      expect(hoisted.disconnect).toHaveBeenCalledWith({ connector: META_MASK }),
    );
    expect(onComplete).not.toHaveBeenCalled();
    expect(await screen.findByText(ADDRESS)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Connect' })).toHaveLength(2),
    );
  });

  it('keeps the address saved and unverified when the server rejects the signature', async () => {
    hoisted.connections = [{ connector: META_MASK, accounts: [ADDRESS] }];
    const onLinked = vi.fn();

    render(
      <SigningAddressesHarness
        onBegin={async (address) => ({ message: `challenge:${address}` })}
        onComplete={async () => ({ ok: false })}
        onLinked={onLinked}
      />,
    );

    await waitFor(() =>
      expect(hoisted.disconnect).toHaveBeenCalledWith({ connector: META_MASK }),
    );
    expect(onLinked).not.toHaveBeenCalled();
    expect(await screen.findByText(ADDRESS)).toBeInTheDocument();
  });
});
