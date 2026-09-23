import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { ContentContainer } from '@/components/shell/ContentContainer';
import { HoldingsScreen } from '@/components/holdings/HoldingsScreen';
import { LinkedWalletSection } from '@/components/holdings/LinkedWalletSection';
import { WalletProvider } from '@/components/wallet/WalletProvider';
import { readWalletConnectProjectId } from '@/lib/env';
import { loadReviewBar } from '@/lib/review/review-bar';
import { loadShellSafe } from '@/lib/safe/shell';
import { getSessionUser } from '@/lib/supabase/server';
import { loadVerifiedHoldings } from './data';
import { beginWalletLink, completeWalletLink } from './link-actions';

/**
 * D17 / EXE-013 — Holdings from signed linked wallets.
 *
 * The screen shows the aggregate of the resident's **signature-verified**
 * wallets and only those. Pasted addresses are excluded structurally, before the
 * aggregate (see `@/lib/wealth/holdings` and `./data`). The link panel proves a
 * new wallet by signing a server-issued challenge through front 03's interface.
 *
 * The wallet context is required: the link panel uses wagmi hooks, so the page
 * wraps the shell in `WalletProvider` exactly as the onboarding and residency
 * steps do.
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
          <HoldingsScreen
            aggregate={aggregate}
            linkPanel={
              <LinkedWalletSection
                configured={walletConfigured}
                onBegin={beginWalletLink}
                onComplete={completeWalletLink}
              />
            }
          />
        </ContentContainer>
      </AppShell>
    </WalletProvider>
  );
}
