import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Address, Hex } from 'viem';

/**
 * `deployAccount` is the seam between the deployment engine and the screen.
 *
 * These tests pin three things the brief calls out:
 *
 *   1. the reported status distinguishes the failure modes, so a resident is
 *      told the truth instead of one opaque "unavailable";
 *   2. the diagnostic (which names configuration) stays in the server log and
 *      never crosses the serialisation boundary to the browser;
 *   3. the ordering guarantee holds: the prediction is persisted before the
 *      engine is asked to send anything, and a failed prediction sends nothing.
 *
 * The engine and every server dependency are mocked, so these are about the
 * wiring, not the chain.
 */

const hoisted = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  loadPasskeyCredential: vi.fn(),
  readSepoliaRpcUrl: vi.fn(),
  deriveAccount: vi.fn(),
  parseP256PublicKey: vi.fn(),
  readContract: vi.fn(),
  safeDeploymentStore: vi.fn(),
  deployResidentSafeFromEnv: vi.fn(),
}));

// Only the client constructor is replaced; `getAddress`/`keccak256` stay real so
// the action builds the same manifest it would in production.
vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    createPublicClient: () => ({ readContract: hoisted.readContract }),
  };
});
vi.mock('@/lib/env', () => ({
  readSepoliaRpcUrl: hoisted.readSepoliaRpcUrl,
}));
vi.mock('@/lib/supabase/server', () => ({
  getSessionUser: hoisted.getSessionUser,
}));
vi.mock('@/lib/safe/manifest', () => ({
  safeDeploymentStore: hoisted.safeDeploymentStore,
}));
vi.mock('@/lib/safe/deploy', () => ({
  deployResidentSafeFromEnv: hoisted.deployResidentSafeFromEnv,
}));
vi.mock('@/app/account/passkey-actions', () => ({
  loadPasskeyCredential: hoisted.loadPasskeyCredential,
}));
vi.mock('@/app/onboarding/signer-actions', () => ({
  deriveAccount: hoisted.deriveAccount,
}));
vi.mock('@/lib/passkey/public-key', () => ({
  parseP256PublicKey: hoisted.parseP256PublicKey,
}));

import { deployAccount } from '@/app/onboarding/deploy-actions';

const USER = 'user-1';
const SAFE = '0x1111111111111111111111111111111111111111' as Address;
const SIGNER = '0x2222222222222222222222222222222222222222' as Address;
const PAYER = '0x3333333333333333333333333333333333333333' as Address;
const TX_HASH = `0x${'ab'.repeat(32)}` as Hex;
const CREATION_CODE = '0x6001600055' as Hex;

interface FakeStore {
  readonly recordPrediction: ReturnType<typeof vi.fn>;
  readonly recordDeployment: ReturnType<typeof vi.fn>;
  readonly recordDeploymentFailure: ReturnType<typeof vi.fn>;
  readonly getByAddress: ReturnType<typeof vi.fn>;
  readonly getForProfile: ReturnType<typeof vi.fn>;
}

function makeStore(): FakeStore {
  return {
    recordPrediction: vi.fn().mockResolvedValue({}),
    recordDeployment: vi.fn().mockResolvedValue({}),
    recordDeploymentFailure: vi.fn().mockResolvedValue({}),
    getByAddress: vi.fn().mockResolvedValue(null),
    getForProfile: vi.fn().mockResolvedValue(null),
  };
}

let store: FakeStore;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  store = makeStore();

  hoisted.getSessionUser.mockResolvedValue({
    domain: 'application-session',
    provider: 'email',
    userId: USER,
    email: 'resident@example.com',
  });
  hoisted.loadPasskeyCredential.mockResolvedValue({
    credentialId: 'cred-1',
    publicKey: 'pk-1',
    signerAddress: SIGNER,
    transports: ['internal'],
    userVerification: true,
    createdAt: '2026-01-02T03:04:05.000Z',
    lastUsedAt: null,
  });
  hoisted.readSepoliaRpcUrl.mockReturnValue('http://127.0.0.1:8545');
  hoisted.parseP256PublicKey.mockReturnValue({ x: 1n, y: 2n });
  hoisted.deriveAccount.mockResolvedValue({
    signerAddress: SIGNER,
    safeAddress: SAFE,
  });
  hoisted.readContract.mockResolvedValue(CREATION_CODE);
  hoisted.safeDeploymentStore.mockReturnValue(store);
});

describe('deployAccount status reporting', () => {
  it('reports a verified deployment and records its transaction', async () => {
    hoisted.deployResidentSafeFromEnv.mockResolvedValue({
      status: 'deployed',
      safeAddress: SAFE,
      txHash: TX_HASH,
      blockNumber: 42n,
      owners: [SIGNER],
      threshold: 1,
    });

    const result = await deployAccount();

    expect(result).toEqual({
      status: 'deployed',
      safeAddress: SAFE,
      txHash: TX_HASH,
    });
    expect(store.recordDeployment).toHaveBeenCalledWith({
      profileId: USER,
      safeAddress: SAFE,
      deploymentTxHash: TX_HASH,
    });
  });

  it('reconciles the record when the Safe is already on chain, without erasing a hash', async () => {
    hoisted.deployResidentSafeFromEnv.mockResolvedValue({
      status: 'already-deployed',
      safeAddress: SAFE,
      owners: [SIGNER],
      threshold: 1,
    });

    const result = await deployAccount();

    expect(result).toEqual({ status: 'already-deployed', safeAddress: SAFE });
    // A null hash marks the row deployed; the store keeps any hash already there.
    expect(store.recordDeployment).toHaveBeenCalledWith({
      profileId: USER,
      safeAddress: SAFE,
      deploymentTxHash: null,
    });
  });

  it('distinguishes not-configured, insufficient funds, mismatch and failure', async () => {
    const cases = [
      {
        engine: {
          status: 'not-configured' as const,
          reason: 'SEPOLIA_DEPLOYER_PRIVATE_KEY is not set',
        },
        expected: 'not-configured',
        recordsFailure: false,
      },
      {
        engine: {
          status: 'insufficient-funds' as const,
          safeAddress: SAFE,
          payer: PAYER,
          required: 1_000n,
          available: 1n,
        },
        expected: 'insufficient-funds',
        recordsFailure: true,
      },
      {
        engine: {
          status: 'address-mismatch' as const,
          safeAddress: SAFE,
          derived: PAYER,
          reason: 'inputs derive another address',
        },
        expected: 'address-mismatch',
        recordsFailure: true,
      },
      {
        engine: {
          status: 'failed' as const,
          safeAddress: SAFE,
          stage: 'send' as const,
          reason: 'the transaction could not be sent',
        },
        expected: 'failed',
        recordsFailure: true,
      },
    ];

    for (const { engine, expected, recordsFailure } of cases) {
      vi.clearAllMocks();
      store = makeStore();
      hoisted.safeDeploymentStore.mockReturnValue(store);
      hoisted.deployResidentSafeFromEnv.mockResolvedValue(engine);

      const result = await deployAccount();

      expect(result.status).toBe(expected);
      if (recordsFailure) {
        expect(store.recordDeploymentFailure).toHaveBeenCalledTimes(1);
      } else {
        expect(store.recordDeploymentFailure).not.toHaveBeenCalled();
      }
    }
  });

  it('never serialises a configuration name or a technical reason to the caller', async () => {
    hoisted.deployResidentSafeFromEnv.mockResolvedValue({
      status: 'not-configured',
      reason:
        'SEPOLIA_DEPLOYER_PRIVATE_KEY is not set (or is not a 32-byte hex key), ' +
        'so no payer account exists.',
    });

    const result = await deployAccount();
    const serialised = JSON.stringify(result);

    expect(result.status).toBe('not-configured');
    expect(serialised).not.toMatch(/SEPOLIA/);
    expect(serialised).not.toMatch(/PRIVATE_KEY/);
    expect(serialised).not.toMatch(/payer account/);
    // The detail is not dropped: it is logged for diagnosis.
    expect(console.warn).toHaveBeenCalled();
  });

  it('reports a precondition failure without pretending a deployment happened', async () => {
    hoisted.getSessionUser.mockResolvedValue(null);
    expect((await deployAccount()).status).toBe('unavailable');

    vi.clearAllMocks();
    hoisted.getSessionUser.mockResolvedValue({
      domain: 'application-session',
      provider: 'email',
      userId: USER,
      email: 'resident@example.com',
    });
    hoisted.loadPasskeyCredential.mockResolvedValue(null);
    expect((await deployAccount()).status).toBe('unavailable');

    vi.clearAllMocks();
    hoisted.getSessionUser.mockResolvedValue({
      domain: 'application-session',
      provider: 'email',
      userId: USER,
      email: 'resident@example.com',
    });
    hoisted.loadPasskeyCredential.mockResolvedValue({
      credentialId: 'cred-1',
      publicKey: 'pk-1',
      signerAddress: null,
      transports: ['internal'],
      userVerification: true,
      createdAt: '2026-01-02T03:04:05.000Z',
      lastUsedAt: null,
    });
    hoisted.readSepoliaRpcUrl.mockReturnValue(null);
    expect((await deployAccount()).status).toBe('not-configured');
  });
});

describe('deployAccount ordering guarantee', () => {
  it('persists the prediction before the engine is asked to deploy', async () => {
    hoisted.deployResidentSafeFromEnv.mockResolvedValue({
      status: 'deployed',
      safeAddress: SAFE,
      txHash: TX_HASH,
      blockNumber: 42n,
      owners: [SIGNER],
      threshold: 1,
    });

    await deployAccount();

    expect(store.recordPrediction).toHaveBeenCalledTimes(1);
    const predicted = store.recordPrediction.mock.invocationCallOrder[0] as number;
    const deployed = hoisted.deployResidentSafeFromEnv.mock
      .invocationCallOrder[0] as number;
    expect(predicted).toBeLessThan(deployed);
    expect(store.recordPrediction).toHaveBeenCalledWith(
      expect.objectContaining({ profileId: USER, safeAddress: SAFE }),
    );
  });

  it('sends nothing when the prediction cannot be persisted', async () => {
    store.recordPrediction.mockRejectedValue(new Error('service role absent'));
    hoisted.deployResidentSafeFromEnv.mockResolvedValue({
      status: 'deployed',
      safeAddress: SAFE,
      txHash: TX_HASH,
      blockNumber: 42n,
      owners: [SIGNER],
      threshold: 1,
    });

    const result = await deployAccount();

    expect(result.status).toBe('failed');
    expect(hoisted.deployResidentSafeFromEnv).not.toHaveBeenCalled();
    expect(store.recordDeployment).not.toHaveBeenCalled();
  });

  it('is retryable: a failed attempt can be followed by a successful one', async () => {
    hoisted.deployResidentSafeFromEnv
      .mockResolvedValueOnce({
        status: 'insufficient-funds',
        safeAddress: SAFE,
        payer: PAYER,
        required: 1_000n,
        available: 1n,
      })
      .mockResolvedValueOnce({
        status: 'deployed',
        safeAddress: SAFE,
        txHash: TX_HASH,
        blockNumber: 42n,
        owners: [SIGNER],
        threshold: 1,
      });

    const first = await deployAccount();
    const second = await deployAccount();

    expect(first.status).toBe('insufficient-funds');
    expect(second.status).toBe('deployed');
    // The retry re-predicts the same deterministic address and deploys again; it
    // never creates a second passkey or a second account.
    expect(store.recordPrediction).toHaveBeenCalledTimes(2);
    expect(store.recordDeployment).toHaveBeenCalledTimes(1);
  });
});
