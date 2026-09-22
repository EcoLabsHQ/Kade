import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { Hex } from 'viem';

/**
 * The pre-approval fee is paid from a modal that names the amount, the deposit
 * address and the rail, then hosts the connect-and-pay control. These tests pin
 * the modal's open/close behaviour and the gating that keeps it away when
 * payment is unconfigured.
 *
 * The wallet hooks are mocked so the modal renders against a recorded
 * connection state, with no AppKit modal and no chain.
 */

const hoisted = vi.hoisted(() => ({
  open: vi.fn(),
  switchNetwork: vi.fn(),
  writeContract: vi.fn(),
  reset: vi.fn(),
  record: vi.fn(),
  account: {
    isConnected: true,
    address: '0x1111111111111111111111111111111111111111' as
      | string
      | undefined,
  },
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
  // FeeStep tears down every connection when the deposit modal opens.
  useConnections: () => [],
  useDisconnect: () => ({ disconnect: vi.fn() }),
}));
vi.mock('@/app/onboarding/payment-actions', () => ({
  recordPreapprovalFeePayment: hoisted.record,
}));

import { FeeStep, type FeeStepProps } from '@/components/onboarding/FeeStep';
import { preapprovalBreakdownFromSchedule } from '@/lib/onboarding/fee';
import { shortAddress } from '@/lib/wealth/format';

const TREASURY = '0x37d9Bcb63118cbD2cdE1d0E24379a876d687738A';
const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const TX = `0x${'ab'.repeat(32)}` as Hex;

/** The contract's worked example: base 1, 0.25 per member, household of three. */
const BREAKDOWN = preapprovalBreakdownFromSchedule(
  { mode: 'demo', baseUsdc: 1, perMemberUsdc: 0.25, roundingScale: 2 },
  3,
);

function renderStep(overrides: Partial<FeeStepProps> = {}) {
  const onPaid = vi.fn();
  const props: FeeStepProps = {
    rows: [],
    breakdown: BREAKDOWN,
    paid: false,
    paymentConfigured: true,
    treasuryAddress: TREASURY,
    usdcAddress: USDC,
    explorerUrl: 'https://sepolia.etherscan.io',
    onPaid,
    onEnter: vi.fn(),
    onBack: vi.fn(),
    ...overrides,
  };
  render(<FeeStep {...props} />);
  return { onPaid };
}

function openDeposit() {
  fireEvent.click(screen.getByRole('button', { name: /^deposit$/i }));
}

beforeEach(() => {
  hoisted.account.isConnected = true;
  hoisted.account.address = '0x1111111111111111111111111111111111111111';
  hoisted.network.chainId = 11155111;
  hoisted.write.data = undefined;
  hoisted.write.isPending = false;
  hoisted.write.error = null;
  hoisted.receipt.isLoading = false;
  hoisted.receipt.isSuccess = false;
  hoisted.record.mockResolvedValue({ status: 'pending' });
  // The pay control mirrors its in-flight hash into sessionStorage, so clear it
  // between tests to keep each one starting from a clean wallet state.
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('FeeStep deposit modal', () => {
  it('opens on the Deposit button and shows the amount and deposit address', () => {
    renderStep();
    expect(screen.queryByRole('dialog')).toBeNull();

    openDeposit();

    const dialog = screen.getByRole('dialog', {
      name: /deposit the pre-approval fee/i,
    });
    expect(within(dialog).getByText('1.75 USDC')).toBeInTheDocument();
    // The address is shown truncated, never as the raw 42-character value.
    expect(within(dialog).getByText(shortAddress(TREASURY))).toBeInTheDocument();
    expect(within(dialog).queryByText(TREASURY)).toBeNull();
    expect(within(dialog).getByText('Ethereum Sepolia')).toBeInTheDocument();
    expect(within(dialog).getByText('USDC')).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: /copy deposit address/i }),
    ).toBeInTheDocument();
  });

  it('focuses the dialog card when it opens', () => {
    renderStep();
    openDeposit();
    expect(screen.getByRole('dialog')).toHaveFocus();
  });

  it('closes on Escape', () => {
    renderStep();
    openDeposit();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on the close button', () => {
    renderStep();
    openDeposit();
    const dialog = screen.getByRole('dialog');

    fireEvent.click(within(dialog).getByRole('button', { name: /close/i }));

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on a click outside the card but not inside it', () => {
    renderStep();
    openDeposit();
    const dialog = screen.getByRole('dialog');

    // A click inside the card must not dismiss it.
    fireEvent.click(dialog);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // The backdrop is the card's parent.
    fireEvent.click(dialog.parentElement as HTMLElement);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers no Deposit button or modal when payment is unconfigured', () => {
    renderStep({ paymentConfigured: false });

    expect(screen.queryByRole('button', { name: /^deposit$/i })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      screen.getByText(/payment is not configured in this environment/i),
    ).toBeInTheDocument();
  });

  it('offers no Deposit button when the deposit address is missing', () => {
    renderStep({ treasuryAddress: null });

    expect(screen.queryByRole('button', { name: /^deposit$/i })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      screen.getByText(/payment is not configured in this environment/i),
    ).toBeInTheDocument();
  });

  it('offers no Deposit button when the fee cannot be resolved', () => {
    renderStep({ breakdown: null });

    expect(screen.queryByRole('button', { name: /^deposit$/i })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      screen.getByText(
        /configured fee could not be read, so payment is unavailable/i,
      ),
    ).toBeInTheDocument();
  });

  it('keeps the full deposit address on hover and copies it in full', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    renderStep();
    openDeposit();

    const dialog = screen.getByRole('dialog');
    const code = within(dialog).getByText(shortAddress(TREASURY));
    expect(code.tagName).toBe('CODE');
    expect(code).toHaveAttribute('title', TREASURY);

    fireEvent.click(
      within(dialog).getByRole('button', { name: /copy deposit address/i }),
    );

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(TREASURY));
    expect(
      within(dialog).getByRole('button', { name: /copy deposit address/i }),
    ).toHaveTextContent(/copied/i);
  });

  it('shows an animated loader while the payment is confirming', () => {
    hoisted.receipt.isLoading = true;

    renderStep();
    openDeposit();

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/confirming your payment on sepolia/i);
    expect(
      within(status).getByRole('progressbar', { name: /confirming payment/i }),
    ).toBeInTheDocument();
  });

  it('shows Close and a View transaction button once the payment confirms', async () => {
    hoisted.write.data = TX;
    hoisted.receipt.isSuccess = true;
    hoisted.record.mockResolvedValue({ status: 'paid', txHash: TX });

    renderStep();
    openDeposit();

    const actions = await screen.findByTestId('fee-complete-actions');
    const view = within(actions).getByRole('link', {
      name: /view transaction/i,
    });
    expect(view).toHaveAttribute(
      'href',
      `https://sepolia.etherscan.io/tx/${TX}`,
    );
    expect(
      within(actions).queryByRole('button', { name: /pay 1\.75 usdc/i }),
    ).toBeNull();

    fireEvent.click(within(actions).getByRole('button', { name: /^close$/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
