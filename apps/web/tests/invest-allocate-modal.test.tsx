import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { InvestScreen } from '@/components/invest/InvestScreen';
import type { InvestVaultSummary } from '@/app/invest/actions';
import type { VaultHoldingRow } from '@/lib/wealth/vault-holdings';
import {
  MIN_ALLOCATION_USDC,
  defaultAllocationUsdc,
  minimumAllocationLabel,
} from '@/lib/invest/allocation-minimum';
import {
  MORPHO_API_URL,
  MORPHO_YIELD_CACHE_SECONDS,
  readMorphoVaultYield,
  type MorphoYieldRead,
} from '@/lib/invest/morpho-yield';

/**
 * The allocate modal's **minimum** and **Morpho income estimate** (T44).
 *
 * Three owner-facing changes are pinned here, all **offline** (no network):
 *
 *   1. the modal renders the reference's panel metrics — its `440px` width and
 *      its mutable surface — with an assertion on the rendered values;
 *   2. the minimum is `$1`, and the column and the summary box state the *same*
 *      figure, derived from one source of truth, so a later edit cannot make
 *      them disagree;
 *   3. the estimate is the typed amount times a yield read from Morpho, and a
 *      failed or unusable read renders `Not quoted` **with its reason** — never
 *      a number, and never a fabricated zero for an unreadable rate.
 *
 * The transaction path is untouched by these changes; a second assertion proves
 * the same two-phase deposit call is still built.
 */

const hoisted = vi.hoisted(() => ({
  beginDeposit: vi.fn(),
  completeDeposit: vi.fn(),
  beginWithdraw: vi.fn(),
  completeWithdraw: vi.fn(),
  promptPasskeyAssertionParts: vi.fn(),
}));

vi.mock('@/app/invest/actions', () => ({
  beginDeposit: hoisted.beginDeposit,
  completeDeposit: hoisted.completeDeposit,
  beginWithdraw: hoisted.beginWithdraw,
  completeWithdraw: hoisted.completeWithdraw,
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

const ETHEREUM_RAIL: InvestVaultSummary = {
  configured: true,
  chainId: 1,
  chainName: 'Ethereum',
  vault: VAULT,
  usdc: USDC,
};
const RAILS: readonly InvestVaultSummary[] = [ETHEREUM_RAIL];

const MORPHO_ETHEREUM = 'Morpho USDC vault · Ethereum';

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

type ScreenOverrides = {
  readonly holdings?: readonly VaultHoldingRow[];
  readonly safeAddress?: string | null;
  readonly yields?: ReadonlyMap<number, MorphoYieldRead>;
};

function renderScreen(overrides: ScreenOverrides = {}) {
  return render(
    <InvestScreen
      vaults={RAILS}
      safeAddress={
        overrides.safeAddress === undefined ? SAFE : overrides.safeAddress
      }
      holdings={overrides.holdings ?? []}
      yields={overrides.yields}
    />,
  );
}

function openDialog(name = MORPHO_ETHEREUM): HTMLElement {
  fireEvent.click(
    screen.getByRole('button', {
      name: new RegExp(`allocate into ${name}`, 'i'),
    }),
  );
  return screen.getByRole('dialog');
}

/** The row cell in the instrument table that states the minimum. */
function tableMinimumCell(): HTMLElement {
  // The row's own minimum cell, addressed through the row rather than a global
  // text query so the table surface is what is asserted (the summary box states
  // the same figure; the header cell states the word "Minimum").
  const row = screen.getByTestId('invest-row-morpho-1');
  return within(row).getByText('$1');
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Invest allocate modal: the reference metrics', () => {
  it('renders the panel at the reference’s width, radius and mutable surface', () => {
    renderScreen();
    const dialog = openDialog();
    const card = dialog as HTMLElement;

    // The reference's allocate panel: `max-width: 440px`, `border-radius: 18px`
    // on a mutable (`#fff`) card.
    expect(card.style.maxWidth).toBe('440px');
    expect(card.style.borderRadius).toBe('18px');
    expect(card.style.background).toBe('rgb(255, 255, 255)');
  });

  it('matches the reference’s header and body metrics inside the panel', () => {
    renderScreen();
    const dialog = openDialog();

    // The body carries the reference's 22px padding.
    const body = dialog.firstElementChild?.nextElementSibling as HTMLElement;
    expect(body.style.padding).toBe('22px');

    // The instrument name is the reference's 15px / 700.
    const name = within(dialog).getByText('Morpho USDC vault · Ethereum');
    expect(name.style.fontSize).toBe('15px');
    expect(name.style.fontWeight).toBe('700');

    // The venue · terms line is the reference's 12px, 4px under the name.
    const venue = within(dialog).getByText(/MetaMorpho · USDC vault · Variable/);
    expect(venue.style.fontSize).toBe('12px');
    expect(venue.style.marginTop).toBe('4px');

    // The "Settles on" chip is the reference's 11.5px, `3px 9px`.
    const chip = within(dialog).getByText('Settles on').parentElement as HTMLElement;
    expect(chip.style.fontSize).toBe('11.5px');
    expect(chip.style.padding).toBe('3px 9px');
    expect(chip.style.borderRadius).toBe('999px');
  });
});

describe('Invest allocate modal: the $1 minimum is consistent', () => {
  it('states $1 in the summary box and in the instrument table', () => {
    renderScreen();
    const dialog = openDialog();
    const summary = within(dialog).getByTestId('invest-allocate-summary');

    // Both surfaces state the same one figure.
    expect(summary).toHaveTextContent('$1');
    expect(tableMinimumCell()).toHaveTextContent('$1');

    // And no surface still states the old `$100`.
    expect(screen.queryByText('$100')).toBeNull();
  });

  it('derives every surface from the one source of truth', () => {
    // The constant and the label cannot disagree, and the label is the exact
    // string the modal and the table render.
    expect(minimumAllocationLabel()).toBe(`$${MIN_ALLOCATION_USDC}`);
    expect(minimumAllocationLabel()).toBe('$1');
    // The seeded default never falls below the minimum.
    expect(defaultAllocationUsdc()).toBeGreaterThanOrEqual(MIN_ALLOCATION_USDC);
  });
});

describe('Invest allocate modal: income estimated from Morpho', () => {
  it('computes the estimate as the typed amount times an injected yield', () => {
    // A known vault rate of 5% (Morpho returns a fraction), injected directly:
    // no network is touched.
    renderScreen({
      yields: new Map([[1, { status: 'known', netApy: 0.05 }]]),
    });
    const dialog = openDialog();

    fireEvent.change(within(dialog).getByLabelText(/amount to allocate/i), {
      target: { value: '500' },
    });

    // $500 × 5% = $25 / yr est. — a real derivation from the injected rate.
    expect(within(dialog).getByTestId('invest-summary-income')).toHaveTextContent(
      '$25 / yr est.',
    );
  });

  it('shows a real $0 for a genuine zero rate, not “Not quoted”', () => {
    renderScreen({ yields: new Map([[1, { status: 'known', netApy: 0 }]]) });
    const dialog = openDialog();
    fireEvent.change(within(dialog).getByLabelText(/amount to allocate/i), {
      target: { value: '500' },
    });

    // A zero rate is a real fact: the estimate is legitimately $0.
    expect(within(dialog).getByTestId('invest-summary-income')).toHaveTextContent(
      '$0 / yr est.',
    );
  });

  it('renders Not quoted with the specific reason when the read failed', () => {
    const reason = 'Morpho answered HTTP 503 for this vault’s yield.';
    renderScreen({
      yields: new Map([[1, { status: 'unknown', reason }]]),
    });
    const dialog = openDialog();
    fireEvent.change(within(dialog).getByLabelText(/amount to allocate/i), {
      target: { value: '500' },
    });

    const income = within(dialog).getByTestId('invest-summary-income');
    expect(income).toHaveTextContent('Not quoted');
    // The value carries the specific reason, never a numeric figure.
    expect(income).toHaveAttribute('title', reason);
    expect(income.textContent).not.toMatch(/\$/);
  });

  it('renders Not quoted when no yield was injected for the rail at all', () => {
    renderScreen();
    const dialog = openDialog();

    const income = within(dialog).getByTestId('invest-summary-income');
    expect(income).toHaveTextContent('Not quoted');
    expect(income.textContent).not.toMatch(/\$/);
    expect(income.getAttribute('title')).toMatch(/no morpho yield/i);
  });
});

describe('readMorphoVaultYield: bounded, cached, honest', () => {
  it('asks Morpho for the pinned vault, with the vault address as the variable', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { vaultByAddress: { address: VAULT, state: { netApy: 0.047 } } },
      }),
    } as Response);

    const read = await readMorphoVaultYield(1, fetchImpl as unknown as typeof fetch);

    expect(read).toEqual({ status: 'known', netApy: 0.047 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0] as [string, RequestInit];
    const [url, init] = call;
    expect(url).toBe(MORPHO_API_URL);
    // Cached for a bounded interval, not per-render; the request is a POST with
    // the pinned vault as the variable, never a caller-supplied address.
    expect(init?.next).toEqual({ revalidate: MORPHO_YIELD_CACHE_SECONDS });
    const variables = JSON.parse(init?.body as string).variables;
    expect(variables.chainId).toBe(1);
    // The variable is *a* vault address resolved from the frozen registry; this
    // test's rail is a local literal, so assert only its shape and non-emptiness.
    expect(variables.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('is honest on a non-200 response, a non-JSON body and a malformed rate', async () => {
    const notOk = vi.fn().mockResolvedValue({ ok: false, status: 503 } as Response);
    expect(await readMorphoVaultYield(1, notOk as unknown as typeof fetch)).toEqual({
      status: 'unknown',
      reason: expect.stringContaining('HTTP 503'),
    });

    const notJson = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);
    expect(
      await readMorphoVaultYield(1, notJson as unknown as typeof fetch),
    ).toEqual({ status: 'unknown', reason: expect.stringContaining('not valid JSON') });

    const malformed = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { vaultByAddress: { state: { netApy: '5%' } } } }),
    } as Response);
    const read = await readMorphoVaultYield(
      1,
      malformed as unknown as typeof fetch,
    );
    expect(read.status).toBe('unknown');
    // Never a coerced, guessed number.
    expect(read).not.toHaveProperty('netApy');
  });

  it('never invents a rate when the read throws or the chain has no pinned vault', async () => {
    const offline = vi.fn().mockRejectedValue(new Error('offline'));
    const read = await readMorphoVaultYield(1, offline as unknown as typeof fetch);
    expect(read.status).toBe('unknown');
    if (read.status === 'unknown') {
      expect(read.reason).toMatch(/could not be reached/i);
    }

    const spy = vi.fn();
    const unpinned = await readMorphoVaultYield(999, spy as unknown as typeof fetch);
    expect(unpinned).toEqual({
      status: 'unknown',
      reason: expect.stringContaining('No MetaMorpho vault is pinned'),
    });
    // A chain with no pinned vault never hits the network.
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('Invest allocate modal: the transaction path is untouched', () => {
  it('still builds the same deposit call through begin → passkey → complete', async () => {
    hoisted.beginDeposit.mockResolvedValue(READY);
    hoisted.promptPasskeyAssertionParts.mockResolvedValue(ASSERTION);
    hoisted.completeDeposit.mockResolvedValue({
      status: 'sent',
      sent: true,
      userOperationHash: `0x${'fe'.repeat(32)}`,
      transactionHash: '0xfeed',
    });

    renderScreen({ yields: new Map([[1, { status: 'known', netApy: 0.05 }]]) });
    const dialog = openDialog();
    fireEvent.change(within(dialog).getByLabelText(/amount to allocate/i), {
      target: { value: '1500.5' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: /build the deposit/i }),
    );

    await vi.waitFor(() =>
      expect(hoisted.completeDeposit).toHaveBeenCalledTimes(1),
    );

    // The same three calls, with the same arguments as before this change.
    expect(hoisted.beginDeposit).toHaveBeenCalledWith({
      safeAddress: SAFE,
      amountUsdc: '1500.5',
      chainId: 1,
    });
    expect(hoisted.promptPasskeyAssertionParts).toHaveBeenCalledWith({
      credentialId: CREDENTIAL_ID,
      challenge: HASH,
      rpId: window.location.hostname,
    });
    expect(hoisted.completeDeposit).toHaveBeenCalledWith({
      token: TOKEN,
      assertion: ASSERTION,
      chainId: 1,
    });
  });
});
