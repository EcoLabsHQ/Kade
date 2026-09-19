import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { ContentContainer } from '@/components/shell/ContentContainer';
import { Card } from '@/components/ui/Card';
import { tokens } from '@/components/ui/tokens';
import { PasskeyEnrolmentPanel } from '@/components/passkey/PasskeyEnrolmentPanel';
import { providerLabel } from '@/lib/auth/provider-label';
import { isAuthConfigured, readAuthEnv } from '@/lib/env';
import { getSessionUser } from '@/lib/supabase/server';
import { loadPasskeyCredential } from './passkey-actions';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const session = await getSessionUser();
  if (!session) {
    redirect('/login');
  }
  const configured = isAuthConfigured(readAuthEnv());
  const storedCredential = await loadPasskeyCredential();

  return (
    <AppShell email={session.email}>
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
          Account &amp; passkey
        </h1>
        <p
          style={{
            margin: '0 0 24px',
            color: tokens.muted,
            maxWidth: '62ch',
            textWrap: 'pretty',
          }}
        >
          Your {providerLabel(session.provider)} session identifies you to
          Kade. It cannot move funds. The passkey is a second authority that
          exists only to authorise Safe transactions.
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '16px',
            alignItems: 'start',
            maxWidth: '960px',
          }}
        >
          <Card radius={14}>
            <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>
              Application session
            </h2>
            <div
              style={{
                marginTop: '12px',
                fontSize: '13px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <Row label="Provider" value={session.provider} />
              <Row label="Email" value={session.email || '—'} />
              <Row label="User id" value={session.userId} mono />
              <Row
                label="Authority"
                value="application-session · no transaction authority"
              />
            </div>
          </Card>

          <PasskeyEnrolmentPanel
            configured={configured}
            session={session}
            initialCredential={storedCredential}
          />
        </div>
      </ContentContainer>
    </AppShell>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: '12px',
        padding: '8px 0',
        borderTop: `1px solid ${tokens.border}`,
      }}
    >
      <span style={{ color: tokens.muted }}>{label}</span>
      <span
        style={{
          fontWeight: 600,
          fontVariantNumeric: mono ? 'tabular-nums' : undefined,
          wordBreak: 'break-all',
          textAlign: 'right',
        }}
      >
        {value}
      </span>
    </div>
  );
}
