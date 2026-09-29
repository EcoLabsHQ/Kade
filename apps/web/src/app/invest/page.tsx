import { redirect } from 'next/navigation';
import { MORPHO_VAULT_CHAIN_IDS } from '@kade/shared';
import { AppShell } from '@/components/shell/AppShell';
import { ContentContainer } from '@/components/shell/ContentContainer';
import { InvestScreen } from '@/components/invest/InvestScreen';
import { getSessionUser } from '@/lib/supabase/server';
import { loadShellSafe } from '@/lib/safe/shell';
import { loadReviewBar } from '@/lib/review/review-bar';
import {
  isMorphoRailConfiguredForChain,
  morphoChainName,
  readMorphoVaultConfigForChain,
} from '@/lib/invest/morpho-config';

export const dynamic = 'force-dynamic';

/**
 * The Invest route (D18 / EXE-014), now over three per-chain rails.
 *
 * Resolves the resident's Safe and the server-only MetaMorpho vault
 * configuration **per chain** (Ethereum mainnet, Base, Arbitrum One) and renders
 * the screen. Each rail's vault address, underlying USDC and chain are passed to
 * the client as display values, so the browser neither reads nor hard-codes
 * them, and the resident chooses exactly one rail in the modal.
 *
 * Execution is resolved server-side by the `beginDeposit` action, which resolves
 * the **named** chain's vault and that chain's own RPC and verifies the Safe's
 * state there. The page passes only what the screen needs to render; `configured`
 * is a UI hint (vault + RPC present) and adds no execution gate of its own.
 */
export default async function InvestPage() {
  const session = await getSessionUser();
  if (!session) {
    redirect('/login');
  }

  const shellSafe = await loadShellSafe(session.userId);
  // One summary per pinned rail, in registry order. `readMorphoVaultConfigForChain`
  // returns null (never throws) when a chain has no deployment or its Ethereum
  // override is malformed, so a misconfigured environment degrades rather than
  // taking the route down.
  const vaults = MORPHO_VAULT_CHAIN_IDS.map((chainId) => {
    const config = readMorphoVaultConfigForChain(chainId);
    return {
      configured: isMorphoRailConfiguredForChain(chainId),
      chainId,
      chainName: morphoChainName(chainId),
      vault: config?.vault ?? null,
      usdc: config?.usdc ?? null,
    };
  });
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
        <InvestScreen vaults={vaults} safeAddress={shellSafe.address} />
      </ContentContainer>
    </AppShell>
  );
}
