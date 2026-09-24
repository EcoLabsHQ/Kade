'use client';

import { useRouter } from 'next/navigation';
import type { HoldingsAggregate } from '@/lib/wealth/holdings';
import { ConnectAndSignAction } from './ConnectAndSignAction';
import { HoldingsScreen } from './HoldingsScreen';
import { LinkAnotherWalletButton } from './LinkAnotherWalletButton';
import type { WalletLinkPanelProps } from './WalletLinkPanel';

/**
 * The client half of Holdings: it binds the browser-only machinery (AppKit, the
 * signature, `router.refresh()`) to the presentational `HoldingsScreen`, so the
 * screen stays prop-driven and testable without a wallet.
 *
 * Two injected controls, one per row state:
 *
 *  - `renderConnectSign` — a "Connect & sign" action on every unverified row:
 *    connect the controlling wallet, sign the server-issued challenge, then
 *    disconnect.
 *  - `renderLinkAnother` — the "+ Link another wallet" action, which persists a
 *    newly connected address as an unsigned `connected-wallet` row.
 *
 * Both are gated on `configured` inside their own components, so the
 * unconfigured path reaches no AppKit/wagmi hook.
 */
export interface HoldingsViewProps {
  readonly aggregate: HoldingsAggregate;
  readonly safeAddress: string | null;
  readonly configured: boolean;
  readonly onBegin: WalletLinkPanelProps['onBegin'];
  readonly onComplete: WalletLinkPanelProps['onComplete'];
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
      renderConnectSign={(wallet) => (
        <ConnectAndSignAction
          wallet={wallet}
          configured={configured}
          onBegin={onBegin}
          onComplete={onComplete}
          onLinked={refresh}
        />
      )}
      renderLinkAnother={() => (
        <LinkAnotherWalletButton
          configured={configured}
          onAddConnectedWallet={onAddConnectedWallet}
          onLinked={refresh}
        />
      )}
    />
  );
}
