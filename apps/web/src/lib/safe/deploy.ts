import {
  getAddress,
  type Account,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { CHAIN_IDS, SAFE_THRESHOLD, rpcEnvVarForChain } from '@kade/shared';
import {
  activeSafeDeployment,
  predictedSafeAddress,
  residentSaltNonce,
} from './account';
import { safeInitializer } from './derive';

/**
 * Deploy a resident's counterfactual Safe on a supported chain.
 *
 * The resident's Safe is a `SafeProxy` created by
 * `SafeProxyFactory.createProxyWithNonce(singleton, initializer, saltNonce)` at
 * an address committed to by those inputs, the factory and the factory's own
 * `SafeProxy` creation code. That address is the resident's account: the place
 * their funds are sent. Deploying a *different* address is therefore not a
 * cosmetic bug, it is the creation of an account the resident does not control.
 *
 * This module exists to make that impossible by accident:
 *
 *   1. **Derive first, from the factory's own code.** The factory's
 *      `proxyCreationCode()` is read from the chain and fed through the same
 *      arithmetic as `./account.ts` (never a local build — see
 *      `SAFE_PROXY_CREATION_CODE`). The derived address must equal the expected,
 *      persisted address or the engine aborts.
 *   2. **Simulate the deploy (`eth_call`) and compare.** The address the factory
 *      *would actually create* must also equal the expected address. The
 *      simulation runs against the factory's on-chain code, so it catches a
 *      stale creation code even if the caller passed a consistent-looking
 *      expected address.
 *   3. **Be idempotent.** If the address already has code, no transaction is
 *      sent; the existing state is read and reported.
 *   4. **Estimate before sending** and refuse when the payer cannot cover the
 *      estimate, rather than surfacing a raw revert.
 *   5. **Verify after sending.** Code must be present, `getOwners()` must be the
 *      single passkey signer and `getThreshold()` must be 1. A deployment that
 *      cannot be verified is reported as a failure, never as success.
 *
 * Nothing here broadcasts on its own: the signer and clients are injected by the
 * caller. `deployResidentSafeFromEnv` is the environment wiring; it reads the
 * payer key and RPC for the requested chain (Sepolia by default, Arbitrum One
 * for the membership chain) and never fabricates an account.
 */

/** `SafeProxyFactory.createProxyWithNonce(address,bytes,uint256)`. */
const SAFE_PROXY_FACTORY_ABI = [
  {
    type: 'function',
    name: 'createProxyWithNonce',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_singleton', type: 'address' },
      { name: 'initializer', type: 'bytes' },
      { name: 'saltNonce', type: 'uint256' },
    ],
    // v1.5.0 returns the created proxy, which is what lets step 2 compare the
    // simulated address without trusting a local CREATE2 re-implementation.
    outputs: [{ name: 'proxy', type: 'address' }],
  },
] as const;

/** `SafeProxyFactory.proxyCreationCode()`. */
const PROXY_CREATION_CODE_ABI = [
  {
    type: 'function',
    name: 'proxyCreationCode',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes' }],
  },
] as const;

/** The `Safe` views used to verify a deployed proxy. */
const SAFE_ABI = [
  {
    type: 'function',
    name: 'getOwners',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address[]' }],
  },
  {
    type: 'function',
    name: 'getThreshold',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

/** The payer's key for the default (Sepolia) deployment. Server-only. */
export const PAYER_PRIVATE_KEY_ENV = 'SEPOLIA_DEPLOYER_PRIVATE_KEY';

/** The Sepolia JSON-RPC endpoint, as used by `./signer-actions`. */
export const RPC_URL_ENV = 'SEPOLIA_RPC_URL';

/**
 * The funded deployer key per chain.
 *
 * The engine is EOA-payer based (it sends `createProxyWithNonce` from a funded
 * account), not sponsored: it does not use Pimlico. A deployment on a new chain
 * therefore needs a deployer key funded on that chain. Sepolia keeps its
 * historical variable; Arbitrum One gets its own, named for the chain like the
 * RPC variables. A chain absent here cannot be deployed by this engine and the
 * caller is told so precisely rather than sent to a key that does not exist.
 */
export const PAYER_PRIVATE_KEY_ENV_BY_CHAIN: Readonly<Record<number, string>> = {
  [CHAIN_IDS.sepolia]: 'SEPOLIA_DEPLOYER_PRIVATE_KEY',
  [CHAIN_IDS.arbitrum]: 'ARBITRUM_DEPLOYER_PRIVATE_KEY',
};

/** The deployer-key variable for `chainId`, or null when the engine has none. */
export function payerPrivateKeyEnvForChain(chainId: number): string | null {
  return PAYER_PRIVATE_KEY_ENV_BY_CHAIN[chainId] ?? null;
}

/**
 * The inputs the resident's address was predicted from, plus the expected
 * address itself.
 *
 * `expectedSafeAddress` is deliberately a separate input from the derivation
 * inputs, not something recomputed silently: it is the value persisted and shown
 * to the resident, and the whole point of the guard is to detect when the
 * derivation inputs no longer agree with it.
 *
 * `proxyCreationCode` is **not** an input. It is read from the deploying
 * factory, because this repository's own build of `SafeProxy` differs from the
 * deployed one and a stale local copy yields an address the factory would never
 * deploy (documented in `@kade/shared`).
 */
export interface SafeDeployRequest {
  readonly userId: string;
  /** The passkey signer: the Safe's only owner. */
  readonly signerAddress: Address;
  /** The counterfactual address the resident's Safe must have. */
  readonly expectedSafeAddress: Address;
}

/**
 * The send half of the engine.
 *
 * Deliberately narrow rather than viem's `WalletClient`: viem's conditional
 * types require a `chain` on `writeContract` when the injected client has no
 * chain generic, which would force production callers to thread a chain through
 * calls it already knows. The environment wrapper owns the real client and casts
 * to this shape.
 */
export interface SafeDeployWalletClient {
  writeContract(args: {
    readonly address: Address;
    readonly abi: readonly unknown[];
    readonly functionName: string;
    readonly args: readonly unknown[];
    readonly account: Account;
  }): Promise<Hex>;
}

/**
 * The clients and payer account the engine needs. Injected so the engine is
 * pure and unit-testable without a network, and so the payer key is never read
 * here.
 */
export interface SafeDeployDependencies {
  readonly publicClient: Pick<
    PublicClient,
    | 'getBytecode'
    | 'simulateContract'
    | 'estimateContractGas'
    | 'estimateFeesPerGas'
    | 'getBalance'
    | 'waitForTransactionReceipt'
    | 'readContract'
  >;
  readonly walletClient: SafeDeployWalletClient;
  /** The funded account that pays for the deployment. */
  readonly account: Account;
}

/**
 * The subset of the environment the wiring reads. A plain string record rather
 * than `NodeJS.ProcessEnv` so tests can pass an empty or partial environment
 * without satisfying `ProcessEnv`'s required members.
 */
export type SafeDeployEnv = Readonly<Record<string, string | undefined>>;

/**
 * Where the failure happened. `address-mismatch` is its own outcome because it
 * is not a deployment failure: it is a refusal to deploy at all.
 */
export type SafeDeployFailureStage =
  | 'derive'
  | 'simulate'
  | 'estimate'
  | 'send'
  | 'receipt'
  | 'verify';

/**
 * Structured outcome. Exactly one of these is returned; the engine does not
 * throw for expected failures (an absent key, a mismatch, a revert), so callers
 * cannot mistake an exception for a successful deployment and cannot forget to
 * check a boolean.
 *
 * `deployed` is the only status that asserts new state was created, and it is
 * only returned after `getBytecode`, `getOwners` and `getThreshold` were all
 * verified on chain. `already-deployed` asserts nothing was sent.
 */
export type SafeDeployResult =
  | {
      readonly status: 'already-deployed';
      readonly safeAddress: Address;
      readonly owners: readonly Address[];
      readonly threshold: number;
    }
  | {
      readonly status: 'deployed';
      readonly safeAddress: Address;
      readonly txHash: Hex;
      readonly blockNumber: bigint;
      readonly owners: readonly Address[];
      readonly threshold: number;
    }
  | {
      readonly status: 'insufficient-funds';
      readonly safeAddress: Address;
      readonly payer: Address;
      /** `gas * maxFeePerGas` (or `gasPrice`), the upper bound for the send. */
      readonly required: bigint;
      readonly available: bigint;
    }
  | {
      readonly status: 'address-mismatch';
      /** The address the resident is supposed to have. */
      readonly safeAddress: Address;
      /** What the frozen inputs plus the factory's own code actually derive. */
      readonly derived: Address;
      /** What the factory would create, when the simulation got that far. */
      readonly simulated?: Address;
      readonly reason: string;
    }
  | {
      readonly status: 'not-configured';
      readonly reason: string;
    }
  | {
      readonly status: 'failed';
      readonly safeAddress: Address;
      readonly stage: SafeDeployFailureStage;
      readonly reason: string;
      readonly txHash?: Hex;
    };

interface SafeState {
  readonly owners: readonly Address[];
  readonly threshold: number;
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function sameAddress(a: Address, b: Address): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Read the deployed Safe's owner set and threshold. Returns a reason string
 * instead of throwing so callers can decide whether a read failure is fatal.
 */
async function readSafeState(
  client: Pick<PublicClient, 'readContract'>,
  address: Address,
): Promise<SafeState | { readonly reason: string }> {
  try {
    const [owners, threshold] = await Promise.all([
      client.readContract({
        address,
        abi: SAFE_ABI,
        functionName: 'getOwners',
      }),
      client.readContract({
        address,
        abi: SAFE_ABI,
        functionName: 'getThreshold',
      }),
    ]);
    return { owners: owners.map((owner) => getAddress(owner)), threshold: Number(threshold) };
  } catch (error) {
    return { reason: describe(error) };
  }
}

function hasReason(
  state: SafeState | { readonly reason: string },
): state is { readonly reason: string } {
  return 'reason' in state;
}

/** `true` when `owners` is exactly the single passkey signer and threshold is 1. */
function isPasskeyOnly(state: SafeState, signer: Address): boolean {
  return (
    state.threshold === SAFE_THRESHOLD &&
    state.owners.length === 1 &&
    state.owners[0] !== undefined &&
    sameAddress(state.owners[0], signer)
  );
}

function mismatch(
  expected: Address,
  derived: Address,
  reason: string,
  simulated?: Address,
): SafeDeployResult {
  // Mismatch is the one abort that is security-relevant rather than
  // operational, so it is logged as well as returned.
  console.error(`[kade] refusing to deploy the resident Safe: ${reason}`);
  return { status: 'address-mismatch', safeAddress: expected, derived, simulated, reason };
}

/**
 * Deploy the resident's Safe, or report why it must not be deployed.
 *
 * The client and payer are injected; see `deployResidentSafeFromEnv` for the
 * environment wiring. No transaction is sent unless derivation, idempotency,
 * simulation and the balance check all pass.
 */
export async function deployResidentSafe(
  request: SafeDeployRequest,
  deps: SafeDeployDependencies,
): Promise<SafeDeployResult> {
  const deployment = activeSafeDeployment();
  const factory = getAddress(deployment.safeProxyFactory.value);
  const singleton = getAddress(deployment.safeL2.value);
  const fallbackHandler = getAddress(deployment.compatibilityFallbackHandler.value);
  const signer = getAddress(request.signerAddress);
  const expected = getAddress(request.expectedSafeAddress);

  // --- 1. Derive from the factory's own creation code and compare. ----------
  let proxyCreationCode: Hex;
  try {
    proxyCreationCode = await deps.publicClient.readContract({
      address: factory,
      abi: PROXY_CREATION_CODE_ABI,
      functionName: 'proxyCreationCode',
    });
  } catch (error) {
    return {
      status: 'failed',
      safeAddress: expected,
      stage: 'derive',
      reason: `could not read proxyCreationCode() from the factory ${factory}: ${describe(error)}`,
    };
  }

  const derived = predictedSafeAddress({
    userId: request.userId,
    signerAddress: signer,
    proxyCreationCode,
  });
  if (!sameAddress(derived, expected)) {
    return mismatch(
      expected,
      derived,
      `the derivation inputs derive ${derived}, but the resident's Safe is expected at ${expected}. ` +
        `Deploying would create a Safe the resident does not control.`,
    );
  }

  const initializer = safeInitializer({
    owners: [signer],
    threshold: SAFE_THRESHOLD,
    fallbackHandler,
  });
  const saltNonce = residentSaltNonce(request.userId);
  const deployArgs = [singleton, initializer, saltNonce] as const;

  // --- 2. Idempotency: never send a second transaction. ---------------------
  let existingCode: Hex | undefined;
  try {
    existingCode = await deps.publicClient.getBytecode({ address: expected });
  } catch (error) {
    return {
      status: 'failed',
      safeAddress: expected,
      stage: 'derive',
      reason: `could not read the code at ${expected}: ${describe(error)}`,
    };
  }
  if (existingCode !== undefined && existingCode !== '0x') {
    const state = await readSafeState(deps.publicClient, expected);
    if (hasReason(state)) {
      return {
        status: 'failed',
        safeAddress: expected,
        stage: 'verify',
        reason: `the Safe at ${expected} already has code but its state could not be read: ${state.reason}`,
      };
    }
    return {
      status: 'already-deployed',
      safeAddress: expected,
      owners: state.owners,
      threshold: state.threshold,
    };
  }

  // --- 3. Simulate: the address the factory would actually create. ----------
  let simulated: Address;
  try {
    const simulation = await deps.publicClient.simulateContract({
      address: factory,
      abi: SAFE_PROXY_FACTORY_ABI,
      functionName: 'createProxyWithNonce',
      args: deployArgs,
      account: deps.account,
    });
    if (!simulation.result) {
      return {
        status: 'failed',
        safeAddress: expected,
        stage: 'simulate',
        reason: 'the factory simulation returned no proxy address, so the created address cannot be confirmed.',
      };
    }
    simulated = getAddress(simulation.result);
  } catch (error) {
    return {
      status: 'failed',
      safeAddress: expected,
      stage: 'simulate',
      reason: `createProxyWithNonce would revert: ${describe(error)}`,
    };
  }
  if (!sameAddress(simulated, expected)) {
    return mismatch(
      expected,
      derived,
      `the factory would create ${simulated}, not the expected ${expected}. ` +
        `The inputs are not the ones the address was predicted from.`,
      simulated,
    );
  }

  // --- 4. Estimate and refuse when the payer cannot cover it. ---------------
  let gas: bigint;
  try {
    gas = await deps.publicClient.estimateContractGas({
      address: factory,
      abi: SAFE_PROXY_FACTORY_ABI,
      functionName: 'createProxyWithNonce',
      args: deployArgs,
      account: deps.account,
    });
  } catch (error) {
    return {
      status: 'failed',
      safeAddress: expected,
      stage: 'estimate',
      reason: `could not estimate the deployment gas: ${describe(error)}`,
    };
  }

  let feePerGas: bigint;
  try {
    const fees = (await deps.publicClient.estimateFeesPerGas()) as {
      readonly maxFeePerGas?: bigint;
      readonly gasPrice?: bigint;
    };
    const resolved = fees.maxFeePerGas ?? fees.gasPrice;
    if (resolved === undefined) {
      return {
        status: 'failed',
        safeAddress: expected,
        stage: 'estimate',
        reason: 'the fee estimate carried neither maxFeePerGas nor gasPrice.',
      };
    }
    feePerGas = resolved;
  } catch (error) {
    return {
      status: 'failed',
      safeAddress: expected,
      stage: 'estimate',
      reason: `could not estimate the deployment fee: ${describe(error)}`,
    };
  }

  const required = gas * feePerGas;
  let available: bigint;
  try {
    available = await deps.publicClient.getBalance({ address: deps.account.address });
  } catch (error) {
    return {
      status: 'failed',
      safeAddress: expected,
      stage: 'estimate',
      reason: `could not read the payer balance: ${describe(error)}`,
    };
  }
  if (available < required) {
    return {
      status: 'insufficient-funds',
      safeAddress: expected,
      payer: deps.account.address,
      required,
      available,
    };
  }

  // --- 5. Send. -------------------------------------------------------------
  let txHash: Hex;
  try {
    txHash = await deps.walletClient.writeContract({
      address: factory,
      abi: SAFE_PROXY_FACTORY_ABI,
      functionName: 'createProxyWithNonce',
      args: deployArgs,
      account: deps.account,
    });
  } catch (error) {
    return {
      status: 'failed',
      safeAddress: expected,
      stage: 'send',
      reason: `the deployment transaction could not be sent: ${describe(error)}`,
    };
  }

  // --- 6. Receipt: a reverted or absent receipt is a failure. ---------------
  let blockNumber: bigint;
  try {
    const receipt = await deps.publicClient.waitForTransactionReceipt({ hash: txHash });
    if (!receipt || receipt.status !== 'success') {
      return {
        status: 'failed',
        safeAddress: expected,
        stage: 'receipt',
        reason: 'the deployment transaction reverted.',
        txHash,
      };
    }
    blockNumber = receipt.blockNumber;
  } catch (error) {
    return {
      status: 'failed',
      safeAddress: expected,
      stage: 'receipt',
      reason: `the deployment receipt was not available: ${describe(error)}`,
      txHash,
    };
  }

  // --- 7. Verify on chain before reporting success. -------------------------
  const deployedCode = await deps.publicClient
    .getBytecode({ address: expected })
    .catch(() => undefined);
  if (deployedCode === undefined || deployedCode === '0x') {
    return {
      status: 'failed',
      safeAddress: expected,
      stage: 'verify',
      reason: `the transaction succeeded but ${expected} has no code; the Safe was not deployed.`,
      txHash,
    };
  }

  const state = await readSafeState(deps.publicClient, expected);
  if (hasReason(state)) {
    return {
      status: 'failed',
      safeAddress: expected,
      stage: 'verify',
      reason: `the Safe at ${expected} could not be verified: ${state.reason}`,
      txHash,
    };
  }
  if (!isPasskeyOnly(state, signer)) {
    return {
      status: 'failed',
      safeAddress: expected,
      stage: 'verify',
      reason:
        `the deployed Safe does not match the frozen ownership: expected exactly one owner ` +
        `${signer} at threshold ${SAFE_THRESHOLD}, found ${state.owners.length} owner(s) at ` +
        `threshold ${state.threshold}.`,
      txHash,
    };
  }

  return {
    status: 'deployed',
    safeAddress: expected,
    txHash,
    blockNumber,
    owners: state.owners,
    threshold: state.threshold,
  };
}

/**
 * Read the payer key from the environment.
 *
 * Returns `null` when the variable is absent or is not a 32-byte hex key, so
 * the caller can report `not-configured` instead of constructing an account
 * from a malformed value. The key itself is never logged.
 */
export function readPayerPrivateKey(
  env: SafeDeployEnv = process.env,
): Hex | null {
  return readKeyFromEnv(PAYER_PRIVATE_KEY_ENV, env);
}

/**
 * Read the payer key for `chainId`, or null when the chain has no key variable
 * or the value is absent/malformed. Never falls back to another chain's key: a
 * deployment on Arbitrum must not be paid from a Sepolia-configured account by
 * accident.
 */
export function readPayerPrivateKeyForChain(
  chainId: number,
  env: SafeDeployEnv = process.env,
): Hex | null {
  const name = payerPrivateKeyEnvForChain(chainId);
  if (!name) return null;
  return readKeyFromEnv(name, env);
}

/** Read a well-formed 32-byte key from `name`, or null. */
function readKeyFromEnv(name: string, env: SafeDeployEnv): Hex | null {
  const raw = env[name]?.trim();
  if (!raw) return null;
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) return null;
  return raw as Hex;
}

/**
 * Environment wiring for `deployResidentSafe`.
 *
 * Reads the payer key and the endpoint for `chainId` (Sepolia by default, so
 * existing callers are unchanged). The RPC variable is resolved through the
 * shared `rpcEnvVarForChain` table and the payer key through
 * {@link payerPrivateKeyEnvForChain}, so the membership chain (Arbitrum One)
 * cannot accidentally be deployed from the Sepolia configuration. If either is
 * missing (or the key is malformed) it returns `not-configured` with the exact
 * variable that is absent; it never falls back to a fabricated account, another
 * chain's key, and never throws an opaque error for absent configuration.
 *
 * The engine's core (`deployResidentSafe`) is chain-agnostic: the factory,
 * singleton and fallback handler are canonical addresses deployed on Arbitrum
 * One as well as Sepolia, and the factory's `proxyCreationCode()` is `pure`, so
 * the derived address is identical on both. What a deployment on Arbitrum One
 * needs is therefore only the two chain-scoped environment values:
 * `ARBITRUM_RPC_URL` and a funded `ARBITRUM_DEPLOYER_PRIVATE_KEY`. There is no
 * Pimlico/paymaster dependency in this path.
 *
 * `.env.example` declares the same names, so there is no divergence to track.
 */
export async function deployResidentSafeFromEnv(
  request: SafeDeployRequest,
  env: SafeDeployEnv = process.env,
  chainId: number = CHAIN_IDS.sepolia,
): Promise<SafeDeployResult> {
  const rpcVariable = rpcEnvVarForChain(chainId);
  if (!rpcVariable) {
    return {
      status: 'not-configured',
      reason:
        `chain ${chainId} has no JSON-RPC variable in the shared registry, so the ` +
        'deployment cannot reach it.',
    };
  }

  const privateKey = readPayerPrivateKeyForChain(chainId, env);
  if (!privateKey) {
    const keyVariable = payerPrivateKeyEnvForChain(chainId);
    return {
      status: 'not-configured',
      reason: keyVariable
        ? `${keyVariable} is not set (or is not a 32-byte hex key), so no payer account exists on chain ${chainId}.`
        : `chain ${chainId} has no deployer-key variable, so no payer account exists.`,
    };
  }

  const rpcUrl = env[rpcVariable]?.trim();
  if (!rpcUrl) {
    return {
      status: 'not-configured',
      reason: `${rpcVariable} is not set, so the deployment cannot reach chain ${chainId}.`,
    };
  }

  const { createPublicClient, createWalletClient, http } = await import('viem');
  const { privateKeyToAccount } = await import('viem/accounts');
  const chain = await viemChainFor(chainId);
  if (!chain) {
    return {
      status: 'not-configured',
      reason: `chain ${chainId} has no viem chain definition, so the deployment cannot be signed.`,
    };
  }

  const account = privateKeyToAccount(privateKey);
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });

  return deployResidentSafe(request, {
    publicClient,
    walletClient: walletClient as unknown as SafeDeployWalletClient,
    account,
  });
}

/**
 * The viem chain object for a chain the engine can deploy on, or null.
 *
 * Only the chains this repository actually deploys on are mapped. Returning
 * null (rather than a chainless client) makes an unsupported chain an explicit
 * `not-configured` refusal instead of a send against an endpoint whose chain id
 * nobody checked.
 */
async function viemChainFor(chainId: number) {
  const chains = await import('viem/chains');
  if (chainId === CHAIN_IDS.sepolia) return chains.sepolia;
  if (chainId === CHAIN_IDS.arbitrum) return chains.arbitrum;
  return null;
}
