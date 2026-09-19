import { describe, expect, it } from 'vitest';
import { predictedSafeAddress, residentSaltNonce } from '@/lib/safe/account';

/**
 * A signer address, as the deployed signer factory would return it for a key.
 * The value itself is not what is under test here — the arithmetic over the
 * frozen deployment inputs is.
 */
const SIGNER = '0x8d36E6FF7e49e1b665c0b83B5394606bEed804A9';
const OTHER_SIGNER = '0x2222222222222222222222222222222222222222';

/**
 * The address derived for this signer and `user-1` under Safe v1.5.0 with the
 * pinned `SafeProxy` creation code. This is a golden vector: it moves only if
 * the Safe release, an address, the initializer shape, the salt strategy or the
 * compiled creation code changes — each of which would move every resident's
 * account, so it is meant to be loud.
 */
const GOLDEN = '0x72c779286Aa40095C30364fd902A84fC036Ba83f';

describe('resident account derivation (D4)', () => {
  it('derives the pinned address for a given resident and signer', () => {
    expect(predictedSafeAddress('user-1', SIGNER)).toBe(GOLDEN);
  });

  it('is deterministic', () => {
    expect(predictedSafeAddress('user-1', SIGNER)).toBe(
      predictedSafeAddress('user-1', SIGNER),
    );
  });

  it('gives each resident a different address', () => {
    expect(predictedSafeAddress('user-2', SIGNER)).not.toBe(GOLDEN);
  });

  it('gives each passkey a different address', () => {
    expect(predictedSafeAddress('user-1', OTHER_SIGNER)).not.toBe(GOLDEN);
  });

  it('returns an EIP-55 checksummed address', () => {
    const address = predictedSafeAddress('user-1', SIGNER);
    // A lowercase-only or uppercase-only result would mean no checksum.
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(address).not.toBe(address.toLowerCase());
  });

  it('derives the salt nonce from the resident id, not from a counter', () => {
    // Stable across calls, distinct between residents, and independent of any
    // state the server would have to keep.
    expect(residentSaltNonce('user-1')).toBe(residentSaltNonce('user-1'));
    expect(residentSaltNonce('user-1')).not.toBe(residentSaltNonce('user-2'));
  });
});
