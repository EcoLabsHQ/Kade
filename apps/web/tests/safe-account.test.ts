import { describe, expect, it } from 'vitest';
import { keccak256 } from 'viem';
import {
  DEPLOYED_SAFE_PROXY_CREATION_CODE,
  DEPLOYED_SAFE_PROXY_CREATION_CODE_HASH,
  SAFE_PROXY_CREATION_CODE,
  SAFE_PROXY_CREATION_CODE_HASH,
} from '@kade/shared';
import { predictedSafeAddress, residentSaltNonce } from '@/lib/safe/account';

/**
 * A signer address, as the deployed signer factory would return it for a key.
 * The value itself is not what is under test — the arithmetic over the frozen
 * deployment inputs is.
 */
const SIGNER = '0x8d36E6FF7e49e1b665c0b83B5394606bEed804A9';
const OTHER_SIGNER = '0x2222222222222222222222222222222222222222';

/** The creation code the deploying factory actually uses, not our own build. */
const DEPLOYED_CODE = DEPLOYED_SAFE_PROXY_CREATION_CODE;

function derive(userId: string, signerAddress: `0x${string}`) {
  return predictedSafeAddress({
    userId,
    signerAddress,
    proxyCreationCode: DEPLOYED_CODE,
  });
}

/**
 * The address derived for this signer and `user-1` under Safe v1.5.0 with the
 * factory's own creation code. A golden vector: it moves only if the Safe
 * release, an address, the initializer shape, the salt strategy or the factory's
 * creation code changes — each of which moves every resident's account.
 */
const GOLDEN = '0x3e8cD8C29a32912f7E6e659c6f8645e4f178A9bb';

describe('resident account derivation (D4)', () => {
  it('derives the pinned address for a given resident and signer', () => {
    expect(derive('user-1', SIGNER)).toBe(GOLDEN);
  });

  it('is deterministic', () => {
    expect(derive('user-1', SIGNER)).toBe(derive('user-1', SIGNER));
  });

  it('gives each resident a different address', () => {
    expect(derive('user-2', SIGNER)).not.toBe(GOLDEN);
  });

  it('gives each passkey a different address', () => {
    expect(derive('user-1', OTHER_SIGNER)).not.toBe(GOLDEN);
  });

  it('returns an EIP-55 checksummed address', () => {
    const address = derive('user-1', SIGNER);
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(address).not.toBe(address.toLowerCase());
  });

  it('derives the salt nonce from the resident id, not from a counter', () => {
    // Stable across calls, distinct between residents, and independent of any
    // state the server would have to keep.
    expect(residentSaltNonce('user-1')).toBe(residentSaltNonce('user-1'));
    expect(residentSaltNonce('user-1')).not.toBe(residentSaltNonce('user-2'));
  });

  it('deriving from a locally built creation code would be wrong', () => {
    // Regression guard for a real defect: this repository's own SafeProxy build
    // is 649 bytes against the factory's 438, so an address derived from it is
    // one the factory would never deploy. The two hashes must not converge, and
    // the derivation above must use the deployed code.
    expect(SAFE_PROXY_CREATION_CODE_HASH).not.toBe(
      DEPLOYED_SAFE_PROXY_CREATION_CODE_HASH,
    );
    expect(keccak256(DEPLOYED_CODE)).toBe(DEPLOYED_SAFE_PROXY_CREATION_CODE_HASH);
    expect(keccak256(SAFE_PROXY_CREATION_CODE)).toBe(SAFE_PROXY_CREATION_CODE_HASH);

    const local = predictedSafeAddress({
      userId: 'user-1',
      signerAddress: SIGNER,
      proxyCreationCode: SAFE_PROXY_CREATION_CODE,
    });
    expect(local).not.toBe(GOLDEN);
  });
});
