import {
  LOGIN_PROVIDERS,
  type ApplicationSession,
  type LoginProvider,
} from '@kade/shared';

/** The subset of a Supabase user needed to build an application session. */
export interface SupabaseUserLike {
  readonly id: string;
  readonly email?: string | null;
  /** Supabase reports how the user authenticated here. */
  readonly app_metadata?: { readonly provider?: string } | null;
}

/**
 * Which permitted provider established the session.
 *
 * This field is descriptive: no guard branches on it, and it confers no
 * authority. When Supabase does not report a permitted provider (for example a
 * user seeded directly through the dashboard), fall back to the first permitted
 * one rather than inventing a new value.
 */
function loginProviderOf(user: SupabaseUserLike): LoginProvider {
  const reported = user.app_metadata?.provider;
  if (reported && (LOGIN_PROVIDERS as readonly string[]).includes(reported)) {
    return reported as LoginProvider;
  }
  return LOGIN_PROVIDERS[0];
}

/**
 * Map a Supabase user onto the frozen `ApplicationSession` type.
 *
 * The session is an application credential only. It carries no wallet address
 * and grants no on-chain authority (ADR 0003).
 */
export function toApplicationSession(user: SupabaseUserLike): ApplicationSession {
  return {
    domain: 'application-session',
    provider: loginProviderOf(user),
    userId: user.id,
    email: user.email ?? '',
  };
}
