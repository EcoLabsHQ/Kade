'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { tokens } from '@/components/ui/tokens';

/**
 * Step 1 — create the transaction passkey.
 *
 * The passkey is created through WebAuthn with user verification, in the
 * authenticator, and authorises Safe transactions. It is not a login method and
 * it is not the session (contract section 2 item 3, ADR 0003), which is why the
 * sign-in screen never asks for it.
 *
 * This is the ordinary path for a new resident, so the screen reads like one:
 * it asks for the passkey, confirms it, and moves on. The Safe address is not
 * shown here because it belongs to the account once the account exists; nothing
 * is displayed that would have to be retracted later.
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
          : 'The passkey could not be created. Please try again.',
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
        Your passkey authorises transactions on your Safe. It stays on this
        device — there is nothing to remember and nothing to type.
      </p>

      <Card padding="22px 24px" style={{ maxWidth: '560px' }}>
        {enrolled ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <CheckMark />
            <div>
              <div style={{ fontSize: '15px', fontWeight: 600 }}>
                Passkey created
              </div>
              <div style={{ fontSize: '13px', color: tokens.muted, marginTop: '2px' }}>
                Your account is ready.
              </div>
            </div>
          </div>
        ) : (
          <>
            <div style={{ fontSize: '15px', fontWeight: 600 }}>
              Create a passkey
            </div>
            <div
              style={{
                fontSize: '13px',
                color: tokens.muted,
                marginTop: '4px',
                lineHeight: 1.6,
              }}
            >
              Your device will ask for your fingerprint, face or PIN.
            </div>
            <button
              type="button"
              onClick={() => void createPasskey()}
              disabled={status === 'creating'}
              style={{
                ...primaryButton,
                marginTop: '16px',
                background: status === 'creating' ? tokens.locked : tokens.action,
                cursor: status === 'creating' ? 'wait' : 'pointer',
              }}
            >
              {status === 'creating' ? 'Waiting for your device…' : 'Create passkey'}
            </button>
          </>
        )}

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

function CheckMark() {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: '0 0 auto',
        width: '26px',
        height: '26px',
        borderRadius: '50%',
        background: '#EAF6F0',
        color: tokens.success,
      }}
    >
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
        <path
          d="M2.5 6.8 5.2 9.5 10.5 3.8"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
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
