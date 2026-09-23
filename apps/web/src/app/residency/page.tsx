import { redirect } from 'next/navigation';
import { chainsForEnv } from '@kade/shared';
import { AppShell } from '@/components/shell/AppShell';
import { ContentContainer } from '@/components/shell/ContentContainer';
import { SiteFooter } from '@/components/shell/SiteFooter';
import { ResidencyStep } from '@/components/residency/ResidencyStep';
import { WalletProvider } from '@/components/wallet/WalletProvider';
import { getSessionUser } from '@/lib/supabase/server';
import { readChainEnv, readWalletConnectProjectId } from '@/lib/env';
import { loadReviewBar } from '@/lib/review/review-bar';
import { loadShellSafe } from '@/lib/safe/shell';
import { loadResidencySnapshot } from '@/lib/residency/server';
import {
  isResidencyServiceFeeConfigured,
  readResidencyServiceFeeConfig,
} from '@/lib/residency/service-fee-server';

export const dynamic = 'force-dynamic';

/** The chain the residency fee is verified on, resolved from configuration. */
function activeSettlementChain() {
  const chains = chainsForEnv(readChainEnv());
  return chains.find((chain) => chain.key === 'ethereum') ?? chains[0] ?? null;
}

/**
 * The Residency step (D16 / EXE-012), reached from the shell.
 *
 * The page reads the session and the resident's own application. A signed-in
 * resident with no application is sent back to onboarding; the step itself is
 * rendered from records by `loadResidencySnapshot`, so nothing on screen is a
 * fixture.
 */
export default async function ResidencyPage() {
  const session = await getSessionUser();
  if (!session) {
    redirect('/login');
  }

  const snapshot = await loadResidencySnapshot(session.userId);
  if (!snapshot) {
    // No application means pre-registration is not finished; send the resident
    // to the step that is actually pending rather than rendering empty state.
    redirect('/onboarding');
  }

  const shellSafe = await loadShellSafe(session.userId);
  const settlement = activeSettlementChain();
  const network = settlement?.name ?? 'Ethereum Sepolia';
  const feeConfig = readResidencyServiceFeeConfig();
  const walletConfigured = readWalletConnectProjectId() !== null;
  const usdcAddress = settlement?.usdcAddress.value ?? '';
  const explorerUrl = settlement?.explorerUrl ?? 'https://sepolia.etherscan.io';
  const reviewBar = await loadReviewBar(session.userId);

  return (
    <WalletProvider>
      <AppShell
        email={session.email}
        safeAddress={shellSafe.address}
        safeDeployed={shellSafe.deployed}
        safeStatus={shellSafe.status}
        explorerUrl={shellSafe.explorerUrl}
        network={network}
        showReviewBar={reviewBar.show}
        reviewReference={reviewBar.reference}
        isReviewer={reviewBar.isReviewer}
      >
        <ContentContainer footer={<SiteFooter />}>
          <ResidencyStep
            snapshot={snapshot}
            network={network}
            paymentConfigured={walletConfigured && isResidencyServiceFeeConfigured()}
            treasuryAddress={feeConfig?.treasury ?? null}
            chainId={feeConfig?.chainId ?? 0}
            usdcAddress={usdcAddress}
            explorerUrl={explorerUrl}
          />
        </ContentContainer>
      </AppShell>
    </WalletProvider>
  );
}
