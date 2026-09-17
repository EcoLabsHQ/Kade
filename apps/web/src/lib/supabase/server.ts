import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApplicationSession } from '@kade/shared';
import { AuthNotConfiguredError } from '@/lib/auth/errors';
import { toApplicationSession } from '@/lib/auth/session';
import { isAuthConfigured, readAuthEnv } from '@/lib/env';

/**
 * Server Supabase client bound to the request cookie jar.
 *
 * Server-side session reading is done with `getUser()`, which validates the
 * access token against Supabase rather than trusting the cookie payload.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const env = readAuthEnv();
  if (!isAuthConfigured(env)) {
    throw new AuthNotConfiguredError();
  }
  const cookieStore = await cookies();
  return createServerClient(
    env.supabaseUrl as string,
    env.supabaseAnonKey as string,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // The middleware refreshes the session instead.
          }
        },
      },
    },
  );
}

/**
 * Read the application session, or null when unauthenticated.
 *
 * Returns null (rather than throwing) when Supabase is not configured, so
 * pages can render an explicit unconfigured state.
 */
export async function getSessionUser(): Promise<ApplicationSession | null> {
  const env = readAuthEnv();
  if (!isAuthConfigured(env)) {
    return null;
  }
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      return null;
    }
    return toApplicationSession(data.user);
  } catch {
    // Misconfigured or unreachable: treat as unauthenticated. Never fabricate
    // a session.
    return null;
  }
}
