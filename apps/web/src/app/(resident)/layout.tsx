import { redirect } from 'next/navigation';
import { chainsForEnv } from '@kade/shared';
import { AppShell } from '@/components/shell/AppShell';
import { getSessionUser } from '@/lib/supabase/server';
import { readChainEnv } from '@/lib/env';
import { loadReviewBar } from '@/lib/review/review-bar';
import { loadShellSafe } from '@/lib/safe/shell';

export const dynamic = 'force-dynamic';

/**
 * The label for the active settlement chain, resolved from KADE_CHAIN_ENV and
 * the shared chain registry rather than hard-coded, so switching to the mainnet
 * configuration is a config change with no code edit (ADR 0005).
 *
 * Mirrors `AppShell`'s own default so a route that does not care which chain is
 * active still names the same one; the residency route previously resolved this
 * itself and passes the same value through to its step.
 */
function activeSettlementChainLabel(): string {
  const chains = chainsForEnv(readChainEnv());
  const ethereum =
    chains.find((chain) => chain.key === 'ethereum') ?? chains[0];
  return ethereum?.name ?? 'Ethereum Sepolia';
}

/**
 * The persistent frame for every resident route.
 *
 * A route group does not change URLs: `/`, `/residency`, `/holdings`, `/invest`,
 * `/bank`, `/card`, `/vote` and `/account` keep their paths, but they now share
 * one layout instead of each page importing `AppShell`. The layout is a segment
 * that Next.js keeps mounted across client-side navigation within the group, so
 * the sidebar, the top banner and the footer no longer re-mount (and no longer
 * visibly reload) when the resident moves between screens; only the page content
 * is replaced, and the group's `loading.tsx` covers that content area alone.
 *
 * The session and the shell state are resolved **once here**, from the same
 * reads the pages used to make to feed `AppShell`. Each page keeps its own reads
 * for its own content and its own redirects (for example the Overview's
 * not-onboarded redirect to `/onboarding`); this layout only owns the shell.
 *
 * Unauthenticated requests are redirected to `/login` exactly as before. The
 * pages keep their own session gate as well, so the policy is unchanged if a
 * page is ever reached outside this group.
 */
export default async function ResidentLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSessionUser();
  if (!session) {
    redirect('/login');
  }

  const [shellSafe, reviewBar] = await Promise.all([
    loadShellSafe(session.userId),
    loadReviewBar(session.userId),
  ]);

  return (
    <AppShell
      email={session.email}
      safeAddress={shellSafe.address}
      safeDeployed={shellSafe.deployed}
      safeStatus={shellSafe.status}
      explorerUrl={shellSafe.explorerUrl}
      network={activeSettlementChainLabel()}
      reviewBar={reviewBar}
      isReviewer={reviewBar.isReviewer}
    >
      {children}
    </AppShell>
  );
}
