import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAuthConfigured, readAuthEnv } from '@/lib/env';

/** Sign-out endpoint. POST-only so it cannot be triggered by a link. */
export async function POST() {
  const env = readAuthEnv();
  // Redirect targets come from the configured origin, never the request, so the
  // destination cannot be influenced by a spoofed Host header (see
  // lib/safe-redirect.ts for the same reasoning).
  const origin = env.siteUrl;

  if (!isAuthConfigured(env)) {
    return NextResponse.redirect(
      new URL('/login?reason=not-configured', origin),
      { status: 303 },
    );
  }

  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  } catch {
    // Best-effort sign-out: still return the user to the login screen.
  }

  return NextResponse.redirect(new URL('/login?reason=signed-out', origin), {
    status: 303,
  });
}
