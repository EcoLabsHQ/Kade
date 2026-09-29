import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { EvmAddressRecord } from '@/lib/wealth/types';

/**
 * A connected wallet's failed balance read is named on the connected-wallet
 * surface, never dropped and never turned into a fabricated zero.
 *
 * A connected account is read through the same server action a pasted address
 * uses. That action folds a chain's failed USDC sub-read (`tokenFailure`) and a
 * whole-chain failure into the record's `readError`, exactly as it does for the
 * Holdings and onboarding surfaces that already name it. The panel receives that
 * `readError`; this file pins that it also *renders* the specific reason for the
 * wallet the resident is looking at, and that a successful read stays unchanged.
 *
 * The AppKit/wagmi hooks and the server action are mocked, so no network and no
 * provider are involved. The panel is rendered without a save handler, so the
 * connected wallet stays live and its row is what the resident sees.
 */

const hoisted = vi.hoisted(() => ({
  open: vi.fn(),
  appKitOpen: false,
  connections: [] as Array<{
    connector: { uid: string; id?: string; name?: string };
    accounts: string[];
  }>,
  disconnect: vi.fn(),
  readAddressBalances: vi.fn(),
  signMessageAsync: vi.fn(),
}));

vi.mock('@reown/appkit/react', () => ({
  useAppKit: () => ({ open: hoisted.open }),
  useAppKitState: () => ({ open: hoisted.appKitOpen }),
}));
vi.mock('wagmi', () => ({
  useConnections: () => hoisted.connections,
  useDisconnect: () => ({ disconnect: hoisted.disconnect }),
  useSignMessage: () => ({ signMessageAsync: hoisted.signMessageAsync }),
}));
vi.mock('@/app/onboarding/wallet-actions', () => ({
  readAddressBalances: hoisted.readAddressBalances,
}));

import { ConnectedWalletPanel } from '@/components/wallet/ConnectedWalletPanel';
import { WealthStep } from '@/components/onboarding/WealthStep';
import type { ConnectedWalletSummary } from '@/lib/wealth/summary';

const ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const META_MASK = { uid: 'uid-metaMask', id: 'metaMask', name: 'MetaMask' };

const TOKEN_FAILURE = {
  chainId: 8453,
  chainName: 'Base',
  reason: 'rejected' as const,
  message:
    'Base (chain 8453): the balance provider is rate limiting this read (HTTP 429).',
};

const WHOLE_CHAIN_FAILURE = {
  chainId: 1,
  chainName: 'Ethereum',
  reason: 'timeout' as const,
  message:
    'Ethereum (chain 1): the balance provider did not respond in time. The endpoint may be overloaded.',
};

/** A record in the shape the server action returns. */
function record(overrides: Partial<EvmAddressRecord>): EvmAddressRecord {
  return {
    address: ADDRESS,
    chains: [],
    usd: null,
    readAt: null,
    readError: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.appKitOpen = false;
  hoisted.connections = [{ connector: META_MASK, accounts: [ADDRESS] }];
});

afterEach(cleanup);

/** Render the panel with one live connection and wait for its read to settle. */
async function renderPanel(recordToReturn: EvmAddressRecord) {
  hoisted.readAddressBalances.mockResolvedValue(recordToReturn);
  render(<ConnectedWalletPanel configured onChange={() => {}} />);
  await waitFor(() =>
    expect(hoisted.readAddressBalances).toHaveBeenCalledWith(ADDRESS),
  );
}

describe('ConnectedWalletPanel — a failed balance read is named, never silent', () => {
  it('names the specific reason for a failed USDC sub-read', async () => {
    await renderPanel(
      record({
        chains: [
          {
            chainId: 8453,
            name: 'Base',
            nativeSymbol: 'ETH',
            nativeAmount: '1.000000',
            nativeUsd: 3000,
            usdc: null,
            tokenFailure: TOKEN_FAILURE,
            usd: 3000,
          },
        ],
        usd: 3000,
        readError: TOKEN_FAILURE.message,
      }),
    );

    // The token sub-read failed: its specific reason is named, with the same
    // `USDC —` wording the Holdings verification modal uses.
    expect(await screen.findByText(/rate limiting this read/)).toBeInTheDocument();
    expect(screen.getByText(/USDC —/)).toBeInTheDocument();
    // No fabricated zero for the token that could not be read.
    expect(screen.queryByText(/\$0\b/)).toBeNull();
    expect(screen.queryByText(/0\.000000 USDC/)).toBeNull();
  });

  it('names the specific reason when the whole chain read failed', async () => {
    await renderPanel(
      record({ chains: [], usd: null, readError: WHOLE_CHAIN_FAILURE.message }),
    );

    expect(
      await screen.findByText(/did not respond in time/),
    ).toBeInTheDocument();
    // A whole-chain failure is not shown as a zero balance either.
    expect(screen.queryByText(/\$0\b/)).toBeNull();
  });

  it('leaves a successful connected wallet unchanged and shows no reason', async () => {
    await renderPanel(
      record({
        chains: [
          {
            chainId: 1,
            name: 'Ethereum',
            nativeSymbol: 'ETH',
            nativeAmount: '1.000000',
            nativeUsd: 2500,
            usdc: { symbol: 'USDC', amount: '10.000000', usd: 10 },
            usd: 2510,
          },
        ],
        usd: 2510,
        readAt: '2026-09-21T00:00:00Z',
      }),
    );

    // The wallet is connected as before, with no failure note.
    expect(
      await screen.findByRole('button', { name: 'Disconnect' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/USDC —/)).toBeNull();
    expect(screen.queryByText(/rate limiting|did not respond/)).toBeNull();
    expect(screen.queryByText(/\$0\b/)).toBeNull();
  });
});

/**
 * Step 3's connected-wallet list must carry the same reason: the summary is the
 * connected-wallet list, and dropping the failure there is what made it
 * invisible on the step even after the panel learned to render it.
 */
function renderWealth(connectedWallets: readonly ConnectedWalletSummary[]) {
  return render(
    <WealthStep
      walletConfigured={false}
      connectedWallets={connectedWallets}
      onWalletChange={() => {}}
      onContinue={() => {}}
      onBack={() => {}}
      tierName="3-year"
      tierMinimum={280000}
      bitcoinAddresses={[]}
      onAddBitcoin={() => {}}
      onRemoveBitcoin={() => {}}
      evmAddresses={[]}
      onAddWalletAddress={() => {}}
      onRemoveWalletAddress={() => {}}
      onSaveConnectedWallet={() => {}}
    />,
  );
}

describe('Step 3 — a connected wallet\'s failed USDC sub-read reaches the list', () => {
  it('names the reason in the connected-wallet list and fabricates no zero', () => {
    renderWealth([
      {
        address: ADDRESS,
        usd: 3000,
        chains: [
          {
            chainId: 8453,
            name: 'Base',
            nativeSymbol: 'ETH',
            nativeAmount: '1.000000',
            nativeUsd: 3000,
            usdc: null,
            tokenFailure: TOKEN_FAILURE,
            usd: 3000,
          },
        ],
        readError: TOKEN_FAILURE.message,
      },
    ]);

    expect(screen.getByText(/rate limiting this read/)).toBeInTheDocument();
    expect(screen.queryByText(/\$0\b/)).toBeNull();
    expect(screen.queryByText(/0\.000000 USDC/)).toBeNull();
  });

  it('names a whole-chain failure and shows no fabricated $0 total', () => {
    renderWealth([
      {
        address: ADDRESS,
        usd: null,
        chains: [],
        readError: WHOLE_CHAIN_FAILURE.message,
      },
    ]);

    // The specific reason is named in the list…
    expect(screen.getByText(/did not respond in time/)).toBeInTheDocument();
    // …and the unread wallet is not summed into a fabricated zero balance.
    expect(screen.queryByText(/\$0\b/)).toBeNull();
  });
});
