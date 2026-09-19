'use client';

import { useState } from 'react';
import { savePasskeyCredential } from '@/app/account/passkey-actions';
import { Card } from '@/components/ui/Card';
import { tokens } from '@/components/ui/tokens';
import type { SignerPersistence } from '@/lib/passkey/credential';

/**
 * Step 1 — create the transaction passkey, and derive the account from it.
 *
 * The passkey is created through WebAuthn with user verification, in the
 * authenticator, and authorises Safe transactions. It is not a login method and
 * it is not the session (contract section 2 item 3, ADR 0003), which is why the
 * sign-in screen never asks for it.
 *
 * The address shown afterwards is the resident's account: the Safe the passkey
 * will own. It is derived from the credential's public key plus inputs frozen in
 * `@kade/shared`, so it is the same address every time and different for every
 * resident. It is counterfactual — nothing is deployed — which is the ordinary
 * state of a Safe before its first transaction.
 */
export interface AccountSetupStepProps {
  readonly rpId: string;
  readonly userId: string;
  readonly userName: string;
  readonly credentialId: string | null;
  readonly onEnrolled: (credentialId: string) => void;
  readonly onContinue: () => void;
}

/** What is known about the account address once the passkey exists. */
type AccountAddress =
  | { readonly state: 'idle' }
  | { readonly state: 'deriving' }
  | { readonly state: 'ready'; readonly value: string }
  | { readonly state: 'unavailable' };

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
  const [account, setAccount] = useState<AccountAddress>({ state: 'idle' });
  const [signer, setSigner] = useState<SignerPersistence | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolveAccount(publicKey: string) {
    setAccount({ state: 'deriving' });
    try {
      const [{ parseP256PublicKey }, { deriveAccount }] = await Promise.all([
        import('@/lib/passkey/public-key'),
        import('@/app/onboarding/signer-actions'),
      ]);
      const { x, y } = parseP256PublicKey(publicKey);
      // The chain is asked for the signer address and for the factory's own
      // proxy creation code; the rest of the derivation is frozen on our side.
      const derived = await deriveAccount(x.toString(), y.toString(), userId);
      setAccount({ state: 'ready', value: derived.safeAddress });
    } catch {
      // The passkey is created and usable either way, so a failure to reach the
      // chain does not block the resident.
      setAccount({ state: 'unavailable' });
    }
  }

  async function createPasskey() {
    setStatus('creating');
    setError(null);
    setSigner(null);
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

      // D3: only a user-verified credential may be persisted. The real
      // enrolment asserts this too, but keeping the guard here makes the
      // call-site invariant explicit and testable.
      if (record.userVerification !== true) {
        throw new Error(
          'The passkey did not require user verification, so it was not saved.',
        );
      }

      // Persist through the existing server action so the credential survives
      // reload. The action derives the signer from the public key; the browser
      // names none. The address shown below is derived from the same persisted
      // public key, so one credential yields one signal.
      let credentialIdToReport = record.credentialId;
      let publicKeyToDerive = record.publicKey;
      try {
        const saved = await savePasskeyCredential({
          credentialId: record.credentialId,
          publicKey: record.publicKey,
          transports: record.transports,
          userVerification: record.userVerification,
        });
        setSigner(saved.signer);
        credentialIdToReport = saved.credential.credentialId;
        publicKeyToDerive = saved.credential.publicKey;
      } catch (cause) {
        // The passkey exists on the device even when the server write fails,
        // so the resident is not blocked. The screen simply must not claim the
        // credential was stored.
        setSigner({
          status: 'not-persisted',
          reason:
            cause instanceof Error
              ? cause.message
              : 'The passkey could not be saved.',
        });
      }

      onEnrolled(credentialIdToReport);
      setStatus('done');
      await resolveAccount(publicKeyToDerive);
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
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '15px', fontWeight: 600 }}>
                Passkey created
              </div>
              <div style={{ fontSize: '13px', color: tokens.muted, marginTop: '2px' }}>
                {signer?.status === 'not-persisted'
                  ? "Your passkey is on this device. We'll link it to your account shortly."
                  : 'Your account is ready.'}
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

        {enrolled ? (
          <div
            style={{
              marginTop: '18px',
              paddingTop: '14px',
              borderTop: `1px solid ${tokens.border}`,
            }}
          >
            <div style={{ fontSize: '12px', color: tokens.muted }}>
              Your account address
            </div>
            <div
              style={{
                marginTop: '4px',
                fontSize: '13px',
                fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
                wordBreak: 'break-all',
              }}
            >
              <AccountAddressLine account={account} />
            </div>
          </div>
        ) : null}

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

function AccountAddressLine({ account }: { readonly account: AccountAddress }) {
  if (account.state === 'ready') return <>{account.value}</>;
  if (account.state === 'deriving') {
    return <span style={{ color: tokens.muted, fontWeight: 500 }}>Preparing…</span>;
  }
  if (account.state === 'unavailable') {
    return (
      <span style={{ color: tokens.muted, fontWeight: 500 }}>
        Will appear once your account is set up.
      </span>
    );
  }
  return <span style={{ color: tokens.muted, fontWeight: 500 }}>—</span>;
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
