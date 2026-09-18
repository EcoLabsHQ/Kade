import { Chip } from '@/components/ui/Chip';
import { tokens } from '@/components/ui/tokens';
import { GoogleGlyph } from '@/components/auth/GoogleGlyph';
import { NotConfiguredNotice } from '@/components/auth/NotConfiguredNotice';
import { SignInPanel } from '@/components/auth/SignInPanel';
import { Logo } from '@/components/shell/Logo';
import { NetworkChip } from '@/components/shell/NetworkChip';

const METHOD_ROW: React.CSSProperties = {
  border: `1px solid ${tokens.border}`,
  background: '#fff',
  borderRadius: '12px',
  padding: '14px 16px',
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
};

const METHOD_SUB: React.CSSProperties = {
  fontSize: '12px',
  color: tokens.muted,
  marginTop: '2px',
};

const METHOD_GLYPH: React.CSSProperties = {
  width: '22px',
  height: '22px',
  flex: '0 0 22px',
  borderRadius: '50%',
  background: tokens.chipBg,
  color: tokens.chipFg,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '12px',
  fontWeight: 700,
};

export interface LoginScreenProps {
  readonly configured: boolean;
  /** false only when the project is connected and the method is known-disabled. */
  readonly googleEnabled?: boolean;
  readonly emailEnabled?: boolean;
  readonly anyProviderEnabled?: boolean;
  readonly callbackUrl: string;
  readonly reason?: string;
  readonly error?: string;
  readonly next?: string;
}

function statusMessage(error?: string, reason?: string): string | null {
  if (error === 'missing-code') {
    // The callback is shared by both providers, so do not name one.
    return 'The sign-in provider did not return an authorisation code. Please try again.';
  }
  if (error === 'callback-failed') {
    return 'The sign-in callback could not be completed. Please try again.';
  }
  if (reason === 'signed-out') {
    return 'You have been signed out.';
  }
  return null;
}

/**
 * Login screen.
 *
 * Visual language ported from the reference's "Create your account" step
 * (template.html lines 268-285), but with the contract's frozen auth model as
 * amended v1.2: Google OAuth and email magic link are the methods, there is no
 * password field and no wallet option, and the passkey is not requested here.
 */
export function LoginScreen({
  configured,
  googleEnabled = true,
  emailEnabled = true,
  anyProviderEnabled = true,
  callbackUrl,
  reason,
  error,
  next,
}: LoginScreenProps) {
  const message = statusMessage(error, reason);
  const notConfigured = !configured || reason === 'not-configured';
  // Connected but the provider is missing: a different problem, with a
  // different fix. Never conflate the two.
  const providerDisabled = configured && !anyProviderEnabled;

  return (
    <div style={{ minHeight: '100vh', background: '#fff' }}>
      <div
        style={{
          maxWidth: '1160px',
          width: '100%',
          margin: '0 auto',
          padding: '36px 40px 64px',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '28px',
          }}
        >
          <Logo />
          <NetworkChip label="Ethereum Sepolia" />
        </header>

        <section style={{ minWidth: 0, maxWidth: '900px' }}>
          <div style={{ animation: 'fadeUp .2s ease-out' }}>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                color: tokens.muted,
              }}
            >
              Step 1 of 4
            </div>
            <h2
              style={{
                margin: '8px 0 6px',
                fontSize: '30px',
                fontWeight: 700,
                letterSpacing: '-.02em',
              }}
            >
              Create your account
            </h2>
            <p
              style={{
                margin: '0 0 24px',
                color: tokens.muted,
                maxWidth: '62ch',
                textWrap: 'pretty',
              }}
            >
              Sign in with Google or a one-time email link. A Safe smart
              account on Ethereum is created for you in the background — no seed
              phrase to manage. A separate passkey is enrolled later and
              authorises transactions only.
            </p>

            <div
              style={{
                background: tokens.surface,
                border: `1px solid ${tokens.border}`,
                borderRadius: '16px',
                padding: '22px 24px',
                maxWidth: '560px',
              }}
            >
              {notConfigured ? <NotConfiguredNotice /> : null}
              {providerDisabled ? (
                <NotConfiguredNotice
                  title="No sign-in method is enabled"
                  detail={
                    'This Supabase project is connected, but neither the Google ' +
                    'nor the email provider is enabled on it, so sign-in cannot ' +
                    'start. Enable one in the Supabase dashboard under ' +
                    'Authentication > Providers, then add this app\u2019s ' +
                    'callback URL to the project\u2019s redirect allow-list.'
                  }
                />
              ) : null}

              {message ? (
                <p
                  role="status"
                  style={{
                    margin: '0 0 16px',
                    padding: '10px 14px',
                    background: '#fff',
                    border: `1px solid ${tokens.border}`,
                    borderRadius: '10px',
                    fontSize: '13px',
                    color: tokens.chipFg,
                  }}
                >
                  {message}
                </p>
              ) : null}

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
              <div style={{ display: 'grid', gap: '10px' }}>
                <div style={METHOD_ROW}>
                  <GoogleGlyph size={22} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14px', fontWeight: 600 }}>Google</div>
                    <div style={METHOD_SUB}>Continue with your Google account</div>
                  </div>
                </div>
                <div style={METHOD_ROW}>
                  <span aria-hidden style={METHOD_GLYPH}>
                    @
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14px', fontWeight: 600 }}>
                      Email link
                    </div>
                    <div style={METHOD_SUB}>
                      A one-time sign-in link. No password.
                    </div>
                  </div>
                </div>
              </div>
              <p
                style={{
                  margin: '8px 0 0',
                  fontSize: '11.5px',
                  color: tokens.muted,
                }}
              >
                Not offered in Week 1: passwords, wallet login, and external
                wallets (contract section 2 item 2, amended v1.2, and section 9).
              </p>

              <div
                style={{
                  marginTop: '18px',
                  background: '#fff',
                  border: `1px solid ${tokens.border}`,
                  borderRadius: '12px',
                  padding: '14px 16px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '12px', color: tokens.muted }}>
                    Your Onchain Island account
                  </div>
                  <div
                    style={{
                      fontSize: '14px',
                      fontWeight: 600,
                      fontVariantNumeric: 'tabular-nums',
                      marginTop: '2px',
                    }}
                  >
                    Safe · not yet deployed · Ethereum Sepolia
                  </div>
                  <div
                    style={{
                      fontSize: '11px',
                      color: tokens.muted,
                      marginTop: '4px',
                    }}
                  >
                    No address is shown because no Safe has been deployed in
                    this environment. The address is withheld rather than
                    fabricated.
                  </div>
                </div>
                <Chip tone="neutral" dot dotColor={tokens.muted}>
                  Not yet created
                </Chip>
              </div>

              <SignInPanel
                configured={configured}
                googleEnabled={googleEnabled}
                emailEnabled={emailEnabled}
                callbackUrl={callbackUrl}
              />

              {next ? (
                <p
                  style={{
                    margin: '12px 0 0',
                    fontSize: '11.5px',
                    color: tokens.muted,
                  }}
                >
                  After sign-in you will return to{' '}
                  <code style={{ fontFamily: 'ui-monospace, monospace' }}>
                    {next}
                  </code>
                  .
                </p>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
