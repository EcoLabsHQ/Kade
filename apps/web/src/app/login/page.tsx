import { redirect } from 'next/navigation';
import { LoginScreen } from '@/components/auth/LoginScreen';
import { authCallbackUrl, isAuthConfigured, readAuthEnv, readChainEnv } from '@/lib/env';
import {
  canAttemptGoogleSignIn,
  emailSignInOffered,
  fetchAuthProviderStatus,
} from '@/lib/auth/providers';
import { chainsForEnv } from '@kade/shared';
import { resolveSafeReturnPath } from '@/lib/safe-redirect';
import { getSessionUser } from '@/lib/supabase/server';
import { postLoginPath } from '@/lib/onboarding/state';

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The chain the flow is actually running on: Sepolia while testing. */
function activeNetworkLabel(): string {
  const chains = chainsForEnv(readChainEnv());
  const ethereum = chains.find((chain) => chain.key === 'ethereum') ?? chains[0];
  return ethereum?.name ?? 'Ethereum Sepolia';
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
  // so a spoofed Host header cannot influence the redirect.
  const next = resolveSafeReturnPath(firstValue(params.next), env.siteUrl);

  if (configured) {
    const session = await getSessionUser();
    if (session) {
      // A requested protected destination wins if the resident meets its
      // requirements; otherwise they are sent to their first pending step.
      redirect(next !== '/' ? next : await postLoginPath(session.userId));
    }
  }

  const baseCallbackUrl = authCallbackUrl(env);
  const callbackUrl =
    next === '/'
      ? baseCallbackUrl
      : `${baseCallbackUrl}?next=${encodeURIComponent(next)}`;

  // A connected project can still have a provider disabled, in which case the
  // redirect lands on raw JSON. Ask first. Unknown must not block the attempt.
  const providerStatus = configured
    ? await fetchAuthProviderStatus(env)
    : { google: null, email: null, checked: false };

  const reason = firstValue(params.reason);

  return (
    <LoginScreen
      configured={configured}
      available={{
        google: canAttemptGoogleSignIn(providerStatus),
        // Email magic link is disabled by product decision (see
        // `emailSignInOffered`); it is not offered on the login screen.
        email: emailSignInOffered(providerStatus),
      }}
      callbackUrl={callbackUrl}
      network={activeNetworkLabel()}
      accountState={{ kind: 'anonymous' }}
      returning={reason === 'signed-out'}
      reason={reason}
      error={firstValue(params.error)}
    />
  );
}
