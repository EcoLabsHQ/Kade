import { tokens } from '@/components/ui/tokens';
import { SetupSidebar } from '@/components/shell/SetupSidebar';
import { ContentContainer } from '@/components/shell/ContentContainer';
import { SiteFooter } from '@/components/shell/SiteFooter';
import type { StepperItem } from '@/components/onboarding/PreRegistrationStepper';
import type { AccountState } from './AccountSummary';
import { AuthPanel } from './AuthPanel';
import type { SignInMethod } from './SignInMethodGroup';

export interface LoginScreenProps {
  readonly configured: boolean;
  readonly available: Readonly<Record<SignInMethod, boolean>>;
  readonly callbackUrl: string;
  readonly network: string;
  readonly accountState: AccountState;
  /** True when we know the visitor already has an account (for example they
   *  just signed out), which changes only the heading copy. */
  readonly returning?: boolean;
  readonly reason?: string;
  readonly error?: string;
}

/**
 * Account creation / sign-in, as step 1 of the resident setup flow.
 *
 * The reference renders this step inside the setup shell, so it carries the
 * sidebar and the footer rather than standing alone. Only the sign-in methods
 * differ from the reference: contract section 2 item 2 (amended v1.2) permits
 * Google OAuth and email magic link, not the prototype's passkey or wallet.
 */
const STEPS: readonly StepperItem[] = [
  { title: 'Create account', state: 'active' },
  {
    title: 'Profile & household',
    state: 'locked',
    lockReason: 'Sign in to continue.',
  },
  {
    title: 'Proof of wealth',
    state: 'locked',
    lockReason: 'Sign in to continue.',
  },
  {
    title: 'Pay pre-approval fee',
    state: 'locked',
    lockReason: 'Sign in to continue.',
  },
];

function statusMessage(error?: string, reason?: string): string | null {
  if (error === 'missing-code') {
    return 'The sign-in provider did not return an authorisation code. Please try again.';
  }
  if (error === 'callback-failed') {
    return 'The sign-in link could not be completed. Request a new one and try again.';
  }
  if (reason === 'signed-out') {
    return 'You have been signed out.';
  }
  return null;
}

export function LoginScreen({
  configured,
  available,
  callbackUrl,
  network,
  accountState,
  returning = false,
  reason,
  error,
}: LoginScreenProps) {
  const message = statusMessage(error, reason);
  // Connected, but neither provider is enabled: the redirect would land on the
  // provider's raw error, so say so here instead.
  const noMethodEnabled =
    configured && !available.google && !available.email;

  return (
    <div
      className="kade-shell"
      style={{
        minHeight: '100vh',
        background: '#fff',
        display: 'flex',
        alignItems: 'stretch',
        animation: 'fadeUp .2s ease-out',
      }}
    >
      <SetupSidebar steps={STEPS} network={network} accountState={accountState} />

      <main
        className="kade-content"
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <ContentContainer footer={<SiteFooter />}>
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

          <h1
            style={{
              margin: '8px 0 6px',
              fontSize: '30px',
              fontWeight: 700,
              letterSpacing: '-.02em',
            }}
          >
            {returning ? 'Welcome back' : 'Create your account'}
          </h1>

          <p
            style={{
              margin: '0 0 24px',
              color: tokens.muted,
              maxWidth: '62ch',
              textWrap: 'pretty',
            }}
          >
            {returning
              ? 'Sign in to continue your application.'
              : 'Sign in with Google or a one-time email link. A Safe smart account on Ethereum is created for you in the background — no seed phrase to manage.'}
          </p>

          {noMethodEnabled ? (
            <div
              role="status"
              style={{
                margin: '0 0 16px',
                background: '#FDF6E7',
                border: `1px solid ${tokens.warning}`,
                borderRadius: '12px',
                padding: '14px 16px',
                maxWidth: '560px',
              }}
            >
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 700,
                  letterSpacing: '.04em',
                  textTransform: 'uppercase',
                  color: tokens.warning,
                }}
              >
                No sign-in method is enabled
              </div>
              <p
                style={{
                  margin: '6px 0 0',
                  fontSize: '13px',
                  color: tokens.chipFg,
                  lineHeight: 1.55,
                }}
              >
                This project is connected, but neither Google nor email sign-in is
                enabled on it yet.
              </p>
            </div>
          ) : null}

          {message ? (
            <p
              role="status"
              style={{
                margin: '0 0 16px',
                fontSize: '13px',
                color: tokens.chipFg,
                background: tokens.surface,
                border: `1px solid ${tokens.border}`,
                borderRadius: '10px',
                padding: '10px 12px',
                maxWidth: '560px',
              }}
            >
              {message}
            </p>
          ) : null}

          <AuthPanel
            configured={configured}
            available={available}
            callbackUrl={callbackUrl}
            accountState={accountState}
          />
        </ContentContainer>
      </main>
    </div>
  );
}
