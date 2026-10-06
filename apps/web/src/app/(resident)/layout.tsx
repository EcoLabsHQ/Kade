import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { chainsForEnv } from '@kade/shared';
import { AppShell } from '@/components/shell/AppShell';
import {
  ShellAdminFallback,
  ShellAdminSwitch,
} from '@/components/shell/ShellAdminSwitch';
import { ShellReviewBanner } from '@/components/shell/ShellReviewBanner';
import { ShellReviewNotice } from '@/components/shell/ShellReviewNotice';
import {
  ShellSafeCard,
  ShellSafeCardFallback,
} from '@/components/shell/ShellSafeCard';
import { getSessionUser } from '@/lib/supabase/server';
import { readChainEnv } from '@/lib/env';

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
 * **The frame renders immediately.** The session is still resolved here, before
 * any chrome: an unauthenticated request must redirect to `/login` server-side
 * and must never see the shell. Once the session is known, `AppShell` renders
 * with only what is already available — the nav, the chain label and the page
 * content. The two per-resident reads (`loadShellSafe` and `loadReviewBar`) are
 * no longer awaited here; they move behind `<Suspense>` in the async slot
 * components below, so the shell paints while they resolve instead of waiting
 * for both database reads first. That blocking pair was the floor this layout
 * imposed on every full page load.
 *
 * Each streamed slot has a fallback that fabricates nothing: the Safe card's is
 * an empty grey shape (never "no account yet" or `0x…`), the Admin affordance's
 * is an empty shape (never the disabled "not a reviewer" state), and the two
 * conditional regions — the review notice and the top banner — render nothing
 * until they know whether they apply. See `ShellSlotFallback`.
 *
 * While this layout itself is resolving, the boundary that covers it is the
 * parent segment's `app/loading.tsx`, not this group's own `loading.tsx`: a
 * segment's `loading.tsx` wraps its children (its pages), not the layout beside
 * it. That fallback is the resident shell skeleton (`ResidentShellLoading`), not
 * the setup placeholder, so the resident frame never flashes the sign-in shape.
 *
 * Each page keeps its own reads for its own content and its own redirects (for
 * example the Overview's not-onboarded redirect to `/onboarding`); this layout
 * only owns the shell. The pages keep their own session gate as well, so the
 * policy is unchanged if a page is ever reached outside this group.
 */
export default async function ResidentLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSessionUser();
  if (!session) {
    redirect('/login');
  }

  const network = activeSettlementChainLabel();

  return (
    <AppShell
      email={session.email}
      network={network}
      safeCard={
        <Suspense fallback={<ShellSafeCardFallback />}>
          <ShellSafeCard userId={session.userId} network={network} />
        </Suspense>
      }
      reviewNotice={
        <Suspense fallback={null}>
          <ShellReviewNotice userId={session.userId} />
        </Suspense>
      }
      reviewBanner={
        <Suspense fallback={null}>
          <ShellReviewBanner userId={session.userId} />
        </Suspense>
      }
      footerAdmin={
        <Suspense fallback={<ShellAdminFallback />}>
          <ShellAdminSwitch userId={session.userId} />
        </Suspense>
      }
    >
      {children}
    </AppShell>
  );
}
