import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { ContentContainer } from '@/components/shell/ContentContainer';
import { HoldingsView } from '@/components/holdings/HoldingsView';
import { WalletProvider } from '@/components/wallet/WalletProvider';
import { addConnectedWallet } from '@/app/onboarding/wallet-actions';
import { readWalletConnectProjectId } from '@/lib/env';
import { loadReviewBar } from '@/lib/review/review-bar';
import { loadShellSafe } from '@/lib/safe/shell';
import { getSessionUser } from '@/lib/supabase/server';
import { loadVerifiedHoldings } from './data';
import { beginWalletLink, completeWalletLink } from './link-actions';

/**
 * D17 / EXE-013 — Holdings over every wallet, signed and unsigned.
 *
 * The screen's total is the aggregate of the resident's **signature-verified**
 * wallets and only those. As amended v1.2/v1.3/v1.4, a connected wallet and a
 * pasted EVM address are shown in the same "In linked wallets" list, with their
 * provenance and a per-row "Connect & sign" action; both are excluded from the
 * total structurally, before the aggregate (see `@/lib/wealth/holdings` and
 * `./data`). A pasted Bitcoin address never feeds Holdings. The per-row proof
 * signs a server-issued challenge through front 03's interface.
 *
 * "+ Link another wallet" is a Holdings action: it connects, persists the
 * address as a `connected-wallet` row through `addConnectedWallet` (imported
 * read-only from onboarding), and disconnects; the row then appears unsigned
 * until the resident signs it, which is what unlocks the vault action.
 *
 * The wallet context is required: the actions use AppKit/wagmi hooks, so the
 * page wraps the shell in `WalletProvider` exactly as the onboarding and
 * residency steps do. `HoldingsView` is the client half that binds those hooks
 * to the presentational `HoldingsScreen`.
 */
export const dynamic = 'force-dynamic';

export default async function HoldingsPage() {
  const session = await getSessionUser();
  if (!session) {
    redirect('/login');
  }

  const [shellSafe, aggregate] = await Promise.all([
    loadShellSafe(session.userId),
    loadVerifiedHoldings(session.userId),
  ]);

  const walletConfigured = readWalletConnectProjectId() !== null;
  const reviewBar = await loadReviewBar(session.userId);

  return (
    <WalletProvider>
      <AppShell
        email={session.email}
        safeAddress={shellSafe.address}
        safeDeployed={shellSafe.deployed}
        safeStatus={shellSafe.status}
        explorerUrl={shellSafe.explorerUrl}
        showReviewBar={reviewBar.show}
        reviewReference={reviewBar.reference}
        isReviewer={reviewBar.isReviewer}
      >
        <ContentContainer>
          <HoldingsView
            aggregate={aggregate}
            safeAddress={shellSafe.address}
            configured={walletConfigured}
            onBegin={beginWalletLink}
            onComplete={completeWalletLink}
            onAddConnectedWallet={addConnectedWallet}
          />
        </ContentContainer>
      </AppShell>
    </WalletProvider>
  );
}
