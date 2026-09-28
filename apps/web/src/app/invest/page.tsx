import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { ContentContainer } from '@/components/shell/ContentContainer';
import { InvestScreen } from '@/components/invest/InvestScreen';
import { getSessionUser } from '@/lib/supabase/server';
import { loadShellSafe } from '@/lib/safe/shell';
import { loadReviewBar } from '@/lib/review/review-bar';
import {
  isMorphoVaultConfigured,
  morphoChainId,
  morphoChainName,
  readMorphoVaultConfig,
} from '@/lib/invest/morpho-config';

export const dynamic = 'force-dynamic';

/**
 * The Invest route (D18 / EXE-014).
 *
 * Resolves the resident's Safe and the server-only MetaMorpho vault
 * configuration and renders the screen. The vault address, its underlying USDC
 * and the chain are passed to the client as display values, so the browser
 * neither reads nor hard-codes them.
 *
 * Execution is resolved server-side by the `beginDeposit` action, which reads
 * the vault configuration and the reserved mainnet `ETHEREUM_RPC_URL` itself
 * and verifies the Safe's state on the deposit chain. The page therefore passes
 * only what the screen needs to render; it adds no execution gate of its own.
 */
export default async function InvestPage() {
  const session = await getSessionUser();
  if (!session) {
    redirect('/login');
  }

  const shellSafe = await loadShellSafe(session.userId);
  // `readMorphoVaultConfig` returns null (never throws) when configuration is
  // absent or malformed, so a misconfigured environment degrades rather than
  // taking the route down.
  const config = readMorphoVaultConfig();
  const reviewBar = await loadReviewBar(session.userId);

  return (
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
        <InvestScreen
          vault={{
            configured: isMorphoVaultConfigured(),
            chainId: morphoChainId(),
            chainName: morphoChainName(),
            vault: config?.vault ?? null,
            usdc: config?.usdc ?? null,
          }}
          safeAddress={shellSafe.address}
        />
      </ContentContainer>
    </AppShell>
  );
}
