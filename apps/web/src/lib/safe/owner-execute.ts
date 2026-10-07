import { getAddress, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { SafeCall } from './execute-safe-4337';

/**
 * Executing an owner-Safe transaction signed by a server-held owner key.
 *
 * The resident-Safe engine (`./execute-safe-4337`) is a passkey + 4337 flow:
 * the resident signs in the browser and pays nothing. This module is the
 * **operator** counterpart. The `MembershipManager` is `Ownable2Step` and its
 * owner is the Kade Safe, so the manager cannot be called directly by the
 * backend: the call must be executed *by the Safe*. The backend holds one Safe
 * owner key (`KADE_MEMBERSHIP_SIGNER_PRIVATE_KEY`), the Safe threshold is 1, so
 * one signature is enough.
 *
 * It follows Safe's documented protocol-kit flow:
 *
 *   Safe.init({ provider, signer, safeAddress })
 *     → protocolKit.createTransaction({ transactions: [call] })
 *     → protocolKit.signTransaction(safeTransaction)
 *     → protocolKit.executeTransaction(signed)
 *     → wait for the receipt
 *
 * **No network is reached in tests**: both seams (`initSafe`, `waitForReceipt`)
 * are injected, so a fake can prove the flow without a chain.
 *
 * ## The signer key is never exposed
 *
 * The private key is read on the server, passed only into `Safe.init`, and
 * never logged, never returned and never serialised. The only identity this
 * module derives is the signer's public address (`deriveSignerAddress`), used to
 * confirm the signer is one of the Safe's owners before anything is signed. A
 * test asserts the key never appears in the result or in any log.
 */

/** The full input one owner-Safe execution needs. */
export interface SafeOwnerExecutionInput {
  /** The chain the Safe and the manager are on. */
  readonly chainId: number;
  /** The RPC endpoint for that chain. */
  readonly rpcUrl: string;
  /** The Safe that owns the manager and executes the call. */
  readonly safeAddress: Address;
  /**
   * The server-held Safe owner private key. Read from the server environment
   * and never logged, returned or serialised.
   */
  readonly privateKey: string;
  /** The single call to execute from the Safe. */
  readonly call: SafeCall;
}

export interface SafeOwnerExecutionResult {
  readonly txHash: Hex;
  readonly blockNumber: bigint;
  /** True only when the mined transaction status is success. */
  readonly success: boolean;
}

/**
 * The executor seam the mint path depends on: it already carries the secrets,
 * so the mint module never sees them.
 */
export type SafeOwnerExecutor = (input: {
  readonly chainId: number;
  readonly call: SafeCall;
}) => Promise<SafeOwnerExecutionResult>;

/** The slice of protocol-kit's `Safe` this module uses. */
export interface ProtocolKitLike {
  getOwners(): Promise<readonly string[]>;
  createTransaction(input: {
    readonly transactions: readonly {
      readonly to: string;
      readonly value: string;
      readonly data: string;
    }[];
  }): Promise<unknown>;
  signTransaction(transaction: unknown): Promise<unknown>;
  executeTransaction(transaction: unknown): Promise<{ readonly hash: string }>;
}

/** The two SDK seams, injected so a test never reaches a chain. */
export interface SafeOwnerExecutionDependencies {
  readonly initSafe: (config: {
    readonly provider: string;
    readonly signer: string;
    readonly safeAddress: string;
  }) => Promise<ProtocolKitLike>;
  readonly waitForReceipt: (input: {
    readonly rpcUrl: string;
    readonly hash: Hex;
  }) => Promise<{ readonly blockNumber: bigint; readonly success: boolean }>;
}

const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;

/**
 * The public address of the owner key, or null when the key is malformed.
 *
 * The derived address is the only signer identity this module exposes; the key
 * itself is never returned. Callers that need to show identity report this.
 */
export function deriveSignerAddress(privateKey: string): Address | null {
  if (!PRIVATE_KEY_PATTERN.test(privateKey)) return null;
  try {
    return getAddress(privateKeyToAccount(privateKey as Hex).address);
  } catch {
    return null;
  }
}

/**
 * Execute one call from the owner Safe, signed by the server-held owner key.
 *
 * Fails closed on a malformed key or a signer that is not one of the Safe's
 * owners, before anything is signed. The returned result carries only the
 * transaction hash, the block and the status.
 */
export async function executeSafeOwnerCall(
  input: SafeOwnerExecutionInput,
  deps: SafeOwnerExecutionDependencies = defaultSafeOwnerExecutionDependencies(),
): Promise<SafeOwnerExecutionResult> {
  const signerAddress = deriveSignerAddress(input.privateKey);
  if (signerAddress === null) {
    throw new Error(
      'The owner-Safe signer key is not a valid 32-byte private key, so no ' +
        'Safe transaction was signed.',
    );
  }

  const protocolKit = await deps.initSafe({
    provider: input.rpcUrl,
    signer: input.privateKey,
    safeAddress: input.safeAddress,
  });

  const owners = await protocolKit.getOwners();
  const isOwner = owners.some(
    (owner) => owner.toLowerCase() === signerAddress.toLowerCase(),
  );
  if (!isOwner) {
    throw new Error(
      'The configured signer is not an owner of the owner Safe, so no Safe ' +
        'transaction was signed.',
    );
  }

  const transaction = await protocolKit.createTransaction({
    transactions: [
      {
        to: input.call.to,
        value: input.call.value.toString(),
        data: input.call.data,
      },
    ],
  });
  const signed = await protocolKit.signTransaction(transaction);
  const executed = await protocolKit.executeTransaction(signed);
  const txHash = executed.hash as Hex;

  const receipt = await deps.waitForReceipt({ rpcUrl: input.rpcUrl, hash: txHash });
  return {
    txHash,
    blockNumber: receipt.blockNumber,
    success: receipt.success,
  };
}

/** Replace every occurrence of `secret` in `message` with a marker. */
function redact(message: string, secret: string): string {
  if (secret.length === 0) return message;
  return message.split(secret).join('[redacted]');
}

/**
 * Bind the environment-resolved secrets into a {@link SafeOwnerExecutor}.
 *
 * The mint path receives the bound executor, so it never handles the key. The
 * low-level `execute` seam is injectable for tests.
 *
 * Any error the executor throws is **redacted**: a message that happened to
 * contain the key (for example from an SDK that echoes its input) is returned
 * without it. This is the boundary that keeps the key out of the mint outcome,
 * the server action's response and any log.
 */
export function ownerSafeExecutor(input: {
  readonly rpcUrl: string;
  readonly safeAddress: Address;
  readonly privateKey: string;
  readonly execute?: (
    input: SafeOwnerExecutionInput,
    deps?: SafeOwnerExecutionDependencies,
  ) => Promise<SafeOwnerExecutionResult>;
}): SafeOwnerExecutor {
  const execute = input.execute ?? executeSafeOwnerCall;
  return async (call) => {
    try {
      return await execute({
        chainId: call.chainId,
        rpcUrl: input.rpcUrl,
        safeAddress: input.safeAddress,
        privateKey: input.privateKey,
        call: call.call,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new Error(redact(message, input.privateKey));
    }
  };
}

/**
 * The production seams: protocol-kit's `Safe.init` and a viem receipt wait.
 *
 * Both are loaded lazily, so importing this module never loads the SDK or dials
 * a network.
 */
export function defaultSafeOwnerExecutionDependencies(): SafeOwnerExecutionDependencies {
  return {
    async initSafe(config) {
      const { default: Safe } = await import('@safe-global/protocol-kit');
      const protocolKit = await Safe.init({
        provider: config.provider,
        signer: config.signer,
        safeAddress: config.safeAddress,
      } as never);
      return protocolKit as unknown as ProtocolKitLike;
    },
    async waitForReceipt({ rpcUrl, hash }) {
      const { createPublicClient, http } = await import('viem');
      const client = createPublicClient({ transport: http(rpcUrl) });
      const receipt = await client.waitForTransactionReceipt({ hash });
      return {
        blockNumber: receipt.blockNumber,
        success: receipt.status === 'success',
      };
    },
  };
}
