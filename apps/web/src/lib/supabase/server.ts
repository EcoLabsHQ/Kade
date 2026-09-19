import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ApplicationSession } from '@kade/shared';
import { AuthNotConfiguredError } from '@/lib/auth/errors';
import { toApplicationSession } from '@/lib/auth/session';
import { isAuthConfigured, readAuthEnv, readServiceRoleKey } from '@/lib/env';

/**
 * Raised when an elevated operation is attempted without a service-role key.
 *
 * Callers that can degrade (write only the resident's own columns and report
 * that the signer address was not stored) should check
 * `isServiceRoleConfigured()` first; this error is for callers that genuinely
 * require the elevated capability.
 */
export class ServiceRoleNotConfiguredError extends Error {
  constructor(
    message = 'SUPABASE_SERVICE_ROLE_KEY is not configured, so elevated ' +
      'database writes are unavailable. Set it in the server environment ' +
      '(see .env.example).',
  ) {
    super(message);
    this.name = 'ServiceRoleNotConfiguredError';
  }
}

/**
 * Whether the service-role key is present, so an elevated write is possible.
 *
 * Reads configuration only; it never constructs a client and never touches the
 * key's value beyond presence.
 */
export function isServiceRoleConfigured(): boolean {
  return isAuthConfigured(readAuthEnv()) && readServiceRoleKey() !== null;
}

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
 * Elevated Supabase client for server-only writes.
 *
 * The service-role key bypasses row level security, so this client must never
 * reach the browser and every query made with it must still be scoped to the
 * signed-in resident explicitly. It is used only for columns the
 * `authenticated` role cannot write — currently
 * `passkey_credentials.signer_address`.
 *
 * Sessions are disabled: the service client acts as the server, not as a user,
 * so it must not read or refresh the request's cookies.
 *
 * @throws {ServiceRoleNotConfiguredError} when the key is absent.
 */
export async function createSupabaseServiceClient(): Promise<SupabaseClient> {
  const env = readAuthEnv();
  const serviceRoleKey = readServiceRoleKey();
  if (!isAuthConfigured(env) || !serviceRoleKey) {
    throw new ServiceRoleNotConfiguredError();
  }
  return createClient(env.supabaseUrl as string, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
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
