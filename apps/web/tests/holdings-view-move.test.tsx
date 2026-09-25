import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

/**
 * The Holdings client half wires the injected "Move to vault" dialog to the
 * presentational screen.
 *
 * A verified USDC row's button must be enabled (the screen has a wallet behind
 * it here), and clicking it must open the dialog for THAT row's token. The
 * native row stays locked. Only the AppKit/wagmi hooks and the router are
 * mocked; the screen and dialog are the real components.
 */

const hoisted = vi.hoisted(() => ({
  open: vi.fn(),
  disconnect: vi.fn(),
  writeContract: vi.fn(),
  reset: vi.fn(),
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
  useConnections: () => [],
  useSignMessage: () => ({ signMessageAsync: vi.fn() }),
  useDisconnect: () => ({ disconnect: hoisted.disconnect }),
  useWriteContract: () => ({
    data: undefined,
    writeContract: hoisted.writeContract,
    isPending: false,
    error: null,
    reset: hoisted.reset,
  }),
  useWaitForTransactionReceipt: () => ({ isLoading: false, isSuccess: false }),
}));

import { HoldingsView } from '@/components/holdings/HoldingsView';
import type { HoldingsAggregate } from '@/lib/wealth/holdings';

const ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const SAFE_ADDRESS = '0x2222222222222222222222222222222222222222';

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

function renderView() {
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
}

describe('HoldingsView move-to-vault wiring', () => {
  it('opens the row’s dialog from the enabled USDC button', () => {
    hoisted.account.isConnected = true;
    hoisted.account.address = ADDRESS;
    renderView();

    const moveButtons = screen.getAllByRole('button', { name: 'Move to vault' });
    // The native ETH row is locked; the USDC row is enabled.
    const usdcButton = moveButtons.find(
      (button) => !(button as HTMLButtonElement).disabled,
    );
    expect(usdcButton).toBeDefined();

    fireEvent.click(usdcButton!);

    const dialog = screen.getByRole('dialog', { name: /move to vault/i });
    expect(within(dialog).getByText('USDC · Ethereum')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Amount (USDC)')).toHaveValue(
      '780.000000',
    );
    // The dialog shows the Safe the tokens will land in.
    expect(within(dialog).getByText('0x222222…222222')).toBeInTheDocument();
  });

  it('leaves the native row locked with a true reason', () => {
    renderView();

    const native = screen
      .getAllByRole('button', { name: 'Move to vault' })
      .find((button) =>
        (button.getAttribute('title') ?? '').includes('native coin'),
      );
    expect(native).toBeDefined();
    expect(native).toBeDisabled();
  });
});
