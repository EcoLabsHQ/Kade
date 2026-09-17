import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { ContentContainer } from '@/components/shell/ContentContainer';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Field } from '@/components/ui/Field';
import { FeeSummary } from '@/components/fees/FeeSummary';
import { tokens } from '@/components/ui/tokens';
import { getSessionUser } from '@/lib/supabase/server';
import { readFeeMode } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const session = await getSessionUser();
  if (!session) {
    redirect('/login');
  }

  // The active fee mode is a server-side configuration switch, passed down as a
  // prop. The client can display the amount but cannot select or override it.
  const feeMode = readFeeMode();

  return (
    <AppShell email={session.email}>
      <ContentContainer>
        <div
          style={{
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            color: tokens.muted,
          }}
        >
          Step 2 of 4
        </div>
        <h1
          style={{
            margin: '8px 0 6px',
            fontSize: '30px',
            fontWeight: 700,
            letterSpacing: '-.02em',
          }}
        >
          Tell us who is applying
        </h1>
        <p
          style={{
            margin: '0 0 24px',
            color: tokens.muted,
            maxWidth: '62ch',
            textWrap: 'pretty',
          }}
        >
          This route exists to prove the protected setup shell renders. The
          Step 1–2 fields, persistence and validation are delivered by the
          onboarding workstream (D5); the fields below are disabled placeholders
          and save nothing.
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.4fr 1fr',
            gap: '16px',
            maxWidth: '920px',
            alignItems: 'start',
          }}
        >
          <Card>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '14px',
              }}
            >
              <div
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  letterSpacing: '.08em',
                  textTransform: 'uppercase',
                  color: tokens.muted,
                }}
              >
                Principal applicant
              </div>
              <Chip tone="warning">Shell only</Chip>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '12px',
              }}
            >
              <Field id="first-name" label="First name" value="" readOnly />
              <Field id="last-name" label="Last name" value="" readOnly />
              <Field
                id="date-of-birth"
                label="Date of birth"
                value=""
                readOnly
                type="date"
              />
              <Field
                id="citizenships"
                label="Citizenships"
                value=""
                readOnly
                hint="Multiple citizenships are stored as rows, not free text."
              />
            </div>
          </Card>

          <Card>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                color: tokens.muted,
                marginBottom: '8px',
              }}
            >
              Pre-approval fee
            </div>
            <FeeSummary mode={feeMode} householdSize={3} />
            <p
              style={{
                margin: '12px 0 0',
                fontSize: '12px',
                color: tokens.muted,
                lineHeight: 1.6,
              }}
            >
              The active schedule is selected by{' '}
              <code style={{ fontFamily: 'ui-monospace, monospace' }}>
                KADE_FEE_MODE
              </code>{' '}
              on the server; a household of 3 is the contract&apos;s worked
              example (section 2.1). The displayed amount comes from
              <code style={{ fontFamily: 'ui-monospace, monospace' }}>
                {' '}
                @kade/shared
              </code>{' '}
              and the client cannot override it.
            </p>
          </Card>
        </div>
      </ContentContainer>
    </AppShell>
  );
}
