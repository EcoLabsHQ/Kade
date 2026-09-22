import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Hex } from 'viem';

/**
 * The connect-and-pay control for the pre-approval fee.
 *
 * The wallet hooks are mocked so each state — disconnected, wrong network,
 * ready, paid, underpaid — is exercised against a recorded outcome, with no
 * AppKit modal and no chain. The amount and the treasury are props, so the
 * component cannot invent either.
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

function renderPayment() {
  const onPaid = vi.fn();
  render(
    <FeePayment
      amountUsdc="1.75"
      treasuryAddress={TREASURY}
      usdcAddress={USDC}
      explorerUrl="https://sepolia.etherscan.io"
      onPaid={onPaid}
    />,
  );
  return { onPaid };
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

  it('sends the fee as USDC to the treasury the server supplied', () => {
    renderPayment();

    fireEvent.click(screen.getByRole('button', { name: /pay 1\.75 usdc/i }));

    expect(hoisted.writeContract).toHaveBeenCalledTimes(1);
    const call = hoisted.writeContract.mock.calls[0]?.[0] as {
      address: string;
      functionName: string;
      args: readonly unknown[];
    };
    expect(call.address).toBe(USDC);
    expect(call.functionName).toBe('transfer');
    expect(call.args[0]).toBe(TREASURY);
    expect(call.args[1]).toBe(1_750_000n);
  });

  it('opens the platform only after the server verifies the receipt', async () => {
    hoisted.write.data = TX;
    hoisted.receipt.isSuccess = true;
    hoisted.record.mockResolvedValue({ status: 'paid', txHash: TX });

    const { onPaid } = renderPayment();

    await waitFor(() => expect(onPaid).toHaveBeenCalledWith(TX));
    expect(hoisted.record).toHaveBeenCalledWith(TX, CONNECTED);
  });

  it('does not open the platform on an underpayment', async () => {
    hoisted.write.data = TX;
    hoisted.receipt.isSuccess = true;
    hoisted.record.mockResolvedValue({
      status: 'underpaid',
      requiredUsdc: '1.75',
      receivedUsdc: '1.00',
    });

    const { onPaid } = renderPayment();

    expect(
      await screen.findByText(/1\.00 USDC but the fee is 1\.75 USDC/i),
    ).toBeInTheDocument();
    expect(onPaid).not.toHaveBeenCalled();
  });

  it('offers a re-check, not a second transfer, while the payment is pending', async () => {
    hoisted.write.data = TX;
    hoisted.receipt.isSuccess = true;
    hoisted.record.mockResolvedValue({ status: 'pending' });

    renderPayment();

    expect(
      await screen.findByRole('button', { name: /check again/i }),
    ).toBeInTheDocument();
    // A second transfer cannot help a transaction that is still confirming.
    expect(
      screen.queryByRole('button', { name: /try the payment again/i }),
    ).toBeNull();
  });

  it('offers a fresh transfer, not a re-check, after an underpayment', async () => {
    hoisted.write.data = TX;
    hoisted.receipt.isSuccess = true;
    hoisted.record.mockResolvedValue({
      status: 'underpaid',
      requiredUsdc: '1.75',
      receivedUsdc: '1.00',
    });

    renderPayment();

    expect(
      await screen.findByRole('button', { name: /try the payment again/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /check again/i }),
    ).toBeNull();
  });

  it('offers no recovery when the rail is not configured', async () => {
    hoisted.write.data = TX;
    hoisted.receipt.isSuccess = true;
    hoisted.record.mockResolvedValue({ status: 'not-configured' });

    renderPayment();

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
