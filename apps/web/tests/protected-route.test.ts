import { describe, expect, it } from 'vitest';
import { resolveAccess, isProtectedPath } from '@/lib/routing';

/**
 * D3: protected routes reject unauthenticated access; login is reachable
 * without a session. These are the decisions the middleware applies.
 */
describe('protected route policy', () => {
  it('treats app routes as protected and login/callback as public', () => {
    expect(isProtectedPath('/')).toBe(true);
    expect(isProtectedPath('/account')).toBe(true);
    expect(isProtectedPath('/onboarding')).toBe(true);
    expect(isProtectedPath('/login')).toBe(false);
    expect(isProtectedPath('/auth/callback')).toBe(false);
    expect(isProtectedPath('/auth/signout')).toBe(false);
    // The public legal page is reachable without a session; look-alikes are not.
    expect(isProtectedPath('/privacy')).toBe(false);
    expect(isProtectedPath('/privacyxyz')).toBe(true);
  });

  it('redirects an unauthenticated request to a protected route', () => {
    const decision = resolveAccess('/account', {
      configured: true,
      userId: null,
    });
    expect(decision).toEqual({
      kind: 'redirect',
      to: '/login',
      query: '?next=%2Faccount',
    });
  });

  it('redirects to a not-configured login when Supabase is absent', () => {
    const decision = resolveAccess('/', { configured: false, userId: null });
    expect(decision).toEqual({
      kind: 'redirect',
      to: '/login',
      query: '?reason=not-configured',
    });
  });

  it('allows an authenticated request to a protected route', () => {
    const decision = resolveAccess('/account', {
      configured: true,
      userId: 'user-1',
    });
    expect(decision).toEqual({ kind: 'allow' });
  });

  it('allows public routes regardless of session state', () => {
    expect(
      resolveAccess('/login', { configured: true, userId: null }),
    ).toEqual({ kind: 'allow' });
    expect(
      resolveAccess('/auth/callback', { configured: false, userId: null }),
    ).toEqual({ kind: 'allow' });
  });
});
