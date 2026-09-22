import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Hex } from 'viem';

/**
 * The connect-and-pay control for the pre-approval fee.
 *
 * The fee is paid in two explicit steps — approve the treasury, then transfer
 * the fee — so the wallet hooks are mocked to let each step's receipt confirm
 * in turn. The amount and the treasury are props, so the component cannot
 * invent either, and the server action must receive the *transfer* hash.
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
const APPROVE_TX = `0x${'cd'.repeat(32)}` as Hex;
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
  const element = () => (
    <FeePayment
      amountUsdc="1.75"
      treasuryAddress={TREASURY}
      usdcAddress={USDC}
      explorerUrl="https://sepolia.etherscan.io"
      onPaid={onPaid}
    />
  );
  const view = render(element());
  return {
    onPaid,
    rerender: () => view.rerender(element()),
  };
}

function approveButton() {
  return screen.getByRole('button', { name: /approve 1\.75 usdc/i });
}

function sendButton() {
  return screen.getByRole('button', { name: /send 1\.75 usdc/i });
}

/** Let the approval receipt confirm; the wallet write already happened. */
function confirmApprove(rerender: () => void) {
  hoisted.write.data = APPROVE_TX;
  hoisted.receipt.isSuccess = true;
  rerender();
}

/** Click Approve, then let the approval receipt confirm. */
function approveAndConfirm(rerender: () => void) {
  fireEvent.click(approveButton());
  confirmApprove(rerender);
}

/** Click Send, then let the transfer receipt confirm on-chain. */
function sendAndConfirm(rerender: () => void, hash: Hex = TX) {
  fireEvent.click(sendButton());
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

  it('approves the treasury before sending the fee', () => {
    const { rerender } = renderPayment();

    fireEvent.click(approveButton());

    // The first write is the approval, not the transfer.
    expect(hoisted.writeContract).toHaveBeenCalledTimes(1);
    const approveCall = writeCall(0);
    expect(approveCall.address).toBe(USDC);
    expect(approveCall.functionName).toBe('approve');
    expect(approveCall.args[0]).toBe(TREASURY);
    expect(approveCall.args[1]).toBe(1_750_000n);

    confirmApprove(rerender);
    fireEvent.click(sendButton());

    expect(hoisted.writeContract).toHaveBeenCalledTimes(2);
    const transferCall = writeCall(1);
    expect(transferCall.address).toBe(USDC);
    expect(transferCall.functionName).toBe('transfer');
    expect(transferCall.args[0]).toBe(TREASURY);
    expect(transferCall.args[1]).toBe(1_750_000n);
  });

  it('sends the fee as USDC to the treasury the server supplied', () => {
    const { rerender } = renderPayment();

    approveAndConfirm(rerender);
    fireEvent.click(sendButton());

    const transferCall = writeCall(1);
    expect(transferCall.address).toBe(USDC);
    expect(transferCall.functionName).toBe('transfer');
    expect(transferCall.args[0]).toBe(TREASURY);
    expect(transferCall.args[1]).toBe(1_750_000n);
  });

  it('does not submit the transfer until the approval confirms', () => {
    const { rerender } = renderPayment();

    fireEvent.click(approveButton());

    // The approval is in flight: Send must stay disabled, and only the
    // approval write may have been submitted.
    expect(sendButton()).toBeDisabled();
    expect(hoisted.writeContract).toHaveBeenCalledTimes(1);
    expect(writeCall(0).functionName).toBe('approve');
    expect(
      hoisted.writeContract.mock.calls.map((call) => call[0]?.functionName),
    ).not.toContain('transfer');

    approveAndConfirm(rerender);

    // Only now is the transfer reachable.
    expect(sendButton()).toBeEnabled();
  });

  it('opens the platform only after the server verifies the receipt', async () => {
    hoisted.record.mockResolvedValue({ status: 'paid', txHash: TX });
    const { onPaid, rerender } = renderPayment();

    approveAndConfirm(rerender);
    sendAndConfirm(rerender);

    await waitFor(() => expect(onPaid).toHaveBeenCalledWith(TX));
    expect(hoisted.record).toHaveBeenCalledWith(TX, CONNECTED);
  });

  it('records the transfer hash and the connected address, never the approval', async () => {
    hoisted.record.mockResolvedValue({ status: 'paid', txHash: TX });
    const { rerender } = renderPayment();

    approveAndConfirm(rerender);
    sendAndConfirm(rerender);

    await waitFor(() => expect(hoisted.record).toHaveBeenCalledWith(TX, CONNECTED));
    expect(hoisted.record).not.toHaveBeenCalledWith(APPROVE_TX, CONNECTED);
  });

  it('does not send after a rejected approval', () => {
    const { rerender } = renderPayment();

    fireEvent.click(approveButton());
    hoisted.write.error = new Error('user rejected the request');
    rerender();

    expect(
      screen.getByText(/the wallet rejected or could not send the payment/i),
    ).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
    expect(hoisted.writeContract).toHaveBeenCalledTimes(1);
    expect(writeCall(0).functionName).toBe('approve');
    expect(
      hoisted.writeContract.mock.calls.map((call) => call[0]?.functionName),
    ).not.toContain('transfer');
  });

  it('does not open the platform on an underpayment', async () => {
    hoisted.record.mockResolvedValue({
      status: 'underpaid',
      requiredUsdc: '1.75',
      receivedUsdc: '1.00',
    });
    const { onPaid, rerender } = renderPayment();

    approveAndConfirm(rerender);
    sendAndConfirm(rerender);

    expect(
      await screen.findByText(/1\.00 USDC but the fee is 1\.75 USDC/i),
    ).toBeInTheDocument();
    expect(onPaid).not.toHaveBeenCalled();
  });

  it('offers a re-check, not a second transfer, while the payment is pending', async () => {
    hoisted.record.mockResolvedValue({ status: 'pending' });
    const { rerender } = renderPayment();

    approveAndConfirm(rerender);
    sendAndConfirm(rerender);

    expect(
      await screen.findByRole('button', { name: /check again/i }),
    ).toBeInTheDocument();
    // A second transfer cannot help a transaction that is still confirming.
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

    approveAndConfirm(rerender);
    sendAndConfirm(rerender);

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

    approveAndConfirm(rerender);
    sendAndConfirm(rerender);

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
});
