import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * The onboarding step must show the real deployment outcome, in product
 * language, and let the resident retry a failed deployment.
 *
 * `deployAccount` is mocked so each failure mode can be presented without a
 * chain. The point is that a failure is neither hidden behind "shortly" nor
 * turned into configuration jargon, and that the retry button re-runs the same
 * action rather than asking for a second passkey.
 */

const hoisted = vi.hoisted(() => ({
  enrolPasskey: vi.fn(),
  savePasskeyCredential: vi.fn(),
  deriveAccount: vi.fn(),
  parseP256PublicKey: vi.fn(),
  deployAccount: vi.fn(),
  sendPasskeySignerDeploymentAction: vi.fn(),
}));

vi.mock('@/lib/passkey/enrolment', () => ({ enrolPasskey: hoisted.enrolPasskey }));
vi.mock('@/app/account/passkey-actions', () => ({
  savePasskeyCredential: hoisted.savePasskeyCredential,
}));
vi.mock('@/app/onboarding/signer-actions', () => ({
  deriveAccount: hoisted.deriveAccount,
  // Step 1 now deploys the WebAuthn signer BEFORE the Safe, because the Safe's
  // owner is the signer contract.
  sendPasskeySignerDeploymentAction: hoisted.sendPasskeySignerDeploymentAction,
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
  // Step 1 deploys the signer first; a succeeded deployment is the happy path.
  hoisted.sendPasskeySignerDeploymentAction.mockResolvedValue({
    status: 'sent',
    signerAddress: SAFE,
    txHash: '0xsigner',
  });
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

describe('AccountSetupStep deployment outcome', () => {
  it('reports a live account on success', async () => {
    hoisted.deployAccount.mockResolvedValue({ status: 'deployed', safeAddress: SAFE });
    renderStep();

    await enrol();

    expect(await screen.findByText(/account is live on Sepolia/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });

  it.each([
    ['not-configured', /still preparing account setup/i],
    ['insufficient-funds', /could not cover the network fee/i],
    ['address-mismatch', /paused for a safety check/i],
    ['failed', /could not finish setting up your account/i],
  ] as const)('states the %s failure specifically and offers a retry', async (status, message) => {
    hoisted.deployAccount.mockResolvedValue({ status, safeAddress: SAFE });
    renderStep();

    await enrol();

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeEnabled();
    // No configuration name reaches the screen.
    expect(screen.queryByText(/SEPOLIA|PRIVATE_KEY|RPC_URL/i)).toBeNull();
  });

  it('retries the same deployment action and can then report success', async () => {
    hoisted.deployAccount
      .mockResolvedValueOnce({ status: 'insufficient-funds', safeAddress: SAFE })
      .mockResolvedValueOnce({ status: 'deployed', safeAddress: SAFE });
    renderStep();

    await enrol();
    const retry = await screen.findByRole('button', { name: /try again/i });

    fireEvent.click(retry);

    await waitFor(() => expect(hoisted.deployAccount).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/account is live on Sepolia/i)).toBeInTheDocument();
    // The passkey was created once; the retry never enrols a second one.
    expect(hoisted.enrolPasskey).toHaveBeenCalledTimes(1);
    expect(hoisted.savePasskeyCredential).toHaveBeenCalledTimes(1);
  });
});
