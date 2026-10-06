import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAuthConfigured, readAuthEnv } from '@/lib/env';
import { postLoginPath } from '@/lib/onboarding/state';
import { DEFAULT_RETURN_PATH, resolveSafeReturnPath } from '@/lib/safe-redirect';

/**
 * PKCE code exchange for the Supabase auth callback, shared by Google OAuth
 * and the email magic link.
 *
 * Google sign-in has been completed end to end by the project owner; the email
 * magic link has not been delivered and followed, which is the remaining gap
 * (docs/known-gaps.md).
 *
 * Redirect targets are built from the configured site origin and the return
 * path is resolved by `resolveSafeReturnPath`, so both the redirect origin and
 * the destination are independent of the incoming Host header.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');

  const env = readAuthEnv();
  const origin = env.siteUrl;
  const next = resolveSafeReturnPath(searchParams.get('next'), origin);

  if (!isAuthConfigured(env)) {
    return NextResponse.redirect(
      new URL('/login?reason=not-configured', origin),
    );
  }

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing-code', origin));
  }

  let userId: string | null = null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(
        new URL('/login?error=callback-failed', origin),
      );
    }
    userId = data.user?.id ?? null;
  } catch {
    return NextResponse.redirect(
      new URL('/login?error=callback-failed', origin),
    );
  }

  // An explicitly requested path always wins. Otherwise land the resident where
  // their onboarding state says they belong, through the same predicate the
  // Overview gate uses (`postLoginPath`), so the two cannot disagree. The
  // exchange has already established the session in this request's cookie jar,
  // which is what the completion read needs.
  const destination =
    next === DEFAULT_RETURN_PATH && userId !== null
      ? await postLoginPath(userId)
      : next;

  return NextResponse.redirect(new URL(destination, origin));
}
