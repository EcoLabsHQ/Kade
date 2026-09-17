'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthNotConfiguredError } from '@/lib/auth/errors';
import { isAuthConfigured, readAuthEnv } from '@/lib/env';

/**
 * Browser Supabase client.
 *
 * Throws `AuthNotConfiguredError` when credentials are absent. Callers must
 * render an explicit "not configured" state instead of attempting sign-in.
 */
export function createSupabaseBrowserClient(): SupabaseClient {
  const env = readAuthEnv();
  if (!isAuthConfigured(env)) {
    throw new AuthNotConfiguredError();
  }
  return createBrowserClient(
    env.supabaseUrl as string,
    env.supabaseAnonKey as string,
  );
}
