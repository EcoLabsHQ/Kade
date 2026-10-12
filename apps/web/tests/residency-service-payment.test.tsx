import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * The service-fee payment control refuses a chain it is not wired for.
 *
 * Only the testnet settlement chain is wired today; a mainnet configuration
 * resolved by the server must not be paid through the Sepolia control.
 */

const hoisted = vi.hoisted(() => ({
  account: { isConnected: false, address: undefined as string | undefined },
  network: { chainId: 11155111 as number | string | undefined },
}));

vi.mock('@reown/appkit/react', () => ({
  useAppKit: () => ({ open: vi.fn() }),
  useAppKitAccount: () => hoisted.account,
  useAppKitNetwork: () => ({
    chainId: hoisted.network.chainId,
    switchNetwork: vi.fn(),
  }),
}));
vi.mock('wagmi', () => ({
  useWriteContract: () => ({
    data: undefined,
    writeContract: vi.fn(),
    isPending: false,
    error: null,
    reset: vi.fn(),
  }),
  useWaitForTransactionReceipt: () => ({ isLoading: false }),
}));
vi.mock('@/app/residency/actions', () => ({
  recordResidencyServiceFeePaymentAction: vi.fn(),
}));

import { ServiceFeePayment } from '@/components/residency/ServiceFeePayment';

afterEach(() => {
  vi.clearAllMocks();
});

function renderPayment(chainId: number, chainName = 'Ethereum Sepolia') {
  render(
    <ServiceFeePayment
      amountUsdc="10"
      chainId={chainId}
      chainName={chainName}
      treasuryAddress="0x37d9Bcb63118cbD2cdE1d0E24379a876d687738A"
      usdcAddress="0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"
      explorerUrl="https://sepolia.etherscan.io"
      onPaid={vi.fn()}
    />,
  );
}

describe('ServiceFeePayment chain guard', () => {
  it('refuses a chain AppKit cannot reach', () => {
    renderPayment(999999, 'Unknown Chain');
    expect(
      screen.getByText(/payment on this chain is not configured in this build/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /connect wallet/i })).toBeNull();
  });

  it('offers the connect control on the testnet settlement chain', () => {
    renderPayment(11155111, 'Ethereum Sepolia');
    expect(
      screen.getByRole('button', { name: /connect wallet/i }),
    ).toBeInTheDocument();
  });

  it('offers the connect control on the mainnet settlement chain and names it', () => {
    renderPayment(1, 'Ethereum');
    expect(
      screen.getByRole('button', { name: /connect wallet/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/pay 10 USDC on Ethereum\./i)).toBeInTheDocument();
  });
});
