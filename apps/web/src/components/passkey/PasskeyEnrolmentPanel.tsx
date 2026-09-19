'use client';

import { useState } from 'react';
import type { ApplicationSession } from '@kade/shared';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { tokens } from '@/components/ui/tokens';
import {
  enrolPasskey,
  type PasskeyEnrolmentRecord,
} from '@/lib/passkey/enrolment';
import { passkeyStore } from '@/lib/passkey/store';

export interface PasskeyEnrolmentPanelProps {
  readonly configured: boolean;
  readonly session: ApplicationSession;
}

function randomChallenge(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function shortCredentialId(id: string): string {
  return id.length > 18 ? `${id.slice(0, 10)}…${id.slice(-6)}` : id;
}

export function PasskeyEnrolmentPanel({
  configured,
  session,
}: PasskeyEnrolmentPanelProps) {
  const [record, setRecord] = useState<PasskeyEnrolmentRecord | null>(null);
  const [signerAddress, setSignerAddress] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Ask the chain for the signer this credential owns, so the panel reports the
   * real address rather than a placeholder state. The passkey exists either way,
   * so a failure here is not an error the resident needs to act on.
   */
  async function resolveSigner(publicKey: string) {
    try {
      const [{ parseP256PublicKey }, { deriveAccount }] = await Promise.all([
        import('@/lib/passkey/public-key'),
        import('@/app/onboarding/signer-actions'),
      ]);
      const { x, y } = parseP256PublicKey(publicKey);
      const derived = await deriveAccount(
        x.toString(),
        y.toString(),
        session.userId,
      );
      setSignerAddress(derived.signerAddress);
    } catch {
      setSignerAddress(null);
    }
  }

  async function handleEnrol() {
    setError(null);
    setPending(true);
    try {
      const rpId =
        typeof window !== 'undefined' ? window.location.hostname : 'localhost';
      const created = await enrolPasskey(session, {
        rpId,
        rpName: 'Kade',
        userId: session.userId,
        userName: session.email || session.userId,
        challenge: randomChallenge(),
      });
      // Persistence seam: in-memory only until a database is reachable.
      await passkeyStore().save(session.userId, created);
      setRecord(created);
      void resolveSigner(created.publicKey);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The passkey could not be created.',
      );
    } finally {
      setPending(false);
    }
  }

  if (!configured) {
    return (
      <div
        style={{
          background: tokens.surface,
          border: `1px solid ${tokens.border}`,
          borderRadius: '14px',
          padding: '18px 20px',
        }}
      >
        <p style={{ margin: 0, fontSize: '13px', color: tokens.chipFg }}>
          Passkey enrolment requires an authenticated session, and
          authentication is not configured. This panel is intentionally locked.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        background: tokens.surface,
        border: `1px solid ${tokens.border}`,
        borderRadius: '14px',
        padding: '18px 20px',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: '12px',
          marginBottom: '10px',
        }}
      >
        <div style={{ fontSize: '15px', fontWeight: 600 }}>
          Transaction passkey
        </div>
        <Chip tone="warning">Scaffold</Chip>
      </div>
      <p
        style={{
          margin: '0 0 14px',
          fontSize: '12.5px',
          color: tokens.muted,
          lineHeight: 1.6,
        }}
      >
        Enrolment requests WebAuthn user verification. It does not sign
        anything and cannot authorise a transaction by itself. The attestation
        response is not verified server-side in this scaffold. Metadata is stored
        in memory only, so it does not yet survive a reload.
      </p>

      {record ? (
        <div
          style={{
            background: '#fff',
            border: `1px solid ${tokens.border}`,
            borderRadius: '12px',
            padding: '12px 14px',
            fontSize: '12.5px',
            color: tokens.chipFg,
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          <div>
            <strong>Credential</strong>{' '}
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {shortCredentialId(record.credentialId)}
            </span>
          </div>
          <div>
            <strong>Transports</strong>{' '}
            {record.transports.length > 0 ? record.transports.join(', ') : '—'}
          </div>
          <div>
            <strong>User verification</strong>{' '}
            {record.userVerification
              ? 'required in the enrolment options'
              : 'not requested'}
          </div>
          <div>
            <strong>Signer address</strong>{' '}
            {signerAddress ? (
              <span style={{ fontVariantNumeric: 'tabular-nums', wordBreak: 'break-all' }}>
                {signerAddress}
              </span>
            ) : (
              <span style={{ color: tokens.muted }}>—</span>
            )}
          </div>
          <div>
            <strong>Created</strong> {record.createdAt}
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: '14px' }}>
        <Button onClick={handleEnrol} disabled={pending}>
          {pending ? 'Waiting for authenticator…' : 'Create transaction passkey'}
        </Button>
        {error ? (
          <p
            role="alert"
            style={{ margin: '10px 0 0', fontSize: '12.5px', color: tokens.danger }}
          >
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
