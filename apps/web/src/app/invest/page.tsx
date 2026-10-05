import { redirect } from 'next/navigation';
import { MORPHO_VAULT_CHAIN_IDS } from '@kade/shared';
import { AppShell } from '@/components/shell/AppShell';
import { ContentContainer } from '@/components/shell/ContentContainer';
import { InvestScreen } from '@/components/invest/InvestScreen';
import { getSessionUser } from '@/lib/supabase/server';
import { loadShellSafe } from '@/lib/safe/shell';
import { loadReviewBar } from '@/lib/review/review-bar';
import { loadVaultHoldings } from '@/lib/wealth/vault-holdings';
import { summarizeQualifiedPosition } from '@/lib/wealth/qualified-position';
import {
  isMorphoRailConfiguredForChain,
  morphoChainName,
  readMorphoVaultConfigForChain,
} from '@/lib/invest/morpho-config';
import { readMorphoVaultYield } from '@/lib/invest/morpho-yield';

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
  // The Safe's position is read **once** here, through the same on-chain reader
  // the Holdings screen uses, and handed to the screen as the single source of
  // truth for the stats, each row's state and the allocate preview. Nothing
  // persists a vault position, so the chain is the only truthful source; a
  // failed read travels as rows carrying their own reasons rather than as a
  // fabricated zero.
  // The Safe's position, the review bar and each configured rail's yield are
  // independent reads — none depends on another's result — so they are issued
  // in one stage. Previously the yields waited for the chain read to finish;
  // now they run alongside it.
  //
  // Each pinned rail's yield is read from Morpho's public API for the **same
  // vault the rail deposits into**, so the allocate modal can estimate income.
  // The reads are bounded and cached by Next (a day), so this route does not
  // call Morpho on every render, and a rail whose read fails travels as an
  // `unknown` carrying its reason — the modal then says `Not quoted` rather
  // than inventing a figure. Only configured rails are read.
  const [vaultHoldings, reviewBar, yieldReads] = await Promise.all([
    loadVaultHoldings(shellSafe.address),
    loadReviewBar(session.userId),
    Promise.all(
      vaults
        .filter((rail) => rail.configured)
        .map(
          async (rail) =>
            [rail.chainId, await readMorphoVaultYield(rail.chainId)] as const,
        ),
    ),
  ]);
  const yields = new Map(yieldReads);

  // The Safe's **qualified** total, reduced **once** here from the same rows
  // through the same function the Holdings card and the residency tier check
  // use. Native coin counts toward it (it is not an Invest instrument and is
  // not allocatable); reducing it once is what keeps Invest and Holdings from
  // showing two different qualified figures.
  const qualified = summarizeQualifiedPosition({
    safeAddress: shellSafe.address,
    rows: vaultHoldings,
  });

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
          vaults={vaults}
          safeAddress={shellSafe.address}
          holdings={vaultHoldings}
          qualified={qualified}
          yields={yields}
        />
      </ContentContainer>
    </AppShell>
  );
}
