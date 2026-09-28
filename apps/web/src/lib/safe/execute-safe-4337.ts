import { CHAIN_IDS } from '@kade/shared';
import type { Address, Hex } from 'viem';
import type { PasskeySigner } from './passkey-signer';

/**
 * The resident-Safe execution, on Safe's documented passkey + 4337 flow.
 *
 * Follows `docs.safe.global` exactly:
 *
 *   Safe.init({ provider, signer: passkeySigner, safeAddress })
 *     → protocolKit.createTransaction({ transactions })
 *     → protocolKit.signTransaction(safeTransaction)
 *     → Safe4337Pack.init(...) / executeTransaction
 *
 * **There is no signer contract to deploy.** The passkey is the owner; Safe
 * verifies the WebAuthn assertion itself. An undeployed Safe is deployed by its
 * first user operation, which is why the flow can start from nothing.
 *
 * Gas is sponsored through Safe's own `{ isSponsored: true }` paymaster option,
 * so the resident signs once with their passkey and pays nothing.
 *
 * Nothing is broadcast in tests: the SDK is injected at both seams.
 */

/** One call in the batch, the shape the rest of the repo already produces. */
export interface SafeCall {
  readonly to: Address;
  readonly value: bigint;
  readonly data: Hex;
}

export const PIMLICO_ENV_KEYS = {
  apiKey: 'PIMLICO_API_KEY',
  policyId: 'PIMLICO_POLICY_ID',
} as const;

export interface PimlicoConfig {
  readonly apiKey: string;
  readonly policyId: string;
  readonly chainId: number;
}

/** Read the Pimlico configuration. Both keys are server-only. */
export function readPimlicoConfig(
  chainId: number,
  env: NodeJS.ProcessEnv = process.env,
): PimlicoConfig | null {
  const apiKey = env[PIMLICO_ENV_KEYS.apiKey]?.trim();
  const policyId = env[PIMLICO_ENV_KEYS.policyId]?.trim();
  if (!apiKey || !policyId) return null;
  return { apiKey, policyId, chainId };
}

/** Pimlico's chain-scoped endpoint (the URL shape Safe's guide uses). */
export function pimlicoUrl(config: PimlicoConfig): string {
  return `https://api.pimlico.io/v2/${config.chainId}/rpc?add_balance_override&apikey=${config.apiKey}`;
}

/** The SDK surface this module uses, declared so it is stubable in tests. */
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
    | {
        readonly receipt?: {
          readonly status?: string;
          readonly transactionHash?: Hex;
        };
      }
    | null
  >;
  /** The Safe address, deployed or counterfactual. */
  readonly protocolKit?: { getAddress(): Promise<string> };
}

export interface SafeExecutionDependencies {
  /** `Safe4337Pack.init(...)`, injected so tests need no network. */
  readonly initPack: (input: {
    readonly chainId: number;
    readonly signer: PasskeySigner;
    readonly safeAddress: Address | null;
    readonly bundlerUrl: string;
  }) => Promise<Safe4337PackLike>;
  /** The passkey signer Safe uses as the owner. */
  readonly signer: PasskeySigner;
  /** The Safe to execute from, or `null` to deploy a fresh one on first use. */
  readonly safeAddress: Address | null;
  readonly chainId?: number;
}

export type SafeExecutionOutcome =
  | { readonly status: 'not-configured'; readonly sent: false; readonly reason: string }
  | { readonly status: 'ready'; readonly sent: false; readonly calls: readonly SafeCall[] }
  | {
      readonly status: 'failed';
      readonly sent: boolean;
      readonly stage: 'init' | 'create' | 'sign' | 'submit' | 'receipt';
      readonly reason: string;
      readonly userOperationHash?: Hex;
    }
  | {
      readonly status: 'sent';
      readonly sent: true;
      readonly userOperationHash: Hex;
      readonly transactionHash: Hex | null;
    };

/**
 * Execute a batch from the resident Safe, signed with the passkey and sponsored
 * by Pimlico.
 *
 * A `sent: true` appears only after the user-operation receipt confirms; every
 * other outcome is `sent: false`, so a prepared batch can never be mistaken for
 * an executed transaction.
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

  if (calls.length === 0) {
    return { status: 'ready', sent: false, calls };
  }

  let pack: Safe4337PackLike;
  try {
    pack = await deps.initPack({
      chainId,
      signer: deps.signer,
      safeAddress: deps.safeAddress,
      bundlerUrl: pimlicoUrl(pimlico),
    });
  } catch (cause) {
    return {
      status: 'failed',
      sent: false,
      stage: 'init',
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
    // The passkey assertion is produced here: Safe asks the signer for it.
    signed = await pack.signSafeOperation(safeOperation);
  } catch (cause) {
    return {
      status: 'failed',
      sent: false,
      stage: 'sign',
      reason: `The passkey could not sign the operation: ${describe(cause)}`,
    };
  }

  // The SDK submits whatever `encodedSignatures()` returns, and that is `"0x"`
  // when the passkey attached nothing. Refuse here rather than broadcast an
  // unsigned operation: no signature means no authorisation, so nothing is sent.
  if (!hasSignature(signed)) {
    return {
      status: 'failed',
      sent: false,
      stage: 'sign',
      reason:
        'The passkey attached no signature to the operation, so it was not ' +
        'submitted.',
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

/**
 * Whether the signed Safe operation actually carries a signature.
 *
 * `SafeOperation.encodedSignatures()` returns `"0x"` when no signature was
 * attached — for example when a passkey assertion resolves with nothing — and
 * the SDK's `executeTransaction` would submit that empty payload anyway. The
 * engine checks the encoded value first, so an operation with no signature can
 * never reach the bundler. Anything that is not a non-empty `0x` string is
 * treated as unsigned, which keeps the guard fail-closed.
 */
function hasSignature(signed: unknown): boolean {
  if (typeof signed !== 'object' || signed === null) return false;
  const encoded = (signed as { encodedSignatures?: unknown }).encodedSignatures;
  if (typeof encoded !== 'function') return false;
  const value = (encoded as () => unknown).call(signed);
  return typeof value === 'string' && value.startsWith('0x') && value.length > 2;
}
