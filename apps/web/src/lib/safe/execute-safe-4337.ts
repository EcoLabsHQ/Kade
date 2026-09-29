import { randomBytes } from 'node:crypto';
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
 *
 * ## The passkey assertion is browser-only
 *
 * `navigator.credentials.get` exists only in the browser, while the Pimlico
 * API key is a server secret, so building and signing cannot happen in one
 * server call. The resident flow is therefore split in two:
 *
 *   1. `buildResidentSafeBatch` — server, no signing. Initialises the pack,
 *      builds the operation and returns its SafeOp EIP-712 `hash` plus a
 *      one-time `token` under which the operation is retained.
 *   2. `submitResidentSafeOperation` — server, after the browser signs. Takes
 *      `{ token, assertion }`, re-checks the retained operation's hash and lets
 *      the SDK attach the client's assertion through the signer's `getFn`.
 *
 * There is no one-call send path: a signer that could produce the assertion
 * in-process does not exist in this product (the passkey is browser-only), so
 * the earlier one-call send seam was removed rather than kept production-dead.
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

/**
 * The bundler's user-operation receipt.
 *
 * `getUserOperationReceipt` returns `null` until the bundler has indexed the
 * mined operation, so a `null` read means "not mined yet" — it is **not** a
 * revert. Only a non-null receipt whose `status` is not `success` is a revert.
 */
export interface UserOperationReceipt {
  readonly receipt?: {
    readonly status?: string;
    readonly transactionHash?: Hex;
  };
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
  getUserOperationReceipt(hash: Hex): Promise<UserOperationReceipt | null>;
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
  /**
   * How the receipt poll waits between reads. Injected so tests stay offline
   * and deterministic; production uses the real timer. See
   * `RECEIPT_POLL_DELAYS_MS`.
   */
  readonly sleep?: (ms: number) => Promise<void>;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** The honest refusal when the sponsored bundler is not configured. */
function pimlicoNotConfiguredReason(): string {
  return (
    `${PIMLICO_ENV_KEYS.apiKey} and ${PIMLICO_ENV_KEYS.policyId} are not both set, ` +
    'so there is no sponsored bundler to submit through.'
  );
}

/**
 * The raw WebAuthn assertion pieces, exactly as they cross the network.
 *
 * A real `Credential` cannot leave the device: `authenticatorData`, `signature`
 * and `clientDataJSON` are byte buffers in the browser. They are serialised as
 * base64url (the WebAuthn JSON form) by the client and decoded back to bytes
 * here.
 *
 * These three values are the **only** thing the submit phase accepts from the
 * client. The operation itself is never accepted from the client — see
 * `submitResidentSafeOperation`.
 */
export interface SafeAssertionParts {
  readonly authenticatorData: string;
  readonly signature: string;
  readonly clientDataJSON: string;
}

/**
 * The build phase's result.
 *
 * `built` carries the one-time `token` that identifies the retained operation
 * and the SafeOp EIP-712 `hash` the passkey must sign. It is **not** the
 * ERC-4337 userOperationHash: the passkey signs the Safe module's typed data,
 * not the bundler's hash.
 */
export type SafeBuildOutcome =
  | { readonly status: 'not-configured'; readonly sent: false; readonly reason: string }
  | { readonly status: 'ready'; readonly sent: false; readonly calls: readonly SafeCall[] }
  | {
      readonly status: 'failed';
      readonly sent: false;
      readonly stage: 'init' | 'create';
      readonly reason: string;
    }
  | {
      readonly status: 'built';
      readonly sent: false;
      /** A cryptographically random, single-use token. */
      readonly token: string;
      /** The SafeOp EIP-712 hash the passkey must sign. */
      readonly hash: Hex;
    };

/** The submit phase's result. `sent` is true only once a user op was broadcast. */
export type SafeSubmitOutcome =
  | { readonly status: 'not-configured'; readonly sent: false; readonly reason: string }
  | {
      readonly status: 'failed';
      readonly sent: boolean;
      readonly stage: 'init' | 'lookup' | 'integrity' | 'sign' | 'submit' | 'receipt';
      readonly reason: string;
      readonly userOperationHash?: Hex;
      /**
       * The mined transaction's hash, when one exists. A reverted user operation
       * still has a transaction on chain, so its hash is surfaced alongside the
       * refusal; a null-receipt pending outcome has no transaction hash.
       */
      readonly transactionHash?: Hex | null;
    }
  | {
      readonly status: 'sent';
      readonly sent: true;
      readonly userOperationHash: Hex;
      readonly transactionHash: Hex | null;
    };

/** How long a retained operation may be signed and submitted before it expires. */
export const RETAINED_OPERATION_TTL_MS = 5 * 60_000;

/**
 * The bounded backoff schedule for reading a user-operation receipt.
 *
 * `executeTransaction` can return before the bundler has indexed the mined
 * operation, so `getUserOperationReceipt` may answer `null` for a while. The
 * schedule caps the extra wait at 30 seconds and backs off so a slow bundler is
 * polled politely; it is a fixed list, so the loop can never run unbounded. When
 * the schedule is exhausted a `null` is reported as **pending**, never as a
 * revert.
 */
export const RECEIPT_POLL_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const;

/** Real wall-clock sleep; injected away in tests so no timer runs. */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface RetainedOperation {
  readonly operation: unknown;
  readonly hash: Hex;
  readonly expiresAt: number;
}

/**
 * The built operations awaiting a signature, keyed by their one-time token.
 *
 * ## Limits (read before scaling)
 *
 * This store is **per-process, in memory**. It does not survive a server
 * restart and it is not shared across instances or serverless invocations, so a
 * build handled by one process cannot be submitted by another. The client
 * simply retries — it builds again and asks for a fresh signature — and the
 * submit phase refuses an unknown, reused or expired token honestly rather than
 * pretending to know it.
 *
 * The alternative (serialising the SDK's `SafeOperation`) is not a supported or
 * stable encoding: the object carries a class instance, a signature map and SDK
 * options, and rebuilding it by hand would risk a different hash — exactly the
 * integrity property this flow must preserve. A short-lived, single-use,
 * in-memory store keyed by a random token is the smallest correct mechanism
 * until a durable store is justified.
 */
const retainedOperations = new Map<string, RetainedOperation>();

/** Retain an operation and mint its one-time token. */
function retainOperation(operation: unknown, hash: Hex, now: number): string {
  // Opportunistically drop operations that were never submitted, so the map
  // cannot grow without bound.
  for (const [key, entry] of retainedOperations) {
    if (entry.expiresAt <= now) retainedOperations.delete(key);
  }
  const token = randomBytes(32).toString('base64url');
  retainedOperations.set(token, {
    operation,
    hash,
    expiresAt: now + RETAINED_OPERATION_TTL_MS,
  });
  return token;
}

/**
 * Consume a token and return its retained operation, or `null`.
 *
 * Single-use: the entry is removed whether or not it has expired, so a replay
 * with the same token can never reach the operation a second time.
 */
function consumeOperation(token: string, now: number): RetainedOperation | null {
  const entry = retainedOperations.get(token);
  if (entry === undefined) return null;
  retainedOperations.delete(token);
  if (entry.expiresAt <= now) return null;
  return entry;
}

/** The SafeOp EIP-712 hash a built operation exposes, or `null` if it has none. */
function operationHash(operation: unknown): Hex | null {
  if (typeof operation !== 'object' || operation === null) return null;
  const getHash = (operation as { getHash?: unknown }).getHash;
  if (typeof getHash !== 'function') return null;
  let value: unknown;
  try {
    value = (getHash as () => unknown).call(operation);
  } catch {
    // A hash that cannot be read is treated as absent, so the caller refuses
    // instead of rejecting out of the fail-closed path.
    return null;
  }
  if (typeof value !== 'string' || !value.startsWith('0x') || value.length <= 2) {
    return null;
  }
  return value as Hex;
}

/**
 * Attach the client's assertion to the signer the submit-phase SDK will ask.
 *
 * The SDK's passkey `sign` reads **only**
 * `assertion.response.{authenticatorData, signature, clientDataJSON}` — its own
 * `extractClientDataFields` and `extractSignature` then run server-side. A real
 * `Credential` cannot cross the network, so a duck-typed object reconstructed
 * from the client's base64url parts satisfies the SDK unchanged. The private
 * extractors are deliberately not reimplemented.
 */
function withAssertion(
  signer: PasskeySigner,
  assertion: SafeAssertionParts,
): PasskeySigner {
  return {
    ...signer,
    getFn: async () =>
      ({
        response: {
          authenticatorData: base64urlToBytes(assertion.authenticatorData),
          signature: base64urlToBytes(assertion.signature),
          clientDataJSON: base64urlToBytes(assertion.clientDataJSON),
        },
      }) as unknown as Credential,
  };
}

/** base64url (no padding) → bytes, the WebAuthn JSON form the client sends. */
function base64urlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary =
    typeof atob === 'function'
      ? atob(padded)
      : Buffer.from(padded, 'base64').toString('binary');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Phase 1 — build the user operation and return the hash the passkey must sign.
 *
 * This performs no signing: it initialises the pack, builds the batch and
 * captures the operation's **SafeOp EIP-712 hash** (`op.getHash()`), which is
 * what the Safe module verifies — not the bundler's userOperationHash. The
 * operation is retained server-side under a one-time token; only `{ token,
 * hash }` is returned, so the calls, nonce, gas and target never round-trip
 * through the client.
 */
export async function buildResidentSafeBatch(
  calls: readonly SafeCall[],
  deps: SafeExecutionDependencies,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SafeBuildOutcome> {
  const chainId = deps.chainId ?? CHAIN_IDS.sepolia;

  const pimlico = readPimlicoConfig(chainId, env);
  if (pimlico === null) {
    return {
      status: 'not-configured',
      sent: false,
      reason: pimlicoNotConfiguredReason(),
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

  let operation: unknown;
  try {
    operation = await pack.createTransaction({
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

  const hash = operationHash(operation);
  if (hash === null) {
    return {
      status: 'failed',
      sent: false,
      stage: 'create',
      reason:
        'The built Safe operation exposed no signable SafeOp hash, so it was ' +
        'not retained and nothing can be signed.',
    };
  }

  const token = retainOperation(operation, hash, Date.now());
  return { status: 'built', sent: false, token, hash };
}

/**
 * Read the user-operation receipt, polling with a bounded backoff while the
 * operation has not been mined yet.
 *
 * A `null` answer is the bundler saying "no receipt has been indexed yet"; it
 * is not a failure and never a revert. The loop is bounded by the fixed
 * `RECEIPT_POLL_DELAYS_MS` schedule, so it can add at most 30 seconds to a
 * request and can never spin. The final `null` is returned to the caller, which
 * reports it as pending rather than reverted.
 *
 * Only this read path is retried: the operation is submitted exactly once, by
 * `submitResidentSafeOperation`, and the one-time token is already consumed.
 */
async function waitForUserOperationReceipt(
  pack: Safe4337PackLike,
  userOperationHash: Hex,
  sleep: (ms: number) => Promise<void>,
): Promise<UserOperationReceipt | null> {
  let receipt = await pack.getUserOperationReceipt(userOperationHash);
  for (const delayMs of RECEIPT_POLL_DELAYS_MS) {
    if (receipt !== null) return receipt;
    await sleep(delayMs);
    receipt = await pack.getUserOperationReceipt(userOperationHash);
  }
  return receipt;
}

/**
 * Phase 2 — attach the client's passkey assertion to the retained operation and
 * submit it.
 *
 * The client supplies only `{ token, assertion }`. Everything else — the calls,
 * nonce, gas, paymaster and target — comes from the server's own retained
 * operation. Before signing, the operation's `getHash()` is re-checked against
 * the hash returned by the build phase; a mismatch refuses. A real assertion
 * that attaches no signature is refused before anything reaches the bundler.
 */
export async function submitResidentSafeOperation(
  input: { readonly token: string; readonly assertion: SafeAssertionParts },
  deps: SafeExecutionDependencies,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SafeSubmitOutcome> {
  const chainId = deps.chainId ?? CHAIN_IDS.sepolia;

  const pimlico = readPimlicoConfig(chainId, env);
  if (pimlico === null) {
    return {
      status: 'not-configured',
      sent: false,
      reason: pimlicoNotConfiguredReason(),
    };
  }

  const retained = consumeOperation(input.token, Date.now());
  if (retained === null) {
    return {
      status: 'failed',
      sent: false,
      stage: 'lookup',
      reason:
        'The operation token is unknown, already used, or expired; nothing was ' +
        'submitted. Build the operation again and sign the fresh hash.',
    };
  }

  const currentHash = operationHash(retained.operation);
  if (currentHash === null || currentHash.toLowerCase() !== retained.hash.toLowerCase()) {
    return {
      status: 'failed',
      sent: false,
      stage: 'integrity',
      reason:
        'The retained operation no longer matches the hash the passkey signed, ' +
        'so it was not submitted.',
    };
  }

  let pack: Safe4337PackLike;
  try {
    pack = await deps.initPack({
      chainId,
      signer: withAssertion(deps.signer, input.assertion),
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

  let signed: unknown;
  try {
    // The SDK recomputes the SafeOp hash, asks the attached `getFn` for the
    // client's assertion, and runs its own extractors over the reconstructed
    // response. No extractor is reimplemented here.
    signed = await pack.signSafeOperation(retained.operation);
  } catch (cause) {
    return {
      status: 'failed',
      sent: false,
      stage: 'sign',
      reason: `The passkey could not sign the operation: ${describe(cause)}`,
    };
  }

  // Fail closed: `encodedSignatures()` is `"0x"` when nothing was attached, and
  // `executeTransaction` would submit that empty payload anyway.
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

  const sleep = deps.sleep ?? defaultSleep;
  try {
    const receipt = await waitForUserOperationReceipt(pack, userOperationHash, sleep);
    if (receipt === null) {
      // The operation was broadcast — `sent` is true — but the bundler has not
      // indexed a receipt within the bounded wait. That is "not mined yet", not
      // a revert, so it is reported as pending with the hash the resident can
      // follow. It is never resubmitted; the token was already consumed.
      return {
        status: 'failed',
        sent: true,
        stage: 'receipt',
        reason:
          'The user operation reached the bundler but has not been confirmed ' +
          'yet; it may still be mined. Track it with its user-operation hash: ' +
          `${userOperationHash}. Do not resubmit.`,
        userOperationHash,
      };
    }
    if (receipt.receipt?.status !== 'success') {
      return {
        status: 'failed',
        sent: true,
        stage: 'receipt',
        reason: 'The user operation reverted.',
        userOperationHash,
        transactionHash: receipt.receipt?.transactionHash ?? null,
      };
    }
    return {
      status: 'sent',
      sent: true,
      userOperationHash,
      transactionHash: receipt.receipt?.transactionHash ?? null,
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
