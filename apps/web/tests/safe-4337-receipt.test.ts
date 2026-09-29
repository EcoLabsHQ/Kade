import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Address, Hex } from 'viem';
import {
  buildResidentSafeBatch,
  RECEIPT_POLL_DELAYS_MS,
  submitResidentSafeOperation,
  type Safe4337PackLike,
  type SafeAssertionParts,
  type SafeExecutionDependencies,
  type UserOperationReceipt,
} from '@/lib/safe/execute-safe-4337';
import type { PasskeySigner } from '@/lib/safe/passkey-signer';

/**
 * Regression: a user operation that is simply not mined yet must never be
 * reported as reverted.
 *
 * `getUserOperationReceipt` answers `null` until the bundler has indexed the
 * mined operation. The engine used to read that `null` as `status !== 'success'`
 * and report "The user operation reverted." even when the chain later showed the
 * operation had succeeded. These tests pin the honest behaviour:
 *
 *   - a null receipt is pending / not confirmed, carries the user-operation
 *     hash, and is never resubmitted;
 *   - only an existing, non-`success` receipt is a revert (with its tx hash);
 *   - a successful receipt still confirms.
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
  const retained = { getHash: () => SAFE_OP_HASH };

  const createTransaction = vi.fn(async () => retained);
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
