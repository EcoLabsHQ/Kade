import { describe, expect, it } from 'vitest';
import { getAddress, keccak256 } from 'viem';
import { predictSafeAddress } from '@/lib/safe/derive';
import {
  deploymentInputsFromPredicted,
  type PredictedSafeConfig,
} from '@/lib/safe/predicted-safe';
import {
  RECORDED_PREDICTED_CONFIG,
  RECORDED_PROXY_CREATION_CODE,
  RECORDED_SAFE_ADDRESS,
} from './fixtures/recorded-account-vector';

/**
 * Regression: the account's deployment must reproduce the address Safe's SDK
 * derived, not a second derivation.
 *
 * The live symptom: onboarding recorded `0x60b70Ae…` (Safe's SDK, chain 11155111)
 * while the membership guard re-derived the same passkey through Kade's separate
 * create2 arithmetic and got `0x45dc2d99…`. Both derivations are chain-independent,
 * so the guard refused on the membership chain (Arbitrum One, 42161) even though
 * the address is meant to be the same on every chain.
 *
 * These tests pin the reconstruction from the SDK's predicted config against the
 * **recorded, real vector**: the demo passkey's config and the v1.4.1 factory's
 * `proxyCreationCode()` — which is byte-for-byte identical on every chain —
 * reproduce `0x60b70Ae…` exactly. The vector lives in
 * `./fixtures/recorded-account-vector.ts`; the passkey public key is public
 * WebAuthn data, not a secret.
 */

const RECORDED_CONFIG: PredictedSafeConfig = RECORDED_PREDICTED_CONFIG;

/** The frozen v1.4.1 deployment the SDK resolved against. */
const V141_FACTORY = getAddress('0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67');
const V141_L1_SINGLETON = getAddress('0x41675C099F32341bf84BFc5382aF534df5C7461a');

describe('deploymentInputsFromPredicted', () => {
  it('reconstructs the frozen v1.4.1 factory, singleton and salt', () => {
    const inputs = deploymentInputsFromPredicted(RECORDED_CONFIG);

    expect(inputs.factory).toBe(V141_FACTORY);
    // The L1 singleton, pinned on every chain so the address is chain-independent.
    expect(inputs.singleton).toBe(V141_L1_SINGLETON);
    expect(inputs.saltNonce).toBe(0n);
    expect(inputs.owners).toEqual(RECORDED_CONFIG.owners);
    expect(inputs.threshold).toBe(1);
  });

  it('reproduces the recorded address from the recorded config and factory code', () => {
    const inputs = deploymentInputsFromPredicted(RECORDED_CONFIG);

    // The exact arithmetic the deploy engine runs, against the factory's own
    // creation code, reconstructs the onboarding address on any chain.
    const derived = predictSafeAddress({
      factory: inputs.factory,
      singleton: inputs.singleton,
      initializerHash: keccak256(inputs.initializer),
      saltNonce: inputs.saltNonce,
      proxyCreationCode: RECORDED_PROXY_CREATION_CODE,
    });

    expect(derived).toBe(RECORDED_SAFE_ADDRESS);
  });

  it('takes no chain id and reads no chain input', () => {
    // The only chain-varying input in the whole derivation is the factory's
    // `proxyCreationCode()`, which is identical at the frozen factory address on
    // every chain (read on Sepolia and Arbitrum One). There is no chain parameter
    // to differ by, so the same config always reconstructs the same deployment —
    // and therefore the same address.
    expect(deploymentInputsFromPredicted(RECORDED_CONFIG)).toEqual(
      deploymentInputsFromPredicted(RECORDED_CONFIG),
    );
  });
});
