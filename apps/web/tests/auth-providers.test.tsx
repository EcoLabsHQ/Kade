import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  canAttemptAnySignIn,
  canAttemptEmailSignIn,
  canAttemptGoogleSignIn,
  emailSignInOffered,
  fetchAuthProviderStatus,
  type AuthProviderStatus,
} from '@/lib/auth/providers';
import { LoginScreen } from '@/components/auth/LoginScreen';
import type { AuthEnv } from '@/lib/env';

const ENV: AuthEnv = {
  supabaseUrl: 'https://example.supabase.co',
  supabaseAnonKey: 'sb_publishable_test',
  siteUrl: 'http://localhost:3000',
  callbackPath: '/auth/callback',
};

afterEach(() => vi.restoreAllMocks());

function mockFetch(body: unknown, ok = true) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok,
    json: async () => body,
  } as Response);
}

describe('fetchAuthProviderStatus', () => {
  it('reports both providers enabled', async () => {
    mockFetch({ external: { email: true, google: true } });
    expect(await fetchAuthProviderStatus(ENV)).toEqual({
      google: true,
      email: true,
      checked: true,
    });
  });

  it('reports google disabled but email available — the case the app could not previously see', async () => {
    mockFetch({ external: { email: true, google: false } });
    expect(await fetchAuthProviderStatus(ENV)).toEqual({
      google: false,
      email: true,
      checked: true,
    });
  });

  it('reports unknown when the response is not ok', async () => {
    mockFetch({}, false);
    expect(await fetchAuthProviderStatus(ENV)).toEqual({
      google: null,
      email: null,
      checked: false,
    });
  });

  it('reports unknown when the body has an unexpected shape', async () => {
    mockFetch({ external: { google: 'yes', email: 1 } });
    expect(await fetchAuthProviderStatus(ENV)).toEqual({
      google: null,
      email: null,
      checked: false,
    });
  });

  it('reports unknown when the request throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    expect(await fetchAuthProviderStatus(ENV)).toEqual({
      google: null,
      email: null,
      checked: false,
    });
  });

  it('does not call the network when the environment is incomplete', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const result = await fetchAuthProviderStatus({ ...ENV, supabaseUrl: null });
    expect(result).toEqual({ google: null, email: null, checked: false });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('canAttemptGoogleSignIn', () => {
  it('allows the attempt when the provider is enabled', () => {
    expect(canAttemptGoogleSignIn({ google: true, email: null, checked: true })).toBe(true);
  });

  it('allows the attempt when the status is unknown', () => {
    // Unknown must never block a user because a probe failed.
    const unknown: AuthProviderStatus = { google: null, email: null, checked: false };
    expect(canAttemptGoogleSignIn(unknown)).toBe(true);
  });

  it('blocks only a known-disabled provider', () => {
    expect(canAttemptGoogleSignIn({ google: false, email: true, checked: true })).toBe(false);
  });
});

describe('canAttemptAnySignIn', () => {
  it('is true when only email is available', () => {
    expect(canAttemptAnySignIn({ google: false, email: true, checked: true })).toBe(true);
    expect(canAttemptEmailSignIn({ google: false, email: true, checked: true })).toBe(true);
  });

  it('is false only when both are known-disabled', () => {
    expect(canAttemptAnySignIn({ google: false, email: false, checked: true })).toBe(false);
  });
});

describe('emailSignInOffered', () => {
  // Product decision (15 Oct 2026): email magic link is disabled in the UI, so
  // the login screen never offers it even when the project reports the email
  // provider as enabled.
  it('does not offer email, whatever the project reports', () => {
    expect(emailSignInOffered({ google: true, email: true, checked: true })).toBe(false);
    expect(emailSignInOffered({ google: false, email: true, checked: true })).toBe(false);
    expect(emailSignInOffered({ google: null, email: null, checked: false })).toBe(false);
  });
});

describe('LoginScreen with a connected project but no provider enabled', () => {
  const props = {
    callbackUrl: 'http://localhost:3000/auth/callback',
    network: 'Ethereum Sepolia',
    accountState: { kind: 'anonymous' } as const,
  };

  it('explains the provider problem instead of announcing a config problem', () => {
    render(
      <LoginScreen
        configured
        {...props}
        available={{ google: false, email: false }}
      />,
    );

    expect(screen.getByText(/No sign-in method is enabled/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/Authentication not configured/i),
    ).not.toBeInTheDocument();
  });

  it('disables both methods so the user is not sent to a raw JSON error', () => {
    render(
      <LoginScreen
        configured
        {...props}
        available={{ google: false, email: false }}
      />,
    );

    // Both methods are disabled, and the single action cannot fire. Which label
    // it carries depends on which method the panel falls back to, so match
    // either rather than pinning one.
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toHaveAttribute('aria-disabled', 'true');
    }
    expect(
      screen.getByRole('button', {
        name: /continue with google|email me a link/i,
      }),
    ).toBeDisabled();
  });

  it('still renders the normal configured state when a provider is enabled', () => {
    render(
      <LoginScreen
        configured
        {...props}
        available={{ google: true, email: true }}
      />,
    );

    expect(screen.getByText(/Continue with Google/i)).toBeInTheDocument();
    expect(screen.queryByText(/No sign-in method is enabled/i)).not.toBeInTheDocument();
  });
});
