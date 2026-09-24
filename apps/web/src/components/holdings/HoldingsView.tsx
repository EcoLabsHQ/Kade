'use client';

import { useRouter } from 'next/navigation';
import type { HoldingsAggregate } from '@/lib/wealth/holdings';
import { HoldingsScreen } from './HoldingsScreen';
import { VerifyWalletsModal } from './VerifyWalletsModal';
import type { OwnershipCallbacks } from './ownership-callbacks';

/**
 * The client half of Holdings: it binds the browser-only machinery (AppKit, the
 * signature, `router.refresh()`) to the presentational `HoldingsScreen`, so the
 * screen stays prop-driven and testable without a wallet.
 *
 * One injected control: `renderVerifyWallets` renders the "Verify wallets"
 * button and the modal behind it. The modal owns the whole per-wallet flow —
 * connect, persist, sign, disconnect — because linking and signing are one
 * gesture: a resident who links a wallet it has not listed yet verifies it in
 * the same pass.
 *
 * The modal is gated on `configured` inside itself, so the unconfigured path
 * renders static markup and reaches no AppKit/wagmi hook.
 */
export interface HoldingsViewProps {
  readonly aggregate: HoldingsAggregate;
  readonly safeAddress: string | null;
  readonly configured: boolean;
  readonly onBegin: OwnershipCallbacks['onBegin'];
  readonly onComplete: OwnershipCallbacks['onComplete'];
  /** `addConnectedWallet`: persist an address as a connected-wallet row. */
  readonly onAddConnectedWallet: (address: string) => Promise<unknown>;
}

export function HoldingsView({
  aggregate,
  safeAddress,
  configured,
  onBegin,
  onComplete,
  onAddConnectedWallet,
}: HoldingsViewProps) {
  const router = useRouter();
  const refresh = () => router.refresh();

  return (
    <HoldingsScreen
      aggregate={aggregate}
      safeAddress={safeAddress}
      renderVerifyWallets={() => (
        <VerifyWalletsModal
          configured={configured}
          wallets={aggregate.unverifiedWallets}
          onAddConnectedWallet={onAddConnectedWallet}
          onBegin={onBegin}
          onComplete={onComplete}
          onLinked={refresh}
        />
      )}
    />
  );
}
