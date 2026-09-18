import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { ContentContainer } from '@/components/shell/ContentContainer';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { StatCard } from '@/components/ui/StatCard';
import { tokens } from '@/components/ui/tokens';
import { providerLabel } from '@/lib/auth/provider-label';
import { getSessionUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const session = await getSessionUser();
  if (!session) {
    redirect('/login');
  }

  return (
    <AppShell email={session.email}>
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
              Bon bini
            </h1>
            <p
              style={{
                margin: '10px 0 0',
                color: tokens.muted,
                maxWidth: '60ch',
                textWrap: 'pretty',
              }}
            >
              You are signed in through {providerLabel(session.provider)}. Your
              transaction passkey is separate and not yet enrolled.
            </p>
          </div>
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
            label="Account status"
            value="Signed in"
            sub={`${providerLabel(session.provider)} application session`}
            valueColor={tokens.success}
          />
          <StatCard
            label="Qualifying balance"
            value="—"
            sub="No chain data source configured"
          />
          <StatCard
            label="Fees paid onchain"
            value="—"
            sub="No fee receipts available"
          />
          <StatCard label="Attestations" value="—" sub="None issued" />
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.5fr 1fr',
            gap: '16px',
            alignItems: 'start',
          }}
        >
          <Card radius={14}>
            <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 600 }}>
              Your account
            </h2>
            <div style={{ marginTop: '12px', fontSize: '13.5px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '12px',
                  padding: '10px 0',
                  borderTop: `1px solid ${tokens.border}`,
                }}
              >
                <span style={{ color: tokens.muted }}>Sign-in</span>
                <span style={{ fontWeight: 600 }}>
                  {providerLabel(session.provider)}
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '12px',
                  padding: '10px 0',
                  borderTop: `1px solid ${tokens.border}`,
                }}
              >
                <span style={{ color: tokens.muted }}>Transaction passkey</span>
                <Chip tone="warning">Not enrolled</Chip>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '12px',
                  padding: '10px 0',
                  borderTop: `1px solid ${tokens.border}`,
                }}
              >
                <span style={{ color: tokens.muted }}>Safe</span>
                <Chip tone="muted">Not deployed</Chip>
              </div>
            </div>
            <p
              style={{
                margin: '12px 0 0',
                fontSize: '12px',
                color: tokens.muted,
                lineHeight: 1.6,
              }}
            >
              The resident Safe and its Sepolia address are owned by the
              Account workstream. Nothing is shown here until a deployment
              record exists, so no address is fabricated.
            </p>
          </Card>

          <Card radius={14}>
            <h2 style={{ margin: '0 0 10px', fontSize: '17px', fontWeight: 600 }}>
              Next steps
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <Link
                href="/account"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: '#fff',
                  border: `1px solid ${tokens.border}`,
                  borderRadius: '10px',
                  padding: '11px 14px',
                  fontSize: '13.5px',
                  fontWeight: 500,
                  color: tokens.ink,
                  textDecoration: 'none',
                }}
              >
                <span>Enrol the transaction passkey</span>
                <span style={{ color: tokens.muted }}>→</span>
              </Link>
              <Link
                href="/onboarding"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: '#fff',
                  border: `1px solid ${tokens.border}`,
                  borderRadius: '10px',
                  padding: '11px 14px',
                  fontSize: '13.5px',
                  fontWeight: 500,
                  color: tokens.ink,
                  textDecoration: 'none',
                }}
              >
                <span>Open the residency setup shell</span>
                <span style={{ color: tokens.muted }}>→</span>
              </Link>
            </div>
          </Card>
        </div>
      </ContentContainer>
    </AppShell>
  );
}
