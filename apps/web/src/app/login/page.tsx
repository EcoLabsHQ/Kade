import { redirect } from 'next/navigation';
import { LoginScreen } from '@/components/auth/LoginScreen';
import { authCallbackUrl, isAuthConfigured, readAuthEnv } from '@/lib/env';
import {
  canAttemptAnySignIn,
  canAttemptEmailSignIn,
  canAttemptGoogleSignIn,
  fetchAuthProviderStatus,
} from '@/lib/auth/providers';
import { resolveSafeReturnPath } from '@/lib/safe-redirect';
import { getSessionUser } from '@/lib/supabase/server';

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const env = readAuthEnv();
  const configured = isAuthConfigured(env);
  // Safety is decided against the configured origin, never the request origin,
  // so a spoofed Host header cannot influence the redirect (see safe-redirect.ts).
  const next = resolveSafeReturnPath(firstValue(params.next), env.siteUrl);

  if (configured) {
    const session = await getSessionUser();
    if (session) {
      redirect(next);
    }
  }

  const baseCallbackUrl = authCallbackUrl(env);
  const callbackUrl =
    next === '/'
      ? baseCallbackUrl
      : `${baseCallbackUrl}?next=${encodeURIComponent(next)}`;

  // A project can be connected and still have no sign-in provider enabled, in
  // which case the redirect lands on Supabase's raw JSON error. Ask first so the
  // screen can explain it. Unknown (unreachable) must not block the user.
  const providerStatus = configured
    ? await fetchAuthProviderStatus(env)
    : { google: null, email: null, checked: false };
  const googleEnabled = canAttemptGoogleSignIn(providerStatus);
  const emailEnabled = canAttemptEmailSignIn(providerStatus);
  const anyProviderEnabled = canAttemptAnySignIn(providerStatus);

  return (
    <LoginScreen
      configured={configured}
      googleEnabled={googleEnabled}
      emailEnabled={emailEnabled}
      anyProviderEnabled={anyProviderEnabled}
      callbackUrl={callbackUrl}
      reason={firstValue(params.reason)}
      error={firstValue(params.error)}
      next={next === '/' ? undefined : next}
    />
  );
}
