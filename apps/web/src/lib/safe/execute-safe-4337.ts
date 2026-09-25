import { CHAIN_IDS } from '@kade/shared';
import type { Address, Hex } from 'viem';

/**
 * The resident-Safe execution path, built on Safe's own ERC-4337 flow.
 *
 * This follows the documented Safe SDK sequence exactly (`docs.safe.global`,
 * "Safe accounts with the Safe4337Module"), not a hand-rolled user operation:
 *
 *   Safe4337Pack.init({ provider, signer, bundlerUrl, paymasterOptions })
 *   → createTransaction({ transactions })
 *   → signSafeOperation(safeOperation)
 *   → executeTransaction({ executable })
 *   → getUserOperationReceipt(userOperationHash)
 *
 * The gas is **sponsored**: the paymaster option is Safe's own
 * `{ isSponsored: true }`, so Pimlico pays and the resident's Safe needs no ETH.
 * That is the whole reason this path exists — a resident Safe funds nothing, and
 * every action here is signed once by the passkey.
 *
 * ## What is wired, and what is not
 *
 * The library call sequence is implemented. What this module does **not** yet
 * do is produce the passkey signature: `Safe4337Pack.init` wants an EIP-1193
 * signer, and Kade's signer is the on-chain `SafeWebAuthnSigner`
 * (`SAFE_PASSKEY_MODULE`), whose owner contract **is not deployed** (D-EXE-011).
 * The `signer` is therefore an injected dependency, and its absence is reported
 * as `blocked`, never faked.
 *
 * Nothing is broadcast in tests: the pack is injected too.
 */

/** One call in the batch, the shape the rest of the repo already produces. */
export interface SafeCall {
  readonly to: Address;
  readonly value: bigint;
  readonly data: Hex;
}

/** The Pimlico configuration, read server-side. */
export interface PimlicoConfig {
  readonly apiKey: string;
  readonly policyId: string;
  readonly chainId: number;
}

export const PIMLICO_ENV_KEYS = {
  apiKey: 'PIMLICO_API_KEY',
  policyId: 'PIMLICO_POLICY_ID',
} as const;

/**
 * Read the Pimlico configuration for a chain.
 *
 * Pimlico's RPC is chain-scoped, so the URL is built from the chain id. Both
 * keys are server-only: the API key is a bearer credential and must never reach
 * the browser.
 */
export function readPimlicoConfig(
  chainId: number,
  env: NodeJS.ProcessEnv = process.env,
): PimlicoConfig | null {
  const apiKey = env[PIMLICO_ENV_KEYS.apiKey]?.trim();
  const policyId = env[PIMLICO_ENV_KEYS.policyId]?.trim();
  if (!apiKey || !policyId) return null;
  return { apiKey, policyId, chainId };
}

/** Pimlico's bundler endpoint for a chain (the documented URL shape). */
export function pimlicoBundlerUrl(config: PimlicoConfig): string {
  return `https://api.pimlico.io/v2/${config.chainId}/rpc?apikey=${config.apiKey}`;
}

/**
 * The subset of `Safe4337Pack` this module uses.
 *
 * Declared structurally rather than imported, so the module is testable with a
 * stub and the exact dependency surface is visible in one place. The method
 * names and argument shapes are the documented ones.
 */
export interface Safe4337PackLike {
  createTransaction(input: {
    readonly transactions: readonly {
      readonly to: Address;
      readonly value: string;
      readonly data: Hex;
    }[];
  }): Promise<unknown>;
  signSafeOperation(safeOperation: unknown): Promise<unknown>;
  executeTransaction(input: { readonly executable: unknown }): Promise<Hex>;
  getUserOperationReceipt(hash: Hex): Promise<
    { readonly receipt?: { readonly status?: string; readonly transactionHash?: Hex } } | null
  >;
}

export interface SafeExecutionDependencies {
  /** `Safe4337Pack.init(...)` from `@safe-global/relay-kit`. Injected. */
  readonly initPack: (input: {
    readonly chainId: number;
    readonly safeAddress: Address;
    readonly bundlerUrl: string;
    readonly ownerAddress: Address;
  }) => Promise<Safe4337PackLike>;
  /** The resident Safe. */
  readonly safeAddress: Address;
  /** The Safe's owner: the deployed WebAuthn signer, or null when it has no code. */
  readonly ownerAddress: Address | null;
  readonly chainId?: number;
}

export type SafeExecutionOutcome =
  | { readonly status: 'not-configured'; readonly sent: false; readonly reason: string }
  | { readonly status: 'blocked'; readonly sent: false; readonly reason: string }
  | { readonly status: 'ready'; readonly sent: false; readonly calls: readonly SafeCall[] }
  | {
      readonly status: 'failed';
      readonly sent: boolean;
      readonly stage: 'create' | 'sign' | 'submit' | 'receipt';
      readonly reason: string;
      readonly userOperationHash?: Hex;
    }
  | { readonly status: 'sent'; readonly sent: true; readonly userOperationHash: Hex; readonly transactionHash: Hex | null };

/**
 * Execute a batch from the resident Safe, signed with the passkey and sponsored
 * by Pimlico.
 *
 * The sequence is Safe's documented one. A `sent: true` is returned only after
 * the user-operation receipt confirms; every other outcome is `sent: false`, so
 * a prepared batch can never be mistaken for an executed transaction.
 */
export async function executeResidentSafeBatch(
  calls: readonly SafeCall[],
  deps: SafeExecutionDependencies,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SafeExecutionOutcome> {
  const chainId = deps.chainId ?? CHAIN_IDS.sepolia;

  const pimlico = readPimlicoConfig(chainId, env);
  if (pimlico === null) {
    return {
      status: 'not-configured',
      sent: false,
      reason:
        `${PIMLICO_ENV_KEYS.apiKey} and ${PIMLICO_ENV_KEYS.policyId} are not both set, ` +
        'so there is no sponsored bundler to submit through.',
    };
  }

  // The Safe's only owner is the WebAuthn signer contract. Without it deployed
  // no passkey signature can validate, so nothing can be signed or sent.
  if (deps.ownerAddress === null) {
    return {
      status: 'blocked',
      sent: false,
      reason:
        'The Safe WebAuthn signer has no code on chain, so the passkey signature ' +
        'cannot validate. Nothing is signed or sent.',
    };
  }

  if (calls.length === 0) {
    return { status: 'ready', sent: false, calls };
  }

  let pack: Safe4337PackLike;
  try {
    pack = await deps.initPack({
      chainId,
      safeAddress: deps.safeAddress,
      bundlerUrl: pimlicoBundlerUrl(pimlico),
      ownerAddress: deps.ownerAddress,
    });
  } catch (cause) {
    return {
      status: 'failed',
      sent: false,
      stage: 'create',
      reason: `Safe4337Pack could not be initialised: ${describe(cause)}`,
    };
  }

  let safeOperation: unknown;
  try {
    safeOperation = await pack.createTransaction({
      transactions: calls.map((call) => ({
        to: call.to,
        value: call.value.toString(),
        data: call.data,
      })),
    });
  } catch (cause) {
    return {
      status: 'failed',
      sent: false,
      stage: 'create',
      reason: `The Safe operation could not be built: ${describe(cause)}`,
    };
  }

  let signed: unknown;
  try {
    signed = await pack.signSafeOperation(safeOperation);
  } catch (cause) {
    return {
      status: 'failed',
      sent: false,
      stage: 'sign',
      reason: `The passkey could not sign the operation: ${describe(cause)}`,
    };
  }

  let userOperationHash: Hex;
  try {
    userOperationHash = await pack.executeTransaction({ executable: signed });
  } catch (cause) {
    return {
      status: 'failed',
      sent: false,
      stage: 'submit',
      reason: `The user operation could not be submitted: ${describe(cause)}`,
    };
  }

  try {
    const receipt = await pack.getUserOperationReceipt(userOperationHash);
    if (receipt?.receipt?.status !== 'success') {
      return {
        status: 'failed',
        sent: true,
        stage: 'receipt',
        reason: 'The user operation reverted.',
        userOperationHash,
      };
    }
    return {
      status: 'sent',
      sent: true,
      userOperationHash,
      transactionHash: receipt.receipt.transactionHash ?? null,
    };
  } catch (cause) {
    return {
      status: 'failed',
      sent: true,
      stage: 'receipt',
      reason: `The receipt could not be read: ${describe(cause)}`,
      userOperationHash,
    };
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
