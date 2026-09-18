'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { assertPermittedSignIn } from '@/lib/auth/provider';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { Button } from '@/components/ui/Button';
import { tokens } from '@/components/ui/tokens';
import { AccountSummary, type AccountState } from './AccountSummary';
import { EmailLinkForm } from './EmailLinkForm';
import { EmailLinkSent } from './EmailLinkSent';
import { SignInMethodGroup, type SignInMethod } from './SignInMethodGroup';

export interface AuthPanelProps {
  readonly configured: boolean;
  readonly available: Readonly<Record<SignInMethod, boolean>>;
  readonly callbackUrl: string;
  readonly accountState: AccountState;
}

const FORM_ID = 'sign-in-form';
const emailSchema = z.string().trim().email();

/** [arbitrary] mirrors Supabase's default per-address email interval. */
const RESEND_COOLDOWN_SECONDS = 60;

const GOOGLE_FAILED =
  'We couldn’t sign you in with Google. Please try again or use an email link.';

/**
 * The sign-in card and its single primary action.
 *
 * Contract section 2 item 2 (amended v1.2): Google OAuth and email magic link
 * are the permitted methods. No password field, no wallet option, and the
 * passkey is never requested here (D3) — it is enrolled later as a transaction
 * authority.
 *
 * One button drives both methods: it lives below the card, as in the reference,
 * and submits the form via `form={FORM_ID}`. The handler dispatches on the
 * selected method, so there is never a second, unrelated action.
 */
export function AuthPanel({
  configured,
  available,
  callbackUrl,
  accountState,
}: AuthPanelProps) {
  // Google is the reference's default, but never select a method that is not
  // available on this project.
  const [method, setMethod] = useState<SignInMethod>(() =>
    available.google ? 'google' : 'email',
  );
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const sendLink = useCallback(
    async (address: string) => {
      setSending(true);
      setFormError(null);
      try {
        const supabase = createSupabaseBrowserClient();
        const { error } = await supabase.auth.signInWithOtp({
          email: address,
          options: { emailRedirectTo: callbackUrl, shouldCreateUser: true },
        });
        if (!alive.current) return;
        if (error) {
          // Keep what was typed: retyping an address after a transient failure
          // is exactly the friction this panel exists to remove.
          setFormError(error.message);
        } else {
          setSentTo(address);
          setCooldown(RESEND_COOLDOWN_SECONDS);
        }
      } catch {
        if (alive.current) {
          setFormError('The sign-in email could not be sent. Please try again.');
        }
      } finally {
        if (alive.current) setSending(false);
      }
    },
    [callbackUrl],
  );

  const continueWithGoogle = useCallback(async () => {
    // Encode D3: the sign-in flow acquires no passkey.
    assertPermittedSignIn();
    setFormError(null);
    setConnecting(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: callbackUrl },
      });
      if (error && alive.current) {
        setFormError(GOOGLE_FAILED);
        setConnecting(false);
      }
      // On success the browser is redirected away; nothing to reset.
    } catch {
      if (alive.current) {
        setFormError(GOOGLE_FAILED);
        setConnecting(false);
      }
    }
  }, [callbackUrl]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (connecting || sending) return;

    if (method === 'google') {
      void continueWithGoogle();
      return;
    }

    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setEmailError('Enter a valid email address.');
      setFormError(null);
      return;
    }
    setEmailError(null);
    void sendLink(parsed.data);
  }

  const busy = connecting || sending;
  // Never offer an action that cannot work: neither an unconfigured environment
  // nor a method that is disabled on the project can sign anyone in.
  const actionDisabled = !configured || !available[method] || busy;
  const actionLabel =
    method === 'google'
      ? connecting
        ? 'Connecting…'
        : 'Continue with Google'
      : sending
        ? 'Sending link…'
        : 'Email me a link';

  return (
    <div>
      <form
        id={FORM_ID}
        onSubmit={submit}
        noValidate
        style={{
          background: tokens.surface,
          border: `1px solid ${tokens.border}`,
          borderRadius: '16px',
          padding: '22px 24px',
          maxWidth: '560px',
        }}
      >
        {sentTo ? (
          <EmailLinkSent
            email={sentTo}
            resending={sending}
            resendInSeconds={cooldown}
            onUseDifferentEmail={() => {
              setSentTo(null);
              setCooldown(0);
            }}
            onResend={() => {
              if (cooldown > 0 || sending) return;
              void sendLink(sentTo);
            }}
          />
        ) : (
          <>
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: tokens.muted,
                  marginBottom: '6px',
                }}
              >
                Sign-in method
              </label>
              <SignInMethodGroup
                value={method}
                onChange={(next) => {
                  setMethod(next);
                  setFormError(null);
                  setEmailError(null);
                }}
                disabled={!configured}
                available={available}
              />
            </div>

            {method === 'email' ? (
              <div style={{ marginTop: '16px' }}>
                <EmailLinkForm
                  email={email}
                onEmailChange={(next) => {
                  setEmail(next);
                  setEmailError(null);
                }}
                  error={emailError}
                  disabled={sending}
                />
              </div>
            ) : null}

            <div style={{ marginTop: '18px' }}>
              <AccountSummary state={accountState} />
            </div>
          </>
        )}
      </form>

      {sentTo ? null : (
        <div style={{ marginTop: '22px' }}>
          <Button
            type="submit"
            form={FORM_ID}
            variant={actionDisabled ? 'locked' : 'primary'}
            disabled={actionDisabled}
            title={
              configured
                ? actionLabel
                : 'Sign-in is not configured in this environment'
            }
          >
            {actionLabel}
          </Button>
        </div>
      )}

      {formError ? (
        <p
          role="alert"
          style={{
            margin: '12px 0 0',
            fontSize: '13px',
            color: tokens.danger,
            maxWidth: '560px',
          }}
        >
          {formError}
        </p>
      ) : null}
    </div>
  );
}
