'use client';

import { useState } from 'react';
import { z } from 'zod';
import { assertPermittedSignIn } from '@/lib/auth/provider';
import { AuthNotConfiguredError } from '@/lib/auth/errors';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { tokens } from '@/components/ui/tokens';
import { Button } from '@/components/ui/Button';
import { GoogleGlyph } from './GoogleGlyph';

export interface SignInPanelProps {
  readonly configured: boolean;
  /** false only when the project is connected and the provider is known-disabled. */
  readonly googleEnabled?: boolean;
  readonly emailEnabled?: boolean;
  readonly callbackUrl: string;
}

/** Matches the browser's own notion of an address; the server validates too. */
const emailSchema = z.string().trim().email();

/**
 * Sign-in.
 *
 * Contract section 2 item 2 (amended v1.2): Google OAuth and email magic link
 * are the permitted methods. There is no password field and no wallet option.
 * D3: the flow must not prompt for a passkey, so this component never touches
 * the WebAuthn API.
 */
export function SignInPanel({
  configured,
  googleEnabled = true,
  emailEnabled = true,
  callbackUrl,
}: SignInPanelProps) {
  const [googlePending, setGooglePending] = useState(false);
  const [emailPending, setEmailPending] = useState(false);
  const [email, setEmail] = useState('');
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canUseGoogle = configured && googleEnabled;
  const canUseEmail = configured && emailEnabled;

  async function handleGoogle() {
    // Encode D3: the sign-in steps contain no passkey/WebAuthn step.
    assertPermittedSignIn();
    setError(null);
    setGooglePending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: callbackUrl },
      });
      if (signInError) {
        setError(signInError.message);
        setGooglePending(false);
      }
    } catch (cause) {
      setError(
        cause instanceof AuthNotConfiguredError
          ? cause.message
          : 'Sign-in could not be started. Please try again.',
      );
      setGooglePending(false);
    }
  }

  async function handleEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    assertPermittedSignIn();
    setError(null);

    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setError('Enter a valid email address.');
      return;
    }

    setEmailPending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: parsed.data,
        options: {
          emailRedirectTo: callbackUrl,
          // The first magic link creates the account, so a new resident is not
          // blocked on a separate signup screen.
          shouldCreateUser: true,
        },
      });
      if (otpError) {
        setError(otpError.message);
      } else {
        setEmailSentTo(parsed.data);
      }
      setEmailPending(false);
    } catch (cause) {
      setError(
        cause instanceof AuthNotConfiguredError
          ? cause.message
          : 'The sign-in email could not be sent. Please try again.',
      );
      setEmailPending(false);
    }
  }

  return (
    <div style={{ marginTop: '18px' }}>
      <Button
        variant={canUseGoogle ? 'primary' : 'locked'}
        disabled={!canUseGoogle || googlePending}
        onClick={handleGoogle}
        title={
          !configured
            ? 'Set the Supabase environment variables to enable sign-in'
            : !googleEnabled
              ? 'Enable the Google provider on the Supabase project first'
              : 'Continue with Google'
        }
      >
        <GoogleGlyph />
        {googlePending ? 'Opening Google…' : 'Continue with Google'}
      </Button>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          margin: '18px 0 14px',
          color: tokens.muted,
          fontSize: '12px',
        }}
      >
        <span style={{ flex: 1, height: '1px', background: tokens.border }} />
        or
        <span style={{ flex: 1, height: '1px', background: tokens.border }} />
      </div>

      {emailSentTo ? (
        <div
          role="status"
          style={{
            background: tokens.surface,
            border: `1px solid ${tokens.border}`,
            borderRadius: '12px',
            padding: '14px 16px',
            fontSize: '13px',
            color: tokens.chipFg,
            lineHeight: 1.55,
          }}
        >
          We sent a sign-in link to{' '}
          <strong style={{ fontWeight: 600 }}>{emailSentTo}</strong>. Open it on
          this device to finish signing in.
          <button
            type="button"
            onClick={() => {
              setEmailSentTo(null);
              setEmail('');
            }}
            style={{
              display: 'block',
              marginTop: '8px',
              border: 0,
              background: 'transparent',
              padding: 0,
              color: tokens.brandPrimary,
              fontFamily: 'inherit',
              fontSize: '12.5px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Use a different address
          </button>
        </div>
      ) : (
        // noValidate: run our own validation and show our own message rather
        // than being blocked by the browser's native constraint UI, which
        // suppresses the submit event entirely and leaves the user with a
        // browser tooltip and no app feedback.
        <form onSubmit={handleEmail} noValidate>
          <label
            htmlFor="sign-in-email"
            style={{
              display: 'block',
              fontSize: '12px',
              fontWeight: 600,
              color: tokens.muted,
              marginBottom: '6px',
            }}
          >
            Email
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              id="sign-in-email"
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              disabled={!canUseEmail || emailPending}
              style={{
                flex: 1,
                height: '44px',
                border: `1px solid ${tokens.border}`,
                borderRadius: '10px',
                padding: '0 14px',
                fontFamily: 'inherit',
                fontSize: '14.5px',
                background: canUseEmail ? '#fff' : tokens.surface,
                color: tokens.ink,
              }}
            />
            <Button
              type="submit"
              variant={canUseEmail ? 'primary' : 'locked'}
              disabled={!canUseEmail || emailPending}
              title={
                !configured
                  ? 'Set the Supabase environment variables to enable sign-in'
                  : !emailEnabled
                    ? 'Enable the email provider on the Supabase project first'
                    : 'Email me a sign-in link'
              }
            >
              {emailPending ? 'Sending…' : 'Email me a link'}
            </Button>
          </div>
          <p
            style={{
              margin: '8px 0 0',
              fontSize: '11.5px',
              color: tokens.muted,
            }}
          >
            A one-time link, no password. The link signs you in on this device.
          </p>
        </form>
      )}

      {error ? (
        <p
          role="alert"
          style={{
            margin: '10px 0 0',
            fontSize: '12.5px',
            color: tokens.danger,
          }}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
