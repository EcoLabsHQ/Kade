import { redirect } from 'next/navigation';
import { chainsForEnv } from '@kade/shared';
import { AppShell } from '@/components/shell/AppShell';
import { ContentContainer } from '@/components/shell/ContentContainer';
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

  // Resolve the shell Safe once for the whole route and hand it to the snapshot,
  // whose qualified-position read then reuses it instead of reading the
  // deployment record a second time.
  const shellSafe = await loadShellSafe(session.userId);

  // The snapshot (application, fee rail and chain reads) and the review bar are
  // independent, so they are issued together rather than the review bar waiting
  // for every snapshot read to finish.
  const [snapshot, reviewBar] = await Promise.all([
    loadResidencySnapshot(session.userId, shellSafe),
    loadReviewBar(session.userId),
  ]);
  if (!snapshot) {
    // No application means pre-registration is not finished; send the resident
    // to the step that is actually pending rather than rendering empty state.
    redirect('/onboarding');
  }

  const settlement = activeSettlementChain();
  const network = settlement?.name ?? 'Ethereum Sepolia';
  const feeConfig = readResidencyServiceFeeConfig();
  const walletConfigured = readWalletConnectProjectId() !== null;
  const usdcAddress = settlement?.usdcAddress.value ?? '';
  const explorerUrl = settlement?.explorerUrl ?? 'https://sepolia.etherscan.io';

  return (
    <WalletProvider>
      <AppShell
        email={session.email}
        safeAddress={shellSafe.address}
        safeDeployed={shellSafe.deployed}
        safeStatus={shellSafe.status}
        explorerUrl={shellSafe.explorerUrl}
        network={network}
        reviewBar={reviewBar}
        isReviewer={reviewBar.isReviewer}
      >
        <ContentContainer>
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
