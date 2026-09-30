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
import { MORPHO_VAULT_CHAIN_IDS } from '@kade/shared';
import {
  morphoChainName,
  readMorphoVaultConfigForChain,
} from '@/lib/invest/morpho-config';
import { shortAddress } from '@/lib/wealth/format';

/**
 * The Invest screen (D18 / EXE-014).
 *
 * The three MetaMorpho rails are three distinct investments, one per network,
 * each named with its own chain. These tests pin the owner's requirement and the
 * screen's honesty: the removed instruments (`aqua`, `soms`, `latam`) do not
 * render, an unconfigured rail is never a selectable investment, starting from a
 * row prepares the deposit for **that row's** chain (not the default), the two
 * server actions and the passkey prompt run in order against recorded outcomes,
 * a deposit is never claimed unless the server confirmed it, the configured
 * vault address is shown as a value (never a literal of its own), no yield figure
 * without a source is quoted, and the control stays disabled until an instrument
 * is wired, a rail is configured, a Safe is recorded and the amount is valid. It
 * must not gate on the Safe's deployment state — the server verifies the
 * deposit-chain Safe and a counterfactual Safe is deployed by its first
 * sponsored operation — and it must surface a server refusal reason rather than
 * swallow it.
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
const BASE_VAULT = '0x2222222222222222222222222222222222222222';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const ARBITRUM_VAULT = '0x3333333333333333333333333333333333333333';
const ARBITRUM_USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const HASH = `0x${'ab'.repeat(32)}`;
const CREDENTIAL_ID = 'abcdef';
const TOKEN = 'tok-1';

/** The three pinned rails, all usable. */
const ETHEREUM_RAIL: InvestVaultSummary = {
  configured: true,
  chainId: 1,
  chainName: 'Ethereum',
  vault: VAULT,
  usdc: USDC,
};
const BASE_RAIL: InvestVaultSummary = {
  configured: true,
  chainId: 8453,
  chainName: 'Base',
  vault: BASE_VAULT,
  usdc: BASE_USDC,
};
const ARBITRUM_RAIL: InvestVaultSummary = {
  configured: true,
  chainId: 42161,
  chainName: 'Arbitrum One',
  vault: ARBITRUM_VAULT,
  usdc: ARBITRUM_USDC,
};
const CONFIGURED_VAULTS: InvestVaultSummary[] = [
  ETHEREUM_RAIL,
  BASE_RAIL,
  ARBITRUM_RAIL,
];

/** The pinned rails, none of them usable (no RPC). */
const UNCONFIGURED_VAULTS: InvestVaultSummary[] = CONFIGURED_VAULTS.map(
  (rail) => ({ ...rail, configured: false, vault: null, usdc: null }),
);

/**
 * The three MetaMorpho rails, each its own investment named with its chain,
 * followed by the one instrument retained from the reference's locked list.
 */
const MORPHO_ETHEREUM = 'Morpho USDC vault · Ethereum';
const MORPHO_BASE = 'Morpho USDC vault · Base';
const MORPHO_ARBITRUM = 'Morpho USDC vault · Arbitrum One';
const MORPHO_INSTRUMENTS = [MORPHO_ETHEREUM, MORPHO_BASE, MORPHO_ARBITRUM];
const RETAINED_INSTRUMENT = 'Ondo USDY';
const EXPECTED_INSTRUMENTS = [...MORPHO_INSTRUMENTS, RETAINED_INSTRUMENT];

/** The instruments the owner asked to remove; none may render or be clickable. */
const REMOVED_INSTRUMENTS = [
  'Aqualectra 2025–2032 · AQUA-A1',
  'Staatsolie 2025–2033 · SOMS-25-A1',
  'LATAM EM Fund · Portfolio B',
];

const READY = {
  status: 'ready' as const,
  token: TOKEN,
  hash: HASH,
  credentialId: CREDENTIAL_ID,
  chainId: 1,
};

const ASSERTION = {
  authenticatorData: 'AQIDBA',
  signature: 'MAYCAQECAQI',
  clientDataJSON: 'e30',
};

function renderScreen(overrides: {
  vaults?: readonly InvestVaultSummary[];
  safeAddress?: string | null;
} = {}) {
  return render(
    <InvestScreen
      vaults={overrides.vaults ?? CONFIGURED_VAULTS}
      safeAddress={overrides.safeAddress === undefined ? SAFE : overrides.safeAddress}
      holdings={[]}
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
    gate: 'rail-not-configured',
    reason: 'The Ethereum rail is not configured (no RPC/payer).',
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
    for (const name of EXPECTED_INSTRUMENTS) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    expect(
      screen.getAllByRole('button', { name: /allocate into/i }),
    ).toHaveLength(EXPECTED_INSTRUMENTS.length);
  });

  it('shows the three Morpho vaults, one per network, and drops aqua, soms and latam', () => {
    // The owner's requirement: the three MetaMorpho rails are three distinct
    // investments on three networks, and instruments 2, 3 and 5 are removed
    // while Ondo USDY stays.
    renderScreen();
    for (const name of MORPHO_INSTRUMENTS) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    for (const name of REMOVED_INSTRUMENTS) {
      expect(screen.queryByText(name)).toBeNull();
      expect(
        screen.queryByRole('button', {
          name: new RegExp(`allocate into ${name}`, 'i'),
        }),
      ).toBeNull();
    }
    expect(screen.getByText(RETAINED_INSTRUMENT)).toBeInTheDocument();
  });

  it('names the vault instrument accurately and does not quote a yield', () => {
    renderScreen();
    // Every Morpho row is a MetaMorpho USDC vault, not a Morpho Blue market.
    expect(screen.getAllByText('MetaMorpho · USDC vault')).toHaveLength(
      MORPHO_INSTRUMENTS.length,
    );
    expect(screen.getAllByText('Variable APY · not quoted')).toHaveLength(
      MORPHO_INSTRUMENTS.length,
    );
    // The reference's demo APY must never be presented as the real figure.
    expect(screen.queryByText(/4\.62%/)).toBeNull();
  });

  it('renders the two baseline stat cards', () => {
    renderScreen();
    expect(screen.getByText('Vault USDC available')).toBeInTheDocument();
    // The figure is the Safe's current on-chain position, not a per-session
    // count (nothing persists a session figure), so the label was renamed from
    // the reference's "Allocated this session" to say what the number is.
    expect(screen.getByText('Currently allocated')).toBeInTheDocument();
  });
});

describe('InvestScreen configuration', () => {
  it('shows the configured vault values from props, not literals', () => {
    renderScreen();
    const dialog = openDialog(MORPHO_ETHEREUM);
    // The contract addresses live behind the collapsed disclosure; expand it.
    fireEvent.click(
      within(dialog).getByRole('button', { name: /contract details/i }),
    );
    // The full address survives as the value even though it renders truncated.
    expect(within(dialog).getByTitle(VAULT)).toHaveTextContent(
      shortAddress(VAULT),
    );
    expect(within(dialog).getByTitle(USDC)).toHaveTextContent(
      shortAddress(USDC),
    );
    // The Ethereum row deposits on Ethereum mainnet, named before signing.
    expect(within(dialog).getByText('Ethereum · 1')).toBeInTheDocument();
  });

  it('opens each Morpho investment on its own chain, vault and USDC — never shared', () => {
    const cases = [
      { name: MORPHO_ETHEREUM, chainId: 1, chain: 'Ethereum', vault: VAULT, usdc: USDC },
      { name: MORPHO_BASE, chainId: 8453, chain: 'Base', vault: BASE_VAULT, usdc: BASE_USDC },
      {
        name: MORPHO_ARBITRUM,
        chainId: 42161,
        chain: 'Arbitrum One',
        vault: ARBITRUM_VAULT,
        usdc: ARBITRUM_USDC,
      },
    ];

    for (const current of cases) {
      renderScreen();
      const dialog = openDialog(current.name);
      // Contract details are collapsed by default; reveal them for this row.
      fireEvent.click(
        within(dialog).getByRole('button', { name: /contract details/i }),
      );

      // The modal names the row's own chain and shows that chain's vault/USDC.
      expect(
        within(dialog).getByText(`${current.chain} · ${current.chainId}`),
      ).toBeInTheDocument();
      // Each address is shown truncated but keeps the full value as its title.
      expect(within(dialog).getByTitle(current.vault)).toHaveTextContent(
        shortAddress(current.vault),
      );
      expect(within(dialog).getByTitle(current.usdc)).toHaveTextContent(
        shortAddress(current.usdc),
      );

      // No other chain's vault leaks into this investment's modal, and there is
      // no chain selector to contradict the row.
      for (const other of cases) {
        if (other.vault !== current.vault) {
          expect(within(dialog).queryByTitle(other.vault)).toBeNull();
        }
      }
      expect(
        within(dialog).queryByRole('button', { name: 'Base' }),
      ).toBeNull();

      cleanup();
    }
  });

  it('never renders an unconfigured rail as a selectable investment', () => {
    // Base's rail is pinned but not configured: it must not appear as a row or a
    // clickable investment, while the configured rails are unaffected.
    const baseUnconfigured = CONFIGURED_VAULTS.map((rail) =>
      rail.chainId === 8453
        ? { ...rail, configured: false, vault: null, usdc: null }
        : rail,
    );
    renderScreen({ vaults: baseUnconfigured });

    expect(screen.queryByText(MORPHO_BASE)).toBeNull();
    expect(
      screen.queryByRole('button', {
        name: /allocate into morpho usdc vault · base/i,
      }),
    ).toBeNull();
    expect(screen.getByText(MORPHO_ETHEREUM)).toBeInTheDocument();
    expect(screen.getByText(MORPHO_ARBITRUM)).toBeInTheDocument();
  });

  it('renders no selectable Morpho investment when no rail is configured', () => {
    renderScreen({ vaults: UNCONFIGURED_VAULTS });
    for (const name of MORPHO_INSTRUMENTS) {
      expect(screen.queryByText(name)).toBeNull();
    }
    // Only the retained, non-wired instrument remains, and it stays locked.
    expect(screen.getByText(RETAINED_INSTRUMENT)).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: /allocate into/i });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toBeDisabled();
  });

  it('renders exactly the pinned per-chain rails the registry can execute', () => {
    // Build the summaries the route builds, from the real registry, so the test
    // fails if a chain is added or removed without the screen following. This is
    // the drift guard: the Morpho rows are derived, not three literals.
    const registryRails: InvestVaultSummary[] = MORPHO_VAULT_CHAIN_IDS.map(
      (chainId) => {
        const config = readMorphoVaultConfigForChain(chainId, {});
        return {
          configured: true,
          chainId,
          chainName: morphoChainName(chainId),
          vault: config?.vault ?? null,
          usdc: config?.usdc ?? null,
        };
      },
    );
    renderScreen({ vaults: registryRails });

    expect(
      screen.getAllByRole('button', {
        name: /allocate into morpho usdc vault/i,
      }),
    ).toHaveLength(MORPHO_VAULT_CHAIN_IDS.length);
    for (const chainId of MORPHO_VAULT_CHAIN_IDS) {
      expect(
        screen.getByText(`Morpho USDC vault · ${morphoChainName(chainId)}`),
      ).toBeInTheDocument();
    }
  });

  it('locks Allocate when the resident has no Safe recorded', () => {
    renderScreen({ safeAddress: null });
    const dialog = openDialog(MORPHO_ETHEREUM);
    const button = confirmButton(dialog);
    expect(button).toBeDisabled();
    // The lock says what is actually missing; it must not claim a deployment.
    expect(button).toHaveAttribute(
      'title',
      'No Safe is recorded for this account yet',
    );
  });

  it('enables Allocate for a recorded Safe that is not yet deployed on the deposit chain', () => {
    // The recorded Safe can still be counterfactual on the deposit chain (its
    // record status is `predicted`). The server verifies the derived address
    // there and the first sponsored user operation deploys it, so deployment
    // state must not lock the control.
    renderScreen();
    const dialog = openDialog(MORPHO_ETHEREUM);
    const button = confirmButton(dialog);
    expect(button).toBeEnabled();
    expect(button.getAttribute('title') ?? '').not.toMatch(/deployed/i);
  });

  it('locks Allocate for a malformed or zero amount', () => {
    renderScreen();
    const dialog = openDialog(MORPHO_ETHEREUM);
    const input = within(dialog).getByLabelText(/amount to allocate/i);

    for (const bad of ['0', '-5', 'abc', '1.1234567', '']) {
      fireEvent.change(input, { target: { value: bad } });
      expect(confirmButton(dialog)).toBeDisabled();
    }
  });

  it('enables Allocate when the vault, Safe and amount are all present', () => {
    renderScreen();
    const dialog = openDialog(MORPHO_ETHEREUM);
    expect(confirmButton(dialog)).toBeEnabled();
  });
});

describe('InvestScreen allocate flow', () => {
  it('runs begin → passkey → complete in order', async () => {
    hoisted.beginDeposit.mockResolvedValue(READY);
    renderScreen();
    const dialog = openDialog(MORPHO_ETHEREUM);
    fireEvent.change(within(dialog).getByLabelText(/amount to allocate/i), {
      target: { value: '1500.5' },
    });

    await clickAllocate(dialog);

    await waitFor(() => expect(hoisted.completeDeposit).toHaveBeenCalledTimes(1));

    expect(hoisted.beginDeposit).toHaveBeenCalledWith({
      safeAddress: SAFE,
      amountUsdc: '1500.5',
      chainId: 1,
    });
    // The browser signs the server's hash with the stored credential, against
    // this page's own host as the relying party.
    expect(hoisted.promptPasskeyAssertionParts).toHaveBeenCalledWith({
      credentialId: CREDENTIAL_ID,
      challenge: HASH,
      rpId: window.location.hostname,
    });
    // The client sends only the token, the three assertion parts and the chain
    // the server built for.
    expect(hoisted.completeDeposit).toHaveBeenCalledWith({
      token: TOKEN,
      assertion: ASSERTION,
      chainId: 1,
    });
  });

  it('prepares the deposit for the row’s own chain, not the default one', async () => {
    renderScreen();
    // Open the Base investment row directly. Its deposit must be built for Base
    // (8453), never the default Ethereum rail.
    const dialog = openDialog(MORPHO_BASE);
    hoisted.beginDeposit.mockResolvedValue({ ...READY, chainId: 8453 });

    await clickAllocate(dialog);

    await waitFor(() => expect(hoisted.completeDeposit).toHaveBeenCalledTimes(1));
    expect(hoisted.beginDeposit).toHaveBeenCalledWith({
      safeAddress: SAFE,
      amountUsdc: '10000',
      chainId: 8453,
    });
    expect(hoisted.completeDeposit).toHaveBeenCalledWith({
      token: TOKEN,
      assertion: ASSERTION,
      chainId: 8453,
    });
    // The success copy names the chain the deposit landed on, not Ethereum.
    expect(
      await within(dialog).findByText(/receipt confirmed on Base/i),
    ).toBeInTheDocument();
  });

  it('prepares the Arbitrum investment for Arbitrum One', async () => {
    renderScreen();
    const dialog = openDialog(MORPHO_ARBITRUM);
    hoisted.beginDeposit.mockResolvedValue({ ...READY, chainId: 42161 });

    await clickAllocate(dialog);

    await waitFor(() => expect(hoisted.completeDeposit).toHaveBeenCalledTimes(1));
    expect(hoisted.beginDeposit).toHaveBeenCalledWith({
      safeAddress: SAFE,
      amountUsdc: '10000',
      chainId: 42161,
    });
    expect(hoisted.completeDeposit).toHaveBeenCalledWith({
      token: TOKEN,
      assertion: ASSERTION,
      chainId: 42161,
    });
  });

  it('reports a confirmed deposit only after the receipt', async () => {
    hoisted.beginDeposit.mockResolvedValue(READY);
    renderScreen();
    const dialog = openDialog(MORPHO_ETHEREUM);

    await clickAllocate(dialog);

    expect(
      await within(dialog).findByText(/deposit submitted/i),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/receipt confirmed/i),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('0xfeed')).toBeInTheDocument();
  });

  it('reports a gated build with the server reason, without prompting the passkey', async () => {
    renderScreen();
    const dialog = openDialog(MORPHO_ETHEREUM);

    await clickAllocate(dialog);

    expect(await within(dialog).findByText(/deposit gated/i)).toBeInTheDocument();
    // The server's refusal reason reaches the screen; a refusal is never
    // swallowed or replaced with a generic message.
    expect(
      within(dialog).getByText(/ethereum rail is not configured/i),
    ).toBeInTheDocument();
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
    const dialog = openDialog(MORPHO_ETHEREUM);

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
    const dialog = openDialog(MORPHO_ETHEREUM);

    await clickAllocate(dialog);

    expect(await within(dialog).findByText(/deposit failed/i)).toBeInTheDocument();
    expect(within(dialog).getByText('sign')).toBeInTheDocument();
    expect(within(dialog).getByText(/nothing was sent/i)).toBeInTheDocument();
    expect(within(dialog).queryByText(/deposit submitted/i)).toBeNull();
  });

  it('puts the wired Morpho investments first and disables the instrument with no execution path', () => {
    renderScreen();
    const buttons = screen.getAllByRole('button', { name: /allocate into/i });
    // One button per investment, in order: the three Morpho rails, then USDY.
    expect(buttons).toHaveLength(EXPECTED_INSTRUMENTS.length);
    for (const [index, name] of MORPHO_INSTRUMENTS.entries()) {
      expect(buttons[index]).toHaveAccessibleName(
        new RegExp(`allocate into ${name}`, 'i'),
      );
      expect(buttons[index]).toBeEnabled();
    }
    const usdy = buttons[buttons.length - 1];
    expect(usdy).toHaveAccessibleName(/allocate into ondo usdy/i);
    expect(usdy).toBeDisabled();
  });
});

/** Capture what the copy buttons write to the clipboard. */
function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

describe('InvestScreen transaction modal', () => {
  it('shows an in-flight status while confirming, then the finish state', async () => {
    hoisted.beginDeposit.mockResolvedValue(READY);
    let resolveComplete!: (value: unknown) => void;
    hoisted.completeDeposit.mockReturnValue(
      new Promise((resolve) => {
        resolveComplete = resolve;
      }),
    );

    renderScreen();
    const dialog = openDialog(MORPHO_ETHEREUM);
    await clickAllocate(dialog);
    await waitFor(() => expect(hoisted.completeDeposit).toHaveBeenCalledTimes(1));

    // In flight: the user can see it is not finished, and success is not claimed.
    const status = within(dialog).getByRole('status');
    expect(status).toHaveTextContent(/confirming the deposit/i);
    expect(within(status).getByRole('progressbar')).toBeInTheDocument();
    expect(within(dialog).queryByTestId('invest-deposit-complete')).toBeNull();
    expect(within(dialog).queryByText(/receipt confirmed/i)).toBeNull();

    resolveComplete({
      status: 'sent',
      sent: true,
      userOperationHash: `0x${'fe'.repeat(32)}`,
      transactionHash: HASH,
    });

    expect(
      await within(dialog).findByText(/receipt confirmed/i),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('progressbar')).toBeNull();
  });

  it('links the confirmed deposit to Etherscan and copies the full values', async () => {
    const writeText = stubClipboard();
    hoisted.beginDeposit.mockResolvedValue(READY);
    hoisted.completeDeposit.mockResolvedValue({
      status: 'sent',
      sent: true,
      userOperationHash: `0x${'fe'.repeat(32)}`,
      transactionHash: HASH,
    });

    renderScreen();
    const dialog = openDialog(MORPHO_ETHEREUM);
    await clickAllocate(dialog);

    const finish = await within(dialog).findByTestId('invest-deposit-complete');

    const txLink = within(finish).getByRole('link', {
      name: /transaction hash on the block explorer/i,
    });
    expect(txLink).toHaveAttribute('href', `https://etherscan.io/tx/${HASH}`);
    expect(txLink).toHaveAttribute('target', '_blank');
    expect(txLink).toHaveAttribute('rel', 'noopener noreferrer');

    // The full vault address is recoverable and copyable, not just truncated.
    expect(within(finish).getByTitle(VAULT)).toBeInTheDocument();
    const vaultCopy = within(finish).getByRole('button', {
      name: /copy MetaMorpho vault address/i,
    });
    // The copy control is icon-only: it carries no visible text.
    expect(vaultCopy.textContent).toBe('');
    fireEvent.click(vaultCopy);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(VAULT));
    // The copied state is announced by the accessible name, not colour alone.
    expect(
      within(finish).getByRole('button', {
        name: 'Copied MetaMorpho vault address',
      }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(finish).getByRole('button', { name: /copy transaction hash/i }),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(HASH));
    expect(
      within(finish).getByRole('button', { name: 'Copied transaction hash' }),
    ).toBeInTheDocument();
  });

  it('points the deposit link at the chain the vault is on', async () => {
    // A Base-only rail: the row is Base, so the confirmed link must point at
    // Basescan, not Etherscan.
    hoisted.beginDeposit.mockResolvedValue({ ...READY, chainId: 8453 });
    hoisted.completeDeposit.mockResolvedValue({
      status: 'sent',
      sent: true,
      userOperationHash: `0x${'fe'.repeat(32)}`,
      transactionHash: HASH,
    });

    renderScreen({ vaults: [BASE_RAIL] });
    const dialog = openDialog(MORPHO_BASE);
    await clickAllocate(dialog);

    const finish = await within(dialog).findByTestId('invest-deposit-complete');
    expect(
      within(finish).getByRole('link', {
        name: /transaction hash on the block explorer/i,
      }),
    ).toHaveAttribute('href', `https://basescan.org/tx/${HASH}`);
  });

  it('does not invent a transaction link when no transaction hash was reported', async () => {
    hoisted.beginDeposit.mockResolvedValue(READY);
    hoisted.completeDeposit.mockResolvedValue({
      status: 'sent',
      sent: true,
      userOperationHash: `0x${'fe'.repeat(32)}`,
      transactionHash: null,
    });

    renderScreen();
    const dialog = openDialog(MORPHO_ETHEREUM);
    await clickAllocate(dialog);

    const finish = await within(dialog).findByTestId('invest-deposit-complete');
    expect(within(finish).getByText(/not reported/i)).toBeInTheDocument();
    expect(
      within(finish).queryByRole('link', { name: /transaction hash/i }),
    ).toBeNull();
  });
});
