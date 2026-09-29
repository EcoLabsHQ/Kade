import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Address, Hex } from 'viem';
import {
  buildResidentSafeBatch,
  bufferVerificationGas,
  submitResidentSafeOperation,
  VERIFICATION_GAS_BUFFER_MIN_ALLOWANCE,
  type Safe4337PackLike,
  type SafeAssertionParts,
  type SafeExecutionDependencies,
} from '@/lib/safe/execute-safe-4337';
import type { PasskeySigner } from '@/lib/safe/passkey-signer';

/**
 * The verification-gas buffer on the resident-Safe build phase.
 *
 * ## Calibration, from the live Base rail
 *
 * `eth_estimateUserOperationGas` estimates against Safe's **dummy** WebAuthn
 * signature (relay-kit's `getDummySignature`), while the operation the resident
 * signs carries a real P-256 assertion. On Base the EntryPoint rejected **two**
 * real deposits with `AA26 over verificationGasLimit`, at the exact estimate the
 * app had computed:
 *
 *   - failures (nonce 0x1, no deployment): verificationGasLimit 51,698
 *   - success  (nonce 0x0, with deployment): verificationGasLimit 1,050,355
 *
 * The success included the Safe deployment, so it does not bound the
 * validation-only cost; the ≈20× gap cannot be decomposed from the data and is
 * treated as unexplained. `verificationGasLimit` is part of the SafeOp hash the
 * passkey signs, so the allowance cannot be corrected at submit time — it must be
 * raised in the build phase, after the SDK's estimate and before `getHash()`.
 *
 * These tests are offline: the pack is injected, so no bundler is touched. They
 * prove the documented rule is applied to a **real** estimate, that it is applied
 * before the hash, and that a missing estimate fails closed instead of being
 * buffered from nothing.
 */

const SAFE = '0x1111111111111111111111111111111111111111' as Address;
const USER_OP_HASH = `0x${'fe'.repeat(32)}` as Hex;
const SIGNATURE = '0xdeadbeef' as Hex;

/** The estimate the two live Base rejections came back with (AA26 twice). */
const RAW_ESTIMATE = 51_698n;
/** The one live Base success; inflated by the Safe deployment, so only an upper anchor. */
const DEPLOY_ESTIMATE = 1_050_355n;
/** buffer(51,698) = max(ceil(51,698 × 3 / 2), 250,000) = 250,000 (the floor). */
const BUFFERED_ESTIMATE = 250_000n;
/** buffer(1,050,355) = ceil(1,050,355 × 3 / 2) = 1,575,533 (the multiplier). */
const DEPLOY_BUFFERED = 1_575_533n;

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

interface FakeOperation {
  readonly operation: Record<string, unknown>;
  readonly state: { verificationGasLimit: bigint; bufferCalls: number };
}

/**
 * A stand-in for relay-kit's v0.7 `SafeOperation`.
 *
 * `getUserOperation` exposes the live allowance, `addEstimations` **assigns** it
 * (exactly as the real class does), and `getHash` commits to the current value —
 * so if the buffer were applied after the hash, the returned hash would not
 * match the retained operation and the test would see it.
 */
function fakeOperation(
  estimate: bigint | null,
  options: { hasHash?: boolean; hasAddEstimations?: boolean } = {},
): FakeOperation {
  const state = { verificationGasLimit: estimate ?? 0n, bufferCalls: 0 };
  const operation: Record<string, unknown> = {};
  if (estimate !== null) {
    operation.getUserOperation = () => ({ verificationGasLimit: state.verificationGasLimit });
  }
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
}

function fakePack(operation: unknown): FakePack {
  const signSafeOperation = vi.fn(async (op: unknown) => ({
    encodedSignatures: () => SIGNATURE,
    // The executable `executeTransaction` would send carries the operation's
    // live allowance; record it so a test can assert what was sent.
    verificationGasLimit: (
      op as { getUserOperation: () => { verificationGasLimit: bigint } }
    ).getUserOperation().verificationGasLimit,
  }));
  const executeTransaction = vi.fn(async () => USER_OP_HASH);
  const createTransaction = vi.fn(async () => operation);
  const getUserOperationReceipt = vi.fn(async () => ({
    receipt: { status: 'success', transactionHash: '0xfeed' as Hex },
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
  };
  return { deps, createTransaction, signSafeOperation, executeTransaction, getUserOperationReceipt };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('bufferVerificationGas', () => {
  it('applies 1.5x when that exceeds the absolute floor', () => {
    expect(bufferVerificationGas(200_000n)).toBe(300_000n);
    expect(bufferVerificationGas(DEPLOY_ESTIMATE)).toBe(DEPLOY_BUFFERED);
  });

  it('applies the 250,000 floor when 1.5x would be smaller', () => {
    expect(bufferVerificationGas(1_000n)).toBe(VERIFICATION_GAS_BUFFER_MIN_ALLOWANCE);
    expect(bufferVerificationGas(100_000n)).toBe(VERIFICATION_GAS_BUFFER_MIN_ALLOWANCE);
  });

  it('lifts the rejected Base estimate well clear while staying under the sponsored deployment allowance', () => {
    // The exact value the EntryPoint rejected twice ...
    expect(bufferVerificationGas(RAW_ESTIMATE)).toBe(BUFFERED_ESTIMATE);
    // ... is raised to roughly 4.8x its size ...
    expect(BUFFERED_ESTIMATE).toBeGreaterThan(4n * RAW_ESTIMATE);
    // ... but stays below the 1,050,355 the same paymaster already sponsored.
    expect(BUFFERED_ESTIMATE).toBeLessThan(DEPLOY_ESTIMATE);
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
    // And the executable that reaches the bundler carries that same allowance.
    const executable = fake.signSafeOperation.mock.results[0]?.value;
    expect(await executable).toMatchObject({ verificationGasLimit: BUFFERED_ESTIMATE });
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
    // Nothing was buffered, nothing was signed, nothing was retained.
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
    expect(fake.signSafeOperation).not.toHaveBeenCalled();
  });

  it('fails closed when the estimate cannot be assigned back onto the operation', async () => {
    const { operation } = fakeOperation(RAW_ESTIMATE, { hasAddEstimations: false });
    const fake = fakePack(operation);

    const outcome = await buildResidentSafeBatch(CALLS, fake.deps, ENV);

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(outcome.stage).toBe('estimate');
    expect(outcome.reason).toMatch(/could not be buffered/i);
    expect(outcome).not.toHaveProperty('token');
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
