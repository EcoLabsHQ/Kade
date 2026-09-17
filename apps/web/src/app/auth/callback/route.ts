import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAuthConfigured, readAuthEnv } from '@/lib/env';
import { resolveSafeReturnPath } from '@/lib/safe-redirect';

/**
 * PKCE code exchange for the Supabase Google OAuth callback.
 *
 * This is the real code path. It cannot be exercised in this environment
 * because no Supabase project or Google credentials have been supplied
 * (contract section 5); live sign-in is therefore unverified.
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

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(
        new URL('/login?error=callback-failed', origin),
      );
    }
  } catch {
    return NextResponse.redirect(
      new URL('/login?error=callback-failed', origin),
    );
  }

  return NextResponse.redirect(new URL(next, origin));
}
