import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LoginScreen } from '@/components/auth/LoginScreen';

const hoisted = vi.hoisted(() => ({ signInWithOAuth: vi.fn() }));

vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { signInWithOAuth: hoisted.signInWithOAuth },
  }),
}));

const callbackUrl = 'http://localhost:3000/auth/callback';

const webauthn = { get: vi.fn(), create: vi.fn() };

beforeEach(() => {
  hoisted.signInWithOAuth.mockReset();
  hoisted.signInWithOAuth.mockResolvedValue({ error: null });
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
  it('offers Google as the only sign-in method and no excluded provider', () => {
    render(<LoginScreen configured callbackUrl={callbackUrl} />);

    expect(
      screen.getByRole('button', { name: /continue with google/i }),
    ).toBeInTheDocument();

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();

    for (const button of screen.getAllByRole('button')) {
      expect(button).not.toHaveAccessibleName(
        /email|password|otp|magic|wallet|passkey/i,
      );
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

  it('renders an explicit not-configured state and locks the button', () => {
    render(<LoginScreen configured={false} callbackUrl={callbackUrl} />);

    expect(screen.getByText(/authentication not configured/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /continue with google/i }),
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
