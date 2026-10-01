import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { ContentContainer } from '@/components/shell/ContentContainer';
import { SiteFooter } from '@/components/shell/SiteFooter';
import { VoteScreen } from '@/components/vote/VoteScreen';
import { getSessionUser } from '@/lib/supabase/server';
import { loadShellSafe } from '@/lib/safe/shell';
import { loadReviewBar } from '@/lib/review/review-bar';

export const dynamic = 'force-dynamic';

/**
 * The Vote route (D20 / VOTE-1).
 *
 * Auth-gated exactly like `/invest`: a signed-out visitor is redirected to
 * `/login`, and the shell is resolved from the same session/Safe/review reads
 * every other authenticated page uses.
 *
 * The screen itself is a **declared presentational mock** (the Week 3 contract
 * declares the divergence; see `docs/week-3-frozen-delivery-contract.md`). The
 * page deliberately loads no consultation or Snapshot data: the only server
 * reads are the shell's own session, Safe and review state, so the route stays
 * truthful about what exists.
 */
export default async function VotePage() {
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
      showReviewBar={reviewBar.show}
      reviewReference={reviewBar.reference}
      isReviewer={reviewBar.isReviewer}
    >
      <ContentContainer footer={<SiteFooter />}>
        <VoteScreen />
      </ContentContainer>
    </AppShell>
  );
}
