import { describe, expect, it, vi } from 'vitest';
import {
  bytesToHex,
  getAddress,
  hexToBytes,
  type Hex,
} from 'viem';
import { prepareMorphoVaultDeposit } from '@/lib/invest/morpho-execution';
import { MORPHO_VAULT_ENV_KEYS } from '@/lib/invest/morpho-config';
import type {
  LoadedSafeAccount,
  LoadSafeAccountInput,
  SafeExecutionGate,
  SafeUserOperationPlan,
  SafeWebAuthnAssertion,
} from '@/lib/safe/execute';

/**
 * The MetaMorpho deposit routed through the resident-Safe engine.
 *
 * The deposit plan (approve + deposit) is built as before; the new path hands
 * its exact calls to `executeSafeTransaction`. These tests prove the wiring
 * sends nothing by default and that a confirmed engine send is reported as a
 * distinct `sent: true`, never as a `ready-to-execute` plan.
 */

const VAULT = getAddress('0x1111222233334444555566667777888899990000');
const USDC = getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
const SAFE = getAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');
const ENTRY_POINT = getAddress('0x0000000071727De22E5E9d8BAf0edAc6f37da032');
const OP_HASH = `0x${'11'.repeat(32)}` as Hex;
const USER_OP_HASH = `0x${'cd'.repeat(32)}` as Hex;
const TX_HASH = `0x${'ab'.repeat(32)}` as Hex;

const COMPLETE_ENV = {
  [MORPHO_VAULT_ENV_KEYS.vault]: VAULT,
  [MORPHO_VAULT_ENV_KEYS.usdc]: USDC,
} as const;

const REQUEST = { safeAddress: SAFE, amountUsdc: '25000' } as const;

const APPROVED: SafeExecutionGate = {
  onchainGateApproved: true,
  approvedBy: 'project owner',
  approvedAt: '2026-09-25',
};

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

function makeAccount(): LoadedSafeAccount {
  return {
    safeAddress: SAFE,
    chainId: 1,
    entryPoint: ENTRY_POINT,
    userOperation: USER_OPERATION,
    safeOperationHash: OP_HASH,
    paymaster: null,
  };
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeAssertion(challenge: Hex): SafeWebAuthnAssertion {
  const clientDataJSON = new TextEncoder().encode(
    `{"type":"webauthn.get","challenge":"${base64Url(hexToBytes(challenge))}","origin":"https://kade.test"}`,
  );
  const authenticatorData = new Uint8Array(37).fill(0xfe);
  authenticatorData[32] = 0x05;
  // A minimal, structurally valid DER signature (r = s = 1).
  const der = new Uint8Array([0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01]);
  return {
    credentialId: 'cred',
    authenticatorData: bytesToHex(authenticatorData),
    clientDataJSON: bytesToHex(clientDataJSON),
    signature: bytesToHex(der),
  };
}

function makeDeps(overrides: {
  readonly gate?: SafeExecutionGate | null;
  readonly withSignAndSubmit?: boolean;
}) {
  const loadAccount = vi.fn(async (_input: LoadSafeAccountInput) => makeAccount());
  const getPasskey = vi.fn(async () => makeAssertion(OP_HASH));
  const submit = vi.fn(async () => ({
    userOperationHash: USER_OP_HASH,
    receipt: { transactionHash: TX_HASH, blockNumber: 42n, status: 'success' as const },
  }));
  const safeExecution = {
    gate: overrides.gate === undefined ? APPROVED : overrides.gate,
    signerDeployed: true,
    loadAccount,
    ...(overrides.withSignAndSubmit ? { getPasskey, submit } : {}),
  };
  return { safeExecution, loadAccount, getPasskey, submit };
}

describe('prepareMorphoVaultDeposit through the Safe engine', () => {
  it('sends nothing by default: no engine, only the plan', async () => {
    const result = await prepareMorphoVaultDeposit(REQUEST, {
      env: COMPLETE_ENV,
      mainnetConfigured: true,
      signerDeployed: true,
    });
    expect(result.status).toBe('ready-to-execute');
    expect(result.gated).toBe(true);
  });

  it('reports the engine gate refusal and sends nothing when approval is absent', async () => {
    const { safeExecution } = makeDeps({ gate: null });
    const result = await prepareMorphoVaultDeposit(REQUEST, {
      env: COMPLETE_ENV,
      mainnetConfigured: true,
      signerDeployed: true,
      safeExecution,
      credential: { credentialId: 'cred' },
    });
    expect(result.status).toBe('gated');
    expect(result.gated).toBe(true);
    if (result.status === 'gated') expect(result.gate).toBe('execution-blocked');
  });

  it('returns a reviewable plan (not a send) when the engine has no signer/submitter', async () => {
    const { safeExecution, loadAccount } = makeDeps({});
    const result = await prepareMorphoVaultDeposit(REQUEST, {
      env: COMPLETE_ENV,
      mainnetConfigured: true,
      signerDeployed: true,
      safeExecution,
      credential: { credentialId: 'cred' },
    });
    expect(result.status).toBe('ready-to-execute');
    expect(result.gated).toBe(true);
    if (result.status === 'ready-to-execute') {
      expect(result.plan.calls).toHaveLength(2);
      expect(result.execution?.status).toBe('plan');
      expect(result.execution?.sent).toBe(false);
    }
    expect(loadAccount).toHaveBeenCalledTimes(1);
  });

  it('reports sent only after the engine confirms a receipt', async () => {
    const { safeExecution, loadAccount, submit } = makeDeps({ withSignAndSubmit: true });
    const result = await prepareMorphoVaultDeposit(REQUEST, {
      env: COMPLETE_ENV,
      mainnetConfigured: true,
      signerDeployed: true,
      safeExecution,
      credential: { credentialId: 'cred' },
    });

    expect(result.status).toBe('sent');
    if (result.status !== 'sent') return;
    expect(result.sent).toBe(true);
    expect(result.gated).toBe(false);
    expect(result.transactionHash).toBe(TX_HASH);
    expect(result.userOperationHash).toBe(USER_OP_HASH);

    expect(loadAccount).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
    // The engine received the deposit's two calls (approve then deposit).
    const request = loadAccount.mock.calls[0]![0] as { calls: readonly unknown[] };
    expect(request.calls).toHaveLength(2);
  });
});
