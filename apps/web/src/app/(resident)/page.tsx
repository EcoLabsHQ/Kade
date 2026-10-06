import Link from 'next/link';
import { redirect } from 'next/navigation';
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
import {
  buildOverview,
  demoBadgeLabel,
  type OverviewFee,
  type OverviewServiceFee,
  type OverviewTone,
} from '@/lib/review/overview';
import { loadShellSafe } from '@/lib/safe/shell';
import { loadFeePayment } from '@/lib/payments/server';
import { loadVaultHoldings } from '@/lib/wealth/vault-holdings';
import { summarizeQualifiedPosition } from '@/lib/wealth/qualified-position';
import {
  loadIdentityFact,
  residencyFactsFrom,
} from '@/lib/residency/server';
import { loadResidencyServiceFeePayment } from '@/lib/residency/service-fee-server';
import { deriveResidencyView } from '@/lib/residency/checks';

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

/**
 * The residency service-fee payment state, or an explicit unread state when the
 * read throws. The same rail the Residency step pays into; `paid` is a verified
 * receipt, never a stored hash.
 */
async function loadServiceFeeOrUnread(
  userId: string,
): Promise<OverviewServiceFee> {
  try {
    return await loadResidencyServiceFeePayment(userId);
  } catch (cause) {
    const reason =
      cause instanceof Error
        ? cause.message
        : 'the service-fee state could not be read.';
    console.warn(
      '[kade] Could not read the residency service fee state:',
      reason,
    );
    return {
      status: 'unread',
      reason: `The service-fee state could not be read: ${reason}`,
    };
  }
}

/**
 * The application row the reviewer's action flips. A failed read degrades to
 * the all-unknown state rather than claiming a status or a figure.
 *
 * Kept as its own async unit so it can be issued in the same stage as the other
 * session-only reads; its error handling is unchanged.
 */
async function loadReviewStateOrUnknown(
  userId: string,
): Promise<ResidentReviewState> {
  if (!isAuthConfigured(readAuthEnv())) {
    return NO_RESIDENT_REVIEW_STATE;
  }
  try {
    const client = await createSupabaseServerClient();
    return await loadResidentReviewState(client, userId);
  } catch (cause) {
    console.warn(
      '[kade] Could not read the resident review state:',
      cause instanceof Error ? cause.message : cause,
    );
    return NO_RESIDENT_REVIEW_STATE;
  }
}

export default async function OverviewPage() {
  const session = await getSessionUser();
  if (!session) {
    redirect('/login');
  }

  // The shell Safe, the onboarding gate, the review row, the Self identity
  // record and the residency service-fee state all depend only on the session,
  // so they are issued in one stage rather than one after another. The identity
  // and service-fee reads are the **same** sources the Residency step uses, so
  // the tracker's rows cannot disagree with that screen.
  const [shellSafe, onboarded, reviewState, identityFact, servicePayment] =
    await Promise.all([
      loadShellSafe(session.userId),
      hasCompletedOnboarding(session.userId),
      loadReviewStateOrUnknown(session.userId),
      loadIdentityFact(session.userId),
      loadServiceFeeOrUnread(session.userId),
    ]);

  // Spec section 8: an authenticated session is not enough to see the account
  // screens. Until the onboarding steps are complete there is no account state
  // to show, so the resident is sent to the step that is actually pending.
  if (!onboarded) {
    redirect('/onboarding');
  }

  const reviewGate: ResidentGate = residentGate(reviewState.status);

  const [vaultHoldings, fee] = await Promise.all([
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

  // Reduce the same records with the same derivation the Residency step uses, so
  // the service-fee and start-residency rows track that screen rather than a
  // guess. `residencyFactsFrom` is the pure mapping `loadResidencyFacts` uses.
  const preapprovalPaid = fee.status === 'paid';
  const residencyView = deriveResidencyView(
    residencyFactsFrom({
      tier: reviewState.tier,
      status: reviewState.status,
      identity: identityFact,
      qualified,
      servicePayment,
      // The service-fee amount is not quoted on the Overview; the derivation's
      // `serviceFeeUnlocked` does not depend on it (the fee is not its own
      // prerequisite), so it is not read a second time here.
      serviceFeeAmountUsdc: null,
      serviceUid: reviewState.serviceUid,
    }),
    preapprovalPaid,
  );

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
    preapprovalPaid,
    // No `kade.kyc.v1` attestation UID exists (issuance is gate-blocked); the
    // identity row reads the real Self outcome instead of inventing one.
    kycUid: null,
    identity: identityFact,
    // The service fee is the same rail the Residency step pays into; `unlocked`
    // is the same derivation, additionally gated on the pre-approval fee exactly
    // as the Residency step gates it.
    serviceFee: servicePayment,
    serviceFeeUnlocked: preapprovalPaid && residencyView.serviceFeeUnlocked,
    // The persisted documents flag and Colosseum demo progress live only in the
    // browser; the client `OverviewTracker` reads them and re-derives the rows.
  };
  const overview = buildOverview(overviewInput);
  const badge = demoBadgeLabel(overview);

  return (
    <>
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
              <Link href="/residency" style={{ fontSize: '13px', fontWeight: 600 }}>
                Open →
              </Link>
            </div>

            {/*
              The Residency "Upload" action writes under `applications.id`
              (`ResidencyStep`), so the Overview reads the same key — never the
              auth user id, which differs. Both normalize an absent id the same
              way inside the persisted store.
            */}
            <OverviewTracker
              input={overviewInput}
              profileKey={reviewState.applicationId}
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
                <Link href="/residency" style={{ fontSize: '13px', fontWeight: 600 }}>
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
    </>
  );
}
