'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { HoldingsAggregate } from '@/lib/wealth/holdings';
import { HoldingsScreen, type MoveToVaultTarget } from './HoldingsScreen';
import { MoveToVaultDialog } from './MoveToVaultDialog';
import { VerifyWalletsModal } from './VerifyWalletsModal';
import type { OwnershipCallbacks } from '@/lib/wallet/ownership-callbacks';

/**
 * The client half of Holdings: it binds the browser-only machinery (AppKit, the
 * signature, `router.refresh()`) to the presentational `HoldingsScreen`, so the
 * screen stays prop-driven and testable without a wallet.
 *
 * Two injected controls. `renderVerifyWallets` renders the "Verify wallets"
 * button and the modal behind it: the modal owns the whole per-wallet flow —
 * connect, persist, sign, disconnect — because linking and signing are one
 * gesture. `onMoveToVault` receives the clicked row and opens the
 * `MoveToVaultDialog`, which owns the connect → sign → send flow for moving that
 * row's token into the resident's Safe. The screen stays presentational; each
 * dialog is gated on `configured` inside itself, so the unconfigured path
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
  // The row whose dialog is open. The screen hands the row up; this client half
  // owns the wallet machinery behind it, exactly like `renderVerifyWallets`.
  const [moveTarget, setMoveTarget] = useState<MoveToVaultTarget | null>(null);

  return (
    <>
      <HoldingsScreen
        aggregate={aggregate}
        safeAddress={safeAddress}
        onMoveToVault={setMoveTarget}
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
      {moveTarget ? (
        <MoveToVaultDialog
          configured={configured}
          target={moveTarget}
          safeAddress={safeAddress}
          onClose={() => setMoveTarget(null)}
          onDone={refresh}
        />
      ) : null}
    </>
  );
}
