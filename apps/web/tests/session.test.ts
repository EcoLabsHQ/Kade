import { describe, expect, it } from 'vitest';
import { toApplicationSession } from '@/lib/auth/session';

describe('application session mapping', () => {
  it('maps a Supabase user onto the frozen application-session type', () => {
    const session = toApplicationSession({ id: 'user-1', email: 'a@b.c' });
    expect(session).toEqual({
      domain: 'application-session',
      provider: 'google',
      userId: 'user-1',
      email: 'a@b.c',
    });
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
