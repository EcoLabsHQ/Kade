import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAddress, type Address, type Hex } from 'viem';
import {
  ensureResidentSafeDeployed,
  type EnsureSafeDeployedDependencies,
} from '@/lib/safe/ensure-deployed';
import type { SafeDeployResult } from '@/lib/safe/deploy';

/**
 * The readiness guard's whole job is to answer one question with the chain, not
 * with a record: does the resident Safe have **code** on the membership chain?
 *
 * These tests pin that the check is a real `getBytecode` on the injected client,
 * that an undeployed Safe triggers the existing deployment engine before the
 * guard reports ready, that a deployed Safe skips the engine, and that every way
 * the deployment can fail becomes a precise refusal — so the mint can never
 * proceed to an address with no contract. No network, no key, no chain.
 */

const PROFILE = '11111111-1111-1111-1111-111111111111';
const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address;
const OWNER = '0x2222222222222222222222222222222222222222' as Address;
const CHAIN_ID = 42161;
const TX_HASH = `0x${'ab'.repeat(32)}` as Hex;
const CODE = '0x6001600055' as Hex;

interface Mocks {
  readonly getBytecode: ReturnType<typeof vi.fn>;
  readonly readOwner: ReturnType<typeof vi.fn>;
  readonly deploy: ReturnType<typeof vi.fn>;
  readonly deps: EnsureSafeDeployedDependencies;
}

function makeMocks(): Mocks {
  const getBytecode = vi.fn().mockResolvedValue(undefined);
  const readOwner = vi.fn().mockResolvedValue(getAddress(OWNER));
  const deploy = vi.fn();
  return {
    getBytecode,
    readOwner,
    deploy,
    deps: {
      codeClient: { getBytecode },
      readOwner,
      deploy,
    },
  };
}

const REQUEST = {
  profileId: PROFILE,
  account: ACCOUNT,
  chainId: CHAIN_ID,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('ensureResidentSafeDeployed — the code check', () => {
  it('reports ready without deploying when the address already has code', async () => {
    const mocks = makeMocks();
    mocks.getBytecode.mockResolvedValue(CODE);

    const result = await ensureResidentSafeDeployed(REQUEST, mocks.deps);

    expect(result).toEqual({
      status: 'deployed',
      safeAddress: getAddress(ACCOUNT),
      txHash: null,
      deployedNow: false,
    });
    // The check is a real chain read, and nothing was sent.
    expect(mocks.getBytecode).toHaveBeenCalledWith({ address: getAddress(ACCOUNT) });
    expect(mocks.deploy).not.toHaveBeenCalled();
  });

  it('refuses, without deploying, when the code read fails', async () => {
    const mocks = makeMocks();
    mocks.getBytecode.mockRejectedValue(new Error('RPC down'));

    const result = await ensureResidentSafeDeployed(REQUEST, mocks.deps);

    expect(result.status).toBe('refused');
    if (result.status !== 'refused') throw new Error('expected refused');
    expect(result.reason).toMatch(/could not be read/i);
    expect(mocks.deploy).not.toHaveBeenCalled();
  });

  it('refuses when the resident has no recorded owner, sending nothing', async () => {
    const mocks = makeMocks();
    mocks.getBytecode.mockResolvedValue(undefined);
    mocks.readOwner.mockResolvedValue(null);

    const result = await ensureResidentSafeDeployed(REQUEST, mocks.deps);

    expect(result.status).toBe('refused');
    if (result.status !== 'refused') throw new Error('expected refused');
    expect(result.reason).toMatch(/no recorded owner/i);
    expect(mocks.deploy).not.toHaveBeenCalled();
  });
});

describe('ensureResidentSafeDeployed — deploying an undeployed Safe', () => {
  it('deploys through the existing engine and reports code observed after', async () => {
    const mocks = makeMocks();
    // First read: no code. Second read (after deploy): code present.
    mocks.getBytecode.mockResolvedValueOnce(undefined).mockResolvedValueOnce(CODE);
    mocks.deploy.mockResolvedValue({
      status: 'deployed',
      safeAddress: ACCOUNT,
      txHash: TX_HASH,
      blockNumber: 42n,
      owners: [getAddress(OWNER)],
      threshold: 1,
    } satisfies SafeDeployResult);

    const result = await ensureResidentSafeDeployed(REQUEST, mocks.deps);

    expect(result).toEqual({
      status: 'deployed',
      safeAddress: getAddress(ACCOUNT),
      txHash: TX_HASH,
      deployedNow: true,
    });
    // The engine is asked to deploy exactly the recorded address from the
    // recorded passkey owner, on the same profile.
    expect(mocks.deploy).toHaveBeenCalledWith({
      userId: PROFILE,
      signerAddress: getAddress(OWNER),
      expectedSafeAddress: getAddress(ACCOUNT),
    });
    // The check is the chain's code, before and after.
    expect(mocks.getBytecode).toHaveBeenCalledTimes(2);
  });

  it('treats an already-deployed engine result as ready without a new hash', async () => {
    const mocks = makeMocks();
    mocks.getBytecode.mockResolvedValueOnce(undefined).mockResolvedValueOnce(CODE);
    mocks.deploy.mockResolvedValue({
      status: 'already-deployed',
      safeAddress: ACCOUNT,
      owners: [getAddress(OWNER)],
      threshold: 1,
    } satisfies SafeDeployResult);

    const result = await ensureResidentSafeDeployed(REQUEST, mocks.deps);

    expect(result).toEqual({
      status: 'deployed',
      safeAddress: getAddress(ACCOUNT),
      txHash: null,
      deployedNow: false,
    });
  });

  it('refuses when the deployment reports success but no code is present', async () => {
    const mocks = makeMocks();
    mocks.getBytecode.mockResolvedValue(undefined);
    mocks.deploy.mockResolvedValue({
      status: 'deployed',
      safeAddress: ACCOUNT,
      txHash: TX_HASH,
      blockNumber: 42n,
      owners: [getAddress(OWNER)],
      threshold: 1,
    } satisfies SafeDeployResult);

    const result = await ensureResidentSafeDeployed(REQUEST, mocks.deps);

    expect(result.status).toBe('refused');
    if (result.status !== 'refused') throw new Error('expected refused');
    expect(result.reason).toMatch(/still has no code/i);
  });
});

describe('ensureResidentSafeDeployed — a failed deployment refuses with the reason', () => {
  const cases: readonly {
    readonly engine: SafeDeployResult;
    readonly matches: RegExp;
  }[] = [
    {
      engine: {
        status: 'not-configured',
        reason: 'ARBITRUM_DEPLOYER_PRIVATE_KEY is not set',
      },
      matches: /not configured/i,
    },
    {
      engine: {
        status: 'insufficient-funds',
        safeAddress: ACCOUNT,
        payer: OWNER,
        required: 1_000n,
        available: 1n,
      },
      matches: /holds 1 wei but the deployment needs 1000 wei/i,
    },
    {
      engine: {
        status: 'address-mismatch',
        safeAddress: ACCOUNT,
        derived: OWNER,
        reason: 'inputs derive another address',
      },
      matches: /do not derive the recorded Safe address/i,
    },
    {
      engine: {
        status: 'failed',
        safeAddress: ACCOUNT,
        stage: 'send',
        reason: 'the transaction could not be sent',
      },
      matches: /failed at send/i,
    },
  ];

  for (const { engine, matches } of cases) {
    it(`refuses ${engine.status}`, async () => {
      const mocks = makeMocks();
      mocks.getBytecode.mockResolvedValue(undefined);
      mocks.deploy.mockResolvedValue(engine);

      const result = await ensureResidentSafeDeployed(REQUEST, mocks.deps);

      expect(result.status).toBe('refused');
      if (result.status !== 'refused') throw new Error('expected refused');
      expect(result.reason).toMatch(matches);
      // A refusal never re-reads code as if it were a success.
      expect(mocks.getBytecode).toHaveBeenCalledTimes(1);
    });
  }

  it('refuses when the engine itself throws', async () => {
    const mocks = makeMocks();
    mocks.getBytecode.mockResolvedValue(undefined);
    mocks.deploy.mockRejectedValue(new Error('engine exploded'));

    const result = await ensureResidentSafeDeployed(REQUEST, mocks.deps);

    expect(result.status).toBe('refused');
    if (result.status !== 'refused') throw new Error('expected refused');
    expect(result.reason).toMatch(/could not be attempted/i);
  });
});
