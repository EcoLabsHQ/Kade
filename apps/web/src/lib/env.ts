/**
 * Authentication environment contract.
 *
 * Sources: .env.example (root) and docs/week-1-frozen-delivery-contract.md
 * section 5. The app must fail clearly and safely when Supabase is not
 * configured: it must never crash and never present a fake signed-in state.
 */

/** Env vars that must be present before any Supabase client is created. */
export const REQUIRED_AUTH_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
] as const;

export interface AuthEnv {
  readonly supabaseUrl: string | null;
  readonly supabaseAnonKey: string | null;
  readonly siteUrl: string;
  readonly callbackPath: string;
}

/** [documented] the local development origin from .env.example. */
const DEFAULT_SITE_URL = 'http://localhost:3000';

/** [arbitrary] the Supabase SSR callback path, from .env.example. */
const DEFAULT_CALLBACK_PATH = '/auth/callback';

export function readAuthEnv(): AuthEnv {
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || null,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || null,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL?.trim() || DEFAULT_SITE_URL,
    callbackPath:
      process.env.NEXT_PUBLIC_AUTH_CALLBACK_PATH?.trim() || DEFAULT_CALLBACK_PATH,
  };
}

export function isAuthConfigured(env: AuthEnv = readAuthEnv()): boolean {
  return env.supabaseUrl !== null && env.supabaseAnonKey !== null;
}

/** Absolute URL Google redirects back to after the OAuth consent step. */
export function authCallbackUrl(env: AuthEnv = readAuthEnv()): string {
  return new URL(env.callbackPath, env.siteUrl).toString();
}
