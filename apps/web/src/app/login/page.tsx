import { redirect } from 'next/navigation';
import { LoginScreen } from '@/components/auth/LoginScreen';
import { authCallbackUrl, isAuthConfigured, readAuthEnv } from '@/lib/env';
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

  return (
    <LoginScreen
      configured={configured}
      callbackUrl={callbackUrl}
      reason={firstValue(params.reason)}
      error={firstValue(params.error)}
      next={next === '/' ? undefined : next}
    />
  );
}
