import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Address, Hex } from 'viem';
import type { PasskeySigner } from '@/lib/safe/passkey-signer';

/**
 * The environment-wired two-phase seams.
 *
 * The SDK is mocked at the module seam, so no bundler and no network are
 * touched. Beyond proving the wrappers wire `initSafe4337Pack`, this pins the
 * inputs that determine the counterfactual Safe address: the owner is the
 * signer's verifier-derived address verbatim and the threshold is 1. Changing
 * either would move the address recorded for existing residents.
 */

const hoisted = vi.hoisted(() => ({
  init: vi.fn(),
  createBundlerClient: vi.fn(() => ({})),
  safeInit: vi.fn(),
  constructed: [] as unknown[],
  packMethods: {} as Record<string, unknown>,
}));

vi.mock('@safe-global/relay-kit', () => {
  class Safe4337Pack {
    static init = hoisted.init;
    constructor(options: unknown) {
      hoisted.constructed.push(options);
      Object.assign(this, hoisted.packMethods);
    }
  }
  return { Safe4337Pack, createBundlerClient: hoisted.createBundlerClient };
});

vi.mock('@safe-global/protocol-kit', () => ({
  default: { init: hoisted.safeInit },
}));

import {
  buildResidentSafeBatchFromEnv,
  submitResidentSafeOperationFromEnv,
} from '@/lib/safe/execute-safe-4337-env';

const SAFE_OP_HASH = `0x${'ab'.repeat(32)}` as Hex;
const USER_OP_HASH = `0x${'fe'.repeat(32)}` as Hex;
const SIGNATURE = '0xdeadbeef' as Hex;

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

const ASSERTION = {
  authenticatorData: 'AQIDBA',
  signature: 'MAYCAQECAQI',
  clientDataJSON: 'e30',
};

const ENV_KEYS = [
  'SEPOLIA_RPC_URL',
  'ETHEREUM_RPC_URL',
  'PIMLICO_API_KEY',
  'PIMLICO_POLICY_ID',
] as const;

const ORIGINAL_ENV = { ...process.env };

interface InitInput {
  readonly options: {
    readonly owners: readonly string[];
    readonly threshold: number;
    readonly saltNonce?: string;
  };
}

/** A relay-kit seed exposing the predicted config the create path pins. */
const SEED = {
  protocolKit: {
    getPredictedSafe: () => ({
      safeAccountConfig: {
        owners: [SIGNER.verifierAddress, '0x94a4F6affBd8975951142c3999aEAB7ecee555c2'],
        threshold: 1,
        fallbackHandler: '0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226',
      },
      safeDeploymentConfig: { safeVersion: '1.4.1', saltNonce: '0' },
    }),
  },
};

function fakePack(): {
  createTransaction: Mock;
  signSafeOperation: Mock;
  executeTransaction: Mock;
  getUserOperationReceipt: Mock;
} {
  const retained = { getHash: () => SAFE_OP_HASH };
  return {
    createTransaction: vi.fn(async () => retained),
    signSafeOperation: vi.fn(async () => ({ encodedSignatures: () => SIGNATURE })),
    executeTransaction: vi.fn(async () => USER_OP_HASH),
    getUserOperationReceipt: vi.fn(async () => ({
      receipt: { status: 'success', transactionHash: '0xfeed' as Hex },
    })),
  };
}

beforeEach(() => {
  hoisted.init.mockReset();
  hoisted.init.mockResolvedValue(SEED);
  hoisted.safeInit.mockReset();
  hoisted.safeInit.mockResolvedValue({});
  hoisted.constructed.length = 0;
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.SEPOLIA_RPC_URL = 'https://sepolia.example';
  process.env.PIMLICO_API_KEY = 'pim_test';
  process.env.PIMLICO_POLICY_ID = 'sp_test';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('the environment-wired split', () => {
  it('builds and submits through initSafe4337Pack, keeping the Safe inputs fixed', async () => {
    const pack = fakePack();
    // The create path returns the pack assembled by the public constructor, so
    // the fake methods are what the constructor's instance carries.
    hoisted.packMethods = pack;

    const built = await buildResidentSafeBatchFromEnv({
      signer: SIGNER,
      safeAddress: null,
      calls: CALLS,
    });
    expect(built.status).toBe('built');
    if (built.status !== 'built') return;
    expect(built.hash).toBe(SAFE_OP_HASH);

    const initInput = hoisted.init.mock.calls[0]?.[0] as InitInput;
    // The owner set and threshold are what the counterfactual address is
    // derived from; they must not move.
    expect(initInput.options.owners).toEqual([SIGNER.verifierAddress]);
    expect(initInput.options.threshold).toBe(1);

    const submitted = await submitResidentSafeOperationFromEnv({
      token: built.token,
      assertion: ASSERTION,
      signer: SIGNER,
      safeAddress: null,
    });

    expect(submitted.status).toBe('sent');
    expect(pack.executeTransaction).toHaveBeenCalledTimes(1);
  });
});
