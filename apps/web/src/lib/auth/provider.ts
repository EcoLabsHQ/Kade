import {
  EXCLUDED_LOGIN_PROVIDERS,
  LOGIN_PROVIDERS,
  assertLoginDoesNotRequirePasskey,
  type LoginProvider,
} from '@kade/shared';

/**
 * The steps the sign-in flow may perform.
 *
 * D3 requires that login does not prompt for a passkey, so no step here may
 * mention a passkey or WebAuthn. `assertPermittedSignIn` makes that executable.
 */
export const SIGN_IN_STEPS = ['open-login-screen', ...LOGIN_PROVIDERS] as const;

/**
 * Encodes contract section 2 item 2 (as amended v1.2: Google or email magic
 * link, no password, no wallet) and D3 (login does not prompt for a passkey).
 *
 * The invariant that matters is unchanged by the amendment: sign-in must not
 * touch the WebAuthn API, because the passkey is a separate transaction
 * authority and must not be enrolled or requested as part of logging in.
 */
export function assertPermittedSignIn(
  steps: readonly string[] = SIGN_IN_STEPS,
): void {
  assertLoginDoesNotRequirePasskey(steps);
  for (const excluded of EXCLUDED_LOGIN_PROVIDERS) {
    if ((steps as readonly string[]).includes(excluded)) {
      throw new Error(
        `The sign-in flow must not offer the excluded provider "${excluded}" ` +
          '(contract section 2, item 2; excluded: ' +
          `${EXCLUDED_LOGIN_PROVIDERS.join(', ')}).`,
      );
    }
  }
}

/** Backwards-compatible alias; the flow is no longer Google-only. */
export const assertGoogleOnlySignIn = assertPermittedSignIn;

export function assertProviderAllowed(
  provider: string,
): asserts provider is LoginProvider {
  if (!(LOGIN_PROVIDERS as readonly string[]).includes(provider)) {
    throw new Error(
      `Only ${LOGIN_PROVIDERS.join(' or ')} sign-in is permitted ` +
        '(contract section 2, item 2).',
    );
  }
}

export function isExcludedProvider(provider: string): boolean {
  return (EXCLUDED_LOGIN_PROVIDERS as readonly string[]).includes(provider);
}
