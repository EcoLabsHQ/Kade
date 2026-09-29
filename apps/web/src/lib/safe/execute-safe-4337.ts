import { createHash, createPublicKey, createVerify, randomBytes } from 'node:crypto';
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
 * `getUserOperationReceipt` is a straight passthrough of the standard
 * `eth_getUserOperationReceipt` response — `@safe-global/relay-kit` performs no
 * normalisation — so the payload carries **two** independent status signals:
 *
 *   - `success` — the ERC-4337 user-operation outcome: did the operation's call
 *     succeed? This is authoritative when present.
 *   - `receipt.status` — the raw JSON-RPC *transaction* status, `'0x1'` for a
 *     mined success and `'0x0'` for a mined revert. It is never the string
 *     `'success'` in a real payload.
 *
 * `getUserOperationReceipt` returns `null` until the bundler has indexed the
 * mined operation, so a `null` read means "not mined yet" — it is **not** a
 * revert. A non-null receipt is decided by `classifyReceipt`.
 */
export interface UserOperationReceipt {
  /**
   * The user-operation-level outcome (ERC-4337). Authoritative when present: it
   * distinguishes a genuine call revert (the call reverted, gas was paid) from a
   * mined success.
   */
  readonly success?: boolean;
  readonly receipt?: {
    /**
     * The raw transaction status. Real providers send the hex string `'0x1'`
     * or `'0x0'`; a boolean or the words `'success'`/`'reverted'` are tolerated
     * so a future normalising provider keeps working.
     */
    readonly status?: string | number | boolean;
    readonly transactionHash?: Hex;
  };
}

/**
 * The props relay-kit passes to an estimator's estimating hooks.
 *
 * Only `userOperation` is read here; the rest are forwarded verbatim to the
 * wrapped estimator, so this stays a faithful passthrough rather than a
 * reimplementation of relay-kit's contract.
 */
export interface FeeEstimationProps {
  readonly userOperation: Record<string, unknown>;
  readonly [key: string]: unknown;
}

/** The estimation data an estimator returns; relay-kit applies it verbatim. */
export type FeeEstimationData = Record<string, unknown>;

/**
 * The slice of relay-kit's `IFeeEstimator` this module composes with.
 *
 * relay-kit's `getEstimateFee` (v6.1.1) calls `preEstimateUserOperationGas`
 * before `eth_estimateUserOperationGas`, then `postEstimateUserOperationGas`
 * **after** the gas fields are populated and **before** they are hashed. The post
 * hook is where the default `PimlicoFeeEstimator` calls
 * `pm_sponsorUserOperation`, so it is the last point at which the account's
 * `verificationGasLimit` can be raised while still being both the value the
 * paymaster signs and the value the passkey hashes. The pre hook supplies gas
 * prices and the paymaster stub data and must be forwarded unchanged.
 */
export interface FeeEstimatorLike {
  preEstimateUserOperationGas?(
    props: FeeEstimationProps,
  ): Promise<FeeEstimationData | undefined>;
  postEstimateUserOperationGas?(
    props: FeeEstimationProps,
  ): Promise<FeeEstimationData | undefined>;
}

/** The SDK surface this module uses, declared so it is stubable in tests. */
export interface Safe4337PackLike {
  createTransaction(input: {
    readonly transactions: readonly {
      readonly to: Address;
      readonly value: string;
      readonly data: Hex;
    }[];
    /**
     * relay-kit's `createTransaction` accepts a `feeEstimator` here and routes
     * it through `getEstimateFee`. Passing one is how this module inserts the
     * buffering step before the paymaster signs.
     */
    readonly options?: { readonly feeEstimator?: FeeEstimatorLike };
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
  /**
   * The SDK's own fee estimator (production: `new PimlicoFeeEstimator()`), which
   * this module wraps so the account's verification gas is buffered **before**
   * the paymaster signs. Omitting it still buffers and still refuses on a bad
   * estimate, but attaches no paymaster data, so production must supply it.
   */
  readonly feeEstimator?: FeeEstimatorLike;
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
      /**
       * `estimate` is its own stage because a built operation that carries no
       * usable verification-gas estimate must refuse before anything is signed
       * — the allowance is part of the hash the passkey signs, so it cannot be
       * corrected at submit time.
       */
      readonly stage: 'init' | 'create' | 'estimate';
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
 * The bounded safety buffer applied to the account's estimated verification gas.
 *
 * ## Why a buffer is needed
 *
 * `eth_estimateUserOperationGas` runs against Safe's **dummy** WebAuthn
 * signature (relay-kit's `getDummySignature`), while the operation the resident
 * signs carries a real P-256 assertion. The estimator therefore undercounts the
 * validation cost, and the shortfall is not small. The gas fields are part of
 * the SafeOp hash the passkey signs, so the allowance cannot be corrected at
 * submit time.
 *
 * ## Calibration — measured on a live sponsored reproduction
 *
 * A diagnosis task reproduced the live Base failure on Sepolia with a throwaway
 * passkey Safe and a throwaway P-256 credential (the same pinned pack factory
 * the app uses, sponsored through the same Pimlico account, a harmless no-op
 * batch). On a **deployed** passkey Safe, changing only `verificationGasLimit`:
 *
 *   | `verificationGasLimit`              | result                      |
 *   |-------------------------------------|-----------------------------|
 *   | 250,000 (`0x3d090`) — the old floor | **`AA24 signature error`**  |
 *   | 300,000                             | rejected                    |
 *   | 400,000                             | rejected                    |
 *   | 450,000 (`0x6ddd0`)                 | accepted                    |
 *   | 600,000 (`0x927c0`)                 | accepted, receipt `success` |
 *
 * The **mechanism** is why this looked like a signing defect for so long: when
 * validation runs out of gas, the Safe's `checkNSignatures` path treats the
 * failed inner call as an *invalid signature*, the account returns
 * `SIG_VALIDATION_FAILED`, and the EntryPoint reports `AA24 signature error` — a
 * signature error for a gas shortfall. The deploying operation escapes it
 * because `initCode` inflates its estimate to ~1.5 M (`0x17d07d`), far above the
 * floor; a deployed Safe's raw estimate is only ~51,698, which is what the old
 * 250,000 floor was applied to.
 *
 * ## Where the buffer sits, and why it must sit there
 *
 * The allowance must also be final **before the paymaster signs**. Pimlico's
 * paymaster commits to the account gas limits: `pm_sponsorUserOperation` is
 * called with the operation's `verificationGasLimit` and returns
 * `paymasterData` signed over it, so a value raised afterwards makes the
 * paymaster recover a different signer and the EntryPoint reverts `AA34`.
 * relay-kit calls the account's own `addEstimations` after the sponsorship
 * signature, so buffering there is too late.
 *
 * The one hook that runs on the right side of that boundary is the fee
 * estimator's `postEstimateUserOperationGas` (relay-kit v6.1.1
 * `Safe4337Pack.getEstimateFee`): it receives the operation **after**
 * `eth_estimateUserOperationGas` and is where the default `PimlicoFeeEstimator`
 * calls `pm_sponsorUserOperation`. {@link createVerificationGasBufferingEstimator}
 * wraps that estimator, hands the paymaster the buffered operation, and returns
 * the buffered value so relay-kit writes the same value back through
 * `addEstimations`. The paymaster and the passkey therefore commit to the same
 * allowance.
 *
 * ## The rule
 *
 *     buffer(g) = max(ceil(g × 3 / 2), 600,000)
 *
 * The **600,000 floor** is the value the measurement above accepts with
 * `success:true`. It sits 50% above the highest rejected allowance (400,000) and
 * 33% above the lowest accepted one (450,000), and is ~200,000 above the highest
 * rejection and ~150,000 above the lowest acceptance. `verificationGasLimit` is
 * a **ceiling, not a charge** — unused verification gas is simply not consumed —
 * so the margin is nearly free and belongs on the safe side. The floor is the
 * part that matters: it lifts the observed 51,698 to 600,000, ~11.6× the
 * estimator value the EntryPoint rejected. The value is deliberately the largest
 * allowance the measurement explicitly accepts, so it needs no leap of faith
 * beyond the data.
 *
 * ## The 1.5× multiplier is deliberately left uncapped
 *
 * The deploying case was checked. A ~1.5 M deploy estimate scales to ~2.34 M
 * under the multiplier. No cap is applied, because every value that could be
 * called "known safe" is **below the deploying operation's own estimate**: the
 * only hard sponsorship ceiling on record, 1,050,355 (the live Base deploy), is
 * already smaller than the Sepolia deploy estimate of ~1.5 M, so capping there
 * would force the deploy allowance below what the estimator itself asks for — a
 * guaranteed shortfall, which is strictly worse than an over-large ceiling.
 * Capping anywhere above the estimate would be an unsupported guess. More
 * fundamentally, **this change only raises the floor**: `buffer` is
 * monotonically non-decreasing, and every estimate at or above
 * `floor × 2/3 = 400,000` — which includes every deployment-scale estimate —
 * receives exactly the same allowance as before. A deploying operation that the
 * previous rule handled is therefore untouched, byte for byte.
 *
 * ## The `AA24` mislabel cannot be distinguished after the fact
 *
 * Because an out-of-gas validation and a genuine bad signature both surface as
 * `AA24 signature error` — the EntryPoint collapses each account
 * `SIG_VALIDATION_FAILED` into the same error — the app cannot honestly tell
 * them apart from the bundler's response. No bounded, app-local signal separates
 * them (a fresh `validateUserOp` re-simulation at a higher ceiling would need
 * another network round-trip and is not the fail-closed path this module owns),
 * so no heuristic is invented here. The honest remedy is prevention: the floor
 * above removes the gas-shortfall cause by construction, so the remaining
 * `AA24`s are genuinely attributable to the signature.
 *
 * `preVerificationGas`, `callGasLimit` and the paymaster's own
 * `paymasterVerificationGasLimit` are deliberately **not** touched.
 */
export const VERIFICATION_GAS_BUFFER_NUMERATOR = 3n;
export const VERIFICATION_GAS_BUFFER_DENOMINATOR = 2n;
export const VERIFICATION_GAS_BUFFER_MIN_ALLOWANCE = 600_000n;

/**
 * Apply the documented buffer to an estimated verification-gas allowance.
 *
 * A non-positive estimate yields `0n`; the caller treats that as "no estimate"
 * and refuses, so nothing is ever buffered out of thin air.
 */
export function bufferVerificationGas(estimated: bigint): bigint {
  if (estimated <= 0n) return 0n;
  const scaled =
    (estimated * VERIFICATION_GAS_BUFFER_NUMERATOR +
      VERIFICATION_GAS_BUFFER_DENOMINATOR -
      1n) /
    VERIFICATION_GAS_BUFFER_DENOMINATOR;
  return scaled > VERIFICATION_GAS_BUFFER_MIN_ALLOWANCE
    ? scaled
    : VERIFICATION_GAS_BUFFER_MIN_ALLOWANCE;
}

/**
 * What the buffering estimator did on its one post-estimate hook.
 *
 * `applied` carries the raw estimate and the buffered value it replaced;
 * `refused` carries the reason the estimate was unusable. `null` (not a
 * variant — the field is nullable) means relay-kit never reached the hook.
 */
export type VerificationGasBufferOutcome =
  | { readonly status: 'applied'; readonly raw: bigint; readonly buffered: bigint }
  | { readonly status: 'refused'; readonly reason: string };

/**
 * A buffering estimator plus the outcome of its post-estimate hook.
 *
 * The outcome is captured here rather than re-derived from the built operation
 * so the build phase can tell "the estimate was missing" (refused) from "the
 * hook never ran" (`null`) from "relay-kit did not write the value back".
 */
export interface VerificationGasBufferingEstimator {
  /** The estimator to hand to relay-kit's `createTransaction`. */
  readonly feeEstimator: FeeEstimatorLike;
  /** The hook's outcome, or `null` if it was never called. */
  outcome(): VerificationGasBufferOutcome | null;
}

/** Read a `verificationGasLimit` from a user operation, or `null`. */
function readVerificationGas(userOperation: unknown): bigint | null {
  if (typeof userOperation !== 'object' || userOperation === null) return null;
  const value = (userOperation as { verificationGasLimit?: unknown }).verificationGasLimit;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^(0x[0-9a-fA-F]+|\d+)$/.test(value)) return BigInt(value);
  return null;
}

/**
 * Wrap the SDK's fee estimator so the account's verification gas is buffered
 * **before the paymaster signs**.
 *
 * In relay-kit, `postEstimateUserOperationGas` is called with the operation the
 * bundler just estimated and is where the default `PimlicoFeeEstimator` calls
 * `pm_sponsorUserOperation`. This wrapper raises `verificationGasLimit` on the
 * operation it passes down, so the paymaster signs the buffered value, and
 * returns the same buffered value so `safeOperation.addEstimations` writes it
 * back. The signed allowance and the submitted allowance are therefore equal by
 * construction, not by coincidence.
 *
 * A missing or non-positive estimate is *refused* rather than buffered from
 * nothing: the hook returns no estimation and records a refusal, and the build
 * phase refuses before anything is signed or retained. Omitting `base` still
 * buffers (and still refuses), but attaches no paymaster data; production
 * supplies the real estimator.
 */
export function createVerificationGasBufferingEstimator(
  base?: FeeEstimatorLike,
): VerificationGasBufferingEstimator {
  let outcome: VerificationGasBufferOutcome | null = null;

  const feeEstimator: FeeEstimatorLike = {
    // Forward the pre hook unchanged (bound to `base`, whose private gas-price
    // helper it calls), so the paymaster stub data and gas prices are still
    // established before the estimate.
    ...(base?.preEstimateUserOperationGas
      ? {
          preEstimateUserOperationGas: (props: FeeEstimationProps) =>
            base.preEstimateUserOperationGas!(props),
        }
      : {}),
    async postEstimateUserOperationGas(props) {
      const estimated = readVerificationGas(props.userOperation);
      if (estimated === null || estimated <= 0n) {
        outcome = {
          status: 'refused',
          reason:
            'The built Safe operation reported no verification gas estimate, so its ' +
            'validation allowance could not be safely buffered and nothing was signed.',
        };
        return {};
      }

      const buffered = bufferVerificationGas(estimated);
      // Hand the *buffered* operation to the SDK's estimator: this is the exact
      // operation the paymaster signs over.
      const estimation = base?.postEstimateUserOperationGas
        ? await base.postEstimateUserOperationGas({
            ...props,
            userOperation: { ...props.userOperation, verificationGasLimit: buffered },
          })
        : undefined;

      outcome = { status: 'applied', raw: estimated, buffered };
      // Carry the buffered value back so `addEstimations` writes the same value
      // the paymaster just committed to.
      return { ...estimation, verificationGasLimit: buffered };
    },
  };

  return { feeEstimator, outcome: () => outcome };
}

/**
 * Read the built operation's live verification-gas allowance, or `null` when it
 * does not expose one.
 *
 * Used as a defence-in-depth check after `createTransaction`: the build phase
 * asserts the operation really carries the buffered value it handed the
 * estimator, so a relay-kit that failed to write the returned estimation back
 * cannot be signed.
 */
function estimatedVerificationGas(operation: unknown): bigint | null {
  if (typeof operation !== 'object' || operation === null) return null;
  const getUserOperation = (operation as { getUserOperation?: unknown }).getUserOperation;
  if (typeof getUserOperation !== 'function') return null;
  let userOperation: unknown;
  try {
    userOperation = (getUserOperation as () => unknown).call(operation);
  } catch {
    return null;
  }
  return readVerificationGas(userOperation);
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
 *
 * The account's `verificationGasLimit` is raised, by the documented
 * {@link bufferVerificationGas} rule, through a wrapped fee estimator **before
 * the paymaster signs** ({@link createVerificationGasBufferingEstimator}). The
 * value the paymaster commits to and the value the passkey hashes are therefore
 * the same; raising it after `createTransaction` returned — the previous
 * approach — made them differ and broke every sponsored operation with `AA34`.
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

  const buffering = createVerificationGasBufferingEstimator(deps.feeEstimator);

  let operation: unknown;
  try {
    operation = await pack.createTransaction({
      transactions: calls.map((call) => ({
        to: call.to,
        value: call.value.toString(),
        data: call.data,
      })),
      options: { feeEstimator: buffering.feeEstimator },
    });
  } catch (cause) {
    return {
      status: 'failed',
      sent: false,
      stage: 'create',
      reason: `The Safe operation could not be built: ${describe(cause)}`,
    };
  }

  // The buffer runs inside `createTransaction`, in the fee estimator's
  // post-estimate hook, so it is already part of the operation the paymaster
  // signed. These checks only confirm it happened and that relay-kit wrote the
  // buffered value back; they never move the allowance.
  const application = buffering.outcome();
  if (application === null) {
    return {
      status: 'failed',
      sent: false,
      stage: 'estimate',
      reason:
        'The verification gas estimator never ran, so the account allowance ' +
        'could not be buffered before signing and nothing was signed.',
    };
  }
  if (application.status === 'refused') {
    return { status: 'failed', sent: false, stage: 'estimate', reason: application.reason };
  }
  if (estimatedVerificationGas(operation) !== application.buffered) {
    return {
      status: 'failed',
      sent: false,
      stage: 'estimate',
      reason:
        'The verification gas estimate could not be buffered onto the built Safe ' +
        'operation, so nothing was signed.',
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
 * Decide a non-null user-operation receipt's outcome.
 *
 * The user-operation-level `success` boolean is authoritative when present: it
 * is what distinguishes a genuine call revert (the call reverted, gas was paid)
 * from a mined success. When it is absent, fall back to the transaction status
 * and accept every real encoding: `'0x1'` / `1` / `true` / `'success'` are
 * success, `'0x0'` / `0` / `false` / `'reverted'` are a revert.
 *
 * An unrecognised or missing status is never success — a non-null receipt we
 * cannot classify is reported as a revert (fail-closed). This is distinct from
 * the `null` "not mined yet" case, which the caller handles before reaching
 * here and never turns into a revert.
 *
 * Regression: the engine previously compared `receipt.status` against the
 * literal `'success'`, a value the provider never produces, so `'0x1'` was
 * always read as a revert and every successful deposit was misreported.
 */
function classifyReceipt(receipt: UserOperationReceipt): 'success' | 'revert' {
  if (typeof receipt.success === 'boolean') {
    return receipt.success ? 'success' : 'revert';
  }
  const status = receipt.receipt?.status;
  const isSuccess =
    status === '0x1' || status === 1 || status === true || status === 'success';
  return isSuccess ? 'success' : 'revert';
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
    // The app's gate above proves the retained operation still hashes to the
    // value the passkey signed, but neither gate can see the operation the
    // EntryPoint validated: the bundler may change a hashed field after this
    // point (for example re-issuing `paymasterData`), and the failure that
    // results is only visible as `AA24`. Capture a secret-free snapshot of the
    // signed hash, the challenge the assertion actually signed, whether the
    // assertion verifies over that hash, and the exact operation fields the SDK
    // hands the bundler, so the next rejection can be settled by comparison
    // rather than inferred. This never changes the outcome.
    logSubmitIntegrity(retained.hash, signed, input.assertion, deps.signer.coordinates, cause);
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
    if (classifyReceipt(receipt) === 'revert') {
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

/**
 * ## The submit integrity gate cannot see past the bundler
 *
 * `submitResidentSafeOperation` proves, before sending, that the retained
 * operation still hashes to the value the passkey signed
 * (`operationHash(retained.operation) === retained.hash`). That gate is
 * necessary but not sufficient: it compares the app's view with the app's view.
 * The EntryPoint validates the operation **as the bundler submits it**, and a
 * bundler is free to touch fields after `eth_sendUserOperation` is called — in
 * particular, a sponsored operation's `paymasterData` is a hashed field that a
 * bundler can re-issue. When it does, only the account's signature covers the
 * old value, and the only signal is `AA24 signature error`.
 *
 * The three facts below are enough to settle that question on the next live
 * attempt, all recovered server-side from data that already crosses the wire:
 *
 *   1. `signedHash` — the app's `getHash()` at submit, i.e. the SafeOp EIP-712
 *      hash the passkey was asked to sign.
 *   2. `assertionChallenge` — the value the assertion's own `clientDataJSON`
 *      carries. A WebAuthn assertion signs its challenge, and the Safe passkey
 *      verifier checks that challenge is `base64url(getHash())`, so this is the
 *      value the passkey actually signed. It is compared with (1).
 *   3. `assertionSignatureValid` — an independent local P-256 verification of
 *      the assertion's raw signature over
 *      `authenticatorData || sha256(clientDataJSON)`, against the stored
 *      credential's public key. It distinguishes "the passkey signed the right
 *      hash, so the mismatch was introduced after signing" from "the assertion
 *      itself is invalid".
 *
 * The diagnostic also carries the operation fields the SDK serialises for the
 * bundler (minus the signature bytes). Everything here is either public
 * on-chain data or derived from it; no key, secret or credential material is
 * included, and nothing here alters the submission or its fail-closed outcome.
 */

/** The WebAuthn challenge a client assertion actually signed, or `null`. */
export function recoverAssertionChallenge(
  assertion: SafeAssertionParts,
): string | null {
  let decoded: string;
  try {
    decoded = new TextDecoder().decode(base64urlToBytes(assertion.clientDataJSON));
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(decoded) as { challenge?: unknown };
    return typeof parsed.challenge === 'string' ? parsed.challenge : null;
  } catch {
    return null;
  }
}

/** `base64url` (no padding) of a 32-byte hash — the WebAuthn challenge form. */
export function operationHashToChallenge(hash: Hex): string {
  return bytesToBase64url(hexToBytes(hash));
}

/** bytes → base64url with no padding. */
function bytesToBase64url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** `0x`-hex → bytes. */
function hexToBytes(value: Hex): Uint8Array {
  const hex = value.startsWith('0x') ? value.slice(2) : value;
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

/** A decimal or `0x`-hex P-256 coordinate as the 32-byte base64url JWK form. */
function coordinateToJwk(value: string): string | null {
  try {
    const n = BigInt(value.startsWith('0x') ? value : value.trim());
    if (n < 0n || n >= 1n << 256n) return null;
    return bytesToBase64url(hexToBytes(`0x${n.toString(16).padStart(64, '0')}` as Hex));
  } catch {
    return null;
  }
}

/** The result of comparing a client assertion with the operation it must cover. */
export interface AssertionIntegrityCheck {
  /** `base64url(operationHash)` — the challenge the verifier demands. */
  readonly expectedChallenge: string;
  /** The challenge the assertion actually carries, or `null` if unreadable. */
  readonly assertionChallenge: string | null;
  readonly challengeMatches: boolean;
  /**
   * Whether the assertion's raw P-256 signature verifies against the stored
   * credential over `authenticatorData || sha256(clientDataJSON)`. `null` means
   * it could not be attempted (e.g. an unreadable coordinate).
   */
  readonly signatureValid: boolean | null;
}

/**
 * Compare a client assertion with the operation hash it must authorise.
 *
 * `true` for `challengeMatches` **and** `signatureValid` means the passkey's
 * assertion is a valid authorisation of exactly `operationHash`; an `AA24` that
 * follows then cannot come from the signature or its message, only from the
 * operation the EntryPoint validated differing from this one.
 */
export function checkAssertionAgainstOperation(
  assertion: SafeAssertionParts,
  operationHash: Hex,
  coordinates: { readonly x: string; readonly y: string },
): AssertionIntegrityCheck {
  const expectedChallenge = operationHashToChallenge(operationHash);
  const assertionChallenge = recoverAssertionChallenge(assertion);
  const challengeMatches = assertionChallenge === expectedChallenge;

  let signatureValid: boolean | null = null;
  try {
    const x = coordinateToJwk(coordinates.x);
    const y = coordinateToJwk(coordinates.y);
    if (x !== null && y !== null) {
      const key = createPublicKey({
        key: { kty: 'EC', crv: 'P-256', x, y },
        format: 'jwk',
      });
      const clientDataJSON = base64urlToBytes(assertion.clientDataJSON);
      const clientHash = createHash('sha256').update(clientDataJSON).digest();
      const signed = Buffer.concat([
        Buffer.from(base64urlToBytes(assertion.authenticatorData)),
        clientHash,
      ]);
      const signature = base64urlToBytes(assertion.signature);
      signatureValid = createVerify('SHA256')
        .update(signed)
        .verify({ key, dsaEncoding: 'der' }, signature);
    }
  } catch {
    signatureValid = null;
  }

  return { expectedChallenge, assertionChallenge, challengeMatches, signatureValid };
}

/** The operation the SDK serialises for the bundler, without signature bytes. */
function operationForDiagnostics(signed: unknown): Record<string, unknown> | null {
  if (typeof signed !== 'object' || signed === null) return null;
  const getUserOperation = (signed as { getUserOperation?: unknown }).getUserOperation;
  if (typeof getUserOperation !== 'function') return null;
  let operation: unknown;
  try {
    operation = (getUserOperation as () => unknown).call(signed);
  } catch {
    return null;
  }
  if (typeof operation !== 'object' || operation === null) return null;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(operation as Record<string, unknown>)) {
    if (key === 'signature') {
      // The signature is not a hashed field and is not logged; only its size is
      // recorded so an empty/missing signature stays visible.
      out.signatureLength = typeof value === 'string' ? value.length : null;
      continue;
    }
    out[key] = typeof value === 'bigint' ? `0x${value.toString(16)}` : (value ?? null);
  }
  return out;
}

/** The complete secret-free integrity snapshot logged when submit is rejected. */
export interface SubmitIntegrityDiagnostic extends AssertionIntegrityCheck {
  readonly signedHash: Hex;
  readonly operation: Record<string, unknown> | null;
}

/** Build the snapshot {@link logSubmitIntegrity} writes. */
export function describeSubmitIntegrity(
  operationHash: Hex,
  signed: unknown,
  assertion: SafeAssertionParts,
  coordinates: { readonly x: string; readonly y: string },
): SubmitIntegrityDiagnostic {
  return {
    signedHash: operationHash,
    ...checkAssertionAgainstOperation(assertion, operationHash, coordinates),
    operation: operationForDiagnostics(signed),
  };
}

/**
 * Log the integrity snapshot on a rejected submission.
 *
 * Observational only: it never throws and never changes the returned outcome,
 * so a diagnostic bug cannot mask or alter the fail-closed refusal.
 */
function logSubmitIntegrity(
  operationHash: Hex,
  signed: unknown,
  assertion: SafeAssertionParts,
  coordinates: { readonly x: string; readonly y: string },
  cause: unknown,
): void {
  try {
    const diagnostic = describeSubmitIntegrity(
      operationHash,
      signed,
      assertion,
      coordinates,
    );
    console.warn(
      '[kade] resident-Safe submission rejected; submit-integrity diagnostic:',
      JSON.stringify({ ...diagnostic, cause: describe(cause) }),
    );
  } catch {
    // Diagnostics must never mask the submit failure.
  }
}
