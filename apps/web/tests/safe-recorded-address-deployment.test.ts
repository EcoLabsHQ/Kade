import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAddress, type Account, type Address, type Hex } from 'viem';
import {
  deployResidentSafe,
  type SafeDeployDependencies,
} from '@/lib/safe/deploy';
import {
  deploymentInputsFromPredicted,
  type PredictedSafeConfig,
} from '@/lib/safe/predicted-safe';
import {
  RECORDED_PREDICTED_CONFIG,
  RECORDED_PROXY_CREATION_CODE,
  RECORDED_SAFE_ADDRESS,
} from './fixtures/recorded-account-vector';

/**
 * Regression: the deploy engine, given the account's own SDK-predicted inputs,
 * deploys **at the recorded address** and refuses when the expected address does
 * not match them.
 *
 * This is the guard's deployment half: onboarding deploys Safe v1.4.1 with the
 * pinned salt `'0'`, so the engine must deploy exactly those inputs rather than
 * re-deriving through Kade's separate create2 arithmetic (v1.5.0 +
 * `residentSaltNonce`). The recorded vector is in
 * `./fixtures/recorded-account-vector.ts`.
 */

const RECORDED_CONFIG: PredictedSafeConfig = RECORDED_PREDICTED_CONFIG;
const V141_FACTORY = getAddress('0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67');

const PAYER = '0x3333333333333333333333333333333333333333' as Address;
const TX_HASH = `0x${'ab'.repeat(32)}` as Hex;
const CODE = '0x6001600055' as Hex;

interface EngineMocks {
  readonly publicClient: Record<string, ReturnType<typeof vi.fn>>;
  readonly walletClient: { writeContract: ReturnType<typeof vi.fn> };
  readonly deps: SafeDeployDependencies;
}

function makeEngineMocks(): EngineMocks {
  const inputs = deploymentInputsFromPredicted(RECORDED_CONFIG);
  const publicClient = {
    getBytecode: vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(CODE),
    simulateContract: vi.fn().mockResolvedValue({ result: RECORDED_SAFE_ADDRESS, request: {} }),
    estimateContractGas: vi.fn().mockResolvedValue(21_000n),
    estimateFeesPerGas: vi.fn().mockResolvedValue({ maxFeePerGas: 2_000_000_000n }),
    getBalance: vi.fn().mockResolvedValue(10n ** 18n),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success', blockNumber: 42n }),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === 'proxyCreationCode') return RECORDED_PROXY_CREATION_CODE;
      if (functionName === 'getOwners') return [...inputs.owners];
      if (functionName === 'getThreshold') return 1n;
      throw new Error(`unexpected readContract(${functionName})`);
    }),
  };
  const walletClient = { writeContract: vi.fn().mockResolvedValue(TX_HASH) };
  return {
    publicClient,
    walletClient,
    deps: {
      publicClient: publicClient as unknown as SafeDeployDependencies['publicClient'],
      walletClient: walletClient as unknown as SafeDeployDependencies['walletClient'],
      account: { address: PAYER, type: 'local' } as unknown as Account,
    },
  };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe("deployResidentSafe with the account's own predicted deployment", () => {
  it('deploys exactly the reconstructed inputs and verifies the recorded owners', async () => {
    const mocks = makeEngineMocks();
    const inputs = deploymentInputsFromPredicted(RECORDED_CONFIG);

    const result = await deployResidentSafe(
      {
        userId: '4fc540b4-144c-4665-a9ac-653058396973',
        signerAddress: getAddress(RECORDED_CONFIG.owners[0] as Address),
        expectedSafeAddress: RECORDED_SAFE_ADDRESS,
        deployment: inputs,
      },
      mocks.deps,
    );

    expect(result).toMatchObject({
      status: 'deployed',
      safeAddress: RECORDED_SAFE_ADDRESS,
      txHash: TX_HASH,
    });
    // The factory is called with the account's own singleton/initializer/salt,
    // never with the frozen Kade-create2 inputs.
    expect(mocks.walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: V141_FACTORY,
        functionName: 'createProxyWithNonce',
        args: [inputs.singleton, inputs.initializer, inputs.saltNonce],
      }),
    );
  });

  it('refuses when the expected address does not match the reconstructed inputs', async () => {
    const mocks = makeEngineMocks();
    const inputs = deploymentInputsFromPredicted(RECORDED_CONFIG);
    const other = getAddress('0x9999999999999999999999999999999999999999');

    const result = await deployResidentSafe(
      {
        userId: '4fc540b4-144c-4665-a9ac-653058396973',
        signerAddress: getAddress(RECORDED_CONFIG.owners[0] as Address),
        expectedSafeAddress: other,
        deployment: inputs,
      },
      mocks.deps,
    );

    expect(result.status).toBe('address-mismatch');
    if (result.status !== 'address-mismatch') throw new Error('expected mismatch');
    expect(result.derived).toBe(RECORDED_SAFE_ADDRESS);
    expect(mocks.walletClient.writeContract).not.toHaveBeenCalled();
    expect(mocks.publicClient.simulateContract).not.toHaveBeenCalled();
  });
});
