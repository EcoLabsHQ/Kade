import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LoginScreen } from '@/components/auth/LoginScreen';

const hoisted = vi.hoisted(() => ({
  signInWithOAuth: vi.fn(),
  signInWithOtp: vi.fn(),
}));

vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      signInWithOAuth: hoisted.signInWithOAuth,
      signInWithOtp: hoisted.signInWithOtp,
    },
  }),
}));

const callbackUrl = 'http://localhost:3000/auth/callback';

const webauthn = { get: vi.fn(), create: vi.fn() };

beforeEach(() => {
  hoisted.signInWithOAuth.mockReset();
  hoisted.signInWithOAuth.mockResolvedValue({ error: null });
  hoisted.signInWithOtp.mockReset();
  hoisted.signInWithOtp.mockResolvedValue({ error: null });
  webauthn.get.mockReset();
  webauthn.create.mockReset();
  Object.defineProperty(navigator, 'credentials', {
    value: webauthn,
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
});

describe('login screen', () => {
  it('offers Google and email magic link, and no password or wallet option', () => {
    render(<LoginScreen configured callbackUrl={callbackUrl} />);

    expect(
      screen.getByRole('button', { name: /continue with google/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /email me a link/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();

    // Still excluded by contract section 2 item 2 (amended v1.2).
    expect(document.querySelector('input[type="password"]')).toBeNull();
    for (const button of screen.getAllByRole('button')) {
      expect(button).not.toHaveAccessibleName(/password|wallet|passkey/i);
    }
  });

  it('starts the Google OAuth flow without invoking WebAuthn', async () => {
    render(<LoginScreen configured callbackUrl={callbackUrl} />);

    fireEvent.click(
      screen.getByRole('button', { name: /continue with google/i }),
    );

    await waitFor(() =>
      expect(hoisted.signInWithOAuth).toHaveBeenCalledWith({
        provider: 'google',
        options: { redirectTo: callbackUrl },
      }),
    );

    expect(webauthn.get).not.toHaveBeenCalled();
    expect(webauthn.create).not.toHaveBeenCalled();
  });

  it('sends a magic link, with account creation allowed, without invoking WebAuthn', async () => {
    render(<LoginScreen configured callbackUrl={callbackUrl} />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'resident@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /email me a link/i }));

    await waitFor(() =>
      expect(hoisted.signInWithOtp).toHaveBeenCalledWith({
        email: 'resident@example.com',
        options: { emailRedirectTo: callbackUrl, shouldCreateUser: true },
      }),
    );

    expect(webauthn.get).not.toHaveBeenCalled();
    expect(webauthn.create).not.toHaveBeenCalled();
  });

  it('confirms where the link went, and offers a way back', async () => {
    render(<LoginScreen configured callbackUrl={callbackUrl} />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'resident@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /email me a link/i }));

    expect(await screen.findByText(/resident@example.com/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /use a different address/i }),
    ).toBeInTheDocument();
  });

  it('rejects an invalid address before calling Supabase', async () => {
    render(<LoginScreen configured callbackUrl={callbackUrl} />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'not-an-email' },
    });
    fireEvent.click(screen.getByRole('button', { name: /email me a link/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/valid email/i);
    expect(hoisted.signInWithOtp).not.toHaveBeenCalled();
  });

  it('renders an explicit not-configured state and locks both methods', () => {
    render(<LoginScreen configured={false} callbackUrl={callbackUrl} />);

    expect(screen.getByText(/authentication not configured/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /continue with google/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /email me a link/i }),
    ).toBeDisabled();
  });

  it('does not fabricate a Safe address', () => {
    render(<LoginScreen configured callbackUrl={callbackUrl} />);

    // The label must not imply a Safe exists. It previously read
    // "Safe · 0x… · Ethereum Sepolia", which showed a placeholder address
    // beside a "Created in the background" chip while no Safe was deployed.
    expect(
      screen.getByText(/Safe · not yet deployed · Ethereum Sepolia/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Not yet created/)).toBeInTheDocument();
    expect(screen.getByText(/address is withheld rather than fabricated/i)).toBeInTheDocument();
    expect(screen.queryByText(/0x…/)).not.toBeInTheDocument();
  });
});
