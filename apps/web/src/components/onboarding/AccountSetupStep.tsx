'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { tokens } from '@/components/ui/tokens';
import { AccountSummary } from '@/components/auth/AccountSummary';

/**
 * Step 1 — create the transaction passkey.
 *
 * REAL: the passkey is created through WebAuthn with user verification, in the
 * authenticator, and its credential id is returned. It is not a login method and
 * it is not the session (contract section 2 item 3, ADR 0003); it exists only to
 * authorise Safe transactions, and the sign-in screen never asks for it.
 *
 * NOT YET POSSIBLE: the Safe itself. Its address is derived from the passkey's
 * public key plus the Safe factory, singleton, fallback handler, WebAuthn signer
 * factory and salt nonce — every one of which is project-supplied and blocked
 * behind the Account gate (contract section 5). Deriving with placeholder values
 * would produce an address that is meaningless and, worse, looks real. So this
 * screen reports the passkey honestly and states plainly that the account
 * address is waiting on those inputs.
 */
export interface AccountSetupStepProps {
  readonly rpId: string;
  readonly userId: string;
  readonly userName: string;
  readonly credentialId: string | null;
  readonly onEnrolled: (credentialId: string) => void;
  readonly onContinue: () => void;
}

/** A 32-byte challenge. [arbitrary] client-side: a production flow issues it server-side. */
function randomChallenge(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function AccountSetupStep({
  rpId,
  userId,
  userName,
  credentialId,
  onEnrolled,
  onContinue,
}: AccountSetupStepProps) {
  const [status, setStatus] = useState<'idle' | 'creating' | 'done' | 'error'>(
    credentialId ? 'done' : 'idle',
  );
  const [error, setError] = useState<string | null>(null);

  async function createPasskey() {
    setStatus('creating');
    setError(null);
    try {
      const { enrolPasskey } = await import('@/lib/passkey/enrolment');
      const record = await enrolPasskey(
        {
          domain: 'application-session',
          provider: 'email',
          userId,
          email: userName,
        },
        {
          rpId,
          rpName: 'Onchain Island',
          userId,
          userName,
          challenge: randomChallenge(),
        },
      );
      onEnrolled(record.credentialId);
      setStatus('done');
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The passkey could not be created.',
      );
      setStatus('error');
    }
  }

  const enrolled = status === 'done';

  return (
    <div style={{ animation: 'fadeUp .2s ease-out' }}>
      <div style={eyebrow}>Step 1 of 4</div>
      <h1 style={heading}>Create your account</h1>
      <p style={lead}>
        Your passkey authorises transactions on your Safe. It is not your login —
        that stays with your email — and it never leaves this device.
      </p>

      <Card padding="22px 24px" style={{ maxWidth: '560px' }}>
        <AccountSummary
          state={
            enrolled
              ? {
                  kind: 'error',
                  message: 'Passkey created · Safe address pending approval',
                }
              : { kind: 'pending' }
          }
        />

        <div style={{ marginTop: '18px' }}>
          {enrolled ? (
            <>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: tokens.success,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: tokens.success,
                  }}
                />
                Transaction passkey created with user verification
              </div>
              <div
                style={{
                  marginTop: '6px',
                  fontSize: '12px',
                  color: tokens.muted,
                  fontVariantNumeric: 'tabular-nums',
                  wordBreak: 'break-all',
                }}
              >
                Credential {credentialId?.slice(0, 24)}…
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void createPasskey()}
              disabled={status === 'creating'}
              style={{
                ...primaryButton,
                background: status === 'creating' ? tokens.locked : tokens.action,
                cursor: status === 'creating' ? 'wait' : 'pointer',
              }}
            >
              {status === 'creating' ? 'Waiting for your device…' : 'Create passkey'}
            </button>
          )}
        </div>

        <div
          style={{
            marginTop: '18px',
            paddingTop: '14px',
            borderTop: `1px solid ${tokens.border}`,
            fontSize: '12px',
            color: tokens.muted,
            lineHeight: 1.6,
          }}
        >
          <strong style={{ color: tokens.chipFg, fontWeight: 600 }}>
            Your Safe address is not shown yet.
          </strong>{' '}
          It is derived from this passkey plus the Safe factory, singleton,
          fallback handler, WebAuthn signer factory and salt nonce. Those are
          project-supplied and awaiting the Account gate, so no address is shown
          rather than one derived from placeholders.
        </div>

        {error ? (
          <p
            role="alert"
            style={{ margin: '12px 0 0', fontSize: '12.5px', color: tokens.danger }}
          >
            {error}
          </p>
        ) : null}
      </Card>

      <div style={{ marginTop: '24px' }}>
        <button
          type="button"
          disabled={!enrolled}
          onClick={onContinue}
          title={enrolled ? 'Continue' : 'Create your passkey first'}
          style={{
            ...primaryButton,
            background: enrolled ? tokens.action : tokens.locked,
            cursor: enrolled ? 'pointer' : 'not-allowed',
          }}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

const eyebrow: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: tokens.muted,
};

const heading: React.CSSProperties = {
  margin: '8px 0 6px',
  fontSize: '30px',
  fontWeight: 700,
  letterSpacing: '-.02em',
};

const lead: React.CSSProperties = {
  margin: '0 0 24px',
  color: tokens.muted,
  maxWidth: '62ch',
  textWrap: 'pretty',
};

const primaryButton: React.CSSProperties = {
  height: '46px',
  padding: '0 22px',
  border: 0,
  borderRadius: '999px',
  color: '#fff',
  fontFamily: 'inherit',
  fontSize: '15px',
  fontWeight: 600,
};
