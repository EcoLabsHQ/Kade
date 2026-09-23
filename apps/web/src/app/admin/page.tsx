import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { ContentContainer } from '@/components/shell/ContentContainer';
import { Card } from '@/components/ui/Card';
import { tokens } from '@/components/ui/tokens';
import { ReviewQueue } from '@/components/admin/ReviewQueue';
import { isAuthConfigured, readAuthEnv } from '@/lib/env';
import { createSupabaseServerClient, getSessionUser } from '@/lib/supabase/server';
import { loadReviewQueue } from '@/lib/review/queue';
import type { ReviewQueueItem } from '@/lib/review/decision';
import type { NavGroupConfig } from '@/components/shell/nav';

export const dynamic = 'force-dynamic';

/**
 * The Admin review dashboard (D19).
 *
 * A reviewer role, not a resident, reaches this surface. RLS is the gate: the
 * queue queries run as the signed-in user, so a non-reviewer's reads return
 * nothing. The explicit role check here is only for a clear "not authorised"
 * screen; it does not replace RLS.
 *
 * The nav passed to the shell is local to this route — `nav.ts` is owned by the
 * integration front and is not edited here.
 */
const ADMIN_NAV: readonly NavGroupConfig[] = [
  {
    label: 'Admin',
    items: [
      { href: '/admin', label: 'Review queue' },
      { href: '/', label: 'Resident overview' },
    ],
  },
];

export default async function AdminPage() {
  const session = await getSessionUser();
  if (!session) {
    redirect('/login');
  }

  const configured = isAuthConfigured(readAuthEnv());
  let isReviewer = false;
  let role: string | null = null;
  let queue: readonly ReviewQueueItem[] = [];
  let loadError: string | null = null;

  if (configured) {
    const client = await createSupabaseServerClient();
    const { data: reviewer, error: reviewerError } = await client
      .from('reviewers')
      .select('id, role')
      .eq('id', session.userId)
      .maybeSingle();
    isReviewer = Boolean(reviewer);
    role = (reviewer as { role: string } | null)?.role ?? null;

    if (reviewerError) {
      console.warn('[kade] could not check the reviewer role:', reviewerError.message);
    } else if (isReviewer) {
      try {
        queue = await loadReviewQueue(client);
      } catch (cause) {
        loadError = cause instanceof Error ? cause.message : 'The queue could not be loaded.';
      }
    }
  }

  return (
    <AppShell email={session.email} nav={ADMIN_NAV} isReviewer={isReviewer}>
      <ContentContainer>
        <h1
          style={{
            margin: '0 0 6px',
            fontSize: '36px',
            lineHeight: 1.1,
            fontWeight: 700,
            letterSpacing: '-.02em',
          }}
        >
          Review queue
        </h1>
        <p style={{ margin: '0 0 24px', color: tokens.muted, maxWidth: '62ch' }}>
          Applications waiting for a decision. Approving or blocking writes a
          review event; the resident&rsquo;s status flips from that event.
        </p>

        {!configured ? (
          <Card radius={14}>
            <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>
              Not configured
            </h2>
            <p style={{ margin: '8px 0 0', color: tokens.muted }}>
              Supabase is not configured in this environment, so there is no
              review surface to show.
            </p>
          </Card>
        ) : !isReviewer ? (
          <Card radius={14}>
            <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>
              Not authorised
            </h2>
            <p style={{ margin: '8px 0 0', color: tokens.muted }}>
              This account is not a reviewer. Admin review is restricted to rows
              in <code>public.reviewers</code>.
            </p>
          </Card>
        ) : loadError ? (
          <Card radius={14}>
            <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>
              Queue unavailable
            </h2>
            <p style={{ margin: '8px 0 0', color: tokens.muted }}>{loadError}</p>
          </Card>
        ) : (
          <>
            <div style={{ fontSize: '12.5px', color: tokens.muted, marginBottom: '12px' }}>
              Reviewer role: {role ?? 'reviewer'} · {queue.length} application
              {queue.length === 1 ? '' : 's'}
            </div>
            <ReviewQueue items={queue} />
          </>
        )}
      </ContentContainer>
    </AppShell>
  );
}
