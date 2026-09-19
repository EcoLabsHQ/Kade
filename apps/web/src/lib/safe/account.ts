import { getAddress, keccak256, toBytes, type Address } from 'viem';
import {
  ACTIVE_SAFE_VERSION,
  SAFE_DEPLOYMENTS,
  SAFE_PROXY_CREATION_CODE,
} from '@kade/shared';
import { initializerHash, predictSafeAddress } from './derive';

/**
 * The resident's account address, derived from their passkey.
 *
 * Every input is frozen except the passkey's signer address, which arrives with
 * the resident: the Safe release and its three addresses come from
 * `@kade/shared`, the `SafeProxy` creation code is pinned by a Foundry test, and
 * the salt nonce is derived from the resident's id. Nothing here is a
 * placeholder, and nothing here is random.
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

/**
 * Predict the address of the resident's Safe.
 *
 * @param userId the resident's id, used only to derive the salt nonce.
 * @param signerAddress the address of the passkey signer that will own it,
 *   which the deployed signer factory is the authority on.
 */
export function predictedSafeAddress(
  userId: string,
  signerAddress: Address,
): Address {
  const deployment = activeSafeDeployment();
  return predictSafeAddress({
    factory: getAddress(deployment.safeProxyFactory.value),
    singleton: getAddress(deployment.safeL2.value),
    initializerHash: initializerHash({
      owners: [signerAddress],
      threshold: 1,
      fallbackHandler: getAddress(
        deployment.compatibilityFallbackHandler.value,
      ),
    }),
    saltNonce: residentSaltNonce(userId),
    proxyCreationCode: SAFE_PROXY_CREATION_CODE,
  });
}
