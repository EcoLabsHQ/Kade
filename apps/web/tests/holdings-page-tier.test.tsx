import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { VaultHoldingRow } from '@/lib/wealth/vault-holdings';

/**
 * The Holdings page connects the resident's **recorded** tier to the
 * `QUALIFIED` card, through `HoldingsView`, so the enterprise behaviour the
 * screen already implements (`Meets the 5-year tier.`, the real shortfall, the
 * fail-closed reason) is actually reached in production rather than falling back
 * to "no tier recorded".
 *
 * The page and the Residency surface both know the tier because both read the
 * **same** application row through `loadApplicationResidencyRow`. A failed read
 * must not take the page down: it yields the honest no-tier line and the page
 * still renders.
 *
 * The real `HoldingsView` and `HoldingsScreen` render here; only the wallet
 * hooks, the router, and the server reads are mocked.
 */

const SAFE = '0x5Af1000000000000000000000000000000000c09D';

const hoisted = vi.hoisted(() => ({
  rows: [] as readonly unknown[],
  application: null as { readonly tier: string | null } | null,
  applicationError: null as Error | null,
  loadApplicationResidencyRow: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@reown/appkit/react', () => ({
  useAppKit: () => ({ open: vi.fn() }),
  useAppKitAccount: () => ({ isConnected: false, address: undefined }),
}));
vi.mock('wagmi', () => ({
  useConnections: () => [],
  useSignMessage: () => ({ signMessageAsync: vi.fn() }),
  useDisconnect: () => ({ disconnect: vi.fn(), disconnectAsync: vi.fn() }),
  useChainId: () => 1,
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
  useWriteContract: () => ({
    data: undefined,
    writeContract: vi.fn(),
    isPending: false,
    error: null,
    reset: vi.fn(),
  }),
  useSendTransaction: () => ({
    data: undefined,
    sendTransaction: vi.fn(),
    isPending: false,
    error: null,
    reset: vi.fn(),
  }),
  useWaitForTransactionReceipt: () => ({ isLoading: false, isSuccess: false }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getSessionUser: vi.fn(async () => ({
    userId: 'resident-1',
    email: 'r@example.com',
  })),
}));
vi.mock('@/lib/safe/shell', () => ({
  loadShellSafe: vi.fn(async () => ({
    address: SAFE,
    deployed: true,
    status: 'deployed',
    explorerUrl: null,
  })),
}));
vi.mock('@/lib/review/review-bar', () => ({
  loadReviewBar: vi.fn(async () => ({
    show: false,
    reference: null,
    isReviewer: false,
  })),
}));
vi.mock('@/lib/env', () => ({
  readWalletConnectProjectId: () => null,
}));
vi.mock('@/lib/wealth/vault-holdings', () => ({
  loadVaultHoldings: vi.fn(async () => hoisted.rows as readonly VaultHoldingRow[]),
}));
// The page must obtain the tier from the residency surface's own read. Mocking
// that read (and only that read) is what makes the assertion below meaningful.
vi.mock('@/lib/residency/server', () => ({
  loadApplicationResidencyRow: hoisted.loadApplicationResidencyRow,
}));
vi.mock('@/components/wallet/WalletProvider', () => ({
  WalletProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/shell/AppShell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/shell/ContentContainer', () => ({
  ContentContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/app/holdings/data', () => ({
  loadVerifiedHoldings: vi.fn(async () => ({
    total: 0,
    walletCount: 0,
    valuedCount: 0,
    unvaluedCount: 0,
    wallets: [],
    unverifiedWallets: [],
    unverifiedCount: 0,
  })),
}));
vi.mock('@/app/holdings/link-actions', () => ({
  beginWalletLink: vi.fn(),
  completeWalletLink: vi.fn(),
}));
vi.mock('@/app/onboarding/wallet-actions', () => ({
  addConnectedWallet: vi.fn(),
}));

import HoldingsPage from '@/app/holdings/page';

/** A known, readable qualified position above the 5-year minimum ($425k). */
const KNOWN_ROWS: readonly VaultHoldingRow[] = [
  {
    key: `${SAFE}:1:native`,
    kind: 'native',
    chainId: 1,
    chainName: 'Ethereum',
    symbol: 'ETH',
    name: 'Ether',
    amount: '200.000000 ETH',
    usd: 500000,
    readError: null,
  },
];

/** A read that failed on chain: the position is unknown, with its reason. */
const UNREAD_ROWS: readonly VaultHoldingRow[] = [
  {
    key: `${SAFE}:1:unread`,
    kind: 'unread',
    chainId: 1,
    chainName: 'Ethereum',
    symbol: '—',
    name: 'Ethereum',
    amount: '—',
    usd: null,
    readError: 'The vault balance on Ethereum could not be read.',
  },
];

beforeEach(() => {
  hoisted.rows = KNOWN_ROWS;
  hoisted.application = { tier: '5-year' };
  hoisted.applicationError = null;
  hoisted.loadApplicationResidencyRow.mockReset();
  hoisted.loadApplicationResidencyRow.mockImplementation(async () => {
    if (hoisted.applicationError) throw hoisted.applicationError;
    return hoisted.application;
  });
});

afterEach(() => {
  cleanup();
});

describe('HoldingsPage — the card reads the resident’s recorded tier', () => {
  it('passes the resident’s real 5-year tier through HoldingsView to the card', async () => {
    render(await HoldingsPage());

    // The derived sentence, not merely a prop: the card names the resident's
    // own tier. The old fallback would have said "No qualifying tier".
    expect(screen.getByText('Meets the 5-year tier.')).toBeInTheDocument();
    expect(screen.queryByText('Meets the 3-year tier.')).toBeNull();
    expect(screen.queryByText('No qualifying tier is recorded.')).toBeNull();
  });

  it('shows the real shortfall below the resident’s own tier', async () => {
    hoisted.application = { tier: '5-year' };
    hoisted.rows = [
      {
        ...KNOWN_ROWS[0],
        amount: '80.000000 ETH',
        usd: 200000,
      },
    ];

    render(await HoldingsPage());

    // $425,000 − $200,000, the real shortfall — never the full minimum.
    expect(
      screen.getByText('Below 5-year tier — $225,000 to go'),
    ).toBeInTheDocument();
  });

  it('claims no tier when none is recorded, rather than inventing one', async () => {
    hoisted.application = { tier: null };

    render(await HoldingsPage());

    expect(
      screen.getByText('No qualifying tier is recorded.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Meets the/)).toBeNull();
  });

  it('renders the page with the honest no-tier line when the tier read fails', async () => {
    hoisted.applicationError = new Error('database down');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Must resolve, not reject: a failed read cannot break the page.
    await expect(HoldingsPage()).resolves.toBeTruthy();
    render(await HoldingsPage());

    expect(
      screen.getByText('No qualifying tier is recorded.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Meets the/)).toBeNull();
    expect(screen.queryByText(/tier to go/)).toBeNull();
    warn.mockRestore();
  });

  it('keeps the read’s reason and makes no tier claim when the position is unknown', async () => {
    hoisted.rows = UNREAD_ROWS;

    render(await HoldingsPage());

    expect(
      screen.getByText('The vault balance on Ethereum could not be read.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Meets the/)).toBeNull();
  });
});

/**
 * Structural guard: the page must obtain the tier from the **same** read the
 * Residency surface uses, so a later edit cannot introduce a second
 * `applications` read and let the card and the residency check disagree.
 *
 * It asserts the wiring directly in source, which no behavioral mock can prove:
 * the page imports `loadApplicationResidencyRow` from `@/lib/residency/server`
 * and never queries `applications` itself; that module both exports the read and
 * uses it to build the residency snapshot's tier.
 */
describe('HoldingsPage — one source for the tier', () => {
  const page = readFileSync(
    resolve(process.cwd(), 'src/app/holdings/page.tsx'),
    'utf8',
  );
  const residencyServer = readFileSync(
    resolve(process.cwd(), 'src/lib/residency/server.ts'),
    'utf8',
  );

  it('imports the residency surface’s own tier read', () => {
    expect(page).toMatch(
      /import\s*\{[^}]*\bloadApplicationResidencyRow\b[^}]*\}\s*from\s*['"]@\/lib\/residency\/server['"]/,
    );
  });

  it('does not grow a second `applications` read of its own', () => {
    expect(page).not.toMatch(/createSupabaseServerClient/);
    expect(page).not.toMatch(/\.from\(\s*['"]applications['"]\s*\)/);
    expect(page).not.toMatch(/\btier\b\s*:/); // no `tier:` re-derivation
  });

  it('residency derives its tier from the exact read the page imports', () => {
    expect(residencyServer).toMatch(
      /export\s+async\s+function\s+loadApplicationResidencyRow\b/,
    );
    expect(residencyServer).toContain(
      'const row = await loadApplicationResidencyRow(profileId);',
    );
    expect(residencyServer).toMatch(/tier:\s*row\.tier/);
  });
});
