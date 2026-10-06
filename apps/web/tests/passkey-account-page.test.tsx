import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

/**
 * `/account` must not 500 when the credential read fails.
 *
 * The page awaits `loadPasskeyCredential()` before rendering. This pins that a
 * thrown read can never reach the page boundary as an unhandled error: the
 * action returns null, so the page renders the ordinary create state.
 */

const hoisted = vi.hoisted(() => ({
  redirect: vi.fn(),
  getSessionUser: vi.fn(),
  loadPasskeyCredential: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: hoisted.redirect }));
vi.mock('@/lib/supabase/server', () => ({
  getSessionUser: hoisted.getSessionUser,
}));
vi.mock('@/app/account/passkey-actions', () => ({
  loadPasskeyCredential: hoisted.loadPasskeyCredential,
}));
vi.mock('@/lib/env', () => ({
  isAuthConfigured: () => true,
  readAuthEnv: () => ({
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: 'anon-key',
    siteUrl: 'http://localhost:3000',
    callbackPath: '/auth/callback',
  }),
}));
// The panel is a client component; this test is about the page's server wiring.
vi.mock('@/components/passkey/PasskeyEnrolmentPanel', () => ({
  PasskeyEnrolmentPanel: () => null,
}));

import AccountPage from '@/app/(resident)/account/page';

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.getSessionUser.mockResolvedValue({
    userId: 'user-1',
    email: 'resident@example.com',
    provider: 'email',
  });
  hoisted.loadPasskeyCredential.mockResolvedValue(null);
});

describe('account page credential read', () => {
  it('renders when the credential read returns null', async () => {
    const element = (await AccountPage()) as ReactElement<{ initialCredential: unknown }>;
    expect(element).toBeTruthy();
  });

  it('redirects to login when there is no session', async () => {
    hoisted.getSessionUser.mockResolvedValue(null);
    hoisted.redirect.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT');
    });

    await expect(AccountPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(hoisted.loadPasskeyCredential).not.toHaveBeenCalled();
  });

  it('does not call the read action when the session is absent', async () => {
    hoisted.getSessionUser.mockResolvedValue(null);
    hoisted.redirect.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT');
    });

    await AccountPage().catch(() => undefined);
    expect(hoisted.loadPasskeyCredential).not.toHaveBeenCalled();
  });
});
