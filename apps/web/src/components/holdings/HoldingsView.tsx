'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { HoldingsAggregate } from '@/lib/wealth/holdings';
import type { VaultHoldingRow } from '@/lib/wealth/vault-holdings';
import type { QualifiedPosition } from '@/lib/wealth/qualified-position';
import { HoldingsScreen, type MoveToVaultTarget } from './HoldingsScreen';
import { MoveToVaultDialog } from './MoveToVaultDialog';
import { VerifyWalletsModal } from './VerifyWalletsModal';
import { useDisconnectThenAct } from '@/components/wallet/useDisconnectThenAct';
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
 * row's token into the resident's Safe. The screen stays presentational; the
 * dialogs are gated on `configured`, so the unconfigured path renders static
 * markup and reaches no AppKit/wagmi hook.
 *
 * Both entry points disconnect **before** opening their modal: clicking a row's
 * "Move to vault" tears the connected wallet down and only then opens the
 * dialog, so it always starts in its "Not connected" state and a carried-over
 * session is never reused (see `useDisconnectThenAct`). This client half owns
 * both the wallet machinery and the sequencing; `HoldingsScreen` stays
 * wallet-free.
 */
export interface HoldingsViewProps {
  readonly aggregate: HoldingsAggregate;
  readonly safeAddress: string | null;
  readonly configured: boolean;
  readonly onBegin: OwnershipCallbacks['onBegin'];
  readonly onComplete: OwnershipCallbacks['onComplete'];
  /** `addConnectedWallet`: persist an address as a connected-wallet row. */
  readonly onAddConnectedWallet: (address: string) => Promise<unknown>;
  /** The Safe's on-chain holdings, read by the server page. */
  readonly vaultHoldings?: readonly VaultHoldingRow[];
  /** The one qualified total, reduced by the server page from `vaultHoldings`. */
  readonly qualified?: QualifiedPosition;
}

export function HoldingsView({
  aggregate,
  safeAddress,
  configured,
  onBegin,
  onComplete,
  onAddConnectedWallet,
  vaultHoldings = [],
  qualified,
}: HoldingsViewProps) {
  const router = useRouter();
  const refresh = () => router.refresh();
  // The row whose dialog is open. The screen hands the row up; this client half
  // owns the wallet machinery behind it, exactly like `renderVerifyWallets`.
  const [moveTarget, setMoveTarget] = useState<MoveToVaultTarget | null>(null);

  const screen = (onMoveToVault: (target: MoveToVaultTarget) => void) => (
    <HoldingsScreen
      aggregate={aggregate}
      safeAddress={safeAddress}
      vaultHoldings={vaultHoldings}
      qualified={qualified}
      onMoveToVault={onMoveToVault}
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

  return (
    <>
      {/*
        The wallet hooks only exist where `WalletProvider` mounted a
        `WagmiProvider`. When the environment is unconfigured there is no wallet
        to disconnect, so the screen is rendered on its own and reaches no hook.
      */}
      {configured ? (
        <ConfiguredMoveTrigger onMoveToVault={setMoveTarget}>
          {screen}
        </ConfiguredMoveTrigger>
      ) : (
        screen(setMoveTarget)
      )}
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

/**
 * The configured move-to-vault trigger. It is mounted only when `WalletProvider`
 * mounted a `WagmiProvider`, so `useDisconnectThenAct` (which reads wagmi state)
 * is safe here — the same gating `FeeStep`'s `DepositControl` uses.
 *
 * Clicking a row's "Move to vault" disconnects the connected wallet first and
 * only then opens the dialog, so it always starts in its "Not connected" state
 * and a carried-over session is never reused. A failed disconnect still opens
 * the dialog.
 */
function ConfiguredMoveTrigger({
  onMoveToVault,
  children,
}: {
  readonly onMoveToVault: (target: MoveToVaultTarget) => void;
  readonly children: (onMoveToVault: (target: MoveToVaultTarget) => void) => React.ReactNode;
}) {
  const { run: disconnectThenAct } = useDisconnectThenAct();

  const openMoveToVault = useCallback(
    (target: MoveToVaultTarget) => {
      void disconnectThenAct(() => onMoveToVault(target));
    },
    [disconnectThenAct, onMoveToVault],
  );

  return <>{children(openMoveToVault)}</>;
}
