import { encodeFunctionData, getAddress, type Address, type Hex } from 'viem';
import { SAFE_DEPLOYMENTS, type SafeVersion } from '@kade/shared';

/**
 * The account's own Safe deployment, as Safe's SDK predicts it.
 *
 * The resident account address comes from Safe's SDK (see `derive-account.ts`
 * and `docs/../DEVELOPMENT_CONTRACT`): `Safe4337Pack` composes the `setup`
 * initializer, pins the salt, chooses the singleton and the proxy factory, and
 * reports the counterfactual address. Kade does not reproduce that arithmetic
 * to decide the address.
 *
 * It is still needed to **deploy** the recorded account with the EOA-payer
 * engine, because `SafeProxyFactory.createProxyWithNonce` has to be handed the
 * exact `initializer`, `singleton` and `saltNonce` the address was committed to.
 * This module is the one place those inputs are reconstructed from the SDK's own
 * predicted configuration, so the deployment cannot drift from the derivation.
 */

/**
 * The SDK's predicted `setup` inputs, flattened.
 *
 * This mirrors `getPredictedSafe().safeAccountConfig` plus the version and salt
 * from `safeDeploymentConfig`. Only the fields that are part of the
 * `SafeProxyFactory.createProxyWithNonce` digest are carried.
 */
export interface PredictedSafeConfig {
  /** The Safe release the SDK predicted (e.g. `1.4.1`). */
  readonly safeVersion: string;
  /** The fixed create2 salt nonce the SDK used (`'0'` for our pinned path). */
  readonly saltNonce: string;
  /** The owners committed to the account. */
  readonly owners: readonly Address[];
  readonly threshold: number;
  /** The `setup` call target (multiSend when the setup is batched). */
  readonly to: Address;
  /** The `setup` call data (module enablement + shared-signer configure). */
  readonly data: Hex;
  readonly fallbackHandler: Address;
  readonly paymentToken?: Address;
  readonly payment?: bigint | number | string;
  readonly paymentReceiver?: Address;
}

/** The `setup` calldata the account is initialised with, ready for the factory. */
export interface SafeDeploymentInputs {
  readonly factory: Address;
  readonly singleton: Address;
  readonly initializer: Hex;
  readonly saltNonce: bigint;
  /** The owners the deployed Safe must report, in order. */
  readonly owners: readonly Address[];
  readonly threshold: number;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

/** `Safe.setup(address[],uint256,address,bytes,address,address,uint256,address)`. */
const SAFE_SETUP_ABI = [
  {
    type: 'function',
    name: 'setup',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_owners', type: 'address[]' },
      { name: '_threshold', type: 'uint256' },
      { name: 'to', type: 'address' },
      { name: 'data', type: 'bytes' },
      { name: 'fallbackHandler', type: 'address' },
      { name: 'paymentToken', type: 'address' },
      { name: 'payment', type: 'uint256' },
      { name: 'paymentReceiver', type: 'address' },
    ],
    outputs: [],
  },
] as const;

/** The Safe release record for a predicted version, or null when unknown. */
function deploymentFor(safeVersion: string) {
  return SAFE_DEPLOYMENTS[safeVersion as SafeVersion] ?? null;
}

/**
 * Reconstruct the `createProxyWithNonce` inputs from the SDK's prediction.
 *
 * The factory and singleton are taken from `@kade/shared`'s frozen record for
 * the predicted version, which is the same record the SDK resolves against. The
 * **L1 singleton** is used deliberately: the create-Safe path pins it for every
 * chain, so the address is the same on every chain (`createPinnedSafe4337Pack`).
 * The initializer is encoded from the SDK's own owners, threshold, `to`, `data`
 * and fallback handler, so it is byte-for-byte the one the address commits to.
 *
 * Throws when the predicted version has no frozen record or the config is
 * incomplete: a deployment that cannot be reconstructed must refuse rather than
 * guess an input.
 */
export function deploymentInputsFromPredicted(
  predicted: PredictedSafeConfig,
): SafeDeploymentInputs {
  const deployment = deploymentFor(predicted.safeVersion);
  if (!deployment) {
    throw new Error(
      `No Safe deployment is recorded for version ${predicted.safeVersion}, so ` +
        'the account cannot be deployed.',
    );
  }
  if (predicted.owners.length === 0) {
    throw new Error('The predicted Safe has no owners, so it cannot be deployed.');
  }

  const initializer = encodeFunctionData({
    abi: SAFE_SETUP_ABI,
    functionName: 'setup',
    args: [
      [...predicted.owners],
      BigInt(predicted.threshold),
      selectedOrZero(predicted.to),
      predicted.data,
      selectedOrZero(predicted.fallbackHandler),
      selectedOrZero(predicted.paymentToken),
      BigInt(predicted.payment ?? 0),
      selectedOrZero(predicted.paymentReceiver),
    ],
  });

  return {
    factory: getAddress(deployment.safeProxyFactory.value),
    singleton: getAddress(deployment.safeSingleton.value),
    initializer,
    saltNonce: BigInt(predicted.saltNonce),
    owners: predicted.owners.map((owner) => getAddress(owner)),
    threshold: predicted.threshold,
  };
}

/** An address, or the zero address when the SDK left it unset. */
function selectedOrZero(value: Address | undefined): Address {
  return value === undefined ? ZERO_ADDRESS : getAddress(value);
}

/**
 * Normalise the SDK's `getPredictedSafe()` result, or `undefined` when it is not
 * a usable counterfactual configuration.
 *
 * The SDK nests the fields under `safeDeploymentConfig` and `safeAccountConfig`.
 * A shape that is missing the version, salt, owners, `to`, `data` or fallback
 * handler cannot be deployed faithfully, so it is reported as absent and the
 * caller refuses rather than reconstructing a partial initializer.
 */
export function normalizePredictedSafe(raw: unknown): PredictedSafeConfig | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as {
    readonly safeDeploymentConfig?: {
      readonly safeVersion?: unknown;
      readonly saltNonce?: unknown;
    };
    readonly safeAccountConfig?: {
      readonly owners?: unknown;
      readonly threshold?: unknown;
      readonly to?: unknown;
      readonly data?: unknown;
      readonly fallbackHandler?: unknown;
      readonly paymentToken?: unknown;
      readonly payment?: unknown;
      readonly paymentReceiver?: unknown;
    };
  };
  const deploymentConfig = value.safeDeploymentConfig;
  const accountConfig = value.safeAccountConfig;
  if (!deploymentConfig || !accountConfig) return undefined;

  const { safeVersion, saltNonce } = deploymentConfig;
  if (typeof safeVersion !== 'string' || typeof saltNonce !== 'string') return undefined;

  const { owners, threshold, to, data, fallbackHandler } = accountConfig;
  if (!Array.isArray(owners) || owners.length === 0) return undefined;
  if (!owners.every((owner): owner is string => typeof owner === 'string')) return undefined;
  if (typeof threshold !== 'number') return undefined;
  if (typeof to !== 'string' || typeof fallbackHandler !== 'string') return undefined;
  if (typeof data !== 'string' || !data.startsWith('0x')) return undefined;

  return {
    safeVersion,
    saltNonce,
    owners: owners.map((owner) => getAddress(owner as Address)),
    threshold,
    to: getAddress(to as Address),
    data: data as Hex,
    fallbackHandler: getAddress(fallbackHandler as Address),
    ...(typeof accountConfig.paymentToken === 'string'
      ? { paymentToken: getAddress(accountConfig.paymentToken as Address) }
      : {}),
    ...(typeof accountConfig.payment === 'bigint' ||
    typeof accountConfig.payment === 'number' ||
    typeof accountConfig.payment === 'string'
      ? { payment: accountConfig.payment as bigint | number | string }
      : {}),
    ...(typeof accountConfig.paymentReceiver === 'string'
      ? { paymentReceiver: getAddress(accountConfig.paymentReceiver as Address) }
      : {}),
  };
}
