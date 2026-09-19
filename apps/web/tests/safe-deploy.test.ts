import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAddress, type Account, type Address, type Hex } from 'viem';
import { DEPLOYED_SAFE_PROXY_CREATION_CODE } from '@kade/shared';
import { predictedSafeAddress } from '@/lib/safe/account';
import {
  PAYER_PRIVATE_KEY_ENV,
  RPC_URL_ENV,
  deployResidentSafe,
  deployResidentSafeFromEnv,
  readPayerPrivateKey,
  type SafeDeployDependencies,
  type SafeDeployRequest,
} from '@/lib/safe/deploy';

/**
 * The deployment engine must be provable without a network or a funded account,
 * so every client is mocked and the payer is a fabricated address. The tests
 * assert on the calls made as much as on the result: the address-mismatch case
 * in particular must send nothing, and idempotency must not send a second
 * transaction.
 */

const SIGNER = '0x8d36E6FF7e49e1b665c0b83B5394606bEed804A9' as Address;
const OWNER = getAddress(SIGNER);
const OTHER = '0x2222222222222222222222222222222222222222' as Address;
const PAYER = '0x3333333333333333333333333333333333333333' as Address;
const TX_HASH = `0x${'ab'.repeat(32)}` as Hex;
const CODE = '0x6001600055' as Hex;
const USER = 'user-1';

/** The factory's own creation code, as the chain would return it. */
const CREATION_CODE = DEPLOYED_SAFE_PROXY_CREATION_CODE;

/** The counterfactual address the frozen inputs commit to. */
const EXPECTED = predictedSafeAddress({
  userId: USER,
  signerAddress: SIGNER,
  proxyCreationCode: CREATION_CODE,
});

const REQUEST: SafeDeployRequest = {
  userId: USER,
  signerAddress: SIGNER,
  expectedSafeAddress: EXPECTED,
};

interface DeployMocks {
  readonly publicClient: {
    getBytecode: ReturnType<typeof vi.fn>;
    simulateContract: ReturnType<typeof vi.fn>;
    estimateContractGas: ReturnType<typeof vi.fn>;
    estimateFeesPerGas: ReturnType<typeof vi.fn>;
    getBalance: ReturnType<typeof vi.fn>;
    waitForTransactionReceipt: ReturnType<typeof vi.fn>;
    readContract: ReturnType<typeof vi.fn>;
  };
  readonly walletClient: { writeContract: ReturnType<typeof vi.fn> };
  readonly deps: SafeDeployDependencies;
}

function makeDeps(): DeployMocks {
  const publicClient = {
    getBytecode: vi.fn(),
    simulateContract: vi.fn(),
    estimateContractGas: vi.fn(),
    estimateFeesPerGas: vi.fn(),
    getBalance: vi.fn(),
    waitForTransactionReceipt: vi.fn(),
    readContract: vi.fn(),
  };
  publicClient.getBytecode.mockResolvedValue(undefined);
  publicClient.simulateContract.mockResolvedValue({ result: EXPECTED, request: {} });
  publicClient.estimateContractGas.mockResolvedValue(21_000n);
  publicClient.estimateFeesPerGas.mockResolvedValue({
    maxFeePerGas: 2_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
  });
  publicClient.getBalance.mockResolvedValue(10n ** 18n);
  publicClient.waitForTransactionReceipt.mockResolvedValue({
    status: 'success',
    blockNumber: 42n,
  });
  publicClient.readContract.mockImplementation(
    async ({ functionName }: { functionName: string }) => {
      if (functionName === 'proxyCreationCode') return CREATION_CODE;
      if (functionName === 'getOwners') return [SIGNER];
      if (functionName === 'getThreshold') return 1n;
      throw new Error(`unexpected readContract(${functionName})`);
    },
  );

  const walletClient = { writeContract: vi.fn() };
  walletClient.writeContract.mockResolvedValue(TX_HASH);

  const account = { address: PAYER, type: 'local' } as unknown as Account;

  return {
    publicClient,
    walletClient,
    deps: {
      publicClient: publicClient as unknown as SafeDeployDependencies['publicClient'],
      walletClient:
        walletClient as unknown as SafeDeployDependencies['walletClient'],
      account,
    },
  };
}

/** First `getBytecode` says counterfactual, the post-deploy one says code. */
function notDeployedThenDeployed(mocks: DeployMocks): void {
  mocks.publicClient.getBytecode
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce(CODE);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('deployResidentSafe', () => {
  it('deploys, verifies on chain and reports the deployed Safe', async () => {
    const mocks = makeDeps();
    notDeployedThenDeployed(mocks);

    const result = await deployResidentSafe(REQUEST, mocks.deps);

    expect(result).toEqual({
      status: 'deployed',
      safeAddress: EXPECTED,
      txHash: TX_HASH,
      blockNumber: 42n,
      owners: [OWNER],
      threshold: 1,
    });
    expect(mocks.walletClient.writeContract).toHaveBeenCalledTimes(1);
    expect(mocks.publicClient.waitForTransactionReceipt).toHaveBeenCalledTimes(1);
  });

  it('short-circuits with the existing state and never sends a second transaction', async () => {
    const mocks = makeDeps();
    mocks.publicClient.getBytecode.mockResolvedValue(CODE);

    const result = await deployResidentSafe(REQUEST, mocks.deps);

    expect(result).toMatchObject({
      status: 'already-deployed',
      safeAddress: EXPECTED,
      owners: [OWNER],
      threshold: 1,
    });
    expect(mocks.walletClient.writeContract).not.toHaveBeenCalled();
    expect(mocks.publicClient.simulateContract).not.toHaveBeenCalled();
    expect(mocks.publicClient.waitForTransactionReceipt).not.toHaveBeenCalled();
  });

  it('aborts when the derivation inputs no longer match the expected address', async () => {
    const mocks = makeDeps();

    const result = await deployResidentSafe(
      { ...REQUEST, expectedSafeAddress: OTHER },
      mocks.deps,
    );

    expect(result.status).toBe('address-mismatch');
    if (result.status !== 'address-mismatch') throw new Error('expected mismatch');
    expect(result.derived).toBe(EXPECTED);
    expect(result.safeAddress).toBe(OTHER);
    expect(mocks.publicClient.simulateContract).not.toHaveBeenCalled();
    expect(mocks.publicClient.getBytecode).not.toHaveBeenCalled();
    expect(mocks.walletClient.writeContract).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it('aborts when the factory would create a different address than expected', async () => {
    const mocks = makeDeps();
    mocks.publicClient.simulateContract.mockResolvedValue({
      result: OTHER,
      request: {},
    });

    const result = await deployResidentSafe(REQUEST, mocks.deps);

    expect(result.status).toBe('address-mismatch');
    if (result.status !== 'address-mismatch') throw new Error('expected mismatch');
    expect(result.simulated).toBe(OTHER);
    expect(result.safeAddress).toBe(EXPECTED);
    expect(mocks.publicClient.simulateContract).toHaveBeenCalledTimes(1);
    expect(mocks.walletClient.writeContract).not.toHaveBeenCalled();
    expect(mocks.publicClient.waitForTransactionReceipt).not.toHaveBeenCalled();
  });

  it('refuses to send when the payer cannot cover the estimate', async () => {
    const mocks = makeDeps();
    mocks.publicClient.getBalance.mockResolvedValue(1n);

    const result = await deployResidentSafe(REQUEST, mocks.deps);

    expect(result).toEqual({
      status: 'insufficient-funds',
      safeAddress: EXPECTED,
      payer: PAYER,
      required: 21_000n * 2_000_000_000n,
      available: 1n,
    });
    expect(mocks.walletClient.writeContract).not.toHaveBeenCalled();
  });

  it('treats a reverted receipt as a failure, not a deployment', async () => {
    const mocks = makeDeps();
    notDeployedThenDeployed(mocks);
    mocks.publicClient.waitForTransactionReceipt.mockResolvedValue({
      status: 'reverted',
      blockNumber: 42n,
    });

    const result = await deployResidentSafe(REQUEST, mocks.deps);

    expect(result).toMatchObject({
      status: 'failed',
      stage: 'receipt',
      txHash: TX_HASH,
    });
    expect(result.status).not.toBe('deployed');
    expect(mocks.walletClient.writeContract).toHaveBeenCalledTimes(1);
  });

  it('does not report success when the deployed Safe has no code', async () => {
    const mocks = makeDeps();
    mocks.publicClient.getBytecode
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const result = await deployResidentSafe(REQUEST, mocks.deps);

    expect(result).toMatchObject({ status: 'failed', stage: 'verify' });
    expect(result.status).not.toBe('deployed');
  });

  it('does not report success when the deployed Safe has the wrong threshold', async () => {
    const mocks = makeDeps();
    notDeployedThenDeployed(mocks);
    mocks.publicClient.readContract.mockImplementation(
      async ({ functionName }: { functionName: string }) => {
        if (functionName === 'proxyCreationCode') return CREATION_CODE;
        if (functionName === 'getOwners') return [SIGNER];
        if (functionName === 'getThreshold') return 2n;
        throw new Error(`unexpected readContract(${functionName})`);
      },
    );

    const result = await deployResidentSafe(REQUEST, mocks.deps);

    expect(result).toMatchObject({ status: 'failed', stage: 'verify' });
    expect(result.status).not.toBe('deployed');
  });

  it('does not report success when the deployed Safe has the wrong owner', async () => {
    const mocks = makeDeps();
    notDeployedThenDeployed(mocks);
    mocks.publicClient.readContract.mockImplementation(
      async ({ functionName }: { functionName: string }) => {
        if (functionName === 'proxyCreationCode') return CREATION_CODE;
        if (functionName === 'getOwners') return [OTHER];
        if (functionName === 'getThreshold') return 1n;
        throw new Error(`unexpected readContract(${functionName})`);
      },
    );

    const result = await deployResidentSafe(REQUEST, mocks.deps);

    expect(result).toMatchObject({ status: 'failed', stage: 'verify' });
    expect(result.status).not.toBe('deployed');
  });

  it('reports a simulation revert as a failure without sending', async () => {
    const mocks = makeDeps();
    mocks.publicClient.simulateContract.mockRejectedValue(
      new Error('execution reverted'),
    );

    const result = await deployResidentSafe(REQUEST, mocks.deps);

    expect(result).toMatchObject({ status: 'failed', stage: 'simulate' });
    expect(mocks.walletClient.writeContract).not.toHaveBeenCalled();
  });
});

describe('deployResidentSafeFromEnv', () => {
  const FABRICATED_KEY = `0x${'11'.repeat(32)}`;

  it('returns not-configured when the payer key is absent', async () => {
    const result = await deployResidentSafeFromEnv(REQUEST, {});

    expect(result.status).toBe('not-configured');
    if (result.status !== 'not-configured') throw new Error('expected not-configured');
    expect(result.reason).toMatch(/SEPOLIA_DEPLOYER_PRIVATE_KEY/);
  });

  it('returns not-configured for a malformed key rather than fabricating one', async () => {
    const result = await deployResidentSafeFromEnv(REQUEST, {
      [PAYER_PRIVATE_KEY_ENV]: 'not-a-key',
      [RPC_URL_ENV]: 'http://127.0.0.1:8545',
    });

    expect(result.status).toBe('not-configured');
  });

  it('returns not-configured when the RPC endpoint is absent', async () => {
    const result = await deployResidentSafeFromEnv(REQUEST, {
      [PAYER_PRIVATE_KEY_ENV]: FABRICATED_KEY,
    });

    expect(result.status).toBe('not-configured');
    if (result.status !== 'not-configured') throw new Error('expected not-configured');
    expect(result.reason).toMatch(/SEPOLIA_RPC_URL/);
  });
});

describe('readPayerPrivateKey', () => {
  it('reads only a well-formed 32-byte key', () => {
    expect(readPayerPrivateKey({})).toBeNull();
    expect(
      readPayerPrivateKey({ [PAYER_PRIVATE_KEY_ENV]: '0x1234' }),
    ).toBeNull();

    const key = `0x${'11'.repeat(32)}`;
    expect(readPayerPrivateKey({ [PAYER_PRIVATE_KEY_ENV]: key })).toBe(key);
  });
});
