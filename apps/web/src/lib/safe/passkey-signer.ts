import { SAFE_PASSKEY_MODULE } from '@kade/shared';

/**
 * The passkey signer, as Safe's SDK defines it.
 *
 * This replaces the hand-rolled `SafeWebAuthnSignerFactory.createSigner` path.
 * Safe's own signers guide (`docs.safe.global/sdk/signers/passkeys`) is explicit
 * that **nothing needs deploying**: the SDK turns a WebAuthn credential into a
 * `PasskeyArgType` and uses it directly as the Safe owner.
 *
 *   const credential = await navigator.credentials.create({ ... })
 *   const signer     = await Safe.createPasskeySigner(credential)
 *   const safe       = await Safe.init({ provider, signer, safeAddress })
 *
 * The old path deployed a signer contract first, because a Safe owner had to be
 * an address with code. With the passkey signer Safe verifies the WebAuthn
 * assertion itself, so there is no contract to pre-deploy and no `signerDeployed`
 * gate to wait on.
 *
 * ## `rawId` is hex, and that is not obvious
 *
 * The SDK produces it as
 *
 *   Buffer.from(credential.rawId).toString('hex')
 *
 * — the credential id's **bytes** as a hex string with no `0x`. Kade stores the
 * credential id as base64url (what WebAuthn JSON gives), so it must be converted.
 * Passing the base64url string through made the SDK fail with
 * `Invalid byte sequence ("0x" in "0xggXbr…")`, which is exactly this mistake.
 *
 * `PasskeyArgType` is `ExtractedPasskeyData & { verifierAddress }`; the
 * coordinates come from the credential, and the verifier is chain configuration
 * the repository already carries (`SAFE_PASSKEY_MODULE.p256Verifier`).
 */

/** The coordinates `Safe.createPasskeySigner` extracts from a credential. */
export interface ExtractedPasskeyData {
  readonly rawId: string;
  readonly coordinates: { readonly x: string; readonly y: string };
}

/**
 * What Safe's SDK accepts as a signer.
 *
 * `getFn` lets the SDK ask for a fresh assertion when it signs; that is the
 * passkey ceremony the browser performs, so it is supplied by the caller rather
 * than stored.
 */
export interface PasskeySigner {
  readonly rawId: string;
  readonly coordinates: { readonly x: string; readonly y: string };
  readonly verifierAddress: string;
  readonly getFn?: () => Promise<Credential>;
}

/** The verifier the passkey coordinates are checked against, from the frozen module. */
export function passkeyVerifierAddress(): string {
  return SAFE_PASSKEY_MODULE.p256Verifier.value;
}

/**
 * Convert a credential id to the form Safe's SDK expects.
 *
 * The SDK's own extraction does
 *
 *   Buffer.from(credential.rawId).toString('hex')
 *
 * so `rawId` is the credential id's **bytes** as lowercase hex with no `0x`.
 * Kade stores the id as base64url, which is what the WebAuthn JSON form uses, so
 * it has to be decoded and re-encoded. Handing the base64url string through
 * makes the SDK reject it as a byte sequence.
 */
export function credentialIdToRawId(credentialId: string): string {
  return Buffer.from(base64urlToBytes(credentialId))
    .toString('hex')
    .toLowerCase();
}

/** base64url (with or without padding) → bytes. */
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

/**
 * Build the signer Safe's SDK expects from the data extracted off a credential.
 *
 * `createPasskeySigner` on the SDK does the extraction; this attaches the
 * verifier and keeps the shape in one place, so the owner the Safe is created
 * with and the one that signs later cannot disagree.
 */
export function toPasskeySigner(
  extracted: ExtractedPasskeyData,
  getFn?: () => Promise<Credential>,
): PasskeySigner {
  return {
    rawId: credentialIdToRawId(extracted.rawId),
    coordinates: {
      x: extracted.coordinates.x,
      y: extracted.coordinates.y,
    },
    verifierAddress: passkeyVerifierAddress(),
    ...(getFn ? { getFn } : {}),
  };
}

/**
 * Extract the signer from a freshly created WebAuthn credential.
 *
 * This is `Safe.createPasskeySigner` with the verifier attached. The SDK is
 * loaded lazily so the module can be imported where the library is not needed
 * (and so a test can stub it).
 */
export async function createPasskeySigner(
  credential: Credential,
  getFn?: () => Promise<Credential>,
): Promise<PasskeySigner> {
  const Safe = (await import('@safe-global/protocol-kit')).default;
  const extracted = (await Safe.createPasskeySigner(
    credential,
  )) as ExtractedPasskeyData;
  return toPasskeySigner(extracted, getFn);
}
