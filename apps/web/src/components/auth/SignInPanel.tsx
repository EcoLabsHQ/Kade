'use client';

import { useState } from 'react';
import { assertGoogleOnlySignIn } from '@/lib/auth/provider';
import { AuthNotConfiguredError } from '@/lib/auth/errors';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { tokens } from '@/components/ui/tokens';
import { Button } from '@/components/ui/Button';
import { GoogleGlyph } from './GoogleGlyph';

export interface SignInPanelProps {
  readonly configured: boolean;
  readonly callbackUrl: string;
}

/**
 * Google sign-in.
 *
 * Contract section 2 item 2: Google is the only provider. D3: the sign-in
 * flow must not prompt for a passkey, so this component never touches the
 * WebAuthn API.
 */
export function SignInPanel({ configured, callbackUrl }: SignInPanelProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    // Encode D3: the sign-in steps contain no passkey/WebAuthn step.
    assertGoogleOnlySignIn();
    setError(null);
    setPending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: callbackUrl },
      });
      if (signInError) {
        setError(signInError.message);
        setPending(false);
      }
    } catch (cause) {
      setError(
        cause instanceof AuthNotConfiguredError
          ? cause.message
          : 'Sign-in could not be started. Please try again.',
      );
      setPending(false);
    }
  }

  return (
    <div style={{ marginTop: '18px' }}>
      <Button
        variant={configured ? 'primary' : 'locked'}
        disabled={!configured || pending}
        onClick={handleSignIn}
        title={
          configured
            ? 'Continue with Google'
            : 'Set the Supabase environment variables to enable sign-in'
        }
      >
        <GoogleGlyph />
        {pending ? 'Opening Google…' : 'Continue with Google'}
      </Button>
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
