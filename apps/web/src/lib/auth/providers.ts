/**
 * Which auth providers the configured Supabase project actually offers.
 *
 * The app can be perfectly wired to Supabase and still be unable to sign anyone
 * in, because the provider itself may not be enabled on the project. In that
 * case `signInWithOAuth` / `signInWithOtp` redirect the browser straight into a
 * raw error response, which is a dead end for the resident.
 *
 * This module asks the project first, so the UI can explain the real problem
 * instead of dropping the user on JSON.
 *
 * Fail-open by design: if the check cannot be made (offline, timeout, unexpected
 * shape) the provider is reported as `null` and the caller must let the user
 * try, rather than showing an error it cannot justify.
 */

import type { AuthEnv } from '@/lib/env';

export interface AuthProviderStatus {
  /** `true` enabled, `false` known-disabled, `null` could not be determined. */
  readonly google: boolean | null;
  /** Supabase's `email` provider, used here for magic links only. */
  readonly email: boolean | null;
  /** Whether the check actually reached the project. */
  readonly checked: boolean;
}

const UNKNOWN: AuthProviderStatus = { google: null, email: null, checked: false };

/** [arbitrary] short enough not to stall a page render, long enough for a RTT. */
const TIMEOUT_MS = 3000;

function readBoolean(source: unknown, key: string): boolean | null {
  if (typeof source !== 'object' || source === null) return null;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'boolean' ? value : null;
}

export async function fetchAuthProviderStatus(
  env: AuthEnv,
): Promise<AuthProviderStatus> {
  if (!env.supabaseUrl || !env.supabaseAnonKey) return UNKNOWN;

  try {
    const response = await fetch(`${env.supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: env.supabaseAnonKey },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return UNKNOWN;

    const body: unknown = await response.json();
    const external =
      typeof body === 'object' && body !== null
        ? (body as { external?: unknown }).external
        : undefined;

    const google = readBoolean(external, 'google');
    const email = readBoolean(external, 'email');
    if (google === null && email === null) return UNKNOWN;
    return { google, email, checked: true };
  } catch {
    // Network failure, timeout, or a non-JSON body: report unknown, not disabled.
    return UNKNOWN;
  }
}

/**
 * Whether a sign-in attempt is worth making.
 *
 * Unknown must not block the user, so only an explicit `false` disables a method.
 */
export function canAttemptGoogleSignIn(status: AuthProviderStatus): boolean {
  return status.google !== false;
}

export function canAttemptEmailSignIn(status: AuthProviderStatus): boolean {
  return status.email !== false;
}

/**
 * Product decision (15 October 2026, explicit human approval): email magic-link
 * sign-in is disabled in the login UI. Google OAuth is the only method offered.
 *
 * This diverges from the frozen Week 1 contract §2 item 2, which lists "Google
 * OAuth and email magic link" as the permitted application logins — email is
 * permitted there, but is deliberately not offered here. That divergence is
 * recorded in code so it is not silent. Re-enabling is this one flag.
 *
 * The gate is applied in `emailSignInOffered` below, so it wins even when the
 * Supabase project reports the email provider as enabled: the method is greyed
 * out regardless of provider configuration.
 */
export const EMAIL_SIGN_IN_ENABLED = false;

/**
 * Whether the login screen should offer the email method. The product flag
 * gates whatever the project reports, so disabling it does not depend on the
 * Supabase provider status.
 */
export function emailSignInOffered(status: AuthProviderStatus): boolean {
  return EMAIL_SIGN_IN_ENABLED && canAttemptEmailSignIn(status);
}

/**
 * The methods the login screen should offer, derived from the project's provider
 * status. Email is always `false` here (see `EMAIL_SIGN_IN_ENABLED`); keeping
 * the mapping in one tested function means the page can pass it straight
 * through instead of assembling an inline object nothing exercises.
 */
export function loginMethodsOffered(status: AuthProviderStatus): {
  readonly google: boolean;
  readonly email: boolean;
} {
  return {
    google: canAttemptGoogleSignIn(status),
    email: emailSignInOffered(status),
  };
}

/** True when at least one sign-in method is available. */
export function canAttemptAnySignIn(status: AuthProviderStatus): boolean {
  return canAttemptGoogleSignIn(status) || canAttemptEmailSignIn(status);
}
