import { notFound, redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { ContentContainer } from '@/components/shell/ContentContainer';
import { SiteFooter } from '@/components/shell/SiteFooter';
import { getSessionUser } from '@/lib/supabase/server';
import { loadShellSafe } from '@/lib/safe/shell';
import { loadReviewBar } from '@/lib/review/review-bar';
import { WithdrawScreen } from './WithdrawScreen';
import { loadOperatorWithdrawBalances } from './balances';
import { isOperatorWithdrawEnabled } from './gate';

export const dynamic = 'force-dynamic';

/**
 * The operator withdrawal is deliberately unindexed: it is an operator tool,
 * not resident-facing content.
 */
export const metadata = { robots: { index: false } };

/**
 * Operator withdrawal (Safe → wallet), unlinked and environment-gated.
 *
 * This is a browser route because the Safe's only signer is the resident's
 * WebAuthn passkey: the passkey prompt exists only in the browser, so the
 * withdrawal must be driven from a page that can ask for it. The route is
 * enabled only when `KADE_OPERATOR_WITHDRAW=1` (off by default); otherwise it
 * is a 404. It is not in the navigation and is not linked from any screen.
 *
 * Authority is unchanged: the passkey is the only signer, no managed signer is
 * introduced, and the connected browser wallet has no authority. See
 * `docs/operator-vault-withdraw.md`.
 */
export default async function OperatorWithdrawPage() {
  if (!isOperatorWithdrawEnabled()) {
    notFound();
  }

  const session = await getSessionUser();
  if (!session) {
    redirect('/login');
  }

  const shellSafe = await loadShellSafe(session.userId);
  const [balances, reviewBar] = await Promise.all([
    loadOperatorWithdrawBalances(shellSafe.address),
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
        <WithdrawScreen safeAddress={shellSafe.address} balances={balances} />
      </ContentContainer>
    </AppShell>
  );
}
