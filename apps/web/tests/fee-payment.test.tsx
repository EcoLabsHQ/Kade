import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Hex } from 'viem';

/**
 * The connect-and-pay control for the pre-approval fee.
 *
 * The fee is paid as a single USDC transfer to the treasury, so the wallet
 * hooks are mocked to let the transfer receipt confirm. The amount and the
 * treasury are props, so the component cannot invent either, and the server
 * action must receive the transfer hash and the connected address.
 */

const hoisted = vi.hoisted(() => ({
  open: vi.fn(),
  switchNetwork: vi.fn(),
  writeContract: vi.fn(),
  reset: vi.fn(),
  record: vi.fn(),
  account: { isConnected: false, address: undefined as string | undefined },
  network: { chainId: 11155111 as number | string | undefined },
  write: {
    data: undefined as Hex | undefined,
    isPending: false,
    error: null as Error | null,
  },
  receipt: { isLoading: false, isSuccess: false },
}));

vi.mock('@reown/appkit/react', () => ({
  useAppKit: () => ({ open: hoisted.open }),
  useAppKitAccount: () => hoisted.account,
  useAppKitNetwork: () => ({
    chainId: hoisted.network.chainId,
    switchNetwork: hoisted.switchNetwork,
  }),
}));
vi.mock('wagmi', () => ({
  useWriteContract: () => ({
    data: hoisted.write.data,
    writeContract: hoisted.writeContract,
    isPending: hoisted.write.isPending,
    error: hoisted.write.error,
    reset: hoisted.reset,
  }),
  useWaitForTransactionReceipt: () => hoisted.receipt,
}));
vi.mock('@/app/onboarding/payment-actions', () => ({
  recordPreapprovalFeePayment: hoisted.record,
}));

import { FeePayment } from '@/components/onboarding/FeePayment';

const TX = `0x${'ab'.repeat(32)}` as Hex;
const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as const;
const TREASURY = '0x37d9Bcb63118cbD2cdE1d0E24379a876d687738A' as const;
const CONNECTED = '0x1111111111111111111111111111111111111111';

interface WriteCall {
  address: string;
  functionName: string;
  args: readonly unknown[];
}

function renderPayment() {
  const onPaid = vi.fn();
  const onEnter = vi.fn();
  const element = () => (
    <FeePayment
      amountUsdc="1.75"
      treasuryAddress={TREASURY}
      usdcAddress={USDC}
      explorerUrl="https://sepolia.etherscan.io"
      onPaid={onPaid}
      onEnter={onEnter}
    />
  );
  const view = render(element());
  return {
    onPaid,
    onEnter,
    rerender: () => view.rerender(element()),
    unmount: () => view.unmount(),
  };
}

function payButton() {
  return screen.getByRole('button', { name: /pay 1\.75 usdc/i });
}

/** Click Pay, then let the transfer receipt confirm on-chain. */
function payAndConfirm(rerender: () => void, hash: Hex = TX) {
  fireEvent.click(payButton());
  hoisted.write.data = hash;
  hoisted.receipt.isSuccess = true;
  rerender();
}

function writeCall(index: number): WriteCall {
  return hoisted.writeContract.mock.calls[index]?.[0] as WriteCall;
}

beforeEach(() => {
  hoisted.account.isConnected = true;
  hoisted.account.address = CONNECTED;
  hoisted.network.chainId = 11155111;
  hoisted.write.data = undefined;
  hoisted.write.isPending = false;
  hoisted.write.error = null;
  hoisted.receipt.isLoading = false;
  hoisted.receipt.isSuccess = false;
  // The in-flight hash is persisted here, so one test must not inherit it.
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('FeePayment', () => {
  it('asks an unconnected visitor to connect a wallet', () => {
    hoisted.account.isConnected = false;
    renderPayment();

    fireEvent.click(screen.getByRole('button', { name: /connect wallet/i }));

    expect(hoisted.open).toHaveBeenCalledTimes(1);
  });

  it('asks a wallet on another network to switch to Sepolia', () => {
    hoisted.network.chainId = 1;
    renderPayment();

    fireEvent.click(
      screen.getByRole('button', { name: /switch to ethereum sepolia/i }),
    );

    expect(hoisted.switchNetwork).toHaveBeenCalledTimes(1);
  });

  it('sends the fee as USDC to the treasury the server supplied', () => {
    renderPayment();

    fireEvent.click(payButton());

    expect(hoisted.writeContract).toHaveBeenCalledTimes(1);
    const call = writeCall(0);
    expect(call.address).toBe(USDC);
    expect(call.functionName).toBe('transfer');
    expect(call.args[0]).toBe(TREASURY);
    expect(call.args[1]).toBe(1_750_000n);
  });

  it('never submits an approval', () => {
    renderPayment();

    fireEvent.click(payButton());

    expect(
      hoisted.writeContract.mock.calls.map((call) => call[0]?.functionName),
    ).not.toContain('approve');
  });

  it('opens the platform only after the server verifies the receipt', async () => {
    hoisted.record.mockResolvedValue({ status: 'paid', txHash: TX });
    const { onPaid, rerender } = renderPayment();

    payAndConfirm(rerender);

    await waitFor(() => expect(onPaid).toHaveBeenCalledWith(TX));
    expect(hoisted.record).toHaveBeenCalledWith(TX, CONNECTED);
  });

  it('offers Enter the platform, through the shared path, only once verified', async () => {
    hoisted.record.mockResolvedValue({ status: 'paid', txHash: TX });
    const { onEnter, rerender } = renderPayment();

    // An unverified payment cannot enter the platform: the control is absent
    // until the server confirms the receipt.
    expect(
      screen.queryByRole('button', { name: /enter the platform/i }),
    ).toBeNull();

    payAndConfirm(rerender);

    fireEvent.click(
      await screen.findByRole('button', { name: /enter the platform/i }),
    );
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it('offers no platform entry after an underpayment', async () => {
    hoisted.record.mockResolvedValue({
      status: 'underpaid',
      requiredUsdc: '1.75',
      receivedUsdc: '1.00',
    });
    const { rerender } = renderPayment();

    payAndConfirm(rerender);

    await screen.findByText(/1\.00 USDC but the fee is 1\.75 USDC/i);
    expect(
      screen.queryByRole('button', { name: /enter the platform/i }),
    ).toBeNull();
  });

  it('does not open the platform on an underpayment', async () => {
    hoisted.record.mockResolvedValue({
      status: 'underpaid',
      requiredUsdc: '1.75',
      receivedUsdc: '1.00',
    });
    const { onPaid, rerender } = renderPayment();

    payAndConfirm(rerender);

    expect(
      await screen.findByText(/1\.00 USDC but the fee is 1\.75 USDC/i),
    ).toBeInTheDocument();
    expect(onPaid).not.toHaveBeenCalled();
  });

  it('stays on the loader while the payment is still confirming', async () => {
    hoisted.record.mockResolvedValue({ status: 'pending' });
    const { rerender } = renderPayment();

    payAndConfirm(rerender);

    // A pending receipt is not a failure: the resident keeps seeing the
    // confirming state and is never offered a re-check or a second transfer.
    expect(
      await screen.findByRole('progressbar', { name: /confirming payment/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /check again/i }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: /try the payment again/i }),
    ).toBeNull();
  });

  it('offers a fresh transfer, not a re-check, after an underpayment', async () => {
    hoisted.record.mockResolvedValue({
      status: 'underpaid',
      requiredUsdc: '1.75',
      receivedUsdc: '1.00',
    });
    const { rerender } = renderPayment();

    payAndConfirm(rerender);

    expect(
      await screen.findByRole('button', { name: /try the payment again/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /check again/i }),
    ).toBeNull();
  });

  it('offers no recovery when the rail is not configured', async () => {
    hoisted.record.mockResolvedValue({ status: 'not-configured' });
    const { rerender } = renderPayment();

    payAndConfirm(rerender);

    expect(
      await screen.findByText(/payment is not configured/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /try the payment again/i }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: /check again/i }),
    ).toBeNull();
  });

  it('resumes a confirmed payment after the modal remounts the control', async () => {
    // The first attempt reads the receipt as pending (a transient read), so the
    // control neither resolves nor forgets the hash.
    hoisted.record.mockReset();
    let attempt = 0;
    hoisted.record.mockImplementation(async () => {
      attempt += 1;
      return attempt === 1
        ? { status: 'pending' as const }
        : { status: 'paid' as const, txHash: TX };
    });

    const first = renderPayment();
    fireEvent.click(payButton());
    hoisted.write.data = TX;
    hoisted.receipt.isSuccess = true;
    first.rerender();

    // The first read is pending, so the control stays on the loader and keeps
    // the hash rather than resolving or forgetting it.
    expect(
      await screen.findByRole('progressbar', { name: /confirming payment/i }),
    ).toBeInTheDocument();

    // The modal closes: FeePayment unmounts and wagmi forgets the in-flight
    // hash. Without a persisted hash a reopen would start from idle.
    first.unmount();
    hoisted.write.data = undefined;
    hoisted.receipt.isSuccess = false;

    // Reopening mounts a fresh control with no wagmi hash; the persisted hash
    // must still be re-verified and the confirmed payment must resolve to paid.
    const second = renderPayment();

    await waitFor(() => expect(second.onPaid).toHaveBeenCalledWith(TX));
    expect(hoisted.record).toHaveBeenLastCalledWith(TX, CONNECTED);
  });
});
