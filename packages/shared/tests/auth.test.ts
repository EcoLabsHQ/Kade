import { describe, expect, it } from 'vitest';
import {
  assertLoginDoesNotRequirePasskey,
  assertSessionCannotAuthoriseTransaction,
  assertUserVerification,
  EXCLUDED_LOGIN_PROVIDERS,
  LOGIN_PROVIDERS,
  type ApplicationSession,
  type PasskeyCredentialRecord,
  type TransactionAuthorisation,
} from '../src/index.js';

const session: ApplicationSession = {
  domain: 'application-session',
  provider: 'google',
  userId: 'user_123',
  email: 'resident@example.com',
};

const authorisation: TransactionAuthorisation = {
  domain: 'transaction-signing',
  method: 'passkey',
  credentialId: 'cred_abc',
};

describe('login model (contract section 2, item 2, amended v1.2)', () => {
  it('permits Google OAuth and email magic link', () => {
    expect([...LOGIN_PROVIDERS].sort()).toEqual(['email', 'google']);
  });

  it('excludes password authentication and wallet login', () => {
    expect(EXCLUDED_LOGIN_PROVIDERS).toContain('password');
    expect(EXCLUDED_LOGIN_PROVIDERS).toContain('wallet');
    // The email provider is permitted, but only for magic links.
    expect(EXCLUDED_LOGIN_PROVIDERS).not.toContain('email');
  });
});

describe('login does not prompt for a passkey (D3)', () => {
  it('accepts a sign-in flow with no WebAuthn step', () => {
    expect(() =>
      assertLoginDoesNotRequirePasskey(['open Google consent', 'exchange code', 'restore session']),
    ).not.toThrow();
  });

  it('rejects a sign-in flow that prompts for a passkey', () => {
    expect(() => assertLoginDoesNotRequirePasskey(['open Google', 'create passkey'])).toThrow(
      /must not prompt for a passkey/,
    );
  });
});

describe('separation of login session and transaction signing', () => {
  it('accepts a passkey authorisation', () => {
    expect(() => assertSessionCannotAuthoriseTransaction(authorisation)).not.toThrow();
  });

  it('rejects a Google session as transaction authorisation (section 2, items 3-4)', () => {
    expect(() => assertSessionCannotAuthoriseTransaction(session)).toThrow(
      /cannot authorise a transaction/,
    );
  });

  it('requires user verification at enrolment', () => {
    const credential: PasskeyCredentialRecord = {
      credentialId: 'cred_abc',
      publicKey: 'pk',
      signerAddress: '0x0000000000000000000000000000000000000001',
      transports: ['internal'],
      userVerification: false,
      createdAt: '2026-09-17T00:00:00Z',
      lastUsedAt: null,
    };
    expect(() => assertUserVerification(credential)).toThrow(/user verification/);
    expect(() => assertUserVerification({ ...credential, userVerification: true })).not.toThrow();
  });
});
