import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression tests for the OAuth callback.
 *
 * Part 1 (unchanged) pins the open-redirect fix: `next` is validated with
 * `resolveSafeReturnPath` and the redirect origin comes from configuration, not
 * the request Host header. Those cases run unconfigured, the branch reachable
 * without Supabase credentials.
 *
 * Part 2 pins the post-login destination: with no explicit `next`, the callback
 * lands the resident where `postLoginPath` says (the same single rule the
 * Overview gate uses) instead of always hard-coding `/`; an explicit safe `next`
 * still wins, and the exchange-failure paths are unchanged.
 */

const ORIGINAL_ENV = { ...process.env };

const hoisted = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  postLoginPath: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { exchangeCodeForSession: hoisted.exchangeCodeForSession },
  }),
}));

vi.mock('@/lib/onboarding/state', () => ({
  postLoginPath: hoisted.postLoginPath,
}));

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

beforeEach(() => {
  hoisted.exchangeCodeForSession.mockReset();
  hoisted.postLoginPath.mockReset();
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

async function callConfiguredCallback(url: string): Promise<string> {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://app.kade.test';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

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

describe('OAuth callback post-login destination', () => {
  it('lands a completed resident on the overview through postLoginPath', async () => {
    hoisted.exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
    hoisted.postLoginPath.mockResolvedValue('/');

    const location = await callConfiguredCallback(
      'https://app.kade.test/auth/callback?code=abc',
    );

    expect(hoisted.postLoginPath).toHaveBeenCalledWith('user-1');
    expect(location).toBe('https://app.kade.test/');
  });

  it('sends an incomplete resident to onboarding through the same rule', async () => {
    hoisted.exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: 'user-2' } },
      error: null,
    });
    hoisted.postLoginPath.mockResolvedValue('/onboarding');

    const location = await callConfiguredCallback(
      'https://app.kade.test/auth/callback?code=abc',
    );

    expect(hoisted.postLoginPath).toHaveBeenCalledWith('user-2');
    expect(location).toBe('https://app.kade.test/onboarding');
  });

  it('lets an explicit safe next win over the onboarding rule', async () => {
    hoisted.exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: 'user-3' } },
      error: null,
    });
    hoisted.postLoginPath.mockResolvedValue('/onboarding');

    const location = await callConfiguredCallback(
      'https://app.kade.test/auth/callback?code=abc&next=%2Fholdings',
    );

    expect(hoisted.postLoginPath).not.toHaveBeenCalled();
    expect(location).toBe('https://app.kade.test/holdings');
  });

  it('falls back to the onboarding rule for an unsafe next target', async () => {
    hoisted.exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: 'user-4' } },
      error: null,
    });
    hoisted.postLoginPath.mockResolvedValue('/');

    const location = await callConfiguredCallback(
      'https://app.kade.test/auth/callback?code=abc&next=%2F%2Fevil.com',
    );

    expect(new URL(location).origin).toBe('https://app.kade.test');
    expect(hoisted.postLoginPath).toHaveBeenCalledWith('user-4');
    expect(location).toBe('https://app.kade.test/');
  });

  it('does not consult the onboarding rule when the exchange fails', async () => {
    hoisted.exchangeCodeForSession.mockResolvedValue({
      data: { user: null },
      error: { message: 'bad code' },
    });

    const location = await callConfiguredCallback(
      'https://app.kade.test/auth/callback?code=abc',
    );

    expect(hoisted.postLoginPath).not.toHaveBeenCalled();
    expect(location).toBe('https://app.kade.test/login?error=callback-failed');
  });

  it('does not consult the onboarding rule when the exchange throws', async () => {
    hoisted.exchangeCodeForSession.mockRejectedValue(new Error('network'));

    const location = await callConfiguredCallback(
      'https://app.kade.test/auth/callback?code=abc',
    );

    expect(hoisted.postLoginPath).not.toHaveBeenCalled();
    expect(location).toBe('https://app.kade.test/login?error=callback-failed');
  });
});
