import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

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
    data: undefined,
    writeContract: hoisted.writeContract,
    isPending: false,
    error: null,
    reset: hoisted.reset,
  }),
  useWaitForTransactionReceipt: () => ({ isLoading: false, isSuccess: false }),
}));
vi.mock('@/app/onboarding/payment-actions', () => ({
  recordPreapprovalFeePayment: hoisted.record,
}));

import { FeeStep, type FeeStepProps } from '@/components/onboarding/FeeStep';
import { preapprovalBreakdownFromSchedule } from '@/lib/onboarding/fee';

const TREASURY = '0x37d9Bcb63118cbD2cdE1d0E24379a876d687738A';
const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';

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
    expect(within(dialog).getByText(TREASURY)).toBeInTheDocument();
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
});
