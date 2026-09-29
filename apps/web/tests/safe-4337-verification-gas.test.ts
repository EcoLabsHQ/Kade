import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Address, Hex } from 'viem';
import {
  buildResidentSafeBatch,
  bufferVerificationGas,
  createVerificationGasBufferingEstimator,
  submitResidentSafeOperation,
  VERIFICATION_GAS_BUFFER_MIN_ALLOWANCE,
  type FeeEstimatorLike,
  type Safe4337PackLike,
  type SafeAssertionParts,
  type SafeExecutionDependencies,
} from '@/lib/safe/execute-safe-4337';
import type { PasskeySigner } from '@/lib/safe/passkey-signer';

/**
 * The verification-gas buffer on the resident-Safe build phase.
 *
 * ## Calibration, measured on a live sponsored reproduction
 *
 * `eth_estimateUserOperationGas` estimates against Safe's **dummy** WebAuthn
 * signature (relay-kit's `getDummySignature`), while the operation the resident
 * signs carries a real P-256 assertion. A diagnosis task reproduced the live
 * Base failure on Sepolia (same pinned pack factory, same Pimlico account,
 * harmless no-op batch) and, on a **deployed** passkey Safe, changed only
 * `verificationGasLimit`:
 *
 *   | verificationGasLimit                | result                      |
 *   |-------------------------------------|-----------------------------|
 *   | 250,000 (`0x3d090`) — the old floor | **`AA24 signature error`**  |
 *   | 300,000                             | rejected                    |
 *   | 400,000                             | rejected                    |
 *   | 450,000 (`0x6ddd0`)                 | accepted                    |
 *   | 600,000 (`0x927c0`)                 | accepted, receipt `success` |
 *
 * The mechanism is why it looked like a signing defect: an out-of-gas validation
 * makes the Safe return `SIG_VALIDATION_FAILED`, which the EntryPoint reports as
 * `AA24 signature error`. These tests pin the calibration, the branch crossover
 * and the fact that the raise is monotone and does not cap the deploy scale.
 *
 * ## Why the buffer runs in the fee estimator, and what these tests model
 *
 * Pimlico's paymaster commits to the operation's account gas limits: the value
 * it is handed at `pm_sponsorUserOperation` is the value its `paymasterData`
 * signs. relay-kit calls `safeOperation.addEstimations` **after** the sponsorship
 * signature, so raising `verificationGasLimit` there yields an operation whose
 * `paymasterData` signs one value while the operation carries another — the
 * paymaster recovers the wrong signer and the EntryPoint reverts `AA34`.
 *
 * These tests therefore model the paymaster's signature over the gas limits (the
 * `paymasterData` is `accountGasLimits(verificationGasLimit, callGasLimit)`), and
 * the fake pack rejects at submission (`AA34`) when the operation's live limits
 * no longer match what the paymaster signed. A fake with no paymaster signature
 * cannot catch this class; that is the whole point.
 *
 * The pack and the estimator are injected, so no bundler and no key are touched.
 */

const SAFE = '0x1111111111111111111111111111111111111111' as Address;
const USER_OP_HASH = `0x${'fe'.repeat(32)}` as Hex;
const SIGNATURE = '0xdeadbeef' as Hex;
const PAYMASTER = '0x7777777777777777777777777777777777777777';
const DUMMY_SIGNATURE = '0xdummy' as Hex;

/** The estimate a deployed Safe's build comes back with (the rejected value). */
const RAW_ESTIMATE = 51_698n;
/** The live Base deploy allowance; only an upper anchor for the multiplier. */
const DEPLOY_ESTIMATE = 1_050_355n;
/** buffer(51,698) = max(ceil(51,698 × 3 / 2), 600,000) = 600,000 (the floor). */
const BUFFERED_ESTIMATE = 600_000n;
/** buffer(1,050,355) = ceil(1,050,355 × 3 / 2) = 1,575,533 (the multiplier). */
const DEPLOY_BUFFERED = 1_575_533n;
/** The estimate a deploying operation produces on Sepolia; `initCode` inflates it. */
const DEPLOY_ESTIMATE_SEPOLIA = 1_560_701n;
/** buffer(1,560,701) = ceil(1,560,701 × 3 / 2) = 2,341,052 (the multiplier, uncapped). */
const DEPLOY_BUFFERED_SEPOLIA = 2_341_052n;
/** The highest allowance the live measurement rejected. */
const HIGHEST_REJECTED = 400_000n;
/** The lowest allowance the live measurement accepted. */
const LOWEST_ACCEPTED = 450_000n;
/** The previous floor, kept only to prove the raise is monotone. */
const OLD_FLOOR = 250_000n;
/** Where the multiplier overtakes the floor: floor × 2/3 = 400,000. */
const FLOOR_CROSSOVER = 400_000n;
/** A non-zero callGasLimit, so accountGasLimits packing has both halves. */
const CALL_GAS = 60_000n;

/**
 * The previous rule (`max(ceil(g × 3 / 2), 250,000)`), kept only as an oracle.
 *
 * The new rule must never hand an operation *less* allowance than the rule it
 * replaces: this is the property that says the floor raise cannot introduce a
 * verification-gas shortfall anywhere, deploy scale included.
 */
function oldBuffer(estimated: bigint): bigint {
  if (estimated <= 0n) return 0n;
  const scaled = (estimated * 3n + 1n) / 2n;
  return scaled > OLD_FLOOR ? scaled : OLD_FLOOR;
}

const env = (values: Record<string, string>): NodeJS.ProcessEnv =>
  values as unknown as NodeJS.ProcessEnv;

const ENV = env({ PIMLICO_API_KEY: 'pim_test', PIMLICO_POLICY_ID: 'sp_test' });

const SIGNER: PasskeySigner = {
  rawId: 'cred-1',
  coordinates: { x: '1', y: '2' },
  verifierAddress: '0x4444444444444444444444444444444444444444',
};

const CALLS = [
  {
    to: '0xaaaa000000000000000000000000000000000001' as Address,
    value: 0n,
    data: '0xdead' as Hex,
  },
];

const ASSERTION: SafeAssertionParts = {
  authenticatorData: Buffer.from(new Uint8Array([1, 2, 3, 4])).toString('base64url'),
  signature: Buffer.from(new Uint8Array([48, 6, 2, 1, 1, 2, 1, 2])).toString('base64url'),
  clientDataJSON: Buffer.from(new Uint8Array([123, 125])).toString('base64url'),
};

/** Encode the allowance into the hash, so a test can see which value was fixed. */
const encodeGas = (gas: bigint): Hex =>
  `0x${gas.toString(16).padStart(64, '0')}` as Hex;

/**
 * The EntryPoint v0.7 `accountGasLimits`: `verificationGasLimit` in the high 128
 * bits, `callGasLimit` in the low 128. This is what Pimlico's paymaster hashes
 * into `paymasterData`, so changing either half after signing invalidates it.
 */
const encodeAccountGasLimits = (verificationGasLimit: bigint, callGasLimit: bigint): Hex =>
  `0x${((verificationGasLimit << 128n) | callGasLimit).toString(16).padStart(64, '0')}` as Hex;

/**
 * A stand-in for the paymaster's sponsorship signature.
 *
 * `pm_sponsorUserOperation` commits to whatever account gas limits it was handed;
 * `paymasterData` is that commitment. The fake pack compares the committed value
 * with the operation's live limits at submission and throws `AA34` when they
 * differ, which is exactly the on-chain failure a post-signature mutation causes.
 */
interface PaymasterSignature {
  /** The verification gas the paymaster signed over, or `undefined` if never called. */
  signedVerificationGas?: bigint;
  /** The call gas the paymaster signed over, or `undefined` if never called. */
  signedCallGas?: bigint;
  /** The commitment returned as `paymasterData`, or `undefined` if never called. */
  paymasterData?: Hex;
}

/** The SDK's estimator, as `new PimlicoFeeEstimator()` behaves for these tests. */
function fakePimlicoEstimator(signature: PaymasterSignature): FeeEstimatorLike {
  return {
    async postEstimateUserOperationGas({ userOperation }) {
      const verificationGasLimit = BigInt(
        userOperation.verificationGasLimit as bigint | string,
      );
      const callGasLimit = BigInt(userOperation.callGasLimit as bigint | string);
      signature.signedVerificationGas = verificationGasLimit;
      signature.signedCallGas = callGasLimit;
      signature.paymasterData = encodeAccountGasLimits(verificationGasLimit, callGasLimit);
      return { paymaster: PAYMASTER, paymasterData: signature.paymasterData };
    },
  };
}

interface FakeOperation {
  readonly operation: Record<string, unknown>;
  readonly state: { verificationGasLimit: bigint; bufferCalls: number };
}

/**
 * A stand-in for relay-kit's v0.7 `SafeOperation`.
 *
 * `getUserOperation` exposes the live allowance and call gas, `addEstimations`
 * **assigns** `verificationGasLimit` (exactly as the real class does), and
 * `getHash` commits to the current value — so if the buffer were applied after
 * the hash, the returned hash would not match the retained operation.
 */
function fakeOperation(
  estimate: bigint | null,
  options: { hasHash?: boolean; hasAddEstimations?: boolean } = {},
): FakeOperation {
  const state = { verificationGasLimit: estimate ?? 0n, bufferCalls: 0 };
  const operation: Record<string, unknown> = {};
  operation.getUserOperation = () =>
    estimate === null
      ? { callGasLimit: CALL_GAS }
      : { verificationGasLimit: state.verificationGasLimit, callGasLimit: CALL_GAS };
  if (options.hasAddEstimations !== false) {
    operation.addEstimations = (estimations: { verificationGasLimit?: bigint }) => {
      if (estimations.verificationGasLimit) {
        state.verificationGasLimit = estimations.verificationGasLimit;
        state.bufferCalls += 1;
      }
    };
  }
  if (options.hasHash !== false) {
    operation.getHash = () => encodeGas(state.verificationGasLimit);
  }
  return { operation, state };
}

interface FakePack {
  readonly deps: SafeExecutionDependencies;
  readonly createTransaction: Mock;
  readonly signSafeOperation: Mock;
  readonly executeTransaction: Mock;
  readonly getUserOperationReceipt: Mock;
  readonly signature: PaymasterSignature;
}

/**
 * A pack whose `createTransaction` models relay-kit's `getEstimateFee`: the
 * post-estimate hook is called with the estimated operation and its returned
 * data is written back through the SDK's own `addEstimations`.
 *
 * `options.estimator` lets a test install the fake paymaster estimator (the usual
 * case) or omit it to prove the build phase refuses when the estimator never
 * runs. `forwardEstimations: false` models a relay-kit that fails to write the
 * hook's return value back.
 */
function fakePack(
  operation: unknown,
  options: {
    estimator?: FeeEstimatorLike;
    forwardEstimations?: boolean;
  } = {},
): FakePack {
  const signature: PaymasterSignature = {};
  const estimator = options.estimator ?? fakePimlicoEstimator(signature);
  const forward = options.forwardEstimations !== false;

  const createTransaction = vi.fn(async (input: {
    options?: { feeEstimator?: FeeEstimatorLike };
  }) => {
    const live = operation as {
      getUserOperation?: () => Record<string, unknown>;
      addEstimations?: (estimations: Record<string, unknown>) => void;
    };
    const props = {
      userOperation: live.getUserOperation?.() ?? {},
      bundlerUrl: 'https://bundler.example',
      entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
      protocolKit: {},
    };
    // relay-kit's getEstimateFee: pre, then eth_estimateUserOperationGas (the
    // operation already carries the estimate), then post. Only the post hook is
    // where the buffer lives.
    const pre = await input.options?.feeEstimator?.preEstimateUserOperationGas?.(props);
    if (pre && forward) live.addEstimations?.(pre);
    const data = await input.options?.feeEstimator?.postEstimateUserOperationGas?.({
      ...props,
      userOperation: { ...(live.getUserOperation?.() ?? {}), signature: DUMMY_SIGNATURE },
    });
    if (data && forward) live.addEstimations?.(data);
    return operation;
  });

  const signSafeOperation = vi.fn(async (op: unknown) => {
    const live = op as { getUserOperation: () => { verificationGasLimit: bigint } };
    return {
      encodedSignatures: () => SIGNATURE,
      // The signed operation is the same object the SDK sent; keep its live gas
      // readable so the fake submission below can model the paymaster's check.
      getUserOperation: () => live.getUserOperation(),
      verificationGasLimit: live.getUserOperation().verificationGasLimit,
    };
  });
  const executeTransaction = vi.fn(async (input: { executable: unknown }) => {
    // The paymaster's validation recovers the signer from the operation it
    // signed. If the live account gas limits moved, the recovery fails and the
    // EntryPoint reverts AA34.
    if (signature.paymasterData !== undefined) {
      const executable = input.executable as {
        getUserOperation?: () => { verificationGasLimit: bigint; callGasLimit: bigint };
      };
      const live = executable.getUserOperation?.();
      if (live) {
        const packed = encodeAccountGasLimits(live.verificationGasLimit, live.callGasLimit);
        if (packed.toLowerCase() !== signature.paymasterData.toLowerCase()) {
          throw new Error(
            'AA34 signature error: the paymaster signed different account gas limits',
          );
        }
      }
    }
    return USER_OP_HASH;
  });
  const getUserOperationReceipt = vi.fn(async () => ({
    success: true,
    receipt: { status: '0x1', transactionHash: '0xfeed' as Hex },
  }));
  const pack = {
    createTransaction,
    signSafeOperation,
    executeTransaction,
    getUserOperationReceipt,
  } as unknown as Safe4337PackLike;

  const deps: SafeExecutionDependencies = {
    initPack: vi.fn<SafeExecutionDependencies['initPack']>(async () => pack),
    signer: SIGNER,
    safeAddress: SAFE,
    feeEstimator: estimator,
  };
  return {
    deps,
    createTransaction,
    signSafeOperation,
    executeTransaction,
    getUserOperationReceipt,
    signature,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('bufferVerificationGas', () => {
  it('applies 1.5x when that exceeds the absolute floor', () => {
    expect(bufferVerificationGas(500_000n)).toBe(750_000n);
    expect(bufferVerificationGas(DEPLOY_ESTIMATE)).toBe(DEPLOY_BUFFERED);
  });

  it('applies the 600,000 floor when 1.5x would be smaller', () => {
    expect(VERIFICATION_GAS_BUFFER_MIN_ALLOWANCE).toBe(600_000n);
    expect(bufferVerificationGas(1_000n)).toBe(VERIFICATION_GAS_BUFFER_MIN_ALLOWANCE);
    expect(bufferVerificationGas(100_000n)).toBe(VERIFICATION_GAS_BUFFER_MIN_ALLOWANCE);
  });

  it('lifts the rejected estimate above every measured rejection, with margin', () => {
    // The exact value the deployed passkey Safe was rejected at ...
    expect(bufferVerificationGas(RAW_ESTIMATE)).toBe(BUFFERED_ESTIMATE);
    // ... is raised to many times its size ...
    expect(BUFFERED_ESTIMATE).toBeGreaterThan(4n * RAW_ESTIMATE);
    // ... clears both the highest rejection and the lowest acceptance with
    // margin ...
    expect(BUFFERED_ESTIMATE).toBeGreaterThan(HIGHEST_REJECTED);
    expect(BUFFERED_ESTIMATE - HIGHEST_REJECTED).toBeGreaterThanOrEqual(150_000n);
    expect(BUFFERED_ESTIMATE).toBeGreaterThan(LOWEST_ACCEPTED);
    // ... and is itself the value the measurement accepted with success:true.
    expect(BUFFERED_ESTIMATE).toBe(600_000n);
  });

  it('switches branches exactly at floor x 2/3 = 400,000', () => {
    // At the crossover both branches agree.
    expect(bufferVerificationGas(FLOOR_CROSSOVER)).toBe(VERIFICATION_GAS_BUFFER_MIN_ALLOWANCE);
    // Just below, the floor binds and clamps to 600,000.
    expect(bufferVerificationGas(FLOOR_CROSSOVER - 1n)).toBe(
      VERIFICATION_GAS_BUFFER_MIN_ALLOWANCE,
    );
    // Just above, the multiplier wins and is strictly larger.
    expect(bufferVerificationGas(FLOOR_CROSSOVER + 1n)).toBe(600_002n);
    expect(bufferVerificationGas(FLOOR_CROSSOVER + 1n)).toBeGreaterThan(
      VERIFICATION_GAS_BUFFER_MIN_ALLOWANCE,
    );
  });

  it('handles the deploy-scale estimate with no cap and no shortfall', () => {
    // A deploying operation's ~1.5M estimate is multiplied, not capped ...
    expect(bufferVerificationGas(DEPLOY_ESTIMATE_SEPOLIA)).toBe(DEPLOY_BUFFERED_SEPOLIA);
    // ... so it stays strictly above the raw estimate: no shortfall.
    expect(DEPLOY_BUFFERED_SEPOLIA).toBeGreaterThan(DEPLOY_ESTIMATE_SEPOLIA);
    // The multiplier branch is unchanged by the floor raise: the old rule gives
    // the same value here, which is why the deployment path cannot regress.
    expect(DEPLOY_BUFFERED_SEPOLIA).toBe(oldBuffer(DEPLOY_ESTIMATE_SEPOLIA));
  });

  it('only ever raises an allowance relative to the old rule', () => {
    const estimates = [
      1n,
      1_000n,
      RAW_ESTIMATE,
      200_000n,
      FLOOR_CROSSOVER - 1n,
      FLOOR_CROSSOVER,
      500_000n,
      DEPLOY_ESTIMATE,
      DEPLOY_ESTIMATE_SEPOLIA,
    ];
    for (const estimate of estimates) {
      expect(bufferVerificationGas(estimate)).toBeGreaterThanOrEqual(oldBuffer(estimate));
    }
    // Above the crossover the two rules are identical ...
    for (const estimate of [FLOOR_CROSSOVER, 500_000n, DEPLOY_ESTIMATE, DEPLOY_ESTIMATE_SEPOLIA]) {
      expect(bufferVerificationGas(estimate)).toBe(oldBuffer(estimate));
    }
    // ... and below it the new floor is the only difference.
    expect(OLD_FLOOR).toBeLessThan(VERIFICATION_GAS_BUFFER_MIN_ALLOWANCE);
  });

  it('is strict: a buffered estimate is always strictly greater than the raw one', () => {
    for (const estimate of [1n, 1_000n, 51_698n, 100_000n, 5_000_000n]) {
      expect(bufferVerificationGas(estimate)).toBeGreaterThan(estimate);
    }
  });

  it('never invents an allowance for a non-positive estimate', () => {
    expect(bufferVerificationGas(0n)).toBe(0n);
  });
});

describe('the buffering fee estimator', () => {
  it('hands the paymaster the buffered operation and returns the same value', async () => {
    const signature: PaymasterSignature = {};
    const estimator = createVerificationGasBufferingEstimator(fakePimlicoEstimator(signature));

    const data = await estimator.feeEstimator.postEstimateUserOperationGas?.({
      userOperation: { verificationGasLimit: RAW_ESTIMATE, callGasLimit: CALL_GAS },
    });

    expect(signature.signedVerificationGas).toBe(BUFFERED_ESTIMATE);
    expect(data?.verificationGasLimit).toBe(BUFFERED_ESTIMATE);
    expect(estimator.outcome()).toEqual({
      status: 'applied',
      raw: RAW_ESTIMATE,
      buffered: BUFFERED_ESTIMATE,
    });
  });

  it('refuses a missing estimate without reaching the paymaster', async () => {
    const signature: PaymasterSignature = {};
    const estimator = createVerificationGasBufferingEstimator(fakePimlicoEstimator(signature));

    const data = await estimator.feeEstimator.postEstimateUserOperationGas?.({
      userOperation: { callGasLimit: CALL_GAS },
    });

    expect(data).toEqual({});
    expect(signature.signedVerificationGas).toBeUndefined();
    expect(estimator.outcome()).toMatchObject({ status: 'refused' });
  });

  it('forwards the pre-estimate hook unchanged, so the paymaster stub data survives', async () => {
    const seen: unknown[] = [];
    const base: FeeEstimatorLike = {
      async preEstimateUserOperationGas(props) {
        seen.push(props);
        return { maxFeePerGas: 7n, maxPriorityFeePerGas: 1n };
      },
    };
    const estimator = createVerificationGasBufferingEstimator(base);
    const props = {
      userOperation: { verificationGasLimit: RAW_ESTIMATE, callGasLimit: CALL_GAS },
    };

    const result = await estimator.feeEstimator.preEstimateUserOperationGas?.(props);

    expect(result).toEqual({ maxFeePerGas: 7n, maxPriorityFeePerGas: 1n });
    expect(seen).toEqual([props]);
  });
});

describe('build-phase verification-gas buffer', () => {
  it('raises the account allowance from the real estimate before retaining it', async () => {
    const { operation, state } = fakeOperation(RAW_ESTIMATE);
    const fake = fakePack(operation);

    const outcome = await buildResidentSafeBatch(CALLS, fake.deps, ENV);

    expect(outcome.status).toBe('built');
    expect(state.bufferCalls).toBe(1);
    // Strictly greater than the raw estimate, by the documented rule.
    expect(state.verificationGasLimit).toBe(BUFFERED_ESTIMATE);
    expect(state.verificationGasLimit).toBe(bufferVerificationGas(RAW_ESTIMATE));
    expect(state.verificationGasLimit).toBeGreaterThan(RAW_ESTIMATE);
  });

  it('has the paymaster sign exactly the value the built operation carries', async () => {
    const { operation, state } = fakeOperation(RAW_ESTIMATE);
    const fake = fakePack(operation);

    const built = await buildResidentSafeBatch(CALLS, fake.deps, ENV);
    expect(built.status).toBe('built');

    // The regression: the value the paymaster committed to and the value in the
    // operation must be equal. A post-signature mutation makes these differ.
    expect(fake.signature.signedVerificationGas).toBe(BUFFERED_ESTIMATE);
    expect(fake.signature.signedVerificationGas).toBe(state.verificationGasLimit);
    expect(fake.signature.signedVerificationGas).not.toBe(RAW_ESTIMATE);
    expect(fake.signature.signedCallGas).toBe(CALL_GAS);

    // And the operation really submits: the paymaster's validation succeeds
    // because nothing moved after it signed.
    if (built.status !== 'built') return;
    const submitted = await submitResidentSafeOperation(
      { token: built.token, assertion: ASSERTION },
      fake.deps,
      ENV,
    );
    expect(submitted.status).toBe('sent');
    expect(fake.executeTransaction).toHaveBeenCalledTimes(1);
  });

  it('buffers before the hash, so the signed hash commits to the buffered allowance', async () => {
    const { operation, state } = fakeOperation(RAW_ESTIMATE);
    const fake = fakePack(operation);

    const built = await buildResidentSafeBatch(CALLS, fake.deps, ENV);
    expect(built.status).toBe('built');
    if (built.status !== 'built') return;

    // The hash was read after the buffer: it encodes the buffered value, not the
    // raw estimate. If the order were reversed, the submit-phase re-check would
    // not match and this test would fail here.
    expect(built.hash).toBe(encodeGas(BUFFERED_ESTIMATE));
    expect(built.hash).not.toBe(encodeGas(RAW_ESTIMATE));

    const submitted = await submitResidentSafeOperation(
      { token: built.token, assertion: ASSERTION },
      fake.deps,
      ENV,
    );

    expect(submitted.status).toBe('sent');
    // The passkey signs the exact retained operation, whose gas is buffered.
    expect(fake.signSafeOperation).toHaveBeenCalledWith(operation);
    expect(state.verificationGasLimit).toBe(BUFFERED_ESTIMATE);
  });

  it('never signs an operation whose allowance moved after the hash was produced', async () => {
    const { operation, state } = fakeOperation(RAW_ESTIMATE);
    const fake = fakePack(operation);
    const built = await buildResidentSafeBatch(CALLS, fake.deps, ENV);
    expect(built.status).toBe('built');
    if (built.status !== 'built') return;

    // Simulate any later code rewriting the allowance. The hash the passkey
    // signed no longer matches, so the submit phase must refuse and sign nothing.
    state.verificationGasLimit = RAW_ESTIMATE;

    const submitted = await submitResidentSafeOperation(
      { token: built.token, assertion: ASSERTION },
      fake.deps,
      ENV,
    );

    expect(submitted.status).toBe('failed');
    if (submitted.status !== 'failed') return;
    expect(submitted.stage).toBe('integrity');
    expect(submitted.sent).toBe(false);
    expect(fake.signSafeOperation).not.toHaveBeenCalled();
    expect(fake.executeTransaction).not.toHaveBeenCalled();
  });

  it('models the paymaster rejection a post-signature mutation would cause', async () => {
    const { operation, state } = fakeOperation(RAW_ESTIMATE);
    const fake = fakePack(operation);
    const built = await buildResidentSafeBatch(CALLS, fake.deps, ENV);
    expect(built.status).toBe('built');
    if (built.status !== 'built') return;

    // Move the allowance while keeping the hash identical, so the integrity
    // re-check cannot catch it: this is the submit-time view a post-signature
    // mutation produces. The paymaster's accountGasLimits no longer match and
    // submission reverts AA34.
    (operation as { getHash: () => Hex }).getHash = () => built.hash;
    state.verificationGasLimit = RAW_ESTIMATE;

    const submitted = await submitResidentSafeOperation(
      { token: built.token, assertion: ASSERTION },
      fake.deps,
      ENV,
    );

    expect(submitted.status).toBe('failed');
    if (submitted.status !== 'failed') return;
    expect(submitted.stage).toBe('submit');
    expect(submitted.reason).toMatch(/AA34/);
  });
});

describe('build-phase verification-gas estimation failure', () => {
  it('fails closed, at its own stage, when the operation exposes no estimate', async () => {
    const { operation } = fakeOperation(null);
    const fake = fakePack(operation);

    const outcome = await buildResidentSafeBatch(CALLS, fake.deps, ENV);

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(outcome.stage).toBe('estimate');
    expect(outcome.sent).toBe(false);
    expect(outcome.reason).toMatch(/verification gas estimate/i);
    // The paymaster never signed, and nothing was signed or retained.
    expect(fake.signature.signedVerificationGas).toBeUndefined();
    expect(outcome).not.toHaveProperty('token');
    expect(fake.signSafeOperation).not.toHaveBeenCalled();
    expect(fake.executeTransaction).not.toHaveBeenCalled();
  });

  it('treats a zero estimate as absent rather than padding it from nothing', async () => {
    const { operation, state } = fakeOperation(0n);
    const fake = fakePack(operation);

    const outcome = await buildResidentSafeBatch(CALLS, fake.deps, ENV);

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(outcome.stage).toBe('estimate');
    expect(state.bufferCalls).toBe(0);
    expect(fake.signature.signedVerificationGas).toBeUndefined();
    expect(fake.signSafeOperation).not.toHaveBeenCalled();
  });

  it('fails closed when the estimator never runs', async () => {
    const { operation } = fakeOperation(RAW_ESTIMATE, { hasAddEstimations: false });
    const fake = fakePack(operation);
    // A pack that ignores the injected estimator: relay-kit never calls it.
    fake.createTransaction.mockImplementation(async () => operation);

    const outcome = await buildResidentSafeBatch(CALLS, fake.deps, ENV);

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(outcome.stage).toBe('estimate');
    expect(outcome.reason).toMatch(/estimator never ran|never ran/i);
    expect(outcome).not.toHaveProperty('token');
    expect(fake.signSafeOperation).not.toHaveBeenCalled();
  });

  it('fails closed when relay-kit does not write the buffered value back', async () => {
    const { operation, state } = fakeOperation(RAW_ESTIMATE);
    const fake = fakePack(operation, { forwardEstimations: false });

    const outcome = await buildResidentSafeBatch(CALLS, fake.deps, ENV);

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(outcome.stage).toBe('estimate');
    expect(outcome.reason).toMatch(/could not be buffered/i);
    // The paymaster did sign the buffered value, but the operation still carries
    // the raw estimate, so the two disagree and nothing is signed.
    expect(fake.signature.signedVerificationGas).toBe(BUFFERED_ESTIMATE);
    expect(state.verificationGasLimit).toBe(RAW_ESTIMATE);
    expect(fake.signSafeOperation).not.toHaveBeenCalled();
  });

  it('names the create stage when the SDK estimate itself rejects', async () => {
    const fake = fakePack({ getHash: () => encodeGas(RAW_ESTIMATE) });
    fake.createTransaction.mockRejectedValueOnce(
      new Error('eth_estimateUserOperationGas failed: AA26'),
    );

    const outcome = await buildResidentSafeBatch(CALLS, fake.deps, ENV);

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(outcome.stage).toBe('create');
    expect(outcome.sent).toBe(false);
    expect(outcome.reason).toMatch(/eth_estimateUserOperationGas failed/);
    expect(fake.signSafeOperation).not.toHaveBeenCalled();
  });
});
