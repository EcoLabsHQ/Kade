import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Address, Hex } from 'viem';
import {
  buildResidentSafeBatch,
  RECEIPT_POLL_DELAYS_MS,
  submitResidentSafeOperation,
  type FeeEstimatorLike,
  type Safe4337PackLike,
  type SafeAssertionParts,
  type SafeExecutionDependencies,
  type UserOperationReceipt,
} from '@/lib/safe/execute-safe-4337';
import type { PasskeySigner } from '@/lib/safe/passkey-signer';

/**
 * Receipt-handling regressions for the resident-Safe 4337 flow.
 *
 * ## A null receipt is not a revert
 *
 * `getUserOperationReceipt` answers `null` until the bundler has indexed the
 * mined operation. The engine used to read that `null` as a failed status and
 * report "The user operation reverted." even when the chain later showed the
 * operation had succeeded. These tests pin the honest behaviour: a null receipt
 * is pending / not confirmed, carries the user-operation hash, and is never
 * resubmitted.
 *
 * ## The provider never returns `status: 'success'`
 *
 * `getUserOperationReceipt` is a straight passthrough of the standard
 * `eth_getUserOperationReceipt` response (`@safe-global/relay-kit`), so the
 * transaction status arrives in raw JSON-RPC form and the user-operation
 * outcome arrives as the top-level `success` boolean. The engine used to
 * compare `receipt.status` against the literal `'success'` — a value the
 * provider never produces — so `'0x1' !== 'success'` was always true and every
 * successful deposit was reported as reverted. The outcome tests below use the
 * **real** payload shape (`success` boolean plus hex `status`).
 *
 * The pack and the poll delay are injected, so no network and no timer runs.
 */

const SAFE = '0x1111111111111111111111111111111111111111' as Address;
const SAFE_OP_HASH = `0x${'ab'.repeat(32)}` as Hex;
const USER_OP_HASH = `0x${'fe'.repeat(32)}` as Hex;
const REVERTED_TX_HASH = `0x${'01'.repeat(32)}` as Hex;
const CONFIRMED_TX_HASH = '0xfeed' as Hex;
const SIGNATURE = '0xdeadbeef' as Hex;

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

interface FakePack {
  readonly deps: SafeExecutionDependencies;
  readonly sleep: Mock<(ms: number) => Promise<void>>;
  readonly executeTransaction: Mock;
  readonly getUserOperationReceipt: Mock;
}

/**
 * A pack whose receipt reads walk a scripted sequence.
 *
 * `receipts` is consumed one entry per read; the last entry repeats once the
 * sequence is exhausted, so `[null]` means "never mined" and
 * `[null, null, success]` means "mined on the third read".
 */
function fakePack(receipts: readonly (UserOperationReceipt | null)[]): FakePack {
  let read = 0;
  const gas = { value: 51_698n };
  const retained = {
    getUserOperation: () => ({ verificationGasLimit: gas.value }),
    addEstimations: (estimations: { verificationGasLimit?: bigint }) => {
      if (estimations.verificationGasLimit) gas.value = estimations.verificationGasLimit;
    },
    getHash: () => SAFE_OP_HASH,
  };

  const createTransaction = vi.fn(
    async (input: { options?: { feeEstimator?: FeeEstimatorLike } }) => {
      // relay-kit's `getEstimateFee`: the post-estimate hook runs on the
      // estimated operation and its return value is written back.
      const data = await input.options?.feeEstimator?.postEstimateUserOperationGas?.({
        userOperation: { ...retained.getUserOperation(), signature: '0xdummy' as Hex },
      });
      if (data) retained.addEstimations(data);
      return retained;
    },
  );
  const signSafeOperation = vi.fn(async () => ({ encodedSignatures: () => SIGNATURE }));
  const executeTransaction = vi.fn(async () => USER_OP_HASH);
  const getUserOperationReceipt = vi.fn(async () => {
    const value = receipts[Math.min(read, receipts.length - 1)] ?? null;
    read += 1;
    return value;
  });

  const pack = {
    createTransaction,
    signSafeOperation,
    executeTransaction,
    getUserOperationReceipt,
  } as unknown as Safe4337PackLike;

  const initPack = vi.fn<SafeExecutionDependencies['initPack']>(async () => pack);
  const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
  const deps: SafeExecutionDependencies = {
    initPack,
    signer: SIGNER,
    safeAddress: SAFE,
    sleep,
  };

  return { deps, sleep, executeTransaction, getUserOperationReceipt };
}

/** Run the build phase and return its one-time token, or fail loudly. */
async function build(fake: FakePack): Promise<{ token: string }> {
  const outcome = await buildResidentSafeBatch(CALLS, fake.deps, ENV);
  if (outcome.status !== 'built') {
    throw new Error(`expected a built outcome, got ${outcome.status}`);
  }
  return { token: outcome.token };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('submitResidentSafeOperation receipt handling', () => {
  it('reports a null receipt as pending, not reverted, and never resubmits', async () => {
    const fake = fakePack([null]);
    const { token } = await build(fake);

    const outcome = await submitResidentSafeOperation(
      { token, assertion: ASSERTION },
      fake.deps,
      ENV,
    );

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    // The operation was broadcast, so `sent` is true — but it is not a success
    // and, crucially, not a revert.
    expect(outcome.sent).toBe(true);
    expect(outcome.stage).toBe('receipt');
    expect(outcome.userOperationHash).toBe(USER_OP_HASH);
    expect(outcome.reason).toMatch(/not been confirmed/i);
    expect(outcome.reason).not.toMatch(/reverted/i);
    // The hash is carried both structurally and in the reason, because the
    // failure UI renders only the reason for a failed outcome.
    expect(outcome.reason).toContain(USER_OP_HASH);

    // Bounded: one initial read plus one read per backoff step, then it stops.
    expect(fake.getUserOperationReceipt).toHaveBeenCalledTimes(
      RECEIPT_POLL_DELAYS_MS.length + 1,
    );
    expect(fake.sleep.mock.calls.map(([ms]) => ms)).toEqual([...RECEIPT_POLL_DELAYS_MS]);

    // Never resubmitted: the operation reached the bundler exactly once.
    expect(fake.executeTransaction).toHaveBeenCalledTimes(1);
  });

  it('reports an existing non-success receipt as a revert, with its transaction hash', async () => {
    const fake = fakePack([
      { receipt: { status: 'reverted', transactionHash: REVERTED_TX_HASH } },
    ]);
    const { token } = await build(fake);

    const outcome = await submitResidentSafeOperation(
      { token, assertion: ASSERTION },
      fake.deps,
      ENV,
    );

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(outcome.sent).toBe(true);
    expect(outcome.stage).toBe('receipt');
    expect(outcome.reason).toBe('The user operation reverted.');
    expect(outcome.transactionHash).toBe(REVERTED_TX_HASH);
    expect(outcome.userOperationHash).toBe(USER_OP_HASH);
    // A real receipt ends the wait immediately — no polling, no resubmission.
    expect(fake.sleep).not.toHaveBeenCalled();
    expect(fake.executeTransaction).toHaveBeenCalledTimes(1);
  });

  it('returns the confirmed outcome for a successful receipt', async () => {
    const fake = fakePack([
      { receipt: { status: 'success', transactionHash: CONFIRMED_TX_HASH } },
    ]);
    const { token } = await build(fake);

    const outcome = await submitResidentSafeOperation(
      { token, assertion: ASSERTION },
      fake.deps,
      ENV,
    );

    expect(outcome.status).toBe('sent');
    if (outcome.status !== 'sent') return;
    expect(outcome.sent).toBe(true);
    expect(outcome.userOperationHash).toBe(USER_OP_HASH);
    expect(outcome.transactionHash).toBe(CONFIRMED_TX_HASH);
    expect(fake.sleep).not.toHaveBeenCalled();
    expect(fake.executeTransaction).toHaveBeenCalledTimes(1);
  });

  it('keeps polling while the receipt is absent, then confirms when it appears', async () => {
    const fake = fakePack([
      null,
      null,
      { receipt: { status: 'success', transactionHash: CONFIRMED_TX_HASH } },
    ]);
    const { token } = await build(fake);

    const outcome = await submitResidentSafeOperation(
      { token, assertion: ASSERTION },
      fake.deps,
      ENV,
    );

    expect(outcome.status).toBe('sent');
    if (outcome.status !== 'sent') return;
    expect(outcome.transactionHash).toBe(CONFIRMED_TX_HASH);
    expect(fake.getUserOperationReceipt).toHaveBeenCalledTimes(3);
    expect(fake.sleep.mock.calls.map(([ms]) => ms)).toEqual([
      RECEIPT_POLL_DELAYS_MS[0],
      RECEIPT_POLL_DELAYS_MS[1],
    ]);
  });

  it('bounds the total wait and backs off', () => {
    const total = RECEIPT_POLL_DELAYS_MS.reduce((sum, delay) => sum + delay, 0);
    expect(total).toBeLessThanOrEqual(30_000);
    // Backoff is non-decreasing and fixed; a future change must be deliberate.
    expect([...RECEIPT_POLL_DELAYS_MS]).toEqual([1_000, 2_000, 4_000, 8_000, 15_000]);
  });
});

/**
 * Regression (T32): decide the outcome from what the provider actually returns.
 *
 * `getUserOperationReceipt` is a straight passthrough of the standard
 * `eth_getUserOperationReceipt` response, so the payload carries the
 * user-operation-level `success` boolean alongside the raw JSON-RPC
 * transaction `status`. The `success: true, receipt.status: '0x1'` fixture
 * below is the **actual observed shape** returned by the live Pimlico bundler
 * for a Base deposit that succeeded (userOp hash
 * 0x9cfeb58a1207d2c0c41307664f8e554e1d0625f7eda94237d79247d77b71033e). The
 * operation's call really succeeded: the resident Safe has an EntryPoint nonce
 * of 1 and a vault position exists. Under the old `status !== 'success'` check
 * this fixture was reported as "The user operation reverted."
 */
const SUCCESS_STATUSES: readonly (string | number | boolean)[] = [
  '0x1',
  1,
  true,
  // The legacy string form: a provider may normalise to this one day, and it
  // must remain accepted — but it is no longer the only accepted form.
  'success',
];
const REVERT_STATUSES: readonly (string | number | boolean)[] = [
  '0x0',
  0,
  false,
  'reverted',
];

describe('provider receipt outcome', () => {
  it('confirms the real provider payload: success true with hex status 0x1', async () => {
    const fake = fakePack([
      {
        success: true,
        receipt: { status: '0x1', transactionHash: CONFIRMED_TX_HASH },
      },
    ]);
    const { token } = await build(fake);

    const outcome = await submitResidentSafeOperation(
      { token, assertion: ASSERTION },
      fake.deps,
      ENV,
    );

    expect(outcome.status).toBe('sent');
    if (outcome.status !== 'sent') return;
    expect(outcome.sent).toBe(true);
    expect(outcome.userOperationHash).toBe(USER_OP_HASH);
    expect(outcome.transactionHash).toBe(CONFIRMED_TX_HASH);
    expect(fake.sleep).not.toHaveBeenCalled();
    expect(fake.executeTransaction).toHaveBeenCalledTimes(1);
  });

  it('uses the user-op success boolean as authoritative over the transaction status', async () => {
    // success false with a 0x1 transaction status is still a revert: the
    // user-op outcome distinguishes a call revert from a mined success.
    const reverted = fakePack([
      { success: false, receipt: { status: '0x1', transactionHash: REVERTED_TX_HASH } },
    ]);
    const { token: revertToken } = await build(reverted);
    const revertOutcome = await submitResidentSafeOperation(
      { token: revertToken, assertion: ASSERTION },
      reverted.deps,
      ENV,
    );
    expect(revertOutcome.status).toBe('failed');
    if (revertOutcome.status !== 'failed') return;
    expect(revertOutcome.reason).toBe('The user operation reverted.');
    expect(revertOutcome.transactionHash).toBe(REVERTED_TX_HASH);

    // success true with a 0x0 transaction status is still a success.
    const confirmed = fakePack([
      { success: true, receipt: { status: '0x0', transactionHash: CONFIRMED_TX_HASH } },
    ]);
    const { token: confirmToken } = await build(confirmed);
    const confirmOutcome = await submitResidentSafeOperation(
      { token: confirmToken, assertion: ASSERTION },
      confirmed.deps,
      ENV,
    );
    expect(confirmOutcome.status).toBe('sent');
    if (confirmOutcome.status !== 'sent') return;
    expect(confirmOutcome.transactionHash).toBe(CONFIRMED_TX_HASH);
  });

  it.each(SUCCESS_STATUSES)(
    'falls back to transaction status %p as success when the user-op outcome is absent',
    async (status) => {
      const fake = fakePack([
        { receipt: { status, transactionHash: CONFIRMED_TX_HASH } },
      ]);
      const { token } = await build(fake);

      const outcome = await submitResidentSafeOperation(
        { token, assertion: ASSERTION },
        fake.deps,
        ENV,
      );

      expect(outcome.status).toBe('sent');
      if (outcome.status !== 'sent') return;
      expect(outcome.transactionHash).toBe(CONFIRMED_TX_HASH);
    },
  );

  it.each(REVERT_STATUSES)(
    'falls back to transaction status %p as a revert when the user-op outcome is absent',
    async (status) => {
      const fake = fakePack([
        { receipt: { status, transactionHash: REVERTED_TX_HASH } },
      ]);
      const { token } = await build(fake);

      const outcome = await submitResidentSafeOperation(
        { token, assertion: ASSERTION },
        fake.deps,
        ENV,
      );

      expect(outcome.status).toBe('failed');
      if (outcome.status !== 'failed') return;
      expect(outcome.sent).toBe(true);
      expect(outcome.stage).toBe('receipt');
      expect(outcome.reason).toBe('The user operation reverted.');
      expect(outcome.transactionHash).toBe(REVERTED_TX_HASH);
      expect(outcome.userOperationHash).toBe(USER_OP_HASH);
    },
  );

  it('does not treat an unrecognised or missing status as success', async () => {
    for (const receipt of [
      { receipt: { status: '0x2' } },
      { receipt: {} },
      {},
    ] as UserOperationReceipt[]) {
      const fake = fakePack([receipt]);
      const { token } = await build(fake);

      const outcome = await submitResidentSafeOperation(
        { token, assertion: ASSERTION },
        fake.deps,
        ENV,
      );

      expect(outcome.status).toBe('failed');
      if (outcome.status !== 'failed') return;
      expect(outcome.reason).toBe('The user operation reverted.');
    }
  });
});
