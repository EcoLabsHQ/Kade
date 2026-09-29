import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Address, Hex } from 'viem';
import {
  buildResidentSafeBatch,
  RETAINED_OPERATION_TTL_MS,
  submitResidentSafeOperation,
  type Safe4337PackLike,
  type SafeAssertionParts,
  type SafeExecutionDependencies,
  type SafeSubmitOutcome,
} from '@/lib/safe/execute-safe-4337';
import type { PasskeySigner } from '@/lib/safe/passkey-signer';

/**
 * The two-phase resident-Safe flow (architecture B).
 *
 * The passkey assertion is browser-only and the Pimlico key is a server secret,
 * so signing cannot happen in one server call. The build phase retains the
 * built operation server-side and returns only `{ token, hash }`; the submit
 * phase accepts only `{ token, assertion }` and never trusts operation fields
 * from the client. These tests pin that split and its fail-closed refusals.
 *
 * The pack is injected at both seams, so no bundler and no key are needed, and
 * no test can broadcast.
 */

const SAFE = '0x1111111111111111111111111111111111111111' as Address;
const ATTACKER = '0x9999999999999999999999999999999999999999' as Address;
const SAFE_OP_HASH = `0x${'ab'.repeat(32)}` as Hex;
const OTHER_HASH = `0x${'cd'.repeat(32)}` as Hex;
const USER_OP_HASH = `0x${'fe'.repeat(32)}` as Hex;
const SIGNATURE = '0xdeadbeef' as Hex;

/** The estimate relay-kit assigns before the build phase buffers it. */
const RAW_VERIFICATION_GAS = 51_698n;

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

const AUTHENTICATOR_DATA = new Uint8Array([1, 2, 3, 4]);
const SIGNATURE_BYTES = new Uint8Array([48, 6, 2, 1, 1, 2, 1, 2]);
const CLIENT_DATA_JSON = new Uint8Array([123, 125]);

const ASSERTION: SafeAssertionParts = {
  authenticatorData: Buffer.from(AUTHENTICATOR_DATA).toString('base64url'),
  signature: Buffer.from(SIGNATURE_BYTES).toString('base64url'),
  clientDataJSON: Buffer.from(CLIENT_DATA_JSON).toString('base64url'),
};

type InitInput = Parameters<SafeExecutionDependencies['initPack']>[0];

/**
 * The slice of relay-kit's `SafeOperation` the build phase reads now that it
 * buffers the estimate: the allowance (`getUserOperation`), the assignment the
 * SDK exposes (`addEstimations`) and the hash it signs. The real v0.7 class
 * assigns `verificationGasLimit`, so the fake does too.
 */
interface RetainedOperation {
  getUserOperation: () => { verificationGasLimit: bigint };
  addEstimations: (estimations: { verificationGasLimit?: bigint }) => void;
  getHash: () => Hex;
}

interface FakePack {
  readonly deps: SafeExecutionDependencies;
  readonly order: string[];
  /** The exact object the build phase retained and returned for signing. */
  readonly retained: RetainedOperation;
  /** The operation's live verification allowance, for assertions. */
  readonly gas: { value: bigint };
  readonly initPack: Mock;
  readonly createTransaction: Mock;
  readonly signSafeOperation: Mock;
  readonly executeTransaction: Mock;
  readonly getUserOperationReceipt: Mock;
}

/**
 * A stub pack that records the documented call order. `hashOf` lets a test
 * move the operation's hash after the build phase, which is exactly the
 * integrity failure the submit phase must catch.
 */
function fakePack(options: { hashOf?: () => Hex; signResult?: () => unknown } = {}): FakePack {
  const order: string[] = [];
  const gas = { value: RAW_VERIFICATION_GAS };
  const retained: RetainedOperation = {
    getUserOperation: () => ({ verificationGasLimit: gas.value }),
    addEstimations: (estimations) => {
      if (estimations.verificationGasLimit) gas.value = estimations.verificationGasLimit;
    },
    getHash: options.hashOf ?? (() => SAFE_OP_HASH),
  };

  const createTransaction = vi.fn(async () => {
    order.push('create');
    return retained;
  });
  const signSafeOperation = vi.fn(async () => {
    order.push('sign');
    return options.signResult ? options.signResult() : { encodedSignatures: () => SIGNATURE };
  });
  const executeTransaction = vi.fn(async () => {
    order.push('submit');
    return USER_OP_HASH;
  });
  const getUserOperationReceipt = vi.fn(async () => {
    order.push('receipt');
    return { receipt: { status: 'success', transactionHash: '0xfeed' as Hex } };
  });

  const pack = {
    createTransaction,
    signSafeOperation,
    executeTransaction,
    getUserOperationReceipt,
  } as unknown as Safe4337PackLike;

  const initPack = vi.fn<SafeExecutionDependencies['initPack']>(async () => pack);
  const deps: SafeExecutionDependencies = { initPack, signer: SIGNER, safeAddress: SAFE };

  return {
    deps,
    order,
    retained,
    gas,
    initPack,
    createTransaction,
    signSafeOperation,
    executeTransaction,
    getUserOperationReceipt,
  };
}

/** Run the build phase and return the token/hash, or fail the test loudly. */
async function build(fake: FakePack): Promise<{ token: string; hash: Hex }> {
  const outcome = await buildResidentSafeBatch(CALLS, fake.deps, ENV);
  if (outcome.status !== 'built') {
    throw new Error(`expected a built outcome, got ${outcome.status}`);
  }
  return { token: outcome.token, hash: outcome.hash };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('buildResidentSafeBatch', () => {
  it('builds, returns the SafeOp hash and a token, and signs nothing', async () => {
    const fake = fakePack();

    const outcome = await buildResidentSafeBatch(CALLS, fake.deps, ENV);

    expect(outcome.status).toBe('built');
    expect(outcome.sent).toBe(false);
    if (outcome.status !== 'built') return;
    // The passkey signs the SafeOp EIP-712 hash, not the bundler's hash.
    expect(outcome.hash).toBe(SAFE_OP_HASH);
    expect(outcome.hash).not.toBe(USER_OP_HASH);
    // 32 random bytes, base64url, no padding.
    expect(outcome.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fake.order).toEqual(['create']);
    expect(fake.signSafeOperation).not.toHaveBeenCalled();
    expect(fake.executeTransaction).not.toHaveBeenCalled();
  });

  it('refuses without the Pimlico keys and reaches no pack', async () => {
    const fake = fakePack();

    const outcome = await buildResidentSafeBatch(CALLS, fake.deps, env({}));

    expect(outcome.status).toBe('not-configured');
    expect(outcome.sent).toBe(false);
    expect(fake.initPack).not.toHaveBeenCalled();
    expect(fake.createTransaction).not.toHaveBeenCalled();
  });

  it('does nothing for an empty batch, and retains nothing', async () => {
    const fake = fakePack();

    const outcome = await buildResidentSafeBatch([], fake.deps, ENV);

    expect(outcome.status).toBe('ready');
    expect(outcome.sent).toBe(false);
    expect(fake.initPack).not.toHaveBeenCalled();
  });

  it('names the create stage and retains nothing when no hash is exposed', async () => {
    const order: string[] = [];
    // The estimate is present and buffered, but the operation exposes no
    // signable hash, so it is refused after buffering and before retention.
    const noHashOperation = {
      getUserOperation: () => ({ verificationGasLimit: RAW_VERIFICATION_GAS }),
      addEstimations: () => {},
    };
    const noHashPack = {
      createTransaction: vi.fn(async () => {
        order.push('create');
        return noHashOperation;
      }),
      signSafeOperation: vi.fn(async () => ({})),
      executeTransaction: vi.fn(async () => USER_OP_HASH),
      getUserOperationReceipt: vi.fn(async () => null),
    } as unknown as Safe4337PackLike;
    const deps: SafeExecutionDependencies = {
      initPack: vi.fn<SafeExecutionDependencies['initPack']>(async () => noHashPack),
      signer: SIGNER,
      safeAddress: SAFE,
    };

    const outcome = await buildResidentSafeBatch(CALLS, deps, ENV);

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(outcome.stage).toBe('create');
    expect(order).toEqual(['create']);
  });
});

describe('submitResidentSafeOperation', () => {
  it('attaches the assertion to the retained operation and submits it', async () => {
    const fake = fakePack();
    const { token } = await build(fake);
    fake.order.length = 0;

    const outcome = await submitResidentSafeOperation({ token, assertion: ASSERTION }, fake.deps, ENV);

    expect(outcome.status).toBe('sent');
    expect(outcome.sent).toBe(true);
    if (outcome.status === 'sent') {
      expect(outcome.userOperationHash).toBe(USER_OP_HASH);
      expect(outcome.transactionHash).toBe('0xfeed');
    }
    expect(fake.order).toEqual(['sign', 'submit', 'receipt']);
    // The SDK signs the exact operation the build phase retained.
    expect(fake.signSafeOperation).toHaveBeenCalledWith(fake.retained);

    // The submit-phase pack is initialised with a signer whose `getFn` returns
    // the reconstructed assertion as bytes, which is all the SDK reads.
    const submitInit = fake.initPack.mock.calls[1]?.[0] as InitInput;
    const getFn = (submitInit.signer as PasskeySigner).getFn;
    expect(typeof getFn).toBe('function');
    const duck = (await getFn!()) as unknown as {
      response: {
        authenticatorData: Uint8Array;
        signature: Uint8Array;
        clientDataJSON: Uint8Array;
      };
    };
    expect(Array.from(duck.response.authenticatorData)).toEqual(Array.from(AUTHENTICATOR_DATA));
    expect(Array.from(duck.response.signature)).toEqual(Array.from(SIGNATURE_BYTES));
    expect(Array.from(duck.response.clientDataJSON)).toEqual(Array.from(CLIENT_DATA_JSON));
  });

  it('re-verifies the hash and refuses when the retained operation moved', async () => {
    let currentHash: Hex = SAFE_OP_HASH;
    const fake = fakePack({ hashOf: () => currentHash });
    const { token } = await build(fake);
    currentHash = OTHER_HASH;

    const outcome = await submitResidentSafeOperation({ token, assertion: ASSERTION }, fake.deps, ENV);

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(outcome.stage).toBe('integrity');
    expect(outcome.sent).toBe(false);
    expect(fake.signSafeOperation).not.toHaveBeenCalled();
    expect(fake.executeTransaction).not.toHaveBeenCalled();
  });

  it('refuses an unknown token at the lookup stage', async () => {
    const fake = fakePack();

    const outcome = await submitResidentSafeOperation(
      { token: 'not-a-real-token', assertion: ASSERTION },
      fake.deps,
      ENV,
    );

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(outcome.stage).toBe('lookup');
    expect(outcome.sent).toBe(false);
    expect(fake.executeTransaction).not.toHaveBeenCalled();
  });

  it('refuses a reused token and submits at most once', async () => {
    const fake = fakePack();
    const { token } = await build(fake);

    const first = await submitResidentSafeOperation({ token, assertion: ASSERTION }, fake.deps, ENV);
    const second = await submitResidentSafeOperation({ token, assertion: ASSERTION }, fake.deps, ENV);

    expect(first.status).toBe('sent');
    expect(second.status).toBe('failed');
    if (second.status !== 'failed') return;
    expect(second.stage).toBe('lookup');
    expect(fake.executeTransaction).toHaveBeenCalledTimes(1);
  });

  it('refuses an expired token', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fake = fakePack();
    const { token } = await build(fake);

    vi.setSystemTime(new Date(Date.now() + RETAINED_OPERATION_TTL_MS + 1));
    const outcome = await submitResidentSafeOperation({ token, assertion: ASSERTION }, fake.deps, ENV);

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(outcome.stage).toBe('lookup');
    expect(fake.executeTransaction).not.toHaveBeenCalled();
  });

  it('ignores every operation field the client supplies alongside the token', async () => {
    const fake = fakePack();
    const { token } = await build(fake);
    fake.order.length = 0;

    // A hostile caller adds operation-shaped fields. Structure alone ignores
    // them; the submitted operation is still the one the server retained.
    const hostile = {
      token,
      assertion: ASSERTION,
      to: ATTACKER,
      value: '1000000000000000000',
      data: '0xdeadbeef' as Hex,
      nonce: '999',
      calls: [{ to: ATTACKER, value: 1n, data: '0x' as Hex }],
    };
    const outcome = await submitResidentSafeOperation(hostile, fake.deps, ENV);

    expect(outcome.status).toBe('sent');
    // The operation was built exactly once, by the build phase.
    expect(fake.createTransaction).toHaveBeenCalledTimes(1);
    expect(fake.signSafeOperation).toHaveBeenCalledWith(fake.retained);
    expect(fake.order).toEqual(['sign', 'submit', 'receipt']);
  });

  it('refuses to submit when the assertion attached no signature', async () => {
    const fake = fakePack({ signResult: () => ({ encodedSignatures: () => '0x' }) });
    const { token } = await build(fake);

    const outcome = await submitResidentSafeOperation({ token, assertion: ASSERTION }, fake.deps, ENV);

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(outcome.stage).toBe('sign');
    expect(outcome.sent).toBe(false);
    expect(fake.executeTransaction).not.toHaveBeenCalled();
  });

  it('refuses a signed operation that exposes no encoded signature at all', async () => {
    // A signed value without `encodedSignatures()` cannot prove authorisation,
    // so the guard stays fail-closed rather than assuming the operation is fine.
    const fake = fakePack({ signResult: () => ({ signed: true }) });
    const { token } = await build(fake);

    const outcome = await submitResidentSafeOperation({ token, assertion: ASSERTION }, fake.deps, ENV);

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(outcome.stage).toBe('sign');
    expect(outcome.sent).toBe(false);
    expect(fake.executeTransaction).not.toHaveBeenCalled();
  });

  it('does not report sent when the receipt reverted', async () => {
    const fake = fakePack();
    fake.getUserOperationReceipt.mockResolvedValueOnce({
      receipt: { status: 'reverted' },
    });
    const { token } = await build(fake);

    const outcome = await submitResidentSafeOperation({ token, assertion: ASSERTION }, fake.deps, ENV);

    expect(outcome.status).toBe('failed');
    // It was submitted, so `sent` is true — but the status is a failure, never
    // a success. The two are separate on purpose.
    expect(outcome.sent).toBe(true);
    if (outcome.status === 'failed') expect(outcome.stage).toBe('receipt');
  });

  it('reports a signing failure without claiming anything was sent', async () => {
    const fake = fakePack();
    fake.signSafeOperation.mockRejectedValueOnce(new Error('user rejected the passkey prompt'));
    const { token } = await build(fake);

    const outcome = await submitResidentSafeOperation({ token, assertion: ASSERTION }, fake.deps, ENV);

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(outcome.stage).toBe('sign');
    expect(outcome.sent).toBe(false);
    expect(outcome.reason).toMatch(/rejected/);
    expect(fake.executeTransaction).not.toHaveBeenCalled();
  });

  it('reports a submit failure as not sent', async () => {
    const fake = fakePack();
    fake.executeTransaction.mockRejectedValueOnce(new Error('bundler unavailable'));
    const { token } = await build(fake);

    const outcome = await submitResidentSafeOperation({ token, assertion: ASSERTION }, fake.deps, ENV);

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(outcome.stage).toBe('submit');
    expect(outcome.sent).toBe(false);
  });

  it('refuses without the Pimlico keys and reaches no pack', async () => {
    const fake = fakePack();

    const outcome: SafeSubmitOutcome = await submitResidentSafeOperation(
      { token: 'anything', assertion: ASSERTION },
      fake.deps,
      env({}),
    );

    expect(outcome.status).toBe('not-configured');
    expect(outcome.sent).toBe(false);
    expect(fake.initPack).not.toHaveBeenCalled();
  });
});
