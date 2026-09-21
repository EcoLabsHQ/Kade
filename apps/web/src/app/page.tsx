import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { ContentContainer } from '@/components/shell/ContentContainer';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { StatCard } from '@/components/ui/StatCard';
import { tokens } from '@/components/ui/tokens';
import { hasCompletedOnboarding } from '@/lib/onboarding/state';
import { getSessionUser } from '@/lib/supabase/server';
import { loadShellSafe } from '@/lib/safe/shell';

export const dynamic = 'force-dynamic';

/**
 * Overview, in the pre-approved state.
 *
 * MOCKED. The reference shows this screen once the pre-approval fee is paid, and
 * the real state behind it — the fee receipt, the attestations, the intake
 * review, the qualified balance — does not exist yet: payments, attestations and
 * the indexer are all excluded from Week 1.
 *
 * So the values below are the reference's demo state, marked as demo rather than
 * presented as this resident's records. The screen is gated on the onboarding
 * steps, which are real.
 */

interface Stage {
  readonly title: string;
  readonly meta: string;
  readonly status: string;
  readonly state: 'done' | 'active' | 'queued';
}

const STAGES: readonly Stage[] = [
  {
    title: 'Profile, household & proof of wealth',
    meta: '3 wallets · $403,216 · provenance clean',
    status: 'Completed',
    state: 'done',
  },
  {
    title: 'Fee paid · account pre-approved',
    meta: 'kade.fee.v1 · demo pricing',
    status: 'Completed',
    state: 'done',
  },
  {
    title: 'Identity verified',
    meta: 'Verify with Self · do this in Residency',
    status: 'In progress',
    state: 'active',
  },
  {
    title: 'Qualified holdings funded',
    meta: '$0 · $425,000 to 5-year tier',
    status: 'In progress',
    state: 'active',
  },
  {
    title: 'Intake review',
    meta: 'Admin review · account pre-approved meanwhile',
    status: 'In progress',
    state: 'active',
  },
  {
    title: 'Start Residency · 2,000 USDC service fee',
    meta: 'Unlocks when identity, containers, documents and review are ready',
    status: 'Queued',
    state: 'queued',
  },
];

const NEXT_STEPS: readonly { label: string; note?: string }[] = [
  { label: 'Move funds into the qualified vault' },
  { label: 'Order Onchain Island Card', note: 'Unlocks after review' },
  { label: 'Start Residency — 0 of 4 ready', note: 'Open' },
];

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

  return (
    <AppShell
      email={session.email}
      safeAddress={shellSafe.address}
      safeDeployed={shellSafe.deployed}
      explorerUrl={shellSafe.explorerUrl}
    >
      <div
        style={{
          background: '#FDF6E7',
          color: '#8A5A12',
          fontSize: '13px',
          padding: '10px 32px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '16px',
        }}
      >
        <span>
          <strong>Pre-approved.</strong> Use the platform now — card issuance,
          bank payouts and borrowing unlock once intake review completes.
        </span>
        <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          Ref CW-2026-0409 ·{' '}
          <span style={{ fontWeight: 600 }}>demo data</span>
        </span>
      </div>

      <ContentContainer>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            gap: '24px',
            marginBottom: '24px',
          }}
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
              Your fee is paid and your account is pre-approved. Next: move funds
              into a qualified vault so they count toward your permit. Card,
              payouts and borrowing unlock once intake review completes.
            </p>
          </div>
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

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '14px',
            marginBottom: '16px',
          }}
        >
          <StatCard
            label="Qualifying balance"
            value="$0"
            sub="Below 3-year tier — $280,000 to go"
            valueColor={tokens.ink}
            highlight
          />
          <StatCard
            label="Account status"
            value="Pre-approved"
            sub="Intake review in progress"
            valueColor={tokens.warning}
          />
          <StatCard
            label="Fees paid onchain"
            value="1.75 USDC"
            sub="1 receipt · pre-approval · demo"
          />
          <StatCard label="Attestations" value="3" sub="KYC · fee · application" />
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)',
            gap: '16px',
            alignItems: 'start',
          }}
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

            <div style={{ marginTop: '10px' }}>
              {STAGES.map((stage, index) => (
                <div
                  key={stage.title}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '26px 1fr auto',
                    gap: '12px',
                    alignItems: 'center',
                    padding: '11px 0',
                    borderTop: `1px solid ${tokens.border}`,
                    opacity: stage.state === 'queued' ? 0.6 : 1,
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: '22px',
                      height: '22px',
                      borderRadius: '50%',
                      background:
                        stage.state === 'done'
                          ? tokens.brandPrimary
                          : stage.state === 'active'
                            ? '#FDF6E7'
                            : tokens.chipBg,
                      color:
                        stage.state === 'done'
                          ? '#fff'
                          : stage.state === 'active'
                            ? tokens.warning
                            : tokens.muted,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '11px',
                      fontWeight: 700,
                    }}
                  >
                    {stage.state === 'done' ? '✓' : index + 1}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '13.5px', fontWeight: 600 }}>
                      {stage.title}
                    </div>
                    <div style={{ fontSize: '12px', color: tokens.muted }}>
                      {stage.meta}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                      color:
                        stage.state === 'done'
                          ? tokens.success
                          : stage.state === 'active'
                            ? tokens.warning
                            : tokens.muted,
                    }}
                  >
                    {stage.status}
                  </span>
                </div>
              ))}
            </div>
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
                $0
              </div>
              <div style={{ marginTop: '6px', fontSize: '12.5px', color: tokens.muted }}>
                No Safe deployed yet · nothing is locked
              </div>
            </Card>

            <Card radius={14}>
              <h2 style={{ margin: '0 0 10px', fontSize: '17px', fontWeight: 600 }}>
                Next steps
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {NEXT_STEPS.map((step) => (
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
                    {step.note ? (
                      <span style={{ fontSize: '12px', color: tokens.muted }}>
                        {step.note}
                      </span>
                    ) : (
                      <span style={{ color: tokens.muted }}>→</span>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>

        <div style={{ marginTop: '16px' }}>
          <Chip tone="neutral" dot>
            Demo data · not this resident&rsquo;s records
          </Chip>
        </div>
      </ContentContainer>
    </AppShell>
  );
}
