import { redirect } from 'next/navigation';
import { LoginScreen } from '@/components/auth/LoginScreen';
import { authCallbackUrl, isAuthConfigured, readAuthEnv } from '@/lib/env';
import { getSessionUser } from '@/lib/supabase/server';

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function safeNext(value: string | undefined, fallback = '/'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return fallback;
  }
  return value;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const env = readAuthEnv();
  const configured = isAuthConfigured(env);
  const next = safeNext(firstValue(params.next));

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
