'use client';

import { useRouter } from 'next/navigation';
import type { HoldingsAggregate } from '@/lib/wealth/holdings';
import { HoldingsScreen } from './HoldingsScreen';
import { LinkedWalletSection } from './LinkedWalletSection';
import { VerifyUnverifiedWallet } from './VerifyUnverifiedWallet';
import type { WalletLinkPanelProps } from './WalletLinkPanel';

/**
 * The client half of Holdings: it binds the browser-only machinery (the
 * wallet-connection context, the signature, `router.refresh()`) to the
 * presentational `HoldingsScreen`, so the screen itself stays prop-driven and
 * testable without a wallet.
 *
 * Two injected pieces:
 *
 *  - `linkPanel` — the free-form "Link a wallet" panel, via
 *    `LinkedWalletSection`, which binds its own refresh on success.
 *  - `renderVerify` — the per-row Verify affordance for an unverified wallet.
 *    When wallet connection is not configured it renders a locked control
 *    instead, so no AppKit/wagmi hook is ever reached on that path.
 */
export interface HoldingsViewProps {
  readonly aggregate: HoldingsAggregate;
  readonly safeAddress: string | null;
  readonly configured: boolean;
  readonly onBegin: WalletLinkPanelProps['onBegin'];
  readonly onComplete: WalletLinkPanelProps['onComplete'];
}

export function HoldingsView({
  aggregate,
  safeAddress,
  configured,
  onBegin,
  onComplete,
}: HoldingsViewProps) {
  const router = useRouter();

  return (
    <HoldingsScreen
      aggregate={aggregate}
      safeAddress={safeAddress}
      linkPanel={
        <LinkedWalletSection
          configured={configured}
          onBegin={onBegin}
          onComplete={onComplete}
        />
      }
      renderVerify={(wallet) => (
        <VerifyUnverifiedWallet
          wallet={wallet}
          configured={configured}
          onBegin={onBegin}
          onComplete={onComplete}
          onLinked={() => router.refresh()}
        />
      )}
    />
  );
}
