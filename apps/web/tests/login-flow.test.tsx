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

function renderLogin(overrides: Record<string, unknown> = {}) {
  return render(
    <LoginScreen
      configured
      available={{ google: true, email: true }}
      callbackUrl={callbackUrl}
      network="Ethereum Sepolia"
      accountState={{ kind: 'anonymous' }}
      {...overrides}
    />,
  );
}

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

afterEach(() => cleanup());

describe('account creation, step 1', () => {
  it('renders as the first step of the resident setup flow', () => {
    renderLogin();

    expect(screen.getByText(/step 1 of 4/i)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /create your account/i }),
    ).toBeInTheDocument();
    // The setup steps are in the sidebar, with step 1 current.
    expect(screen.getByText('Create account')).toBeInTheDocument();
    expect(screen.getByText('Profile & household')).toBeInTheDocument();
  });

  it('offers Google and email link as one accessible radio group', () => {
    renderLogin();

    const group = screen.getByRole('radiogroup', { name: /sign-in method/i });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.getByRole('radio', { name: /google/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('does not offer a password field or a wallet option', () => {
    renderLogin();

    expect(document.querySelector('input[type="password"]')).toBeNull();
    for (const button of screen.getAllByRole('button')) {
      expect(button).not.toHaveAccessibleName(/password|wallet|passkey/i);
    }
  });

  it('disables the email method so Google is the only offered sign-in', () => {
    // The login page passes `email: emailSignInOffered(...)`, which is false by
    // product decision; render the screen in that state.
    renderLogin({ available: { google: true, email: false } });

    const emailMethod = screen.getByRole('radio', { name: /email link/i });
    expect(emailMethod).toHaveAttribute('aria-disabled', 'true');
    // The intro must not advertise a method that cannot be used.
    expect(screen.queryByText(/one-time email link/i)).toBeNull();
    expect(screen.getByText(/sign in with google\./i)).toBeInTheDocument();

    // Selecting it is a no-op: no email field appears and the single action
    // stays on Google.
    fireEvent.click(emailMethod);
    expect(screen.queryByLabelText(/email/i)).toBeNull();
    expect(
      screen.getByRole('button', { name: /continue with google/i }),
    ).toBeInTheDocument();
  });

  it('shows the email field only while the email method is selected', () => {
    renderLogin();

    expect(screen.queryByLabelText(/email/i)).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /email link/i }));
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });

  it('moves the single primary action with the selected method', () => {
    renderLogin();

    expect(
      screen.getByRole('button', { name: /continue with google/i }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /email link/i }));

    expect(
      screen.getByRole('button', { name: /email me a link/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /continue with google/i }),
    ).toBeNull();
  });

  it('starts the Google flow without invoking WebAuthn', async () => {
    renderLogin();

    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));

    await waitFor(() =>
      expect(hoisted.signInWithOAuth).toHaveBeenCalledWith({
        provider: 'google',
        options: { redirectTo: callbackUrl },
      }),
    );
    expect(webauthn.get).not.toHaveBeenCalled();
    expect(webauthn.create).not.toHaveBeenCalled();
  });

  it('sends a magic link, allowing account creation, without WebAuthn', async () => {
    renderLogin();

    fireEvent.click(screen.getByRole('radio', { name: /email link/i }));
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

  it('rejects an invalid address before asking Supabase for anything', async () => {
    renderLogin();

    fireEvent.click(screen.getByRole('radio', { name: /email link/i }));
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'not-an-email' },
    });
    fireEvent.click(screen.getByRole('button', { name: /email me a link/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/valid email/i);
    expect(hoisted.signInWithOtp).not.toHaveBeenCalled();
  });

  it('replaces the form with a confirmation once the link is sent', async () => {
    renderLogin();

    fireEvent.click(screen.getByRole('radio', { name: /email link/i }));
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'resident@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /email me a link/i }));

    expect(
      await screen.findByRole('heading', { name: /check your email/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/resident@example.com/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /use a different email/i }),
    ).toBeInTheDocument();
  });

  it('disables the action when sign-in is not configured', () => {
    renderLogin({ configured: false });

    expect(
      screen.getByRole('button', { name: /continue with google/i }),
    ).toBeDisabled();
  });

  it('does not fabricate an account before authentication', () => {
    renderLogin();

    expect(
      screen.getByText(/your account will be set up after you sign in/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/0x/)).toBeNull();
  });
});
