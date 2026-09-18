'use client';

import { tokens } from '@/components/ui/tokens';

export interface EmailLinkSentProps {
  readonly email: string;
  readonly onUseDifferentEmail: () => void;
  readonly onResend: () => void;
  /** Seconds until resending is allowed again; 0 means now. */
  readonly resendInSeconds: number;
  readonly resending?: boolean;
}

/**
 * The confirmation shown after a magic link is accepted.
 *
 * Replaces the form rather than sitting beside it, so there is one thing to do
 * next. The resend wait mirrors the server's own rate limit instead of inviting
 * a request that will be rejected.
 */
export function EmailLinkSent({
  email,
  onUseDifferentEmail,
  onResend,
  resendInSeconds,
  resending = false,
}: EmailLinkSentProps) {
  const canResend = resendInSeconds <= 0 && !resending;

  return (
    <div>
      <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 600 }}>
        Check your email
      </h2>
      <p
        style={{
          margin: '8px 0 0',
          fontSize: '13.5px',
          color: tokens.chipFg,
          lineHeight: 1.55,
        }}
      >
        We sent a sign-in link to{' '}
        <strong style={{ fontWeight: 600 }}>{email}</strong>. Open it on this
        device to finish signing in. The link can be used once and expires.
      </p>

      <div
        style={{ display: 'flex', gap: '10px', marginTop: '16px', flexWrap: 'wrap' }}
      >
        <button
          type="button"
          onClick={onUseDifferentEmail}
          style={linkButton}
        >
          Use a different email
        </button>
        <button
          type="button"
          onClick={onResend}
          disabled={!canResend}
          style={{
            ...linkButton,
            color: canResend ? tokens.brandPrimary : tokens.locked,
            cursor: canResend ? 'pointer' : 'not-allowed',
          }}
        >
          {resending
            ? 'Sending…'
            : resendInSeconds > 0
              ? `Resend link in ${resendInSeconds}s`
              : 'Resend link'}
        </button>
      </div>
    </div>
  );
}

const linkButton: React.CSSProperties = {
  border: 0,
  background: 'transparent',
  padding: 0,
  fontFamily: 'inherit',
  fontSize: '13px',
  fontWeight: 600,
  color: tokens.brandPrimary,
  cursor: 'pointer',
  textDecoration: 'underline',
};
