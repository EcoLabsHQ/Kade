import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { InvestScreen } from '@/components/invest/InvestScreen';
import type { InvestPoolSummary } from '@/app/invest/actions';

/**
 * The Invest screen (D18 / EXE-014).
 *
 * The server action is mocked so the screen is exercised against recorded server
 * outcomes, but the assertions are about what the screen must never do: it must
 * not claim a deposit happened, it must show the configured pool address as a
 * value (never a literal of its own), and it must refuse to allocate until the
 * pool, the Safe and a valid amount are all present.
 */

const hoisted = vi.hoisted(() => ({
  buildDeposit: vi.fn(),
}));

vi.mock('@/app/invest/actions', () => ({
  buildDeposit: hoisted.buildDeposit,
}));

const SAFE = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const MORPHO = '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const MARKET_ID = '0x94b823e6bd8ea533b4e33fbc307faea0b307301bc48763acc4d4aa4def7636cd';

const CONFIGURED_POOL: InvestPoolSummary = {
  configured: true,
  chainId: 1,
  chainName: 'Ethereum',
  loanToken: USDC,
  morpho: MORPHO,
  marketId: MARKET_ID,
};

const UNCONFIGURED_POOL: InvestPoolSummary = {
  configured: false,
  chainId: 1,
  chainName: 'Ethereum',
  loanToken: null,
  morpho: null,
  marketId: null,
};

function renderScreen(overrides: {
  pool?: InvestPoolSummary;
  safeAddress?: string | null;
  safeDeployed?: boolean;
  mainnetConfigured?: boolean;
  signerDeployed?: boolean;
} = {}) {
  return render(
    <InvestScreen
      pool={overrides.pool ?? CONFIGURED_POOL}
      safeAddress={overrides.safeAddress === undefined ? SAFE : overrides.safeAddress}
      safeDeployed={overrides.safeDeployed ?? true}
      mainnetConfigured={overrides.mainnetConfigured ?? false}
      signerDeployed={overrides.signerDeployed ?? true}
    />,
  );
}

function allocateButton() {
  return screen.getByRole('button', { name: /^allocate/i });
}

afterEach(() => {
  cleanup();
  hoisted.buildDeposit.mockReset();
});

beforeEach(() => {
  hoisted.buildDeposit.mockResolvedValue({
    status: 'gated',
    gate: 'mainnet-not-configured',
    reason: 'The Ethereum-mainnet rail is not configured (no RPC/payer).',
  });
});

describe('InvestScreen configuration', () => {
  it('shows the configured pool address and market id from props, not literals', () => {
    renderScreen();
    expect(screen.getByText(MORPHO)).toBeInTheDocument();
    expect(screen.getByText(USDC)).toBeInTheDocument();
    expect(screen.getByText(MARKET_ID)).toBeInTheDocument();
    expect(screen.getByText('Ethereum mainnet')).toBeInTheDocument();
  });

  it('says the pool is not configured and shows no address when it is absent', () => {
    renderScreen({ pool: UNCONFIGURED_POOL });
    expect(screen.getByText(/pool not configured/i)).toBeInTheDocument();
    expect(screen.queryByText(MORPHO)).toBeNull();
  });

  it('locks Allocate when the pool is not configured', () => {
    renderScreen({ pool: UNCONFIGURED_POOL });
    expect(allocateButton()).toBeDisabled();
  });

  it('locks Allocate when the resident has no Safe', () => {
    renderScreen({ safeAddress: null, safeDeployed: false });
    expect(allocateButton()).toBeDisabled();
  });

  it('locks Allocate when the Safe is not deployed', () => {
    renderScreen({ safeDeployed: false });
    expect(allocateButton()).toBeDisabled();
  });

  it('locks Allocate for a malformed or zero amount', () => {
    renderScreen();
    const input = screen.getByLabelText(/amount to allocate/i);

    for (const bad of ['0', '-5', 'abc', '1.1234567', '']) {
      fireEvent.change(input, { target: { value: bad } });
      expect(allocateButton()).toBeDisabled();
    }
  });

  it('enables Allocate when the pool, Safe and amount are all present', () => {
    renderScreen();
    expect(allocateButton()).toBeEnabled();
  });
});

describe('InvestScreen building', () => {
  it('asks the server to build the deposit with the resolved inputs', async () => {
    renderScreen();
    fireEvent.change(screen.getByLabelText(/amount to allocate/i), {
      target: { value: '1500.5' },
    });
    fireEvent.click(allocateButton());

    await waitFor(() => expect(hoisted.buildDeposit).toHaveBeenCalledTimes(1));
    expect(hoisted.buildDeposit).toHaveBeenCalledWith({
      safeAddress: SAFE,
      amountUsdc: '1500.5',
      poolConfigured: true,
      mainnetConfigured: false,
      signerDeployed: true,
    });
  });

  it('reports a gated outcome without claiming anything was sent', async () => {
    renderScreen();
    fireEvent.click(allocateButton());

    const notice = await screen.findByText(/deposit gated/i);
    expect(notice).toBeInTheDocument();
    expect(screen.getByText(/nothing was signed or sent/i)).toBeInTheDocument();
  });

  it('shows the built calls and states plainly that nothing was sent', async () => {
    hoisted.buildDeposit.mockResolvedValue({
      status: 'ready-to-execute',
      callCount: 2,
      calls: [
        { to: USDC, selector: '0x095ea7b3' },
        { to: MORPHO, selector: '0xa99aad89' },
      ],
      marketId: MARKET_ID,
      amountUsdc: '25000',
    });
    renderScreen();
    fireEvent.click(allocateButton());

    const notice = await screen.findByText(/deposit built · not sent/i);
    expect(notice).toBeInTheDocument();
    expect(screen.getByText(/nothing has been sent/i)).toBeInTheDocument();
    expect(screen.getByText('Call 1 · approve')).toBeInTheDocument();
    expect(screen.getByText('Call 2 · supply')).toBeInTheDocument();
  });
});
