import {
  startAuthentication,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import type { PasskeySigner } from '@/lib/safe/passkey-signer';

/**
 * Prompt the browser for a passkey assertion.
 *
 * This is the ceremony Safe asks for when it signs: the credential already
 * exists on the device, and this produces the WebAuthn assertion over Safe's
 * challenge. It is the `getFn` of a `PasskeyArgType`.
 *
 * Enrolment creates the credential; this is the only other place the browser's
 * WebAuthn API is reached. Nothing is stored: the assertion is handed straight
 * to the signer.
 *
 * `challenge` is passed through as a base64url string rather than generated
 * here, because Safe produces it from the user operation and it must be signed
 * exactly as issued.
 */

export interface PasskeyAssertionOptions {
  readonly credentialId: string;
  /** base64url challenge from Safe, signed exactly as issued. */
  readonly challenge: string;
  readonly rpId: string;
  readonly timeoutMs?: number;
}

/** [arbitrary] long enough for a fingerprint or a Face ID prompt. */
const DEFAULT_TIMEOUT_MS = 60_000;

export function buildAssertionOptions(
  options: PasskeyAssertionOptions,
): PublicKeyCredentialRequestOptionsJSON {
  return {
    challenge: options.challenge,
    rpId: options.rpId,
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    userVerification: 'required',
    allowCredentials: [
      {
        id: options.credentialId,
        type: 'public-key',
        // `internal` covers platform authenticators (Touch ID, Face ID,
        // Windows Hello, Android biometrics). `hybrid` covers a phone used as
        // the authenticator for a desktop browser.
        transports: ['internal', 'hybrid'],
      },
    ],
  };
}

/**
 * Ask the device for the assertion, as a raw `Credential`.
 *
 * The Safe SDK's `getFn` wants the platform `Credential`, not the parsed
 * response, so this goes through `navigator.credentials.get` directly with the
 * options `@simplewebauthn/browser` builds. Going through the library's own
 * `startAuthentication` would return a parsed object instead.
 */
export async function promptPasskeyAssertion(
  options: PasskeyAssertionOptions,
): Promise<Credential> {
  if (typeof navigator === 'undefined' || !navigator.credentials) {
    throw new Error('WebAuthn is not available in this environment.');
  }

  const publicKey = buildAssertionOptions(options);
  const credential = await navigator.credentials.get({
    publicKey: {
      // Every base64url field has to become bytes before the platform API sees
      // it: it takes `BufferSource`, not the strings WebAuthn's JSON form uses.
      challenge: base64urlToBytes(publicKey.challenge),
      rpId: publicKey.rpId,
      timeout: publicKey.timeout,
      userVerification: publicKey.userVerification,
      allowCredentials: publicKey.allowCredentials?.map((entry) => ({
        id: base64urlToBytes(entry.id),
        type: entry.type as PublicKeyCredentialType,
        transports: entry.transports as AuthenticatorTransport[] | undefined,
      })),
    },
  } as unknown as CredentialRequestOptions);

  if (!credential) {
    throw new Error('The passkey prompt returned no assertion.');
  }
  return credential;
}

/** Attach the prompt to a passkey signer, so Safe can ask for the assertion. */
export function withAssertionPrompt(
  signer: PasskeySigner,
  rpId: string,
  challenge: string,
): PasskeySigner {
  return {
    ...signer,
    getFn: () => promptPasskeyAssertion({ credentialId: signer.rawId, challenge, rpId }),
  };
}

/** base64url (no padding) → bytes, as WebAuthn credential ids are encoded. */
function base64urlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary =
    typeof atob === 'function'
      ? atob(padded)
      : Buffer.from(padded, 'base64').toString('binary');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
