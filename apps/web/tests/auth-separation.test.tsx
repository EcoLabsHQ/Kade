import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import {
  assertLoginDoesNotRequirePasskey,
  assertSessionCannotAuthoriseTransaction,
  assertUserVerification,
  type ApplicationSession,
  type PasskeyCredentialRecord,
  type TransactionAuthorisation,
} from '@kade/shared';
import { assertPermittedSignIn, isExcludedProvider, SIGN_IN_STEPS } from '@/lib/auth/provider';
import { asTransactionAuthorisation } from '@/lib/passkey/signing';
import {
  assertEnrolmentAllowed,
  buildRegistrationOptions,
  enrolPasskey,
  toEnrolmentRecord,
  UNRESOLVED_SIGNER_ADDRESS,
} from '@/lib/passkey/enrolment';
import { FeeSummary } from '@/components/fees/FeeSummary';

afterEach(() => {
  cleanup();
});

const session: ApplicationSession = {
  domain: 'application-session',
  provider: 'google',
  userId: 'user-1',
  email: 'resident@example.com',
};

const authorisation: TransactionAuthorisation = {
  domain: 'transaction-signing',
  method: 'passkey',
  credentialId: 'cred-1',
};

describe('login does not require a passkey', () => {
  it('passes for the real sign-in steps', () => {
    expect(() => assertLoginDoesNotRequirePasskey(SIGN_IN_STEPS)).not.toThrow();
    expect(() => assertPermittedSignIn(SIGN_IN_STEPS)).not.toThrow();
  });

  it('fails if a passkey step is introduced', () => {
    expect(() =>
      assertLoginDoesNotRequirePasskey(['open-login-screen', 'passkey']),
    ).toThrow(/must not prompt for a passkey/i);
  });

  it('records the excluded providers', () => {
    // Contract section 2 item 2 as amended v1.2: email magic link is now a
    // permitted method, but password and wallet login remain excluded.
    expect(isExcludedProvider('password')).toBe(true);
    expect(isExcludedProvider('wallet')).toBe(true);
    expect(isExcludedProvider('google')).toBe(false);
    expect(isExcludedProvider('email')).toBe(false);
  });
});

describe('session and transaction authority are separate', () => {
  it('refuses to treat an application session as a transaction authorisation', () => {
    expect(() => assertSessionCannotAuthoriseTransaction(session)).toThrow(
      /cannot authorise a transaction/i,
    );
    expect(() => asTransactionAuthorisation(session)).toThrow();
  });

  it('accepts a passkey authorisation', () => {
    expect(asTransactionAuthorisation(authorisation)).toBe(authorisation);
  });
});

describe('passkey enrolment scaffold', () => {
  it('requires an authenticated session', () => {
    expect(() => assertEnrolmentAllowed(null)).toThrow(
      /authenticated application session/i,
    );
    expect(() => assertEnrolmentAllowed(session)).not.toThrow();
  });

  it('requests user verification', () => {
    const options = buildRegistrationOptions({
      rpId: 'localhost',
      rpName: 'Kade',
      userId: session.userId,
      userName: session.email,
      challenge: 'challenge',
    });
    expect(options.authenticatorSelection?.userVerification).toBe('required');
  });

  it('enrols with an unresolved signer address and keeps user verification', async () => {
    const register = vi.fn().mockResolvedValue({
      id: 'credential-id',
      rawId: 'credential-id',
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: 'client-data',
        attestationObject: 'attestation',
        transports: ['internal'],
        publicKey: 'public-key',
      },
    });

    const record = await enrolPasskey(
      session,
      {
        rpId: 'localhost',
        rpName: 'Kade',
        userId: session.userId,
        userName: session.email,
        challenge: 'challenge',
      },
      { register },
    );

    expect(record.credentialId).toBe('credential-id');
    expect(record.transports).toEqual(['internal']);
    expect(record.userVerification).toBe(true);
    expect(record.signerAddressStatus).toBe('unresolved');
    expect(record.signerAddress).toBe(UNRESOLVED_SIGNER_ADDRESS);
  });

  it('rejects a credential that was not created with user verification', () => {
    const record: PasskeyCredentialRecord = {
      credentialId: 'cred',
      publicKey: 'key',
      signerAddress: UNRESOLVED_SIGNER_ADDRESS,
      transports: [],
      userVerification: false,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    };
    expect(() => assertUserVerification(record)).toThrow(/user verification/i);
  });

  it('marks a registration response as unresolved rather than inventing an address', () => {
    const record = toEnrolmentRecord({
      id: 'cred',
      rawId: 'cred',
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: 'client-data',
        attestationObject: 'attestation',
        transports: [],
      },
    });
    expect(record.signerAddressStatus).toBe('unresolved');
    expect(record.signerAddress).toBe(UNRESOLVED_SIGNER_ADDRESS);
  });
});

describe('fee display reads from the shared package', () => {
  it('renders the shared value and accepts no client amount', () => {
    const { getByText } = render(<FeeSummary mode="demo" householdSize={3} />);
    expect(getByText('1.75 USDC')).toBeInTheDocument();
  });
});
