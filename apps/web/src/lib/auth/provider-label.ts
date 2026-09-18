import { LOGIN_PROVIDERS, type LoginProvider } from '@kade/shared';

/**
 * Display name for the provider that established a session.
 *
 * Screens must render the session's actual provider through this, never a
 * hardcoded name: contract v1.2 permits Google OAuth and email magic link, so a
 * resident who signed in by email must not be told they signed in with Google.
 *
 * Distinct from the sign-in affordances themselves ("Continue with Google",
 * "Email me a link"), which legitimately name a specific method because the
 * resident is choosing one.
 */
const LABELS: Readonly<Record<LoginProvider, string>> = {
  google: 'Google',
  email: 'Email link',
};

/** Compile-time completeness: adding a provider forces a label here. */
const _allProvidersLabelled: readonly LoginProvider[] = LOGIN_PROVIDERS;
void _allProvidersLabelled;

export function providerLabel(provider: LoginProvider): string {
  return LABELS[provider];
}
