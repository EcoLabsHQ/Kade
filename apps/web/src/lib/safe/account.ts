import { getAddress, keccak256, toBytes, type Address, type Hex } from 'viem';
import {
  ACTIVE_SAFE_VERSION,
  SAFE_DEPLOYMENTS,
} from '@kade/shared';
import { initializerHash, predictSafeAddress } from './derive';

/**
 * The resident's account address, derived from their passkey.
 *
 * Every input is either frozen in `@kade/shared` or taken from the chain. The
 * one that must come from the chain is the `SafeProxy` creation code: it is part
 * of the CREATE2 digest, so an address is only correct if it is computed from
 * the code the deploying factory will actually use. This repository's own build
 * of `SafeProxy` does **not** produce it — see `SAFE_PROXY_CREATION_CODE` — so
 * the factory is asked for its creation code rather than a local copy being
 * trusted.
 *
 * Nothing is deployed. The Safe address is counterfactual, which is the normal
 * state of a Safe before its first transaction — not a shortcoming of this
 * derivation.
 */

/** The Safe release and inputs that iteration 1 uses. */
export function activeSafeDeployment() {
  return SAFE_DEPLOYMENTS[ACTIVE_SAFE_VERSION];
}

/**
 * The salt nonce that makes one resident's address differ from another's.
 *
 * `SafeProxyFactory` mixes this into the CREATE2 salt, so without it every
 * resident would derive the address of every other resident's Safe. Deriving it
 * from the resident's own id keeps the address stable for a given resident and
 * distinct between residents, with no server-side counter to lose.
 */
export function residentSaltNonce(userId: string): bigint {
  return BigInt(keccak256(toBytes(userId)));
}

export interface SafeAddressInputs {
  readonly userId: string;
  /** The passkey owner, as the deployed signer factory reports it. */
  readonly signerAddress: Address;
  /**
   * `SafeProxyFactory.proxyCreationCode()` from the deploying factory. Not a
   * constant: a local build of the same Safe release differs.
   */
  readonly proxyCreationCode: Hex;
}

/**
 * Predict the address of the resident's Safe, given the deploying factory's own
 * creation code.
 *
 * Callers must supply `proxyCreationCode` from the factory. Passing a locally
 * compiled value silently yields an address the factory will never deploy.
 */
export function predictedSafeAddress(inputs: SafeAddressInputs): Address {
  const deployment = activeSafeDeployment();
  return predictSafeAddress({
    factory: getAddress(deployment.safeProxyFactory.value),
    singleton: getAddress(deployment.safeL2.value),
    initializerHash: initializerHash({
      owners: [inputs.signerAddress],
      threshold: 1,
      fallbackHandler: getAddress(
        deployment.compatibilityFallbackHandler.value,
      ),
    }),
    saltNonce: residentSaltNonce(inputs.userId),
    proxyCreationCode: inputs.proxyCreationCode,
  });
}
