import { LOGIN_PROVIDER, type ApplicationSession } from '@kade/shared';

/** The subset of a Supabase user needed to build an application session. */
export interface SupabaseUserLike {
  readonly id: string;
  readonly email?: string | null;
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
    provider: LOGIN_PROVIDER,
    userId: user.id,
    email: user.email ?? '',
  };
}
