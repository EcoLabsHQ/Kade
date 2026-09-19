import { describe, expect, it } from 'vitest';
import { parseP256PublicKey } from '@/lib/passkey/public-key';

/**
 * A real P-256 key, generated with OpenSSL and exported as SubjectPublicKeyInfo
 * DER then base64url-encoded — the same bytes `startRegistration()` returns in
 * `response.publicKey`. The expected coordinates are OpenSSL's own `ec -text`
 * output for the same key, so the vector is independent of this parser.
 */
const REAL_SPKI =
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEhKtMrf9_4pL52N0vu32ITXObg_aKHBEmUhtHBc8emoPeHcxCgv3XReybe6LiIVB-gpgt05_d49LeIZCWRbXVWA';
const REAL_X = 0x84ab4cadff7fe292f9d8dd2fbb7d884d739b83f68a1c1126521b4705cf1e9a83n;
const REAL_Y = 0xde1dcc4282fdd745ec9b7ba2e221507e82982dd39fdde3d2de21909645b5d558n;

/** base64url <-> bytes, so vectors can be corrupted byte-wise in the test. */
function decode(value: string): Uint8Array {
  const normalised = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised.padEnd(
    normalised.length + ((4 - (normalised.length % 4)) % 4),
    '=',
  );
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

describe('P-256 public key parsing', () => {
  it('recovers the coordinates of a real credential public key', () => {
    expect(parseP256PublicKey(REAL_SPKI)).toEqual({ x: REAL_X, y: REAL_Y });
  });

  it('recovers the same key from the padded base64url form', () => {
    // Some transports pad base64url; the coordinates must not change.
    expect(parseP256PublicKey(`${REAL_SPKI}==`)).toEqual({
      x: REAL_X,
      y: REAL_Y,
    });
  });

  it('rejects a key that is not P-256 SubjectPublicKeyInfo', () => {
    // A real P-384 key, again generated with OpenSSL: a well-formed
    // SubjectPublicKeyInfo that is simply not the curve the Safe signer uses.
    const p384Spki =
      'MHYwEAYHKoZIzj0CAQYFK4EEACIDYgAEBX_khbtVb6picG0M88_Ad3HUDdqP9Pa54nVC-1pfaTz-rPuitP366fIO3akyqB_05JOshF0QsLl6LkqJlBxMc74mwzyRB0E9fPfhsyirtQwhN2wQa1GZQk7JMtCfqGhD';
    expect(() => parseP256PublicKey(p384Spki)).toThrow(/91-byte P-256/);
  });

  it('rejects a P-256-length value whose framing is wrong', () => {
    // Same byte count, corrupted leading SEQUENCE tag: the coordinates must not
    // be read out of a structure this parser does not recognise.
    const bytes = decode(REAL_SPKI);
    bytes[0] = 0x31;
    expect(() => parseP256PublicKey(encode(bytes))).toThrow(
      /SubjectPublicKeyInfo/,
    );
  });

  it('rejects a compressed point', () => {
    const bytes = decode(REAL_SPKI);
    bytes[26] = 0x02; // compressed marker in place of 0x04
    expect(() => parseP256PublicKey(encode(bytes))).toThrow(/uncompressed/);
  });

  it('refuses to guess when the input is not a key at all', () => {
    expect(() => parseP256PublicKey('not-a-key')).toThrow();
  });
});
