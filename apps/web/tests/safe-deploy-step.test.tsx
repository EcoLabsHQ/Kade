import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

/**
 * Onboarding Step 1, under Safe's passkey model.
 *
 * The step creates the passkey and persists the credential. It does **not**
 * deploy anything: the passkey is the Safe's owner and the account is deployed
 * by its first user operation, so there is no signer contract and no separate
 * deployment transaction. These tests pin that, and pin that a persistence
 * failure is reported honestly rather than hidden.
 */

const hoisted = vi.hoisted(() => ({
  enrolPasskey: vi.fn(),
  savePasskeyCredential: vi.fn(),
  deriveAccount: vi.fn(),
  parseP256PublicKey: vi.fn(),
  deployAccount: vi.fn(),
}));

vi.mock('@/lib/passkey/enrolment', () => ({ enrolPasskey: hoisted.enrolPasskey }));
vi.mock('@/app/account/passkey-actions', () => ({
  savePasskeyCredential: hoisted.savePasskeyCredential,
}));
vi.mock('@/app/onboarding/signer-actions', () => ({
  deriveAccount: hoisted.deriveAccount,
}));
vi.mock('@/lib/passkey/public-key', () => ({
  parseP256PublicKey: hoisted.parseP256PublicKey,
}));
vi.mock('@/app/onboarding/deploy-actions', () => ({
  deployAccount: hoisted.deployAccount,
}));

import { AccountSetupStep } from '@/components/onboarding/AccountSetupStep';

const SAFE = '0x3e8cD8C29a32912f7E6e659c6f8645e4f178A9bb';

function renderStep() {
  return render(
    <AccountSetupStep
      rpId="localhost"
      userId="user-1"
      userName="user-1"
      credentialId={null}
      onEnrolled={() => {}}
      onContinue={() => {}}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.enrolPasskey.mockResolvedValue({
    credentialId: 'cred-new',
    publicKey: 'pk-new',
    transports: ['internal'],
    userVerification: true,
  });
  hoisted.savePasskeyCredential.mockResolvedValue({
    credential: {
      credentialId: 'cred-new',
      publicKey: 'pk-new',
      signerAddress: SAFE,
      transports: ['internal'],
      userVerification: true,
      createdAt: '2026-01-02T03:04:05.000Z',
      lastUsedAt: null,
    },
    signer: { status: 'persisted', address: SAFE },
  });
  hoisted.parseP256PublicKey.mockReturnValue({ x: 1n, y: 2n });
  hoisted.deriveAccount.mockResolvedValue({ signerAddress: SAFE, safeAddress: SAFE });
});

afterEach(() => {
  cleanup();
});

async function enrol() {
  fireEvent.click(screen.getByRole('button', { name: /create passkey/i }));
  await screen.findByText(/passkey created/i);
}

describe('AccountSetupStep under the passkey model', () => {
  it('creates the passkey and reports it ready', async () => {
    renderStep();
    await enrol();

    expect(screen.getByText(/passkey created/i)).toBeInTheDocument();
    expect(screen.getByText(/becomes your account owner/i)).toBeInTheDocument();
  });

  it('deploys nothing: the passkey is the owner and the first operation deploys the account', async () => {
    renderStep();
    await enrol();

    // No deployment transaction is attempted from this step any more.
    expect(hoisted.deployAccount).not.toHaveBeenCalled();
    // And the screen never offers a retry for a deployment that cannot fail.
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });

  it('still enrols when the server write fails, and says so instead of claiming it was stored', async () => {
    hoisted.savePasskeyCredential.mockRejectedValue(
      new Error('Storing the credential failed.'),
    );
    renderStep();
    await enrol();

    // The passkey exists on the device even when the row does not, so the
    // resident is not blocked — and the screen must not claim persistence.
    expect(screen.getByText(/passkey created/i)).toBeInTheDocument();
    expect(screen.getByText(/link it to your account shortly/i)).toBeInTheDocument();
  });

  it('surfaces an enrolment failure rather than a half-created account', async () => {
    hoisted.enrolPasskey.mockRejectedValue(new Error('No credential was returned.'));
    renderStep();
    fireEvent.click(screen.getByRole('button', { name: /create passkey/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /No credential was returned/,
    );
  });
});
