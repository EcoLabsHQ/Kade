import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression test for the open-redirect defect found in review.
 *
 * The callback previously validated `next` with a string prefix check and built
 * its redirect with the origin taken from the incoming request URL. Two
 * consequences, both covered here:
 *
 *   1. `next=/\evil.com` passed the prefix check and resolved to the attacker's
 *      origin after a real Google sign-in.
 *   2. the redirect origin was derived from the request, so it depended on the
 *      Host header rather than on configuration.
 *
 * The route is exercised unconfigured, which is the branch reachable without
 * Supabase credentials. Both properties are asserted on the resulting Location.
 */

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

async function callCallback(url: string): Promise<string> {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://app.kade.test';
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const { GET } = await import('@/app/auth/callback/route');
  const response = await GET(new Request(url));
  const location = response.headers.get('location');
  if (location === null) throw new Error('callback returned no Location header');
  return location;
}

describe('OAuth callback redirect safety', () => {
  it('redirects to the configured origin, not the request host', async () => {
    const location = await callCallback(
      'https://evil.example/auth/callback?code=abc',
    );
    expect(location.startsWith('https://app.kade.test/')).toBe(true);
    expect(location).not.toContain('evil.example');
  });

  it('never returns an off-origin target for a backslash bypass attempt', async () => {
    const location = await callCallback(
      'https://evil.example/auth/callback?next=/%5Cevil.com',
    );
    expect(new URL(location).origin).toBe('https://app.kade.test');
  });

  it('does not honour a protocol-relative next target', async () => {
    const location = await callCallback(
      'https://evil.example/auth/callback?next=//evil.com',
    );
    expect(new URL(location).origin).toBe('https://app.kade.test');
  });

  it('surfaces the not-configured reason rather than faking a session', async () => {
    const location = await callCallback('https://app.kade.test/auth/callback');
    expect(location).toBe('https://app.kade.test/login?reason=not-configured');
  });
});
