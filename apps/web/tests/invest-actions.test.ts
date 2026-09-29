import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Address, Hex } from 'viem';

/**
 * The Invest two-phase server actions (D18 / EXE-014).
 *
 * `beginDeposit` must resolve the signer from the **stored credential** (never
 * from the caller), build the deposit through the existing plan builder, and
 * return only `{ token, hash, credentialId }` — signing nothing. `completeDeposit`
 * must resolve the same signer and Safe and return the engine's outcome
 * verbatim: success only for a confirmed receipt, every refusal naming its
 * stage. A resident with no session, no stored passkey or no recorded Safe is
 * refused honestly.
 *
 * Every collaborator is mocked, so nothing touches the network, the database or
 * a bundler.
 */

const hoisted = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  loadPasskeyCredential: vi.fn(),
  parseP256PublicKey: vi.fn(),
  toPasskeySigner: vi.fn(),
  loadShellSafe: vi.fn(),
  deriveAccountFromPasskey: vi.fn(),
  prepareMorphoVaultDeposit: vi.fn(),
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
}));
vi.mock('@/lib/invest/safe-usdc-balance', () => ({
  checkSafeDepositFunding: hoisted.checkSafeDepositFunding,
}));
vi.mock('@/lib/safe/execute-safe-4337-env', () => ({
  buildResidentSafeBatchFromEnv: hoisted.buildResidentSafeBatchFromEnv,
  submitResidentSafeOperationFromEnv: hoisted.submitResidentSafeOperationFromEnv,
}));

import { beginDeposit, completeDeposit } from '@/app/invest/actions';

const SAFE = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed' as Address;
const OTHER_SAFE = '0x9999999999999999999999999999999999999999';
const VAULT = '0x1111222233334444555566667777888899990000' as Address;
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address;
const SAFE_OP_HASH = `0x${'ab'.repeat(32)}` as Hex;
const USER_OP_HASH = `0x${'fe'.repeat(32)}` as Hex;
const TOKEN = 'tok-1';

const SIGNER = {
  rawId: 'abcdef',
  coordinates: { x: '1', y: '2' },
  verifierAddress: '0x4444444444444444444444444444444444444444',
} as const;

const CALLS = [
  { to: '0xaaaa000000000000000000000000000000000001' as Address, value: 0n, data: '0xdead' as Hex },
  { to: '0xaaaa000000000000000000000000000000000002' as Address, value: 0n, data: '0xbeef' as Hex },
];

const PLAN = {
  chainId: 1,
  vault: VAULT,
  usdc: USDC,
  safeAddress: SAFE,
  amountUsdc: '25000',
  amountUnits: 25_000_000_000n,
  approve: CALLS[0],
  deposit: CALLS[1],
  calls: CALLS,
};

const ASSERTION = {
  authenticatorData: 'AQIDBA',
  signature: 'MAYCAQECAQI',
  clientDataJSON: 'e30',
};

function seedHappyPath(): void {
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
  hoisted.prepareMorphoVaultDeposit.mockResolvedValue({
    status: 'ready-to-execute',
    plan: PLAN,
    gated: true,
  });
  hoisted.checkSafeDepositFunding.mockResolvedValue({
    ok: true,
    balance: 25_000_000_000n,
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

const BEGIN_INPUT = {
  safeAddress: SAFE,
  amountUsdc: '25000',
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  seedHappyPath();
});

describe('beginDeposit', () => {
  it('returns a token + hash + credentialId and signs nothing', async () => {
    const result = await beginDeposit(BEGIN_INPUT);

    expect(result).toEqual({
      status: 'ready',
      token: TOKEN,
      hash: SAFE_OP_HASH,
      credentialId: SIGNER.rawId,
    });

    // The signer is built from the stored credential, with no `getFn`: the
    // browser owns the assertion, which is the whole point of the split.
    expect(hoisted.toPasskeySigner).toHaveBeenCalledTimes(1);
    expect(hoisted.toPasskeySigner.mock.calls[0]).toHaveLength(1);

    const buildInput = hoisted.buildResidentSafeBatchFromEnv.mock.calls[0]?.[0];
    expect(buildInput).toEqual({
      signer: SIGNER,
      // Not deployed on the deposit chain, so the predicted branch is used; the
      // calls themselves still target the verified SAFE address.
      safeAddress: null,
      calls: CALLS,
      chainId: 1,
    });
    // The deposit-chain state is read, not assumed from the record.
    expect(hoisted.deriveAccountFromPasskey).toHaveBeenCalledWith(SIGNER, {
      chainId: 1,
    });
    // Building retains the operation; it never submits.
    expect(hoisted.submitResidentSafeOperationFromEnv).not.toHaveBeenCalled();
  });

  it('uses the predicted Safe when it is not deployed on the deposit chain', async () => {
    hoisted.deriveAccountFromPasskey.mockResolvedValue({
      safeAddress: SAFE,
      deployed: false,
      chainId: 1,
    });

    const result = await beginDeposit(BEGIN_INPUT);

    expect(result.status).toBe('ready');
    const buildInput = hoisted.buildResidentSafeBatchFromEnv.mock.calls[0]?.[0];
    // `safeAddress: null` selects the SDK's predicted branch (`owners`/
    // `threshold`), so the first user operation deploys the Safe, sponsored.
    expect(buildInput.safeAddress).toBeNull();
    // The calls still target the verified recorded address, not the derived
    // object's identity.
    expect(buildInput.calls).toEqual(CALLS);
  });

  it('uses the existing Safe when it is deployed on the deposit chain', async () => {
    hoisted.deriveAccountFromPasskey.mockResolvedValue({
      safeAddress: SAFE,
      deployed: true,
      chainId: 1,
    });

    const result = await beginDeposit(BEGIN_INPUT);

    expect(result.status).toBe('ready');
    const buildInput = hoisted.buildResidentSafeBatchFromEnv.mock.calls[0]?.[0];
    expect(buildInput.safeAddress).toBe(SAFE);
  });

  it('refuses when the derived Safe is not the recorded one', async () => {
    // Fail closed: the derived address is what the passkey controls on the
    // deposit chain, and it must match the recorded target before anything is
    // built. A mismatch means funds could go to an address that is not the
    // resident's Safe, so the deposit stops here.
    hoisted.deriveAccountFromPasskey.mockResolvedValue({
      safeAddress: OTHER_SAFE,
      deployed: false,
      chainId: 1,
    });

    const result = await beginDeposit(BEGIN_INPUT);

    expect(result.status).toBe('gated');
    if (result.status === 'gated') {
      expect(result.gate).toBe('safe-not-verified');
      expect(result.reason).toMatch(/not the Safe recorded/i);
    }
    expect(hoisted.buildResidentSafeBatchFromEnv).not.toHaveBeenCalled();
    // The funding check is additional to the existing fail-closed gate and
    // never replaces it: a Safe that is not the recorded one is refused before
    // any balance is read.
    expect(hoisted.checkSafeDepositFunding).not.toHaveBeenCalled();
  });

  it('refuses an under-funded Safe before building the user operation', async () => {
    // The deposit batches `approve` + `deposit` for 1 USDC against a Safe that
    // holds nothing. The operation could never succeed, so it must never be
    // built: the funding check refuses first and the build seam is not reached.
    hoisted.prepareMorphoVaultDeposit.mockResolvedValue({
      status: 'ready-to-execute',
      plan: { ...PLAN, amountUsdc: '1', amountUnits: 1_000_000n },
      gated: true,
    });
    hoisted.checkSafeDepositFunding.mockResolvedValue({
      ok: false,
      gate: 'safe-insufficient-usdc',
      reason:
        'The Safe holds 0 USDC on Ethereum, but this deposit needs 1 USDC. ' +
        'Move at least 1 USDC into the Safe before allocating.',
    });

    const result = await beginDeposit({ ...BEGIN_INPUT, amountUsdc: '1' });

    expect(result.status).toBe('gated');
    if (result.status === 'gated') {
      expect(result.gate).toBe('safe-insufficient-usdc');
      expect(result.reason).toMatch(/holds 0 USDC on Ethereum/);
      expect(result.reason).toMatch(/needs 1 USDC/);
    }
    // The whole point: nothing was built, so nothing could reach the bundler.
    expect(hoisted.buildResidentSafeBatchFromEnv).not.toHaveBeenCalled();
    // The check reads the Safe and the USDC the plan already targets, on the
    // plan's chain, for the plan's amount.
    expect(hoisted.checkSafeDepositFunding).toHaveBeenCalledWith({
      safeAddress: SAFE,
      usdc: USDC,
      chainId: 1,
      chainName: 'Ethereum',
      amountUnits: 1_000_000n,
    });
  });

  it('refuses with the real reason when the Safe balance cannot be read', async () => {
    // A read failure is not a pass and is not a zero: it must refuse, and the
    // reason must carry the real read failure rather than a fabricated figure.
    hoisted.checkSafeDepositFunding.mockResolvedValue({
      ok: false,
      gate: 'safe-balance-unreadable',
      reason:
        "The Safe's USDC balance on Ethereum could not be read, so the deposit " +
        'was not built: the balance read failed: RPC timed out.',
    });

    const result = await beginDeposit(BEGIN_INPUT);

    expect(result.status).toBe('gated');
    if (result.status === 'gated') {
      expect(result.gate).toBe('safe-balance-unreadable');
      expect(result.reason).toMatch(/could not be read/);
      expect(result.reason).toMatch(/RPC timed out/);
    }
    expect(hoisted.buildResidentSafeBatchFromEnv).not.toHaveBeenCalled();
  });

  it('proceeds to build only after the Safe is confirmed to hold enough', async () => {
    hoisted.checkSafeDepositFunding.mockResolvedValue({
      ok: true,
      balance: 25_000_000_000n,
    });

    const result = await beginDeposit(BEGIN_INPUT);

    expect(result.status).toBe('ready');
    expect(hoisted.checkSafeDepositFunding).toHaveBeenCalledTimes(1);
    expect(hoisted.buildResidentSafeBatchFromEnv).toHaveBeenCalledTimes(1);
  });

  it('refuses honestly when the deposit-chain Safe cannot be resolved', async () => {
    hoisted.deriveAccountFromPasskey.mockRejectedValue(
      new Error('ETHEREUM_RPC_URL is not set, so the bundler cannot be reached.'),
    );

    const result = await beginDeposit(BEGIN_INPUT);

    expect(result.status).toBe('gated');
    if (result.status === 'gated') {
      expect(result.gate).toBe('safe-not-resolved');
      expect(result.reason).toMatch(/ETHEREUM_RPC_URL/);
    }
    expect(hoisted.buildResidentSafeBatchFromEnv).not.toHaveBeenCalled();
  });

  it('resolves the mainnet gate from the environment, not the caller', async () => {
    const previous = {
      rpc: process.env.ETHEREUM_RPC_URL,
      vault: process.env.KADE_MORPHO_VAULT_ADDRESS,
      usdc: process.env.KADE_MORPHO_USDC_ADDRESS,
    };
    try {
      // The rail is judged on its own two pieces — a complete vault
      // configuration and the reserved mainnet RPC — so both are set here and
      // only the RPC is varied. The value is never taken from the caller.
      process.env.KADE_MORPHO_VAULT_ADDRESS = VAULT;
      process.env.KADE_MORPHO_USDC_ADDRESS = USDC;

      delete process.env.ETHEREUM_RPC_URL;
      await beginDeposit(BEGIN_INPUT);
      expect(hoisted.prepareMorphoVaultDeposit).toHaveBeenLastCalledWith(
        { safeAddress: SAFE, amountUsdc: '25000' },
        { mainnetConfigured: false },
      );

      process.env.ETHEREUM_RPC_URL = 'https://mainnet.example';
      await beginDeposit(BEGIN_INPUT);
      expect(hoisted.prepareMorphoVaultDeposit).toHaveBeenLastCalledWith(
        { safeAddress: SAFE, amountUsdc: '25000' },
        { mainnetConfigured: true },
      );
    } finally {
      const restore = (key: string, value: string | undefined) => {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      };
      restore('ETHEREUM_RPC_URL', previous.rpc);
      restore('KADE_MORPHO_VAULT_ADDRESS', previous.vault);
      restore('KADE_MORPHO_USDC_ADDRESS', previous.usdc);
    }
  });

  it('refuses honestly when the resident has no stored passkey', async () => {
    hoisted.loadPasskeyCredential.mockResolvedValue(null);

    const result = await beginDeposit(BEGIN_INPUT);

    expect(result.status).toBe('gated');
    if (result.status === 'gated') {
      expect(result.gate).toBe('not-authenticated');
      expect(result.reason).toMatch(/passkey/i);
    }
    expect(hoisted.buildResidentSafeBatchFromEnv).not.toHaveBeenCalled();
  });

  it('refuses honestly when there is no session', async () => {
    hoisted.getSessionUser.mockResolvedValue(null);

    const result = await beginDeposit(BEGIN_INPUT);

    expect(result.status).toBe('gated');
    if (result.status === 'gated') expect(result.gate).toBe('not-authenticated');
  });

  it('refuses honestly when no Safe is recorded for the account', async () => {
    hoisted.loadShellSafe.mockResolvedValue({
      address: null,
      deployed: false,
      explorerUrl: null,
      status: null,
    });

    const result = await beginDeposit(BEGIN_INPUT);

    expect(result.status).toBe('gated');
    if (result.status === 'gated') {
      expect(result.gate).toBe('not-authenticated');
      expect(result.reason).toMatch(/safe/i);
    }
  });

  it('refuses a Safe that is not the one recorded for the account', async () => {
    const result = await beginDeposit({ ...BEGIN_INPUT, safeAddress: OTHER_SAFE });

    expect(result.status).toBe('gated');
    if (result.status === 'gated') expect(result.gate).toBe('safe-mismatch');
    expect(hoisted.buildResidentSafeBatchFromEnv).not.toHaveBeenCalled();
  });

  it('passes the vault/mainnet gates through without building', async () => {
    hoisted.prepareMorphoVaultDeposit.mockResolvedValue({
      status: 'gated',
      gate: 'mainnet-not-configured',
      reason: 'The Ethereum-mainnet rail is not configured (no RPC/payer).',
      gated: true,
    });

    const result = await beginDeposit(BEGIN_INPUT);

    expect(result).toEqual({
      status: 'gated',
      gate: 'mainnet-not-configured',
      reason: 'The Ethereum-mainnet rail is not configured (no RPC/payer).',
    });
    expect(hoisted.buildResidentSafeBatchFromEnv).not.toHaveBeenCalled();
  });

  it('maps an engine build failure to a gated outcome naming the stage', async () => {
    hoisted.buildResidentSafeBatchFromEnv.mockResolvedValue({
      status: 'failed',
      sent: false,
      stage: 'create',
      reason: 'The Safe operation could not be built: boom',
    });

    const result = await beginDeposit(BEGIN_INPUT);

    expect(result.status).toBe('gated');
    if (result.status === 'gated') {
      expect(result.gate).toBe('build-create');
      expect(result.reason).toBe('The Safe operation could not be built: boom');
    }
  });
});

describe('completeDeposit', () => {
  it('submits the retained operation and reports a confirmed send', async () => {
    const result = await completeDeposit({ token: TOKEN, assertion: ASSERTION });

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
      // Not deployed on the deposit chain, so the predicted branch is used.
      safeAddress: null,
      chainId: 1,
    });
  });

  it('refuses at the resolve stage when the deposit-chain Safe does not match', async () => {
    hoisted.deriveAccountFromPasskey.mockResolvedValue({
      safeAddress: OTHER_SAFE,
      deployed: false,
      chainId: 1,
    });

    const result = await completeDeposit({ token: TOKEN, assertion: ASSERTION });

    expect(result).toMatchObject({ status: 'failed', sent: false, stage: 'resolve' });
    expect(hoisted.submitResidentSafeOperationFromEnv).not.toHaveBeenCalled();
  });

  it('returns an engine refusal verbatim, naming its stage', async () => {
    hoisted.submitResidentSafeOperationFromEnv.mockResolvedValue({
      status: 'failed',
      sent: false,
      stage: 'sign',
      reason: 'The passkey attached no signature to the operation.',
    });

    const result = await completeDeposit({ token: TOKEN, assertion: ASSERTION });

    expect(result).toEqual({
      status: 'failed',
      sent: false,
      stage: 'sign',
      reason: 'The passkey attached no signature to the operation.',
    });
  });

  it('refuses before the engine when there is no stored passkey', async () => {
    hoisted.loadPasskeyCredential.mockResolvedValue(null);

    const result = await completeDeposit({ token: TOKEN, assertion: ASSERTION });

    expect(result).toEqual({
      status: 'failed',
      sent: false,
      stage: 'resolve',
      reason: expect.stringMatching(/passkey/i),
    });
    expect(hoisted.submitResidentSafeOperationFromEnv).not.toHaveBeenCalled();
  });

  it('refuses before the engine when there is no session', async () => {
    hoisted.getSessionUser.mockResolvedValue(null);

    const result = await completeDeposit({ token: TOKEN, assertion: ASSERTION });

    expect(result).toMatchObject({ status: 'failed', sent: false, stage: 'resolve' });
    expect(hoisted.submitResidentSafeOperationFromEnv).not.toHaveBeenCalled();
  });
});
