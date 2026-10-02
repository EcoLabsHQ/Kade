import { notFound, redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { ContentContainer } from '@/components/shell/ContentContainer';
import { SiteFooter } from '@/components/shell/SiteFooter';
import { ColosseumScreen } from '@/components/colosseum/ColosseumScreen';
import { getSessionUser } from '@/lib/supabase/server';
import { loadShellSafe } from '@/lib/safe/shell';
import { loadReviewBar } from '@/lib/review/review-bar';
import { loadResidencySnapshot } from '@/lib/residency/server';
import { loadColosseumMembership } from '@/lib/colosseum/server';
import { isColosseumEnabled } from '@/lib/colosseum/gate';

export const dynamic = 'force-dynamic';

/**
 * The Colosseum residency surface (COLOSSEUM-1), off by default.
 *
 * The route is a 404 unless `KADE_COLOSSEUM=1` (the exact string `1`), and when
 * enabled it is auth-gated exactly like `/residency`: no session goes to
 * `/login`, and a resident with no application goes back to `/onboarding`. The
 * screen is driven by the real snapshot (`loadResidencySnapshot`) and the
 * persisted membership; nothing on screen is a fixture.
 */
export default async function ColosseumPage() {
  if (!isColosseumEnabled()) {
    notFound();
  }

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

  const [membership, shellSafe, reviewBar] = await Promise.all([
    loadColosseumMembership(session.userId),
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
      reviewBar={reviewBar}
      isReviewer={reviewBar.isReviewer}
    >
      <ContentContainer footer={<SiteFooter />}>
        <ColosseumScreen snapshot={snapshot} membership={membership} />
      </ContentContainer>
    </AppShell>
  );
}
