import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { ContentContainer } from '@/components/shell/ContentContainer';
import { SiteFooter } from '@/components/shell/SiteFooter';
import { CardScreen } from '@/components/finance/card/CardScreen';
import { getSessionUser } from '@/lib/supabase/server';
import { loadShellSafe } from '@/lib/safe/shell';
import { loadReviewBar } from '@/lib/review/review-bar';

export const dynamic = 'force-dynamic';

/**
 * The Card & Banking route (D21).
 *
 * Auth-gated exactly like `/invest`: a signed-out visitor is redirected to
 * `/login`, and the shell is resolved from the same session/Safe/review reads
 * every other authenticated page uses.
 *
 * The screen itself is a **declared presentational mock** (Finance is beyond
 * the frozen Week 2 scope, week-2 contract §2.1). The page deliberately loads
 * no chain or finance data: the only server reads are the shell's own session,
 * Safe and review state, so the route stays truthful about what exists.
 */
export default async function CardPage() {
  const session = await getSessionUser();
  if (!session) {
    redirect('/login');
  }

  const shellSafe = await loadShellSafe(session.userId);
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
      <ContentContainer footer={<SiteFooter />}>
        <CardScreen />
      </ContentContainer>
    </AppShell>
  );
}
