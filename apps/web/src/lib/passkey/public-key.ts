/**
 * P-256 public key extraction from a WebAuthn registration response.
 *
 * `navigator.credentials.create()` hands back the credential's public key as a
 * base64url-encoded SubjectPublicKeyInfo (DER). A Safe passkey owner is a
 * contract deployed at an address derived from the key's `(x, y)` coordinates,
 * so those coordinates have to be recovered before any account address can be
 * computed.
 *
 * The DER framing depends on the curve: for P-256 the prefix is fixed and the
 * key is always 91 bytes, so this parses that one shape exactly and refuses
 * anything else. It does not attempt to be a general ASN.1 reader — anything it
 * does not recognise is an error, never a guess, because a misread coordinate
 * yields an address for a key the resident does not hold.
 */

export interface P256PublicKey {
  readonly x: bigint;
  readonly y: bigint;
}

/**
 * `SEQUENCE { SEQUENCE { id-ecPublicKey, prime256v1 }, BIT STRING { 0x04 || X || Y } }`
 * up to and including the uncompressed-point marker.
 */
const P256_SPKI_PREFIX =
  '3059301306072a8648ce3d020106082a8648ce3d030107034200';

/** 26-byte prefix + 1-byte point marker + two 32-byte coordinates. */
const P256_SPKI_BYTES = 91;

const PREFIX_BYTES = 26;
const COORDINATE_BYTES = 32;
const UNCOMPRESSED_POINT = 0x04;

function decodeBase64Url(value: string): Uint8Array {
  const normalised = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised.padEnd(
    normalised.length + ((4 - (normalised.length % 4)) % 4),
    '=',
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Recover the `(x, y)` coordinates of a P-256 credential public key.
 *
 * @param spkiBase64Url the value of `response.publicKey` from
 *   `startRegistration()`, which is base64url-encoded SubjectPublicKeyInfo.
 * @throws if the value is not an uncompressed P-256 SubjectPublicKeyInfo.
 */
export function parseP256PublicKey(spkiBase64Url: string): P256PublicKey {
  const bytes = decodeBase64Url(spkiBase64Url);

  if (bytes.length !== P256_SPKI_BYTES) {
    throw new Error(
      `Expected a ${P256_SPKI_BYTES}-byte P-256 public key, got ${bytes.length} bytes. ` +
        'The credential may not use the P-256 curve.',
    );
  }
  if (toHex(bytes.slice(0, PREFIX_BYTES)) !== P256_SPKI_PREFIX) {
    throw new Error(
      'Public key is not an uncompressed P-256 SubjectPublicKeyInfo.',
    );
  }
  if (bytes[PREFIX_BYTES] !== UNCOMPRESSED_POINT) {
    throw new Error(
      'Compressed public keys are not supported; the point must be uncompressed.',
    );
  }

  const xStart = PREFIX_BYTES + 1;
  const yStart = xStart + COORDINATE_BYTES;
  return {
    x: BigInt(`0x${toHex(bytes.slice(xStart, yStart))}`),
    y: BigInt(`0x${toHex(bytes.slice(yStart, yStart + COORDINATE_BYTES))}`),
  };
}
