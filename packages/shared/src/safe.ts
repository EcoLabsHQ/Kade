/**
 * Safe account model.
 *
 * Source: docs/week-1-frozen-delivery-contract.md section 4 (D4) and section 2
 * items 5-7, 9.
 *
 * Frozen facts:
 *   - The resident Safe is deployed on Ethereum Sepolia in iteration 1.
 *   - The direct Safe WebAuthn signer is the only operational owner.
 *   - Threshold is 1.
 *   - No user EOA is an owner.
 *   - The active chains (Ethereum Sepolia and Base Sepolia, per contract v1.6)
 *     must produce the same Safe address from frozen deployment inputs.
 *   - The transaction, Safe address, predicted L2 addresses, Safe version,
 *     factory, singleton, initializer, handler, owner, threshold, salt and
 *     creation-code assumptions must all be persisted.
 *
 * Concrete version, factory, singleton and handler values are recorded in
 * `./safe-deployments.ts` with their provenance; the passkey module is confirmed
 * against the deployed contracts. The signer (the Safe's `owner`) is not an
 * input: it is derived per resident from the passkey through the deployed
 * signer factory. The salt nonce strategy is proposed but not yet approved at
 * the Account gate (section 7, checkpoint 2).
 */

import type { Sourced } from './provenance.js';
import type { ChainId } from './chains.js';

export type Address = `0x${string}`;

/** Threshold is frozen at 1 (contract section 2, item 6). */
export const SAFE_THRESHOLD = 1 as const;

/** No managed embedded signer in Week 1 (contract section 2, item 5). */
export const FORBIDDEN_SIGNER_PROVIDERS = ['privy', 'turnkey'] as const;

export interface SafeDeploymentInputs {
  readonly safeVersion: Sourced<string>;
  readonly proxyFactory: Sourced<Address>;
  readonly singleton: Sourced<Address>;
  readonly compatibilityFallbackHandler: Sourced<Address>;
  readonly saltNonce: Sourced<string>;
  readonly threshold: typeof SAFE_THRESHOLD;
}

/**
 * Inputs that must be identical on every chain for the address to match.
 * Changing any of these changes the predicted address and is therefore a
 * change-control item (contract section 8).
 *
 * The passkey signer is not listed: it is derived per resident from the
 * credential, not supplied as configuration, and it is persisted as the
 * manifest's `owner` rather than as an input (see `SafeDeploymentManifest`).
 */
export function identicalAcrossChains(inputs: SafeDeploymentInputs): Record<string, string> {
  return {
    safeVersion: inputs.safeVersion.value,
    proxyFactory: inputs.proxyFactory.value,
    singleton: inputs.singleton.value,
    compatibilityFallbackHandler: inputs.compatibilityFallbackHandler.value,
    saltNonce: inputs.saltNonce.value,
    threshold: String(inputs.threshold),
  };
}

export interface SafeDeploymentRecord {
  readonly chainId: ChainId;
  readonly safeAddress: Address;
  /** Set only for the chain where the Safe was actually deployed. */
  readonly deploymentTxHash: Address | null;
  /** True when the address is counterfactual (predicted, not deployed). */
  readonly predicted: boolean;
}

/**
 * D4: the same Safe address on every active chain (iteration 1: Ethereum
 * Sepolia and Base Sepolia; Arbitrum deferred, contract v1.6).
 */
export function assertSameAddressAcrossChains(records: readonly SafeDeploymentRecord[]): void {
  const addresses = new Set(records.map((r) => r.safeAddress.toLowerCase()));
  if (addresses.size !== 1) {
    throw new Error(
      `Safe address mismatch across chains: expected one address, found ${addresses.size} ` +
        `(${[...addresses].join(', ')}). The deployment inputs are not frozen.`,
    );
  }
}

/**
 * D4: the passkey signer is the only operational owner, and no user EOA is an
 * owner.
 */
export function assertPasskeyOnlyOwnership(
  owners: readonly Address[],
  signer: Address,
  knownUserEoas: readonly Address[] = [],
): void {
  if (owners.length !== 1) {
    throw new Error(`Expected exactly 1 owner (the passkey signer), found ${owners.length}.`);
  }
  if (owners[0]?.toLowerCase() !== signer.toLowerCase()) {
    throw new Error(
      `Expected the passkey signer ${signer} to be the only owner, found ${owners[0]}.`,
    );
  }
  const eoa = knownUserEoas.find((a) => a.toLowerCase() === signer.toLowerCase());
  if (eoa) {
    throw new Error(`The passkey signer must not be a user EOA (contract section 2, item 6).`);
  }
}

/** D4: threshold 1. */
export function assertThresholdOne(threshold: number): void {
  if (threshold !== SAFE_THRESHOLD) {
    throw new Error(`Safe threshold must be ${SAFE_THRESHOLD}, found ${threshold}.`);
  }
}
