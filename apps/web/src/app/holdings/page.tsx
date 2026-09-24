import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { ContentContainer } from '@/components/shell/ContentContainer';
import { HoldingsView } from '@/components/holdings/HoldingsView';
import { WalletProvider } from '@/components/wallet/WalletProvider';
import { readWalletConnectProjectId } from '@/lib/env';
import { loadReviewBar } from '@/lib/review/review-bar';
import { loadShellSafe } from '@/lib/safe/shell';
import { getSessionUser } from '@/lib/supabase/server';
import { loadVerifiedHoldings } from './data';
import { beginWalletLink, completeWalletLink } from './link-actions';

/**
 * D17 / EXE-013 — Holdings from signed linked wallets, plus unverified rows.
 *
 * The screen's total is the aggregate of the resident's **signature-verified**
 * wallets and only those. As amended v1.2/v1.3, a connected wallet and a pasted
 * EVM address are also shown, in one labelled unverified section, with their
 * provenance and a per-row Verify action; both are excluded from the total
 * structurally, before the aggregate (see `@/lib/wealth/holdings` and `./data`).
 * A pasted Bitcoin address never feeds Holdings. The link panel and the per-row
 * Verify proof both sign a server-issued challenge through front 03's interface.
 *
 * The wallet context is required: the link panel and the Verify action use wagmi
 * hooks, so the page wraps the shell in `WalletProvider` exactly as the
 * onboarding and residency steps do. `HoldingsView` is the client half that
 * binds those hooks to the presentational `HoldingsScreen`.
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
          />
        </ContentContainer>
      </AppShell>
    </WalletProvider>
  );
}
