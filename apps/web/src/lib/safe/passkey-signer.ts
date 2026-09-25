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
 * `PasskeyArgType` is `ExtractedPasskeyData & { verifierAddress }` — the
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
    rawId: extracted.rawId,
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
