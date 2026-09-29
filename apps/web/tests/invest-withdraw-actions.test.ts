import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Address, Hex } from 'viem';

/**
 * The Invest **un-allocate** two-phase server actions (the inverse of deposit).
 *
 * `beginWithdraw` must resolve the signer from the stored credential (never the
 * caller), resolve the vault rail and **pre-flight the Safe's shares** before
 * building anything, then return only `{ token, hash, credentialId, chainId }`
 * — signing nothing. `completeWithdraw` must resolve the same signer and Safe
 * and return the engine's outcome verbatim: success only for a confirmed
 * receipt, every refusal naming its stage. A resident with no session, no
 * stored passkey or no recorded Safe is refused honestly, and an unconfigured
 * chain is refused with the chain named.
 *
 * Every collaborator is mocked, so nothing touches the network, the database or
 * a bundler. The real pre-flight and calldata are covered by
 * `invest-withdraw-execution.test.ts` and `morpho-withdraw.test.ts`.
 */

const hoisted = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  loadPasskeyCredential: vi.fn(),
  parseP256PublicKey: vi.fn(),
  toPasskeySigner: vi.fn(),
  loadShellSafe: vi.fn(),
  deriveAccountFromPasskey: vi.fn(),
  prepareMorphoVaultDeposit: vi.fn(),
  prepareMorphoVaultWithdraw: vi.fn(),
  checkSafeDepositFunding: vi.fn(),
  buildResidentSafeBatchFromEnv: vi.fn(),
  submitResidentSafeOperationFromEnv: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  getSessionUser: hoisted.getSessionUser,
}));
vi.mock('@/app/account/passkey-actions', () => ({
  loadPasskeyCredential: hoisted.loadPasskeyCredential,
}));
vi.mock('@/lib/passkey/public-key', () => ({
  parseP256PublicKey: hoisted.parseP256PublicKey,
}));
vi.mock('@/lib/safe/passkey-signer', () => ({
  toPasskeySigner: hoisted.toPasskeySigner,
}));
vi.mock('@/lib/safe/shell', () => ({
  loadShellSafe: hoisted.loadShellSafe,
}));
vi.mock('@/lib/safe/derive-account', () => ({
  deriveAccountFromPasskey: hoisted.deriveAccountFromPasskey,
}));
vi.mock('@/lib/invest/morpho-execution', () => ({
  prepareMorphoVaultDeposit: hoisted.prepareMorphoVaultDeposit,
  prepareMorphoVaultWithdraw: hoisted.prepareMorphoVaultWithdraw,
}));
vi.mock('@/lib/invest/safe-usdc-balance', () => ({
  checkSafeDepositFunding: hoisted.checkSafeDepositFunding,
}));
vi.mock('@/lib/safe/execute-safe-4337-env', () => ({
  buildResidentSafeBatchFromEnv: hoisted.buildResidentSafeBatchFromEnv,
  submitResidentSafeOperationFromEnv: hoisted.submitResidentSafeOperationFromEnv,
}));

import { beginWithdraw, completeWithdraw } from '@/app/invest/actions';

const SAFE = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed' as Address;
const OTHER_SAFE = '0x9999999999999999999999999999999999999999';
const VAULT = '0x1111222233334444555566667777888899990000' as Address;
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address;
const SAFE_OP_HASH = `0x${'ab'.repeat(32)}` as Hex;
const USER_OP_HASH = `0x${'fe'.repeat(32)}` as Hex;
const TOKEN = 'tok-w1';

const SIGNER = {
  rawId: 'abcdef',
  coordinates: { x: '1', y: '2' },
  verifierAddress: '0x4444444444444444444444444444444444444444',
} as const;

const WITHDRAW_CALL = {
  to: VAULT,
  value: 0n,
  data: '0xbeef' as Hex,
};

const WITHDRAW_PLAN = {
  chainId: 1,
  vault: VAULT,
  usdc: USDC,
  safeAddress: SAFE,
  mode: 'all' as const,
  amountUsdc: null,
  amountUnits: null,
  shareUnits: 5n,
  call: WITHDRAW_CALL,
  calls: [WITHDRAW_CALL],
};

const ASSERTION = {
  authenticatorData: 'AQIDBA',
  signature: 'MAYCAQECAQI',
  clientDataJSON: 'e30',
};

function seedContext(): void {
  hoisted.getSessionUser.mockResolvedValue({
    domain: 'application-session',
    provider: 'email',
    userId: 'user-1',
    email: 'resident@example.com',
  });
  hoisted.loadPasskeyCredential.mockResolvedValue({
    credentialId: 'Y3JlZA',
    publicKey: 'pk-1',
    signerAddress: null,
    transports: ['internal'],
    userVerification: true,
    createdAt: '2026-01-02T03:04:05.000Z',
    lastUsedAt: null,
  });
  hoisted.parseP256PublicKey.mockReturnValue({ x: 1n, y: 2n });
  hoisted.toPasskeySigner.mockReturnValue(SIGNER);
  hoisted.loadShellSafe.mockResolvedValue({
    address: SAFE,
    deployed: false,
    explorerUrl: null,
    status: 'predicted',
  });
  hoisted.deriveAccountFromPasskey.mockResolvedValue({
    safeAddress: SAFE,
    deployed: false,
    chainId: 1,
  });
  hoisted.prepareMorphoVaultWithdraw.mockResolvedValue({
    status: 'ready-to-execute',
    plan: WITHDRAW_PLAN,
    gated: true,
  });
  hoisted.buildResidentSafeBatchFromEnv.mockResolvedValue({
    status: 'built',
    sent: false,
    token: TOKEN,
    hash: SAFE_OP_HASH,
  });
  hoisted.submitResidentSafeOperationFromEnv.mockResolvedValue({
    status: 'sent',
    sent: true,
    userOperationHash: USER_OP_HASH,
    transactionHash: '0xfeed' as Hex,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  seedContext();
});

describe('beginWithdraw', () => {
  it('returns a token + hash + credentialId for a partial amount and signs nothing', async () => {
    const result = await beginWithdraw({
      safeAddress: SAFE,
      amount: { kind: 'partial', amountUsdc: '0.5' },
      chainId: 1,
    });

    expect(result).toEqual({
      status: 'ready',
      token: TOKEN,
      hash: SAFE_OP_HASH,
      credentialId: SIGNER.rawId,
      chainId: 1,
    });

    // The server resolved the vault/rail and pre-flighted the shares itself.
    expect(hoisted.prepareMorphoVaultWithdraw).toHaveBeenCalledWith(
      { safeAddress: SAFE, amount: { kind: 'partial', amountUsdc: '0.5' }, chainId: 1 },
      { railConfigured: expect.any(Boolean) },
    );
    // The single redemption call is handed to the same batch seam as a deposit.
    const buildInput = hoisted.buildResidentSafeBatchFromEnv.mock.calls[0]?.[0];
    expect(buildInput).toEqual({
      signer: SIGNER,
      safeAddress: null,
      calls: [WITHDRAW_CALL],
      chainId: 1,
    });
    expect(hoisted.submitResidentSafeOperationFromEnv).not.toHaveBeenCalled();
  });

  it('builds "all" directly, and never fabricates an amount client-side', async () => {
    const result = await beginWithdraw({
      safeAddress: SAFE,
      amount: { kind: 'all' },
      chainId: 1,
    });

    expect(result.status).toBe('ready');
    expect(hoisted.prepareMorphoVaultWithdraw).toHaveBeenCalledWith(
      { safeAddress: SAFE, amount: { kind: 'all' }, chainId: 1 },
      { railConfigured: expect.any(Boolean) },
    );
  });

  it('refuses before building when the share pre-flight gates', async () => {
    hoisted.prepareMorphoVaultWithdraw.mockResolvedValue({
      status: 'gated',
      gate: 'safe-insufficient-shares',
      reason:
        'The Safe’s MetaMorpho shares are worth 0 USDC on Ethereum, but this ' +
        'un-allocate needs 10 USDC. The Safe does not hold enough shares to ' +
        'cover it — short by 10 USDC.',
      gated: true,
    });

    const result = await beginWithdraw({
      safeAddress: SAFE,
      amount: { kind: 'partial', amountUsdc: '10' },
      chainId: 1,
    });

    expect(result.status).toBe('gated');
    if (result.status === 'gated') {
      expect(result.gate).toBe('safe-insufficient-shares');
      expect(result.reason).toMatch(/short by 10 USDC/);
    }
    // The whole point: nothing was built, so nothing could reach the bundler.
    expect(hoisted.buildResidentSafeBatchFromEnv).not.toHaveBeenCalled();
  });

  it('refuses an unreadable share balance before building', async () => {
    hoisted.prepareMorphoVaultWithdraw.mockResolvedValue({
      status: 'gated',
      gate: 'safe-shares-unreadable',
      reason:
        'The Safe’s MetaMorpho share balance on Ethereum could not be read, so ' +
        'the un-allocate was not built: RPC timed out.',
      gated: true,
    });

    const result = await beginWithdraw({
      safeAddress: SAFE,
      amount: { kind: 'all' },
      chainId: 1,
    });

    expect(result.status).toBe('gated');
    if (result.status === 'gated') {
      expect(result.gate).toBe('safe-shares-unreadable');
      expect(result.reason).toMatch(/RPC timed out/);
    }
    expect(hoisted.buildResidentSafeBatchFromEnv).not.toHaveBeenCalled();
  });

  it('passes an unconfigured-chain gate through without building', async () => {
    hoisted.prepareMorphoVaultWithdraw.mockResolvedValue({
      status: 'gated',
      gate: 'vault-not-configured',
      reason:
        'No MetaMorpho vault is configured for chain 84532. Nothing was built, ' +
        'and no other chain’s vault is substituted.',
      gated: true,
    });

    const result = await beginWithdraw({
      safeAddress: SAFE,
      amount: { kind: 'partial', amountUsdc: '10' },
      chainId: 84532,
    });

    expect(result.status).toBe('gated');
    if (result.status === 'gated') {
      expect(result.gate).toBe('vault-not-configured');
      expect(result.reason).toContain('84532');
    }
    expect(hoisted.buildResidentSafeBatchFromEnv).not.toHaveBeenCalled();
  });

  it('refuses a Safe that is not the one recorded for the account', async () => {
    const result = await beginWithdraw({
      safeAddress: OTHER_SAFE,
      amount: { kind: 'all' },
      chainId: 1,
    });

    expect(result.status).toBe('gated');
    if (result.status === 'gated') expect(result.gate).toBe('safe-mismatch');
    expect(hoisted.prepareMorphoVaultWithdraw).not.toHaveBeenCalled();
    expect(hoisted.buildResidentSafeBatchFromEnv).not.toHaveBeenCalled();
  });

  it('refuses honestly when there is no stored passkey', async () => {
    hoisted.loadPasskeyCredential.mockResolvedValue(null);

    const result = await beginWithdraw({
      safeAddress: SAFE,
      amount: { kind: 'all' },
      chainId: 1,
    });

    expect(result.status).toBe('gated');
    if (result.status === 'gated') {
      expect(result.gate).toBe('not-authenticated');
      expect(result.reason).toMatch(/passkey/i);
    }
    expect(hoisted.buildResidentSafeBatchFromEnv).not.toHaveBeenCalled();
  });

  it('maps an engine build failure to a gated outcome naming the stage', async () => {
    hoisted.buildResidentSafeBatchFromEnv.mockResolvedValue({
      status: 'failed',
      sent: false,
      stage: 'create',
      reason: 'The Safe operation could not be built: boom',
    });

    const result = await beginWithdraw({
      safeAddress: SAFE,
      amount: { kind: 'all' },
      chainId: 1,
    });

    expect(result.status).toBe('gated');
    if (result.status === 'gated') {
      expect(result.gate).toBe('build-create');
      expect(result.reason).toBe('The Safe operation could not be built: boom');
    }
  });
});

describe('completeWithdraw', () => {
  it('submits the retained operation and reports a confirmed send', async () => {
    const result = await completeWithdraw({
      token: TOKEN,
      assertion: ASSERTION,
      chainId: 1,
    });

    expect(result).toEqual({
      status: 'sent',
      sent: true,
      userOperationHash: USER_OP_HASH,
      transactionHash: '0xfeed',
    });
    expect(hoisted.submitResidentSafeOperationFromEnv).toHaveBeenCalledWith({
      token: TOKEN,
      assertion: ASSERTION,
      signer: SIGNER,
      safeAddress: null,
      chainId: 1,
    });
  });

  it('refuses a chain with no pinned vault rather than defaulting a network', async () => {
    const result = await completeWithdraw({
      token: TOKEN,
      assertion: ASSERTION,
      chainId: 84532,
    });

    expect(result).toMatchObject({ status: 'failed', sent: false, stage: 'resolve' });
    if (result.status === 'failed') {
      expect(result.reason).toContain('84532');
    }
    expect(hoisted.submitResidentSafeOperationFromEnv).not.toHaveBeenCalled();
    expect(hoisted.deriveAccountFromPasskey).not.toHaveBeenCalled();
  });

  it('returns an engine refusal verbatim, naming its stage', async () => {
    hoisted.submitResidentSafeOperationFromEnv.mockResolvedValue({
      status: 'failed',
      sent: false,
      stage: 'sign',
      reason: 'The passkey attached no signature to the operation.',
    });

    const result = await completeWithdraw({
      token: TOKEN,
      assertion: ASSERTION,
      chainId: 1,
    });

    expect(result).toEqual({
      status: 'failed',
      sent: false,
      stage: 'sign',
      reason: 'The passkey attached no signature to the operation.',
    });
  });
});
