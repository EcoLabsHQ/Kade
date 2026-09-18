import { describe, expect, it } from 'vitest';
import { toApplicationSession } from '@/lib/auth/session';

describe('application session mapping', () => {
  it('maps a Supabase user onto the frozen application-session type', () => {
    const session = toApplicationSession({
      id: 'user-1',
      email: 'a@b.c',
      app_metadata: { provider: 'google' },
    });
    expect(session).toEqual({
      domain: 'application-session',
      provider: 'google',
      userId: 'user-1',
      email: 'a@b.c',
    });
  });

  it('records the email provider for a magic-link session', () => {
    const session = toApplicationSession({
      id: 'user-2',
      email: 'resident@example.com',
      app_metadata: { provider: 'email' },
    });
    expect(session.provider).toBe('email');
  });

  it('falls back to a permitted provider when Supabase reports none', () => {
    // A user seeded through the dashboard has no provider metadata. The field is
    // descriptive only, so fall back rather than inventing a value.
    const session = toApplicationSession({ id: 'user-3', app_metadata: null });
    expect(['google', 'email']).toContain(session.provider);
  });

  it('never carries a wallet or signer field', () => {
    const session = toApplicationSession({ id: 'user-1', email: null });
    expect(session.email).toBe('');
    expect(Object.keys(session).sort()).toEqual([
      'domain',
      'email',
      'provider',
      'userId',
    ]);
  });
});
