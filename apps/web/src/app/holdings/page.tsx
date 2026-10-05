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
import { loadApplicationResidencyRow } from '@/lib/residency/server';
import { loadVaultHoldings } from '@/lib/wealth/vault-holdings';
import { summarizeQualifiedPosition } from '@/lib/wealth/qualified-position';
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

/**
 * The resident's recorded qualifying tier, read from the **one** application row
 * the Residency surface reads (`loadApplicationResidencyRow`), so the `QUALIFIED`
 * card and the residency tier check cannot disagree about which tier the
 * resident is on. This is the page's only tier read; the card derives its
 * sub-line from this value and the same qualified position the residency check
 * reduces.
 *
 * A failed read yields null — the same "no tier recorded" the card already
 * renders — so the page still renders and never claims a tier it could not read.
 * A tier is never inferred from the qualified total or re-derived anywhere.
 */
async function loadResidentTier(profileId: string): Promise<string | null> {
  try {
    const row = await loadApplicationResidencyRow(profileId);
    return row?.tier ?? null;
  } catch (cause) {
    console.warn(
      '[kade] Could not read the application tier for holdings:',
      cause instanceof Error ? cause.message : cause,
    );
    return null;
  }
}

export default async function HoldingsPage() {
  const session = await getSessionUser();
  if (!session) {
    redirect('/login');
  }

  const [shellSafe, aggregate, tier] = await Promise.all([
    loadShellSafe(session.userId),
    loadVerifiedHoldings(session.userId),
    loadResidentTier(session.userId),
  ]);

  // The Safe's qualified holdings are a fresh on-chain read pointed at the Safe
  // address. No deposit flow persists a vault position, so the chain is the only
  // truthful source; a failed read stays visible rather than becoming a zero.
  //
  // The review bar is an independent record read that depends only on the
  // session, so it is issued in the same stage as the chain read rather than
  // serially after it. Both start as soon as the Safe address is known; neither
  // waits on the other.
  const [vaultHoldings, reviewBar] = await Promise.all([
    loadVaultHoldings(shellSafe.address),
    loadReviewBar(session.userId),
  ]);

  // The one qualified total, reduced once from the rows above. The residency
  // tier check reduces the same Safe's rows with the same function, so the
  // `QUALIFIED` card and the tier check cannot disagree.
  const qualified = summarizeQualifiedPosition({
    safeAddress: shellSafe.address,
    rows: vaultHoldings,
  });

  const walletConfigured = readWalletConnectProjectId() !== null;

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
            vaultHoldings={vaultHoldings}
            qualified={qualified}
            tier={tier}
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
