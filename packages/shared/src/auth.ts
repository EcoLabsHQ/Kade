/**
 * Authentication and transaction-authorisation model.
 *
 * Source: docs/week-1-frozen-delivery-contract.md section 2 items 2-6 and
 * section 4 (D3).
 *
 * Frozen facts:
 *   - Google OAuth through Supabase is the only application login.
 *   - No email OTP fallback in Week 1.
 *   - The passkey is separate from the login session and is used only to
 *     authorise Safe transactions.
 *   - Google credentials cannot authorise financial transactions.
 *   - Login must not prompt for a passkey.
 *   - Credential metadata required for future signing is stored securely and
 *     survives reload.
 *   - A test signature validates through the direct Safe WebAuthn signer.
 *
 * This module encodes the separation as data and guards, so that a regression
 * which couples login to the passkey, or which lets a Google session reach the
 * signing path, fails a test rather than shipping.
 */

/** The only permitted login provider (contract section 2, item 2). */
export const LOGIN_PROVIDER = 'google' as const;
export type LoginProvider = typeof LOGIN_PROVIDER;

/** Providers explicitly excluded in Week 1 (contract section 2, item 2). */
export const EXCLUDED_LOGIN_PROVIDERS = ['email', 'email_otp', 'password', 'magic_link'] as const;

/**
 * The two authority domains. They never overlap: an application session
 * authenticates the user; a passkey authorises a Safe transaction.
 */
export type AuthorityDomain = 'application-session' | 'transaction-signing';

export interface PasskeyCredentialRecord {
  /** WebAuthn credential id (base64url). */
  readonly credentialId: string;
  /** Credential public key, used to derive the Safe WebAuthn signer. */
  readonly publicKey: string;
  /** The counterfactual `SafeWebAuthnSigner` address for this credential. */
  readonly signerAddress: `0x${string}`;
  /** Transports reported by the authenticator. */
  readonly transports: readonly string[];
  /** Whether the credential required user verification at enrolment. */
  readonly userVerification: boolean;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
}

export interface ApplicationSession {
  readonly domain: 'application-session';
  readonly provider: LoginProvider;
  /** Supabase user id. Never a wallet address. */
  readonly userId: string;
  readonly email: string;
}

export interface TransactionAuthorisation {
  readonly domain: 'transaction-signing';
  /** Always the passkey. Never the session provider. */
  readonly method: 'passkey';
  readonly credentialId: string;
}

/**
 * D3: login does not prompt for a passkey.
 *
 * The enrolment flow is only reachable from an authenticated session, and the
 * sign-in flow must not invoke the WebAuthn API.
 */
export function assertLoginDoesNotRequirePasskey(signInSteps: readonly string[]): void {
  const prompt = signInSteps.find((s) => /passkey|webauthn|credential/i.test(s));
  if (prompt) {
    throw new Error(
      `Login must not prompt for a passkey (contract D3); found step "${prompt}".`,
    );
  }
}

/**
 * Contract section 2, items 3 and 4: Google credentials cannot authorise
 * financial transactions.
 */
export function assertSessionCannotAuthoriseTransaction(
  authorisation: TransactionAuthorisation | ApplicationSession,
): asserts authorisation is TransactionAuthorisation {
  if (authorisation.domain !== 'transaction-signing') {
    throw new Error(
      'A Google/Supabase session cannot authorise a transaction. ' +
        'Transaction authorisation requires the passkey (contract section 2, items 3-4).',
    );
  }
  if (authorisation.method !== 'passkey') {
    throw new Error('Transaction authorisation method must be the passkey.');
  }
}

/** An application session is never sufficient on its own. */
export function requiresPasskeyForTransaction(): true {
  return true;
}

/** Enrolment requires user verification (contract D3). */
export function assertUserVerification(credential: PasskeyCredentialRecord): void {
  if (!credential.userVerification) {
    throw new Error('The transaction passkey must be created with user verification (contract D3).');
  }
}
