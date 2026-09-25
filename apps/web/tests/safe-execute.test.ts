import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bytesToHex,
  decodeAbiParameters,
  getAddress,
  hexToBytes,
  type Hex,
} from 'viem';
import {
  assertSafeExecutionApproved,
  encodeSafeWebAuthnSignature,
  executeSafeTransaction,
  executeSafeTransactionFromEnv,
  pimlicoRpcUrl,
  prepareSafeTransaction,
  readPimlicoConfig,
  readSafeExecutionGate,
  type LoadedSafeAccount,
  type LoadSafeAccountInput,
  type SafeCall,
  type SafeExecutionDependencies,
  type SafeExecutionGate,
  type SafeUserOperationPlan,
  type SafeWebAuthnAssertion,
} from '@/lib/safe/execute';

/**
 * The resident-Safe transaction engine.
 *
 * These tests are offline: every network boundary is injected. They prove three
 * things — the approval gate refuses before a signer or a bundler is reached; a
 * plan is never reported as a send; and `sent: true` appears only after a
 * confirmed receipt. They also exercise the WebAuthn signature packing against
 * the published safe-modules v0.2.1 struct.
 */

const SAFE = getAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');
const OTHER_SAFE = getAddress('0x1111111111111111111111111111111111111111');
const USDC = getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
const VAULT = getAddress('0x1111222233334444555566667777888899990000');
const ENTRY_POINT = getAddress('0x0000000071727De22E5E9d8BAf0edAc6f37da032');
const PAYMASTER = getAddress('0x7777777777777777777777777777777777777777');
const OP_HASH = `0x${'11'.repeat(32)}` as Hex;
const USER_OP_HASH = `0x${'cd'.repeat(32)}` as Hex;
const TX_HASH = `0x${'ab'.repeat(32)}` as Hex;
const R = 0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20n;
const S = 0x2122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f40n;

const APPROVED: SafeExecutionGate = {
  onchainGateApproved: true,
  approvedBy: 'project owner',
  approvedAt: '2026-09-25',
};
const NOT_APPROVED: SafeExecutionGate = {
  onchainGateApproved: false,
  approvedBy: 'project owner',
  approvedAt: '2026-09-25',
};

const CALLS: readonly SafeCall[] = [
  { to: USDC, value: 0n, data: '0x095ea7b3' as Hex },
  { to: VAULT, value: 0n, data: '0x6e553f65' as Hex },
];

const USER_OPERATION: SafeUserOperationPlan = {
  sender: SAFE,
  nonce: 1n,
  callData: '0xdeadbeef' as Hex,
  callGasLimit: 100_000n,
  verificationGasLimit: 120_000n,
  preVerificationGas: 21_000n,
  maxFeePerGas: 1_000_000_000n,
  maxPriorityFeePerGas: 1n,
  paymasterAndData: '0x' as Hex,
  signature: '0x' as Hex,
};

function makeAccount(overrides: Partial<LoadedSafeAccount> = {}): LoadedSafeAccount {
  return {
    safeAddress: SAFE,
    chainId: 11155111,
    entryPoint: ENTRY_POINT,
    userOperation: USER_OPERATION,
    safeOperationHash: OP_HASH,
    paymaster: PAYMASTER,
    ...overrides,
  };
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function derInteger(value: bigint): number[] {
  let hex = value.toString(16);
  if (hex.length % 2 === 1) hex = `0${hex}`;
  const bytes = [...hexToBytes(`0x${hex}`)];
  // DER INTEGERs are signed: a leading high bit needs a 0x00 pad.
  if ((bytes[0]! & 0x80) !== 0) bytes.unshift(0x00);
  return [0x02, bytes.length, ...bytes];
}

function makeAssertion(
  challenge: Hex = OP_HASH,
  flags = 0x05,
): SafeWebAuthnAssertion {
  const clientDataJSON = new TextEncoder().encode(
    `{"type":"webauthn.get","challenge":"${base64Url(hexToBytes(challenge))}","origin":"https://kade.test"}`,
  );
  const authenticatorData = new Uint8Array(37).fill(0xfe);
  authenticatorData[32] = flags;
  const rBytes = derInteger(R);
  const sBytes = derInteger(S);
  const signature = new Uint8Array([
    0x30,
    rBytes.length + sBytes.length,
    ...rBytes,
    ...sBytes,
  ]);
  return {
    credentialId: 'kade-test-credential',
    authenticatorData: bytesToHex(authenticatorData),
    clientDataJSON: bytesToHex(clientDataJSON),
    signature: bytesToHex(signature),
  };
}

interface Mocks {
  readonly deps: SafeExecutionDependencies;
  readonly loadAccount: ReturnType<typeof vi.fn>;
  readonly getPasskey: ReturnType<typeof vi.fn>;
  readonly submit: ReturnType<typeof vi.fn>;
}

function makeDeps(
  opts: {
    readonly account?: LoadedSafeAccount;
    readonly assertion?: SafeWebAuthnAssertion;
    readonly receiptStatus?: 'success' | 'reverted';
    readonly submitThrows?: Error;
    readonly assertCanBeBad?: boolean;
  } = {},
): Mocks {
  const loadAccount = vi.fn(async (_input: LoadSafeAccountInput) => opts.account ?? makeAccount());
  const getPasskey = vi.fn(async () => opts.assertion ?? makeAssertion());
  const submit = vi.fn(async () => {
    if (opts.submitThrows) throw opts.submitThrows;
    return {
      userOperationHash: USER_OP_HASH,
      receipt: {
        transactionHash: TX_HASH,
        blockNumber: 42n,
        status: opts.receiptStatus ?? 'success',
      },
    };
  });

  const deps: SafeExecutionDependencies = {
    gate: APPROVED,
    signerDeployed: true,
    loadAccount,
    getPasskey,
    submit,
  };
  return { deps, loadAccount, getPasskey, submit };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the approval gate', () => {
  it('is absent when no approval is recorded', () => {
    expect(readSafeExecutionGate({})).toBeNull();
  });

  it('reads the recorded approval and who approved it', () => {
    const gate = readSafeExecutionGate({
      KADE_SAFE_EXECUTION_APPROVED: 'true',
      KADE_SAFE_EXECUTION_APPROVED_BY: 'project owner',
      KADE_SAFE_EXECUTION_APPROVED_AT: '2026-09-25',
    });
    expect(gate).toEqual(APPROVED);
    expect(() => assertSafeExecutionApproved(gate!)).not.toThrow();
  });

  it('refuses an unapproved or unattributed approval', () => {
    expect(() => assertSafeExecutionApproved(NOT_APPROVED)).toThrow(/not been approved/i);
    expect(() =>
      assertSafeExecutionApproved({
        onchainGateApproved: true,
        approvedBy: '',
        approvedAt: '2026-09-25',
      }),
    ).toThrow(/who approved/i);
  });
});

describe('encodeSafeWebAuthnSignature', () => {
  it('packs the assertion into the WebAuthn.Signature struct', () => {
    const assertion = makeAssertion();
    const encoded = encodeSafeWebAuthnSignature(assertion, OP_HASH);
    const decoded = decodeAbiParameters(
      [{ type: 'bytes' }, { type: 'string' }, { type: 'uint256' }, { type: 'uint256' }],
      encoded,
    );
    expect(decoded[0]).toBe(assertion.authenticatorData);
    expect(decoded[1]).toBe('"origin":"https://kade.test"');
    expect(decoded[2]).toBe(R);
    expect(decoded[3]).toBe(S);
  });

  it('refuses an assertion whose challenge is a different operation hash', () => {
    const otherHash = `0x${'22'.repeat(32)}` as Hex;
    const assertion = makeAssertion(otherHash);
    expect(() => encodeSafeWebAuthnSignature(assertion, OP_HASH)).toThrow(
      /does not equal the Safe operation hash/i,
    );
  });

  it('refuses an assertion that did not perform user verification', () => {
    const assertion = makeAssertion(OP_HASH, 0x01);
    expect(() => encodeSafeWebAuthnSignature(assertion, OP_HASH)).toThrow(
      /user verification/i,
    );
  });

  it('refuses malformed client data and DER signatures', () => {
    const good = makeAssertion();
    expect(() =>
      encodeSafeWebAuthnSignature(
        { ...good, clientDataJSON: bytesToHex(new TextEncoder().encode('not json')) },
        OP_HASH,
      ),
    ).toThrow(/client data JSON/i);
    expect(() =>
      encodeSafeWebAuthnSignature({ ...good, signature: '0x1234' }, OP_HASH),
    ).toThrow(/DER/i);
  });
});

describe('prepareSafeTransaction', () => {
  it('is not-configured and unsent with no recorded approval, reaching nothing', async () => {
    const mocks = makeDeps();
    const result = await prepareSafeTransaction(
      { calls: CALLS, safeAddress: SAFE },
      { ...mocks.deps, gate: null, env: {} },
    );
    expect(result.status).toBe('not-configured');
    expect(result.sent).toBe(false);
    expect(mocks.loadAccount).not.toHaveBeenCalled();
    expect(mocks.getPasskey).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('is blocked and unsent when the approval is recorded but not granted', async () => {
    const mocks = makeDeps();
    const result = await prepareSafeTransaction(
      { calls: CALLS, safeAddress: SAFE },
      { ...mocks.deps, gate: NOT_APPROVED },
    );
    expect(result.status).toBe('blocked');
    expect(result.sent).toBe(false);
    if (result.status === 'blocked') expect(result.missing).toBe('approval');
    expect(mocks.loadAccount).not.toHaveBeenCalled();
    expect(mocks.getPasskey).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('is blocked on the undeployed signer without loading an account', async () => {
    const mocks = makeDeps();
    const result = await prepareSafeTransaction(
      { calls: CALLS, safeAddress: SAFE },
      { ...mocks.deps, signerDeployed: false },
    );
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') expect(result.missing).toBe('signer');
    expect(mocks.loadAccount).not.toHaveBeenCalled();
  });

  it('refuses malformed input rather than preparing it', async () => {
    const mocks = makeDeps();
    const noCalls = await prepareSafeTransaction(
      { calls: [], safeAddress: SAFE },
      mocks.deps,
    );
    expect(noCalls.status).toBe('blocked');

    const badChain = await prepareSafeTransaction(
      { calls: CALLS, safeAddress: SAFE, chainId: 999999 },
      mocks.deps,
    );
    expect(badChain.status).toBe('blocked');
    if (badChain.status === 'blocked') expect(badChain.missing).toBe('input');
    expect(mocks.loadAccount).not.toHaveBeenCalled();
  });

  it('builds the reviewable plan with the exact calls and resolved addresses', async () => {
    const mocks = makeDeps();
    const result = await prepareSafeTransaction(
      { calls: CALLS, safeAddress: SAFE },
      mocks.deps,
    );
    expect(result.status).toBe('plan');
    expect(result.sent).toBe(false);
    if (result.status === 'plan') {
      expect(result.plan.calls).toEqual(CALLS);
      expect(result.plan.safeAddress).toBe(SAFE);
      expect(result.plan.entryPoint).toBe(ENTRY_POINT);
      expect(result.plan.safeOperationHash).toBe(OP_HASH);
      expect(result.plan.paymaster).toBe(PAYMASTER);
      expect(result.reason).toMatch(/NOT sent/i);
    }
    expect(mocks.loadAccount).toHaveBeenCalledTimes(1);
    expect(mocks.getPasskey).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('refuses when the loader resolves a different Safe', async () => {
    const mocks = makeDeps({ account: makeAccount({ safeAddress: OTHER_SAFE }) });
    const result = await prepareSafeTransaction(
      { calls: CALLS, safeAddress: SAFE },
      mocks.deps,
    );
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') expect(result.missing).toBe('account');
  });
});

describe('executeSafeTransaction', () => {
  it('never reaches the signer or the submitter when the gate is not approved', async () => {
    const mocks = makeDeps();
    const result = await executeSafeTransaction(
      { calls: CALLS, safeAddress: SAFE },
      { ...mocks.deps, gate: NOT_APPROVED },
    );
    expect(result.sent).toBe(false);
    expect(result.status).toBe('blocked');
    expect(mocks.loadAccount).not.toHaveBeenCalled();
    expect(mocks.getPasskey).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('returns the plan and sends nothing without a signer and a submitter', async () => {
    const loadAccount = vi.fn(async () => makeAccount());
    const getPasskey = vi.fn(async () => makeAssertion());
    const result = await executeSafeTransaction(
      { calls: CALLS, safeAddress: SAFE },
      { gate: APPROVED, signerDeployed: true, loadAccount, getPasskey },
    );
    expect(result.status).toBe('plan');
    expect(result.sent).toBe(false);
    expect(getPasskey).not.toHaveBeenCalled();
    expect(loadAccount).toHaveBeenCalledTimes(1);
  });

  it('re-checks the gate immediately before signing', async () => {
    let currentGate: SafeExecutionGate = APPROVED;
    const loadAccount = vi.fn(async (_input: LoadSafeAccountInput) => makeAccount());
    const getPasskey = vi.fn(async () => makeAssertion());
    const submit = vi.fn();
    const result = await executeSafeTransaction(
      { calls: CALLS, safeAddress: SAFE },
      {
        get gate() {
          return currentGate;
        },
        signerDeployed: true,
        loadAccount: vi.fn(async (input) => {
          const account = await loadAccount(input);
          // The approval is withdrawn after the plan was prepared.
          currentGate = NOT_APPROVED;
          return account;
        }),
        getPasskey,
        submit,
      },
    );
    expect(result.status).toBe('blocked');
    expect(result.sent).toBe(false);
    expect(getPasskey).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('signs, submits and reports sent only after a confirmed receipt', async () => {
    const mocks = makeDeps();
    const result = await executeSafeTransaction(
      { calls: CALLS, safeAddress: SAFE, credential: { credentialId: 'cred' } },
      mocks.deps,
    );

    expect(result.status).toBe('sent');
    expect(result.sent).toBe(true);
    if (result.status === 'sent') {
      expect(result.transactionHash).toBe(TX_HASH);
      expect(result.userOperationHash).toBe(USER_OP_HASH);
      expect(result.blockNumber).toBe(42n);
      // The signature attached to the submitted operation is the encoded one.
      expect(result.webAuthnSignature).toMatch(/^0x[0-9a-f]+$/i);
    }

    expect(mocks.getPasskey).toHaveBeenCalledTimes(1);
    const signInput = mocks.getPasskey.mock.calls[0]![0] as {
      safeOperationHash: Hex;
    };
    expect(signInput.safeOperationHash).toBe(OP_HASH);

    expect(mocks.submit).toHaveBeenCalledTimes(1);
    const submitInput = mocks.submit.mock.calls[0]![0] as {
      userOperation: SafeUserOperationPlan;
      webAuthnSignature: Hex;
    };
    expect(submitInput.userOperation.signature).toBe(submitInput.webAuthnSignature);
  });

  it('reports failed and unsent when the receipt reverted', async () => {
    const mocks = makeDeps({ receiptStatus: 'reverted' });
    const result = await executeSafeTransaction(
      { calls: CALLS, safeAddress: SAFE },
      mocks.deps,
    );
    expect(result.status).toBe('failed');
    expect(result.sent).toBe(false);
    if (result.status === 'failed') {
      expect(result.stage).toBe('receipt');
      expect(result.transactionHash).toBe(TX_HASH);
    }
  });

  it('reports failed and unsent when the passkey assertion cannot be produced', async () => {
    const mocks = makeDeps();
    mocks.getPasskey.mockRejectedValue(new Error('user cancelled'));
    const result = await executeSafeTransaction(
      { calls: CALLS, safeAddress: SAFE },
      mocks.deps,
    );
    expect(result.status).toBe('failed');
    expect(result.sent).toBe(false);
    if (result.status === 'failed') expect(result.stage).toBe('sign');
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('never submits when the assertion is over a different operation hash', async () => {
    const mocks = makeDeps({ assertion: makeAssertion(`0x${'33'.repeat(32)}` as Hex) });
    const result = await executeSafeTransaction(
      { calls: CALLS, safeAddress: SAFE },
      mocks.deps,
    );
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.stage).toBe('encode');
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('reports failed and unsent when the submitter throws', async () => {
    const mocks = makeDeps({ submitThrows: new Error('bundler down') });
    const result = await executeSafeTransaction(
      { calls: CALLS, safeAddress: SAFE },
      mocks.deps,
    );
    expect(result.status).toBe('failed');
    expect(result.sent).toBe(false);
    if (result.status === 'failed') expect(result.stage).toBe('submit');
  });
});

describe('Pimlico configuration', () => {
  it('is absent unless both keys are set', () => {
    expect(readPimlicoConfig({})).toBeNull();
    expect(readPimlicoConfig({ PIMLICO_API_KEY: 'key' })).toBeNull();
    expect(readPimlicoConfig({ PIMLICO_POLICY_ID: 'policy' })).toBeNull();
  });

  it('builds the v2 endpoint from the key and chain', () => {
    const config = readPimlicoConfig(
      { PIMLICO_API_KEY: 'key', PIMLICO_POLICY_ID: 'policy' },
      11155111,
    );
    expect(config?.policyId).toBe('policy');
    expect(config?.rpcUrl).toBe(pimlicoRpcUrl(11155111, 'key'));
    expect(config?.rpcUrl).toContain('api.pimlico.io/v2/11155111/rpc');
  });
});

describe('executeSafeTransactionFromEnv', () => {
  const REQUEST = { calls: CALLS, safeAddress: SAFE } as const;

  it('is not-configured with no recorded approval', async () => {
    const result = await executeSafeTransactionFromEnv(REQUEST, {});
    expect(result.status).toBe('not-configured');
    expect(result.sent).toBe(false);
  });

  it('is blocked when the approval is recorded but not granted', async () => {
    const result = await executeSafeTransactionFromEnv(REQUEST, {
      KADE_SAFE_EXECUTION_APPROVED: 'false',
      KADE_SAFE_EXECUTION_APPROVED_BY: 'owner',
      KADE_SAFE_EXECUTION_APPROVED_AT: '2026-09-25',
    });
    expect(result.status).toBe('blocked');
    expect(result.sent).toBe(false);
  });

  it('is not-configured when the Pimlico keys are absent', async () => {
    const result = await executeSafeTransactionFromEnv(REQUEST, {
      KADE_SAFE_EXECUTION_APPROVED: 'true',
      KADE_SAFE_EXECUTION_APPROVED_BY: 'owner',
      KADE_SAFE_EXECUTION_APPROVED_AT: '2026-09-25',
    });
    expect(result.status).toBe('not-configured');
    expect(result.sent).toBe(false);
  });

  it('names the remaining seam and sends nothing when the keys are present', async () => {
    const result = await executeSafeTransactionFromEnv(REQUEST, {
      KADE_SAFE_EXECUTION_APPROVED: 'true',
      KADE_SAFE_EXECUTION_APPROVED_BY: 'owner',
      KADE_SAFE_EXECUTION_APPROVED_AT: '2026-09-25',
      PIMLICO_API_KEY: 'key',
      PIMLICO_POLICY_ID: 'policy',
    });
    expect(result.status).toBe('blocked');
    expect(result.sent).toBe(false);
    if (result.status === 'blocked') {
      expect(result.reason).toMatch(/safe-global|permissionless|D-EXE-011/);
    }
  });
});
