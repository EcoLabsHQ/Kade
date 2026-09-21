import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ApplicationSession } from '@kade/shared';
import { SIGNER_NOT_STORED_REASON } from '@/lib/passkey/credential';

/**
 * The account panel must never render a server configuration detail.
 *
 * `savePasskeyCredential` returns a `not-persisted` reason that may name
 * database or server configuration. The onboarding surface hides that, and this
 * pins the account surface to the same rule: honest about the outcome, but in
 * the product's language. The mock reason below stands in for any such
 * server-side detail.
 */

const hoisted = vi.hoisted(() => ({
  savePasskeyCredential: vi.fn(),
  enrolPasskey: vi.fn(),
}));

vi.mock('@/app/account/passkey-actions', () => ({
  savePasskeyCredential: hoisted.savePasskeyCredential,
}));

vi.mock('@/lib/passkey/enrolment', () => ({
  enrolPasskey: hoisted.enrolPasskey,
}));

import { PasskeyEnrolmentPanel } from '@/components/passkey/PasskeyEnrolmentPanel';

const session: ApplicationSession = {
  domain: 'application-session',
  provider: 'email',
  userId: 'user-1',
  email: 'resident@example.com',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PasskeyEnrolmentPanel signer disclosure', () => {
  it('never renders the environment-variable name when the signer was not stored', async () => {
    hoisted.enrolPasskey.mockResolvedValue({
      credentialId: 'cred-1',
      publicKey: 'pk-1',
      transports: ['internal'],
      userVerification: true,
    });
    hoisted.savePasskeyCredential.mockResolvedValue({
      credential: {
        credentialId: 'cred-1',
        publicKey: 'pk-1',
        signerAddress: null,
        transports: ['internal'],
        userVerification: true,
        createdAt: '2026-01-02T03:04:05.000Z',
        lastUsedAt: null,
      },
      signer: {
        status: 'not-persisted',
        reason:
          'SUPABASE_SERVICE_ROLE_KEY is not configured, so the derived signer ' +
          'address was not written to passkey_credentials.signer_address.',
      },
    });

    render(
      <PasskeyEnrolmentPanel
        configured
        session={session}
        initialCredential={null}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /create transaction passkey/i }));

    // Honest product language is shown...
    expect(
      await screen.findByText(new RegExp(SIGNER_NOT_STORED_REASON.slice(0, 30))),
    ).toBeInTheDocument();
    // ...and the internal variable name is not.
    expect(screen.queryByText(/SUPABASE_SERVICE_ROLE_KEY/i)).toBeNull();
    expect(screen.queryByText(/signer_address/i)).toBeNull();
  });

  it('offers enrolment when there is no stored credential', () => {
    render(
      <PasskeyEnrolmentPanel
        configured
        session={session}
        initialCredential={null}
      />,
    );

    expect(
      screen.getByRole('button', { name: /create transaction passkey/i }),
    ).toBeEnabled();
  });

  it('shows a stored credential instead of offering to create a second', () => {
    render(
      <PasskeyEnrolmentPanel
        configured
        session={session}
        initialCredential={{
          credentialId: 'cred-existing',
          publicKey: 'pk',
          signerAddress: '0x00000000000000000000000000000000000000AA',
          transports: ['internal'],
          userVerification: true,
          createdAt: '2026-01-02T03:04:05.000Z',
          lastUsedAt: null,
        }}
      />,
    );

    expect(
      screen.queryByRole('button', { name: /create transaction passkey/i }),
    ).toBeNull();
    waitFor(() => expect(screen.getByText(/cred-existing/i)).toBeInTheDocument());
  });
});
