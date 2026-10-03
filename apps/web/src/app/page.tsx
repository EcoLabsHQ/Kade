import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { ContentContainer } from '@/components/shell/ContentContainer';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { StatCard } from '@/components/ui/StatCard';
import { tokens } from '@/components/ui/tokens';
import { ReviewGateWatcher } from '@/components/review/ReviewGateWatcher';
import { OverviewTracker } from '@/components/review/OverviewTracker';
import { hasCompletedOnboarding } from '@/lib/onboarding/state';
import { isAuthConfigured, readAuthEnv } from '@/lib/env';
import {
  createSupabaseServerClient,
  getSessionUser,
} from '@/lib/supabase/server';
import {
  loadResidentReviewState,
  NO_RESIDENT_REVIEW_STATE,
  type ResidentReviewState,
} from '@/lib/review/queue';
import { residentGate, type ResidentGate } from '@/lib/review/gate';
import { loadReviewBar } from '@/lib/review/review-bar';
import {
  buildOverview,
  demoBadgeLabel,
  type OverviewFee,
  type OverviewTone,
} from '@/lib/review/overview';
import { loadShellSafe } from '@/lib/safe/shell';
import { loadFeePayment } from '@/lib/payments/server';
import { loadVaultHoldings } from '@/lib/wealth/vault-holdings';
import { summarizeQualifiedPosition } from '@/lib/wealth/qualified-position';

export const dynamic = 'force-dynamic';

/**
 * Overview, in the pre-approved state.
 *
 * Every value is the resident's real state: the review gate read from the
 * application row the reviewer's action flips, the recorded Safe, the qualified
 * position read from the chain through the same reader the Holdings screen uses
 * (`loadVaultHoldings`), reduced once by the **same** `summarizeQualifiedPosition`
 * the Holdings `QUALIFIED` card and the residency tier check call, and the
 * recorded fee state. Nothing is a literal and no stage is a fixture: a stage
 * with no source on this screen says so rather than inventing a status, and an
 * unknown read is shown with its reason rather than a fabricated `$0`.
 *
 * The "Demo data" chip is rendered only while {@link demoBadgeLabel} finds a
 * block that is still demo data; with everything derived here there is none.
 */

const TONE_COLOR: Readonly<Record<OverviewTone, string>> = {
  ink: tokens.ink,
  success: tokens.success,
  warning: tokens.warning,
  danger: tokens.danger,
  muted: tokens.muted,
};

/**
 * The recorded fee state, or an explicit unread state when the read throws.
 * `loadFeePayment` re-derives "paid" from the Sepolia receipt, so a stored hash
 * is never presented as paid.
 */
async function loadFeeOrUnread(userId: string): Promise<OverviewFee> {
  try {
    return await loadFeePayment(userId);
  } catch (cause) {
    const reason =
      cause instanceof Error ? cause.message : 'the fee state could not be read.';
    console.warn('[kade] Could not read the pre-approval fee state:', reason);
    return { status: 'unread', reason: `The fee state could not be read: ${reason}` };
  }
}

export default async function OverviewPage() {
  const session = await getSessionUser();
  if (!session) {
    redirect('/login');
  }
  const shellSafe = await loadShellSafe(session.userId);

  // Spec section 8: an authenticated session is not enough to see the account
  // screens. Until the onboarding steps are complete there is no account state
  // to show, so the resident is sent to the step that is actually pending.
  if (!(await hasCompletedOnboarding(session.userId))) {
    redirect('/onboarding');
  }

  // The application row the reviewer's action flips. A failed read degrades to
  // the all-unknown state rather than claiming a status or a figure.
  let reviewState: ResidentReviewState = NO_RESIDENT_REVIEW_STATE;
  if (isAuthConfigured(readAuthEnv())) {
    try {
      const client = await createSupabaseServerClient();
      reviewState = await loadResidentReviewState(client, session.userId);
    } catch (cause) {
      console.warn(
        '[kade] Could not read the resident review state:',
        cause instanceof Error ? cause.message : cause,
      );
    }
  }
  const reviewGate: ResidentGate = residentGate(reviewState.status);

  const [reviewBar, vaultHoldings, fee] = await Promise.all([
    loadReviewBar(session.userId),
    // The Safe's qualified position: the one reader, pointed at the Safe.
    loadVaultHoldings(shellSafe.address),
    loadFeeOrUnread(session.userId),
  ]);

  // The **one** qualified figure: the same single reduction the Holdings
  // `QUALIFIED` card and the residency tier check call, over the same rows. The
  // dashboard reads no chains of its own and composes no total its own way, so
  // the three surfaces cannot disagree — including when the Safe holds native
  // coin, which this reduction counts and a USDC + MetaMorpho-only composition
  // would not.
  const qualified = summarizeQualifiedPosition({
    safeAddress: shellSafe.address,
    rows: vaultHoldings,
  });

  const overviewInput = {
    gate: reviewGate,
    tier: reviewState.tier,
    preapprovalUsdc: reviewState.preapprovalUsdc,
    fee,
    reviewUid: reviewState.reviewUid,
    serviceUid: reviewState.serviceUid,
    safeAddress: shellSafe.address,
    safeDeployed: shellSafe.deployed,
    qualified,
    // The pre-approval fee is "paid" only when the receipt re-verifies; the
    // attestation stat uses this to say whether the fee attestation is recorded.
    preapprovalPaid: fee.status === 'paid',
    // The Overview does not read Self or the residency gate, so a kyc UID is not
    // available here and the tracker says so rather than claiming a proof.
    kycUid: null,
    // The persisted documents flag and Colosseum demo progress live only in the
    // browser; the client `OverviewTracker` reads them and re-derives the rows.
  };
  const overview = buildOverview(overviewInput);
  const badge = demoBadgeLabel(overview);

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
      <ReviewGateWatcher userId={session.userId} />
      <ContentContainer>
        <div
          className="kade-dashboard-header"
          style={{ marginBottom: '24px' }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: '36px',
                lineHeight: 1.1,
                fontWeight: 700,
                letterSpacing: '-.02em',
              }}
            >
              Bon bini, {session.email ? session.email.split('@')[0] : 'resident'}
            </h1>
            <p
              style={{
                margin: '10px 0 0',
                color: tokens.muted,
                maxWidth: '60ch',
                textWrap: 'pretty',
              }}
            >
              {overview.summary}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <Link
              href="/onboarding"
              style={{
                border: `1px solid ${tokens.border}`,
                borderRadius: '999px',
                padding: '11px 18px',
                fontSize: '13.5px',
                fontWeight: 600,
                color: tokens.ink,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              Replay setup
            </Link>
          </div>
        </div>

        <div
          className="kade-grid-4"
          style={{
            gap: '14px',
            marginBottom: '16px',
          }}
        >
          {overview.stats.map((stat) => (
            <StatCard
              key={stat.label}
              label={stat.label}
              value={stat.value}
              sub={stat.sub}
              valueColor={TONE_COLOR[stat.tone]}
              highlight={stat.highlight}
            />
          ))}
        </div>

        <div
          className="kade-grid-dashboard"
          style={{ gap: '16px' }}
        >
          <Card radius={14}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: '12px',
              }}
            >
              <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 600 }}>
                Getting ready for residency
              </h2>
              <Link href="/onboarding" style={{ fontSize: '13px', fontWeight: 600 }}>
                Open →
              </Link>
            </div>

            <OverviewTracker
              input={overviewInput}
              profileKey={reviewState.applicationId ?? session.userId}
            />
          </Card>

          <div style={{ display: 'grid', gap: '16px' }}>
            <Card radius={14}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  gap: '12px',
                }}
              >
                <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 600 }}>
                  Qualified holdings
                </h2>
                <Link href="/onboarding" style={{ fontSize: '13px', fontWeight: 600 }}>
                  Open →
                </Link>
              </div>
              <div
                style={{
                  marginTop: '10px',
                  fontSize: '26px',
                  fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {overview.holdings.value}
              </div>
              <div style={{ marginTop: '6px', fontSize: '12.5px', color: tokens.muted }}>
                {overview.holdings.sub}
              </div>
            </Card>

            <Card radius={14}>
              <h2 style={{ margin: '0 0 10px', fontSize: '17px', fontWeight: 600 }}>
                Next steps
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {overview.steps.map((step) => (
                  <div
                    key={step.label}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '12px',
                      background: '#fff',
                      border: `1px solid ${tokens.border}`,
                      borderRadius: '10px',
                      padding: '11px 14px',
                      fontSize: '13.5px',
                      fontWeight: 500,
                    }}
                  >
                    <span>{step.label}</span>
                    <span style={{ fontSize: '12px', color: tokens.muted }}>
                      {step.note}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>

        {badge ? (
          <div style={{ marginTop: '16px' }}>
            <Chip tone="neutral" dot>
              {badge}
            </Chip>
          </div>
        ) : null}
      </ContentContainer>
    </AppShell>
  );
}
