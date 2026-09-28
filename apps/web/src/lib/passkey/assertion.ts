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
  /**
   * The credential id as Safe's SDK carries it: the credential's **bytes** as
   * lowercase hex, with no `0x` (see `@/lib/safe/passkey-signer`). WebAuthn's
   * JSON form uses base64url instead, so this is decoded from hex — accepting
   * base64url here would silently produce the wrong credential id.
   */
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
        // Safe's SDK carries the credential id as hex; WebAuthn's JSON form
        // carries it as base64url. Convert once, here.
        id: hexToBase64url(options.credentialId),
        type: 'public-key',
        // `internal` covers platform authenticators (Touch ID, Face ID,
        // Windows Hello, Android biometrics). `hybrid` covers a phone used as
        // the authenticator for a desktop browser.
        transports: ['internal', 'hybrid'],
      },
    ],
  };
}

/** A hex credential id, with or without `0x`, as base64url. */
function hexToBase64url(value: string): string {
  const hex = value.startsWith('0x') ? value.slice(2) : value;
  return Buffer.from(hex, 'hex')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
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

/** The three WebAuthn assertion pieces, base64url, ready to cross the network. */
export interface SerializedPasskeyAssertion {
  readonly authenticatorData: string;
  readonly signature: string;
  readonly clientDataJSON: string;
}

export interface PasskeyAssertionPartsOptions {
  /**
   * The credential id as Safe's SDK carries it: the credential's **bytes** as
   * lowercase hex, with no `0x`. Converted inside, exactly as
   * `promptPasskeyAssertion` does.
   */
  readonly credentialId: string;
  /**
   * The challenge the passkey must sign, as **hex** — here the SafeOp EIP-712
   * hash the build phase returned. It is converted to the base64url form
   * WebAuthn's JSON representation uses, so the signature covers exactly the
   * bytes the hash denotes.
   */
  readonly challenge: string;
  readonly rpId: string;
  readonly timeoutMs?: number;
}

/**
 * Prompt the passkey and return the assertion in transportable form.
 *
 * This is the client half of the two-phase resident flow: the server builds the
 * operation and hands the browser the SafeOp hash, the browser signs it, and
 * the three raw assertion pieces travel back to the server for the SDK to
 * verify. Only these three byte fields are needed — the SDK reads nothing else
 * off the assertion — so a parsed object is enough; a `Credential` never
 * crosses the network.
 */
export async function promptPasskeyAssertionParts(
  options: PasskeyAssertionPartsOptions,
): Promise<SerializedPasskeyAssertion> {
  const credential = (await promptPasskeyAssertion({
    credentialId: options.credentialId,
    // Safe issues the challenge as hex; WebAuthn carries it as base64url.
    // Convert once, here, and sign the same bytes the server hashed.
    challenge: hexToBase64url(options.challenge),
    rpId: options.rpId,
    timeoutMs: options.timeoutMs,
  })) as PublicKeyCredential;

  const response = credential.response as AuthenticatorAssertionResponse;
  if (
    !response ||
    !response.authenticatorData ||
    !response.signature ||
    !response.clientDataJSON
  ) {
    throw new Error(
      'The passkey assertion did not carry authenticatorData, signature and clientDataJSON.',
    );
  }

  return {
    authenticatorData: bytesToBase64url(response.authenticatorData),
    signature: bytesToBase64url(response.signature),
    clientDataJSON: bytesToBase64url(response.clientDataJSON),
  };
}

/** bytes (or an `ArrayBuffer`) → base64url with no padding. */
function bytesToBase64url(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  const base64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(bytes).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
