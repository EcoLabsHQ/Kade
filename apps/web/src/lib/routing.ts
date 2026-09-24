/**
 * Protected-route policy.
 *
 * Kept free of Supabase and Next request objects so the decision is directly
 * testable. `src/middleware.ts` supplies the session state.
 */

/**
 * Routes reachable without an application session.
 *
 * `/api/webhooks` is public because a provider calls it server-to-server: it
 * carries no resident session and authenticates with its own signed payload
 * (see `src/app/api/webhooks/self/route.ts`). Without this, `middleware.ts`
 * would redirect the provider to `/login` and the event would never arrive.
 * The prefix is deliberately narrow: only the webhook subtree is exposed, not
 * `/api` at large.
 */
export const PUBLIC_PATHS = [
  '/login',
  '/auth/callback',
  '/auth/signout',
  '/api/webhooks',
] as const;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (publicPath) =>
      pathname === publicPath || pathname.startsWith(`${publicPath}/`),
  );
}

export function isProtectedPath(pathname: string): boolean {
  return !isPublicPath(pathname);
}

export interface AccessState {
  /** Whether Supabase credentials are present. */
  readonly configured: boolean;
  /** The Supabase user id, or null when unauthenticated. */
  readonly userId: string | null;
}

export type AccessDecision =
  | { readonly kind: 'allow' }
  | { readonly kind: 'redirect'; readonly to: string; readonly query: string };

/**
 * D3: protected routes reject unauthenticated access. A missing configuration
 * redirects too, so the app can never render protected content without a
 * verifiable session.
 */
export function resolveAccess(
  pathname: string,
  state: AccessState,
): AccessDecision {
  if (!isProtectedPath(pathname)) {
    return { kind: 'allow' };
  }
  if (!state.configured) {
    return { kind: 'redirect', to: '/login', query: '?reason=not-configured' };
  }
  if (!state.userId) {
    return {
      kind: 'redirect',
      to: '/login',
      query: `?next=${encodeURIComponent(pathname)}`,
    };
  }
  return { kind: 'allow' };
}
