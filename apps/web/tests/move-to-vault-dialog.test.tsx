import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { getAddress, type Hex } from 'viem';

/**
 * The Move to vault dialog.
 *
 * The row's holding is fixed by the row (passed in as `target`); the resident
 * only supplies the amount. Confirming with the row's own wallet runs the move
 * on the holding's own chain:
 *
 *  - if the wallet is elsewhere it is asked to switch first;
 *  - a refused/unavailable switch is reported and nothing is sent;
 *  - an ERC-20 row sends `transfer(safe, amount)` through `useWriteContract`;
 *  - a native row sends `{ to, value }` through `useSendTransaction` and warns
 *    that moving all of it leaves no gas.
 *
 * A wrong wallet is an error and the wallet is disconnected — a transfer can
 * never be signed by the wrong account. The real wallet/chain reason is shown,
 * never a fixed generic string.
 *
 * Only the AppKit/wagmi hooks are mocked; the amount validation and the
 * builders are the real modules.
 */

const hoisted = vi.hoisted(() => ({
  open: vi.fn(),
  disconnect: vi.fn(),
  writeContract: vi.fn(),
  sendTransaction: vi.fn(),
  resetWrite: vi.fn(),
  resetSend: vi.fn(),
  switchChainAsync: vi.fn(),
  chainId: 1 as number,
  account: {
    isConnected: true,
    address: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed' as string | undefined,
  },
  write: {
    data: undefined as Hex | undefined,
    isPending: false,
    error: null as Error | null,
  },
  send: {
    data: undefined as Hex | undefined,
    isPending: false,
    error: null as Error | null,
  },
  receipt: { isLoading: false, isSuccess: false },
}));

vi.mock('@reown/appkit/react', () => ({
  useAppKit: () => ({ open: hoisted.open }),
  useAppKitAccount: () => hoisted.account,
}));
vi.mock('wagmi', () => ({
  useChainId: () => hoisted.chainId,
  useSwitchChain: () => ({ switchChainAsync: hoisted.switchChainAsync }),
  useWriteContract: () => ({
    data: hoisted.write.data,
    writeContract: hoisted.writeContract,
    isPending: hoisted.write.isPending,
    error: hoisted.write.error,
    reset: hoisted.resetWrite,
  }),
  useSendTransaction: () => ({
    data: hoisted.send.data,
    sendTransaction: hoisted.sendTransaction,
    isPending: hoisted.send.isPending,
    error: hoisted.send.error,
    reset: hoisted.resetSend,
  }),
  useWaitForTransactionReceipt: () => hoisted.receipt,
  useDisconnect: () => ({ disconnect: hoisted.disconnect }),
}));

import { MoveToVaultDialog } from '@/components/holdings/MoveToVaultDialog';
import type { MoveToVaultTarget } from '@/components/holdings/HoldingsScreen';
import { shortAddress } from '@/lib/wealth/format';

const WALLET = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const OTHER_WALLET = '0x9999999999999999999999999999999999999999';
const SAFE = '0x2222222222222222222222222222222222222222';
const USDC = getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
const SEPOLIA = 11155111;
const TX = `0x${'ab'.repeat(32)}` as Hex;

const TARGET: MoveToVaultTarget = {
  key: `${WALLET}:1:usdc`,
  kind: 'erc20',
  symbol: 'USDC',
  name: 'USDC',
  address: WALLET,
  chainId: 1,
  chainName: 'Ethereum',
  tokenAddress: USDC,
  decimals: 6,
  amount: '780.000000',
};

const NATIVE_TARGET: MoveToVaultTarget = {
  key: `${WALLET}:1:native`,
  kind: 'native',
  symbol: 'ETH',
  name: 'Ether',
  address: WALLET,
  chainId: 1,
  chainName: 'Ethereum',
  tokenAddress: null,
  decimals: 18,
  amount: '1.000000000000000000',
};

function renderDialog(overrides: Partial<Parameters<typeof MoveToVaultDialog>[0]> = {}) {
  const onClose = vi.fn();
  const onDone = vi.fn();
  render(
    <MoveToVaultDialog
      configured
      target={TARGET}
      safeAddress={SAFE}
      onClose={onClose}
      onDone={onDone}
      {...overrides}
    />,
  );
  return { onClose, onDone };
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.account.isConnected = true;
  hoisted.account.address = WALLET;
  hoisted.chainId = 1;
  hoisted.switchChainAsync.mockResolvedValue(undefined);
  hoisted.write.data = undefined;
  hoisted.write.isPending = false;
  hoisted.write.error = null;
  hoisted.send.data = undefined;
  hoisted.send.isPending = false;
  hoisted.send.error = null;
  hoisted.receipt.isLoading = false;
  hoisted.receipt.isSuccess = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('MoveToVaultDialog', () => {
  it('shows the row token, the amount, the source wallet and the Safe', () => {
    renderDialog();

    const dialog = screen.getByRole('dialog', { name: /move to vault/i });
    expect(within(dialog).getByText('USDC · Ethereum')).toBeInTheDocument();
    // The source wallet and the connected wallet are the same address here.
    expect(
      within(dialog).getAllByText(shortAddress(WALLET)).length,
    ).toBeGreaterThanOrEqual(1);
    expect(within(dialog).getByText(shortAddress(SAFE))).toBeInTheDocument();
    // The full addresses stay available on hover, never printed raw.
    expect(within(dialog).queryByText(WALLET)).toBeNull();
    expect(within(dialog).queryByText(SAFE)).toBeNull();
    expect(within(dialog).getByLabelText('Amount (USDC)')).toHaveValue(
      '780.000000',
    );
  });

  it('rejects a zero, negative or over-precise amount before sending', () => {
    renderDialog();
    const input = screen.getByLabelText('Amount (USDC)');
    const confirm = screen.getByRole('button', { name: /^Move / });

    for (const value of ['0', '-1', '1.2345678']) {
      fireEvent.change(input, { target: { value } });
      expect(
        screen.getByText(/positive amount with at most 6 decimal places/i),
      ).toBeInTheDocument();
      expect(confirm).toBeDisabled();
    }
    expect(hoisted.writeContract).not.toHaveBeenCalled();
    expect(hoisted.sendTransaction).not.toHaveBeenCalled();
  });

  it('refuses a wrong connected wallet and disconnects it', () => {
    hoisted.account.address = OTHER_WALLET;
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: /^Move / }));

    expect(
      screen.getByText(/is not the wallet this holding belongs to/i),
    ).toBeInTheDocument();
    expect(hoisted.disconnect).toHaveBeenCalledTimes(1);
    expect(hoisted.writeContract).not.toHaveBeenCalled();
    expect(hoisted.sendTransaction).not.toHaveBeenCalled();
  });

  it('builds transfer(safe, amount) from the row when the wallet matches', () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText('Amount (USDC)'), {
      target: { value: '250.5' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Move / }));

    expect(hoisted.writeContract).toHaveBeenCalledTimes(1);
    const call = hoisted.writeContract.mock.calls[0]![0] as {
      abi: unknown;
      address: string;
      functionName: string;
      args: [string, bigint];
      chainId: number;
    };
    expect(call.address).toBe(USDC);
    expect(call.functionName).toBe('transfer');
    expect(call.chainId).toBe(1);
    expect(getAddress(call.args[0])).toBe(getAddress(SAFE));
    expect(call.args[1]).toBe(250_500_000n);
    // Already on the holding's chain: no switch is asked for.
    expect(hoisted.switchChainAsync).not.toHaveBeenCalled();
  });

  it('switches to the holding’s chain when the wallet is elsewhere, then sends', async () => {
    hoisted.chainId = SEPOLIA;
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: /^Move / }));

    await waitFor(() =>
      expect(hoisted.switchChainAsync).toHaveBeenCalledWith({ chainId: 1 }),
    );
    await waitFor(() =>
      expect(hoisted.writeContract).toHaveBeenCalledTimes(1),
    );
    const call = hoisted.writeContract.mock.calls[0]![0] as { chainId: number };
    expect(call.chainId).toBe(1);
  });

  it('reports a rejected switch honestly and sends nothing', async () => {
    hoisted.chainId = SEPOLIA;
    hoisted.switchChainAsync.mockRejectedValueOnce(
      new Error('User rejected the request.'),
    );
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: /^Move / }));

    const alert = await screen.findByText(/Could not switch your wallet to Ethereum/i);
    expect(alert.textContent).toMatch(/User rejected the request\./);
    expect(alert.textContent).toMatch(/Nothing was sent\./);
    expect(hoisted.writeContract).not.toHaveBeenCalled();
    expect(hoisted.sendTransaction).not.toHaveBeenCalled();
  });

  it('shows a pending state while the wallet signs', () => {
    hoisted.write.isPending = true;
    renderDialog();

    const confirm = screen.getByRole('button', {
      name: /waiting for your wallet/i,
    });
    expect(confirm).toBeDisabled();
  });

  it('surfaces the real wallet rejection reason without claiming a move', () => {
    hoisted.write.error = new Error('insufficient funds for gas * price + value');
    renderDialog();

    expect(
      screen.getByText(/insufficient funds for gas \* price \+ value/i),
    ).toBeInTheDocument();
    // No success state and no false "moved" claim.
    expect(screen.queryByTestId('move-to-vault-complete')).toBeNull();
  });

  it('sends the native coin with { to, value } and warns about gas', () => {
    renderDialog({ target: NATIVE_TARGET });

    // The honest distinction: moving all the native coin leaves no gas.
    expect(
      screen.getByText(/native coin\. If you move all of it, nothing is left/i),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: /^Move 1\.000000000000000000 ETH$/ }),
    );

    expect(hoisted.sendTransaction).toHaveBeenCalledTimes(1);
    const call = hoisted.sendTransaction.mock.calls[0]![0] as {
      to: string;
      value: bigint;
      chainId: number;
    };
    expect(getAddress(call.to)).toBe(getAddress(SAFE));
    expect(call.value).toBe(1_000_000_000_000_000_000n);
    expect(call.chainId).toBe(1);
    // A native coin has no contract, so no ERC-20 write is issued.
    expect(hoisted.writeContract).not.toHaveBeenCalled();
  });

  it('prompts to connect the wallet when none is connected', () => {
    hoisted.account.isConnected = false;
    hoisted.account.address = undefined;
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: /connect wallet/i }));
    expect(hoisted.open).toHaveBeenCalledTimes(1);
    expect(hoisted.writeContract).not.toHaveBeenCalled();
    expect(hoisted.sendTransaction).not.toHaveBeenCalled();
  });

  it('reports the confirmed move once and offers Done', async () => {
    hoisted.write.data = TX;
    hoisted.receipt.isSuccess = true;
    const { onDone } = renderDialog();

    expect(screen.getByTestId('move-to-vault-complete')).toBeInTheDocument();
    expect(screen.getByText(/moved 780\.000000 USDC to your vault/i)).toBeInTheDocument();
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: /done/i })).toBeInTheDocument();
  });

  it('renders static markup and no controls when the wallet is unconfigured', () => {
    renderDialog({ configured: false });

    expect(
      screen.getByText(/wallet connection is not configured in this environment/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Move / })).toBeNull();
    expect(hoisted.writeContract).not.toHaveBeenCalled();
  });
});
