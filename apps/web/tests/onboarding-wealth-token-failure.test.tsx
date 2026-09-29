import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WealthStep } from '@/components/onboarding/WealthStep';
import type { EvmAddressRecord } from '@/lib/wealth/types';

/**
 * Step 3 must not hide a failed USDC sub-read.
 *
 * A chain's native read can succeed while its USDC sub-read fails. `evm.ts`
 * carries that failure on the chain as `tokenFailure`, and the server action
 * folds it into the record's `readError` exactly as the Holdings surface does.
 * The onboarding step must therefore mark the token with an explicit `—` and
 * name the specific reason — never silently omit the figure and never fabricate
 * a zero. A successful read stays unchanged.
 *
 * The component is rendered with `walletConfigured={false}`, so the wallet panel
 * takes its hook-free path and no AppKit/wagmi provider is needed.
 */

const ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';

const TOKEN_FAILURE = {
  chainId: 8453,
  chainName: 'Base',
  reason: 'rejected' as const,
  message:
    'Base (chain 8453): the balance provider is rate limiting this read (HTTP 429).',
};

/** The record exactly as the server action returns it: failure folded in. */
function record(overrides: Partial<EvmAddressRecord> = {}): EvmAddressRecord {
  return {
    address: ADDRESS,
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
    readAt: null,
    readError: TOKEN_FAILURE.message,
    ...overrides,
  };
}

function renderWealth(addresses: readonly EvmAddressRecord[]) {
  return render(
    <WealthStep
      walletConfigured={false}
      connectedWallets={[]}
      onWalletChange={() => {}}
      onContinue={() => {}}
      onBack={() => {}}
      tierName="3-year"
      tierMinimum={280000}
      bitcoinAddresses={[]}
      onAddBitcoin={() => {}}
      onRemoveBitcoin={() => {}}
      evmAddresses={addresses}
      onAddWalletAddress={() => {}}
      onRemoveWalletAddress={() => {}}
      onSaveConnectedWallet={() => {}}
    />,
  );
}

describe('WealthStep — a failed USDC sub-read is shown, not hidden', () => {
  it('shows the specific token reason and an explicit — for the unread token', () => {
    renderWealth([record()]);

    // The chain's native read is real and still shown.
    expect(screen.getByText(/Base · 1\.000000 ETH/)).toBeInTheDocument();
    // The token is not silently omitted: an explicit dash marks it unread…
    expect(screen.getByText(/USDC —/)).toBeInTheDocument();
    // …and the specific reason is named rather than a generic dead end.
    expect(screen.getByText(/rate limiting this read/)).toBeInTheDocument();
    // No fabricated zero for the token that could not be read.
    expect(screen.queryByText('0.000000 USDC')).toBeNull();
    expect(screen.queryByText('$0')).toBeNull();
  });

  it('leaves a successful token read unchanged and shows no token reason', () => {
    renderWealth([
      record({
        chains: [
          {
            chainId: 8453,
            name: 'Base',
            nativeSymbol: 'ETH',
            nativeAmount: '1.000000',
            nativeUsd: 3000,
            usdc: { symbol: 'USDC', amount: '183.500000', usd: 183.5 },
            usd: 3183.5,
          },
        ],
        usd: 3183.5,
        readError: null,
      }),
    ]);

    expect(screen.getByText(/183\.500000 USDC/)).toBeInTheDocument();
    expect(screen.queryByText(/USDC —/)).toBeNull();
    expect(screen.queryByText(/rate limiting/)).toBeNull();
  });
});
