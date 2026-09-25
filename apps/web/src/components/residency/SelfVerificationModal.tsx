'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { tokens } from '@/components/ui/tokens';

/**
 * The Self handoff dialog (D16 / EXE-012).
 *
 * The resident is sent to Self's hosted `verificationUrl`: Self renders the QR
 * and the deeplink, scans the passport's NFC chip and verifies the proof in
 * backend (off-chain) mode. We never draw a QR and never fabricate a result.
 * This dialog renders the real link the server created, or says plainly why it
 * cannot (not configured / unavailable).
 *
 * What Kade learns is stated honestly: that the passport is valid, that the
 * resident is 18 or older, that they are not on a sanctions list, and the facts
 * Self discloses — nationality and passport expiry. Kade does NOT receive or
 * store the passport number, date of birth or photo.
 */

export interface SelfModalState {
  readonly status:
    | 'created'
    | 'not-configured'
    | 'unavailable'
    | 'unauthenticated';
  readonly verificationUrl?: string | null;
  readonly reason?: string | null;
}

export interface SelfVerificationModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** null while the session is being created. */
  readonly state: SelfModalState | null;
  /**
   * True while Self has not confirmed yet, so the dialog can show an honest
   * status line instead of a button that only pretends to check something.
   */
  readonly pending?: boolean;
}

const FACTS: readonly string[] = [
  'Your passport is genuine and current — verified by Self.',
  'You are 18 or older.',
  'You are not on a sanctions list.',
  'Kade receives only the facts Self discloses — your nationality and passport expiry — never your passport number, date of birth or photo.',
];

export function SelfVerificationModal({
  open,
  onClose,
  state,
  pending = true,
}: SelfVerificationModalProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  const url =
    state !== null && state.status === 'created'
      ? (state.verificationUrl ?? null)
      : null;

  return createPortal(
    <div onClick={onClose} style={backdrop}>
      <div
        role='dialog'
        aria-modal='true'
        aria-label='Verify your identity'
        onClick={(event) => event.stopPropagation()}
        style={card}
      >
        <div style={header}>
          <div>
            <div style={eyebrow}>Verify your identity</div>
            <div
              style={{ fontSize: '15px', fontWeight: 700, marginTop: '4px' }}
            >
              Powered by Self
            </div>
          </div>
          <button
            type='button'
            aria-label='Close'
            onClick={onClose}
            style={closeButton}
          >
            ×
          </button>
        </div>

        <div style={{ padding: '18px' }}>
          {state === null ? (
            <div style={bodyCopy} role='status'>
              Creating your Self verification session…
            </div>
          ) : state.status === 'created' && url !== null ? (
            <>
              <div style={bodyCopy}>
                Open Self to scan your passport&rsquo;s NFC chip. Self verifies
                the proof; no passport number, date of birth or photo comes to
                Kade.
              </div>

              {/*
                One control. Self's hosted page already decides how to continue:
                it shows a QR on desktop and an "Open Self app" button on mobile.
                Duplicating that choice here (a separate link, a separate button)
                only competed with it. When the resident finishes, Self sends them
                back to /residency via successUrl.
              */}

              <div style={whatLabel}>What Self verifies</div>
              <div style={factsBox}>
                {FACTS.map((fact) => (
                  <div key={fact} style={{ color: tokens.muted }}>
                    {fact}
                  </div>
                ))}
              </div>
              <a
                href={url}
                target='_blank'
                rel='noopener noreferrer'
                style={confirmButtonLink}
              >
                Continue with Self
              </a>
            </>
          ) : (
            <>
              <div style={bodyCopy} role='status'>
                {messageFor(state)}
              </div>
              <div style={linkFallback}>self.xyz</div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function messageFor(state: SelfModalState): string {
  switch (state.status) {
    case 'not-configured':
      return 'Self is not configured in this environment, so identity cannot be verified yet.';
    case 'unavailable':
      return (
        state.reason ?? 'Self is temporarily unavailable. Try again shortly.'
      );
    case 'unauthenticated':
      return 'Your session expired. Sign in again.';
    default:
      return 'Identity verification is unavailable.';
  }
}

const backdrop: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(16,24,40,.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '32px',
  zIndex: 60,
};

const card: CSSProperties = {
  background: '#fff',
  borderRadius: '18px',
  width: '100%',
  maxWidth: '420px',
  maxHeight: '86vh',
  overflow: 'auto',
  boxShadow: '0 30px 80px -20px rgba(16,24,40,.45)',
  animation: 'fadeUp .16s ease-out',
};

const header: CSSProperties = {
  padding: '18px 22px',
  borderBottom: `1px solid ${tokens.border}`,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '12px',
};

const eyebrow: CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: tokens.muted,
};

const closeButton: CSSProperties = {
  width: '28px',
  height: '28px',
  border: `1px solid ${tokens.border}`,
  background: '#fff',
  borderRadius: '50%',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: '14px',
  color: tokens.muted,
  lineHeight: 1,
  flex: '0 0 auto',
};

const bodyCopy: CSSProperties = {
  fontSize: '13.5px',
  color: tokens.chipFg,
  lineHeight: 1.6,
};

const whatLabel: CSSProperties = {
  marginTop: '16px',
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: tokens.muted,
};

const factsBox: CSSProperties = {
  marginTop: '6px',
  background: tokens.surface,
  border: `1px solid ${tokens.border}`,
  borderRadius: '12px',
  padding: '14px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  fontSize: '12.5px',
  lineHeight: 1.5,
};

const infoBox: CSSProperties = {
  marginTop: '14px',
  background: '#EAF2FC',
  borderRadius: '10px',
  padding: '11px 13px',
  fontSize: '12.5px',
  color: '#0063B5',
  lineHeight: 1.5,
};

const confirmButton: CSSProperties = {
  marginTop: '18px',
  width: '100%',
  height: '44px',
  border: 0,
  borderRadius: '999px',
  background: tokens.ink,
  color: '#fff',
  fontFamily: 'inherit',
  fontSize: '14.5px',
  fontWeight: 600,
  cursor: 'pointer',
};

const confirmButtonLink: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginTop: '18px',
  width: '100%',
  height: '44px',
  borderRadius: '999px',
  background: tokens.ink,
  color: '#fff',
  fontSize: '14.5px',
  fontWeight: 600,
  textDecoration: 'none',
};

const linkFallback: CSSProperties = {
  marginTop: '12px',
  fontSize: '11.5px',
  color: tokens.muted,
  textAlign: 'center',
  wordBreak: 'break-all',
};

const linkText: CSSProperties = {
  color: '#0063B5',
  textDecoration: 'underline',
};
