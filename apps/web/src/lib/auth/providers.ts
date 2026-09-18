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

/** True when at least one sign-in method is available. */
export function canAttemptAnySignIn(status: AuthProviderStatus): boolean {
  return canAttemptGoogleSignIn(status) || canAttemptEmailSignIn(status);
}
