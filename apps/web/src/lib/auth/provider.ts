import {
  EXCLUDED_LOGIN_PROVIDERS,
  LOGIN_PROVIDER,
  assertLoginDoesNotRequirePasskey,
} from '@kade/shared';

/**
 * The steps the sign-in flow may perform.
 *
 * D3 requires that login does not prompt for a passkey, so no step here may
 * mention a passkey or WebAuthn. `assertGoogleOnlySignIn` makes that
 * executable.
 */
export const SIGN_IN_STEPS = ['open-login-screen', LOGIN_PROVIDER] as const;

/**
 * Encodes contract section 2 item 2 (Google only, no email OTP fallback) and
 * D3 (login does not prompt for a passkey).
 */
export function assertGoogleOnlySignIn(
  steps: readonly string[] = SIGN_IN_STEPS,
): void {
  assertLoginDoesNotRequirePasskey(steps);
  for (const excluded of EXCLUDED_LOGIN_PROVIDERS) {
    if ((steps as readonly string[]).includes(excluded)) {
      throw new Error(
        `The sign-in flow must not offer the excluded provider "${excluded}" ` +
          '(contract section 2, item 2).',
      );
    }
  }
}

export function assertProviderAllowed(
  provider: string,
): asserts provider is typeof LOGIN_PROVIDER {
  if (provider !== LOGIN_PROVIDER) {
    throw new Error(
      `Only "${LOGIN_PROVIDER}" sign-in is permitted (contract section 2, item 2).`,
    );
  }
}

export function isExcludedProvider(provider: string): boolean {
  return (EXCLUDED_LOGIN_PROVIDERS as readonly string[]).includes(provider);
}
