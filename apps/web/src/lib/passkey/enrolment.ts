import {
  assertUserVerification,
  type Address,
  type ApplicationSession,
  type PasskeyCredentialRecord,
} from '@kade/shared';
import {
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import { assertPermittedSignIn } from '@/lib/auth/provider';

/**
 * Passkey enrolment scaffold.
 *
 * Contract section 2 item 3 and ADR 0003: the passkey is separate from the
 * login session and authorises Safe transactions only. Enrolment is reachable
 * only from an authenticated session and requests user verification.
 *
 * This is a scaffold:
 *   - the challenge is generated client-side because there is no server
 *     endpoint yet; a production flow must issue and verify it server-side;
 *   - the record carries a sentinel signer address, because deriving the real one
 *     needs a chain call; the enrolling caller derives it separately and shows
 *     the result;
 *   - the browser record is not persisted here: the account panel hands the
 *     credential id, public key, transports and user-verification flag to the
 *     server action, which writes `passkey_credentials` in ./store and derives
 *     the signer address.
 */

/**
 * Sentinel meaning "the Safe WebAuthn signer address has not been derived".
 * The zero address is the conventional null address and is never a deployed
 * signer. `signerAddressStatus` makes the state explicit.
 */
export const UNRESOLVED_SIGNER_ADDRESS: Address =
  '0x0000000000000000000000000000000000000000';

export interface PasskeyEnrolmentRecord extends PasskeyCredentialRecord {
  readonly signerAddressStatus: 'unresolved';
}

/** D3: enrolment requires user verification. */
export const USER_VERIFICATION = 'required' as const;

/**
 * D3: enrolment is only reachable from an authenticated session, and the
 * sign-in flow itself carries no passkey step.
 */
export function assertEnrolmentAllowed(
  session: ApplicationSession | null,
): asserts session is ApplicationSession {
  if (!session || session.domain !== 'application-session') {
    throw new Error(
      'Passkey enrolment requires an authenticated application session (contract D3).',
    );
  }
  assertPermittedSignIn();
}

/** Relying-party metadata. `[arbitrary]` until the project supplies the domain. */
export interface EnrolmentContext {
  readonly rpId: string;
  readonly rpName: string;
  readonly userId: string;
  readonly userName: string;
  readonly challenge: string;
  readonly now?: () => Date;
}

export function buildRegistrationOptions(
  context: EnrolmentContext,
): PublicKeyCredentialCreationOptionsJSON {
  return {
    challenge: context.challenge,
    rp: { id: context.rpId, name: context.rpName },
    user: {
      id: context.userId,
      name: context.userName,
      displayName: context.userName,
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },
      { type: 'public-key', alg: -257 },
    ],
    timeout: 60_000,
    attestation: 'none',
    authenticatorSelection: {
      userVerification: USER_VERIFICATION,
      residentKey: 'preferred',
    },
  };
}

export interface EnrolmentDependencies {
  readonly register?: (options: {
    optionsJSON: PublicKeyCredentialCreationOptionsJSON;
  }) => Promise<RegistrationResponseJSON>;
  readonly now?: () => Date;
}

/** Convert a WebAuthn registration response into the server-side record shape. */
export function toEnrolmentRecord(
  response: RegistrationResponseJSON,
  now: () => Date = () => new Date(),
): PasskeyEnrolmentRecord {
  const record: PasskeyEnrolmentRecord = {
    credentialId: response.id,
    publicKey: response.response.publicKey ?? '',
    signerAddress: UNRESOLVED_SIGNER_ADDRESS,
    transports: response.response.transports ?? [],
    userVerification: true,
    createdAt: now().toISOString(),
    lastUsedAt: null,
    signerAddressStatus: 'unresolved',
  };
  assertUserVerification(record);
  return record;
}

export async function enrolPasskey(
  session: ApplicationSession | null,
  context: EnrolmentContext,
  dependencies: EnrolmentDependencies = {},
): Promise<PasskeyEnrolmentRecord> {
  assertEnrolmentAllowed(session);
  const register = dependencies.register ?? startRegistration;
  const options = buildRegistrationOptions(context);
  const response = await register({ optionsJSON: options });
  return toEnrolmentRecord(response, dependencies.now);
}
