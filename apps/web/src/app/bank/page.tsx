import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { ContentContainer } from '@/components/shell/ContentContainer';
import { SiteFooter } from '@/components/shell/SiteFooter';
import { BankScreen } from '@/components/finance/bank/BankScreen';
import { getSessionUser } from '@/lib/supabase/server';
import { loadShellSafe } from '@/lib/safe/shell';
import { loadReviewBar } from '@/lib/review/review-bar';

export const dynamic = 'force-dynamic';

/**
 * The Bank ↔ Crypto route.
 *
 * A **declared presentational mock**: Finance (D21) is beyond the frozen Week 2
 * scope, so the screen renders the reference's GOS layout from demo values and
 * creates no capability — no server action, no Supabase read for the screen, no
 * wallet or chain code. The page still resolves the shell exactly like the other
 * resident routes (session gate, Safe, review bar) so it renders inside the same
 * authenticated frame as Invest and Holdings.
 */
export default async function BankPage() {
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
        <BankScreen />
      </ContentContainer>
    </AppShell>
  );
}
