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
 * The two server actions and the passkey prompt are mocked so the screen is
 * exercised against recorded outcomes, but the assertions are about what the
 * screen must never do: it must not claim a deposit happened unless the server
 * confirmed it, it must show the configured vault address as a value (never a
 * literal of its own), it must not quote a yield figure it has no source for,
 * and it must refuse to allocate until the vault, the Safe and a valid amount
 * are all present. It must also call the three phases in order and report a
 * dismissed prompt truthfully.
 */

const hoisted = vi.hoisted(() => ({
  beginDeposit: vi.fn(),
  completeDeposit: vi.fn(),
  promptPasskeyAssertionParts: vi.fn(),
}));

vi.mock('@/app/invest/actions', () => ({
  beginDeposit: hoisted.beginDeposit,
  completeDeposit: hoisted.completeDeposit,
}));

vi.mock('@/lib/passkey/assertion', () => ({
  promptPasskeyAssertionParts: hoisted.promptPasskeyAssertionParts,
}));

const SAFE = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const VAULT = '0x1111222233334444555566667777888899990000';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const HASH = `0x${'ab'.repeat(32)}`;
const CREDENTIAL_ID = 'abcdef';
const TOKEN = 'tok-1';

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

const READY = {
  status: 'ready' as const,
  token: TOKEN,
  hash: HASH,
  credentialId: CREDENTIAL_ID,
};

const ASSERTION = {
  authenticatorData: 'AQIDBA',
  signature: 'MAYCAQECAQI',
  clientDataJSON: 'e30',
};

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

function confirmButton(dialog: HTMLElement) {
  return within(dialog).getByRole('button', { name: /build the deposit/i });
}

async function clickAllocate(dialog: HTMLElement) {
  fireEvent.click(confirmButton(dialog));
  // Let the async handler reach its first await before asserting.
  await waitFor(() => expect(hoisted.beginDeposit).toHaveBeenCalled());
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  hoisted.beginDeposit.mockResolvedValue({
    status: 'gated',
    gate: 'mainnet-not-configured',
    reason: 'The Ethereum-mainnet rail is not configured (no RPC/payer).',
  });
  hoisted.promptPasskeyAssertionParts.mockResolvedValue(ASSERTION);
  hoisted.completeDeposit.mockResolvedValue({
    status: 'sent',
    sent: true,
    userOperationHash: `0x${'fe'.repeat(32)}`,
    transactionHash: '0xfeed',
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
    expect(confirmButton(dialog)).toBeDisabled();
  });

  it('locks Allocate when the resident has no Safe', () => {
    renderScreen({ safeAddress: null, safeDeployed: false });
    const dialog = openDialog('Morpho USDC vault');
    expect(confirmButton(dialog)).toBeDisabled();
  });

  it('locks Allocate when the Safe is not deployed', () => {
    renderScreen({ safeDeployed: false });
    const dialog = openDialog('Morpho USDC vault');
    expect(confirmButton(dialog)).toBeDisabled();
  });

  it('locks Allocate for a malformed or zero amount', () => {
    renderScreen();
    const dialog = openDialog('Morpho USDC vault');
    const input = within(dialog).getByLabelText(/amount to allocate/i);

    for (const bad of ['0', '-5', 'abc', '1.1234567', '']) {
      fireEvent.change(input, { target: { value: bad } });
      expect(confirmButton(dialog)).toBeDisabled();
    }
  });

  it('enables Allocate when the vault, Safe and amount are all present', () => {
    renderScreen();
    const dialog = openDialog('Morpho USDC vault');
    expect(confirmButton(dialog)).toBeEnabled();
  });
});

describe('InvestScreen allocate flow', () => {
  it('runs begin → passkey → complete in order', async () => {
    hoisted.beginDeposit.mockResolvedValue(READY);
    renderScreen();
    const dialog = openDialog('Morpho USDC vault');
    fireEvent.change(within(dialog).getByLabelText(/amount to allocate/i), {
      target: { value: '1500.5' },
    });

    await clickAllocate(dialog);

    await waitFor(() => expect(hoisted.completeDeposit).toHaveBeenCalledTimes(1));

    expect(hoisted.beginDeposit).toHaveBeenCalledWith({
      safeAddress: SAFE,
      amountUsdc: '1500.5',
      vaultConfigured: true,
      mainnetConfigured: false,
    });
    // The browser signs the server's hash with the stored credential, against
    // this page's own host as the relying party.
    expect(hoisted.promptPasskeyAssertionParts).toHaveBeenCalledWith({
      credentialId: CREDENTIAL_ID,
      challenge: HASH,
      rpId: window.location.hostname,
    });
    // The client sends only the token and the three assertion parts.
    expect(hoisted.completeDeposit).toHaveBeenCalledWith({
      token: TOKEN,
      assertion: ASSERTION,
    });
  });

  it('reports a confirmed deposit only after the receipt', async () => {
    hoisted.beginDeposit.mockResolvedValue(READY);
    renderScreen();
    const dialog = openDialog('Morpho USDC vault');

    await clickAllocate(dialog);

    expect(
      await within(dialog).findByText(/deposit submitted/i),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/receipt confirmed/i),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('0xfeed')).toBeInTheDocument();
  });

  it('reports a gated build without prompting the passkey', async () => {
    renderScreen();
    const dialog = openDialog('Morpho USDC vault');

    await clickAllocate(dialog);

    expect(await within(dialog).findByText(/deposit gated/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/nothing was signed or sent/i)).toBeInTheDocument();
    expect(hoisted.promptPasskeyAssertionParts).not.toHaveBeenCalled();
    expect(hoisted.completeDeposit).not.toHaveBeenCalled();
  });

  it('reports a dismissed passkey prompt truthfully instead of returning to the form', async () => {
    hoisted.beginDeposit.mockResolvedValue(READY);
    hoisted.promptPasskeyAssertionParts.mockRejectedValue(
      new Error('The passkey prompt returned no assertion.'),
    );
    renderScreen();
    const dialog = openDialog('Morpho USDC vault');

    await clickAllocate(dialog);

    expect(await within(dialog).findByText(/deposit failed/i)).toBeInTheDocument();
    expect(within(dialog).getByText('passkey')).toBeInTheDocument();
    expect(
      within(dialog).getByText(/no assertion/i),
    ).toBeInTheDocument();
    expect(hoisted.completeDeposit).not.toHaveBeenCalled();
  });

  it('reports a failed submission with its stage and no false success', async () => {
    hoisted.beginDeposit.mockResolvedValue(READY);
    hoisted.completeDeposit.mockResolvedValue({
      status: 'failed',
      sent: false,
      stage: 'sign',
      reason: 'The passkey attached no signature to the operation.',
    });
    renderScreen();
    const dialog = openDialog('Morpho USDC vault');

    await clickAllocate(dialog);

    expect(await within(dialog).findByText(/deposit failed/i)).toBeInTheDocument();
    expect(within(dialog).getByText('sign')).toBeInTheDocument();
    expect(within(dialog).getByText(/nothing was sent/i)).toBeInTheDocument();
    expect(within(dialog).queryByText(/deposit submitted/i)).toBeNull();
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
