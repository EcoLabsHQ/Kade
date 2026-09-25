import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { InvestScreen } from '@/components/invest/InvestScreen';
import type { InvestVaultSummary } from '@/app/invest/actions';

/**
 * The Invest screen (D18 / EXE-014), laid out to match the deployed baseline.
 *
 * The server action is mocked so the screen is exercised against recorded server
 * outcomes, but the assertions are about what the screen must never do: it must
 * not claim a deposit happened, it must show the configured vault address as a
 * value (never a literal of its own), it must not quote a yield figure it has no
 * source for, and it must refuse to allocate until the vault, the Safe and a
 * valid amount are all present.
 */

const hoisted = vi.hoisted(() => ({
  buildDeposit: vi.fn(),
}));

vi.mock('@/app/invest/actions', () => ({
  buildDeposit: hoisted.buildDeposit,
}));

const SAFE = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const VAULT = '0x1111222233334444555566667777888899990000';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

const CONFIGURED_VAULT: InvestVaultSummary = {
  configured: true,
  chainId: 1,
  chainName: 'Ethereum',
  vault: VAULT,
  usdc: USDC,
};

const UNCONFIGURED_VAULT: InvestVaultSummary = {
  configured: false,
  chainId: 1,
  chainName: 'Ethereum',
  vault: null,
  usdc: null,
};

const REFERENCE_INSTRUMENTS = [
  'Aqualectra 2025–2032 · AQUA-A1',
  'Staatsolie 2025–2033 · SOMS-25-A1',
  'Ondo USDY',
  'Morpho USDC vault',
  'LATAM EM Fund · Portfolio B',
];

function renderScreen(overrides: {
  vault?: InvestVaultSummary;
  safeAddress?: string | null;
  safeDeployed?: boolean;
  mainnetConfigured?: boolean;
} = {}) {
  return render(
    <InvestScreen
      vault={overrides.vault ?? CONFIGURED_VAULT}
      safeAddress={overrides.safeAddress === undefined ? SAFE : overrides.safeAddress}
      safeDeployed={overrides.safeDeployed ?? true}
      mainnetConfigured={overrides.mainnetConfigured ?? false}
    />,
  );
}

/** The reference's "Allocate" button carries the instrument name for a11y. */
function allocateInto(name: string) {
  return screen.getByRole('button', { name: new RegExp(`allocate into ${name}`, 'i') });
}

function openDialog(name: string) {
  fireEvent.click(allocateInto(name));
  return screen.getByRole('dialog');
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

describe('InvestScreen reference layout', () => {
  it('renders the reference heading, subtitle and the instrument table', () => {
    renderScreen();
    expect(screen.getByRole('heading', { name: 'Invest' })).toBeInTheDocument();
    expect(
      screen.getByText(/Allocate from the vault into qualifying instruments/i),
    ).toBeInTheDocument();
    for (const name of REFERENCE_INSTRUMENTS) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    expect(
      screen.getAllByRole('button', { name: /allocate into/i }),
    ).toHaveLength(REFERENCE_INSTRUMENTS.length);
  });

  it('names the vault instrument accurately and does not quote a yield', () => {
    renderScreen();
    expect(screen.getByText('MetaMorpho · Ethereum vault')).toBeInTheDocument();
    expect(screen.getByText('Variable APY · not quoted')).toBeInTheDocument();
    // The reference's demo APY must never be presented as the real figure.
    expect(screen.queryByText(/4\.62%/)).toBeNull();
  });

  it('renders the two baseline stat cards', () => {
    renderScreen();
    expect(screen.getByText('Vault USDC available')).toBeInTheDocument();
    expect(screen.getByText('Allocated this session')).toBeInTheDocument();
  });
});

describe('InvestScreen configuration', () => {
  it('shows the configured vault values from props, not literals', () => {
    renderScreen();
    const dialog = openDialog('Morpho USDC vault');
    expect(within(dialog).getByText(VAULT)).toBeInTheDocument();
    expect(within(dialog).getByText(USDC)).toBeInTheDocument();
    expect(
      within(dialog).getByText(`Ethereum · ${CONFIGURED_VAULT.chainId}`),
    ).toBeInTheDocument();
  });

  it('cannot allocate when the vault is not configured', () => {
    renderScreen({ vault: UNCONFIGURED_VAULT });
    const dialog = openDialog('Morpho USDC vault');
    expect(within(dialog).queryByText(VAULT)).toBeNull();
    expect(within(dialog).getAllByText('Not configured').length).toBeGreaterThan(0);
    expect(
      within(dialog).getByRole('button', { name: /build the deposit/i }),
    ).toBeDisabled();
  });

  it('locks Allocate when the resident has no Safe', () => {
    renderScreen({ safeAddress: null, safeDeployed: false });
    const dialog = openDialog('Morpho USDC vault');
    expect(
      within(dialog).getByRole('button', { name: /build the deposit/i }),
    ).toBeDisabled();
  });

  it('locks Allocate when the Safe is not deployed', () => {
    renderScreen({ safeDeployed: false });
    const dialog = openDialog('Morpho USDC vault');
    expect(
      within(dialog).getByRole('button', { name: /build the deposit/i }),
    ).toBeDisabled();
  });

  it('locks Allocate for a malformed or zero amount', () => {
    renderScreen();
    const dialog = openDialog('Morpho USDC vault');
    const input = within(dialog).getByLabelText(/amount to allocate/i);
    const confirm = () =>
      within(dialog).getByRole('button', { name: /build the deposit/i });

    for (const bad of ['0', '-5', 'abc', '1.1234567', '']) {
      fireEvent.change(input, { target: { value: bad } });
      expect(confirm()).toBeDisabled();
    }
  });

  it('enables Allocate when the vault, Safe and amount are all present', () => {
    renderScreen();
    const dialog = openDialog('Morpho USDC vault');
    expect(
      within(dialog).getByRole('button', { name: /build the deposit/i }),
    ).toBeEnabled();
  });
});

describe('InvestScreen building', () => {
  it('asks the server to build the deposit with the resolved inputs', async () => {
    renderScreen();
    const dialog = openDialog('Morpho USDC vault');
    fireEvent.change(within(dialog).getByLabelText(/amount to allocate/i), {
      target: { value: '1500.5' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: /build the deposit/i }),
    );

    await waitFor(() => expect(hoisted.buildDeposit).toHaveBeenCalledTimes(1));
    expect(hoisted.buildDeposit).toHaveBeenCalledWith({
      safeAddress: SAFE,
      amountUsdc: '1500.5',
      vaultConfigured: true,
      mainnetConfigured: false,
    });
  });

  it('reports a gated outcome without claiming anything was sent', async () => {
    renderScreen();
    const dialog = openDialog('Morpho USDC vault');
    fireEvent.click(
      within(dialog).getByRole('button', { name: /build the deposit/i }),
    );

    expect(await within(dialog).findByText(/deposit gated/i)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/nothing was signed or sent/i),
    ).toBeInTheDocument();
  });

  it('shows the built calls and states plainly that nothing was sent', async () => {
    hoisted.buildDeposit.mockResolvedValue({
      status: 'ready-to-execute',
      callCount: 2,
      calls: [
        { to: USDC, selector: '0x095ea7b3' },
        { to: VAULT, selector: '0x6e553f65' },
      ],
      vault: VAULT,
      amountUsdc: '25000',
    });
    renderScreen();
    const dialog = openDialog('Morpho USDC vault');
    fireEvent.click(
      within(dialog).getByRole('button', { name: /build the deposit/i }),
    );

    expect(
      await within(dialog).findByText(/deposit built · not sent/i),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/nothing has been sent/i)).toBeInTheDocument();
    // The vault address is shown both as the configured vault and on the plan.
    expect(within(dialog).getAllByText(VAULT).length).toBeGreaterThan(0);
    expect(within(dialog).getByText('Call 1 · approve')).toBeInTheDocument();
    expect(within(dialog).getByText('Call 2 · deposit')).toBeInTheDocument();
  });

  it('puts Morpho first and disables the instruments with no execution path', () => {
    renderScreen();
    const buttons = screen.getAllByRole('button', { name: /allocate into/i });
    expect(buttons[0]).toHaveAccessibleName(/allocate into morpho usdc vault/i);
    expect(buttons[0]).toBeEnabled();
    for (const button of buttons.slice(1)) {
      expect(button).toBeDisabled();
    }
  });
});
