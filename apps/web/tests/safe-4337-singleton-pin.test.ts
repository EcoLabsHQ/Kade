import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeFunctionData, encodePacked, parseAbi, type Address, type Hex } from 'viem';
import {
  SAFE_4337_MODULE,
  SAFE_DEPLOYMENTS,
  SAFE_PASSKEY_MODULE,
} from '@kade/shared';
import type { PasskeySigner } from '@/lib/safe/passkey-signer';

/**
 * Regression: the create-Safe address must not depend on the chain.
 *
 * Before this fix, protocol-kit fed two chain-dependent inputs into the
 * counterfactual address, so the same passkey produced a different Safe on
 * mainnet and on Sepolia:
 *
 *   1. the salt — a chain-derived default
 *      (`keccak256(PREDETERMINED_SALT_NONCE + chainId)`); and
 *   2. the singleton — `isL1SafeSingleton` defaults to
 *      `safeDeploymentsL1ChainIds.includes(chainId)` and, in protocol-kit
 *      8.0.7, `safeDeploymentsL1ChainIds = [1n]`, so only mainnet used SafeL1
 *      and every other chain silently used SafeL2.
 *
 * These tests are offline: relay-kit and protocol-kit are both mocked at the
 * module seam. They pin the two fixed inputs, the consistency between the
 * constructor's module address and the initializer's fallback handler, and that
 * the pack returned really is the one assembled through the public constructor.
 *
 * This suite is **mock-verified only**: it does not prove, against real chains,
 * that the predicted address is equal across chains. That end-to-end equality is
 * a separate opt-in, network-dependent proof committed at
 * `tests/proofs/safe-address-chain-parity.proof.ts`; run it with
 * `scripts/safe-chain-parity/run.sh`. `./scripts/verify.sh` does not run it.
 */

const hoisted = vi.hoisted(() => ({
  init: vi.fn(),
  createBundlerClient: vi.fn(() => ({})),
  safeInit: vi.fn(),
  constructed: [] as unknown[],
  instance: null as unknown,
}));

vi.mock('@safe-global/relay-kit', () => {
  class Safe4337Pack {
    static init = hoisted.init;
    constructor(options: unknown) {
      hoisted.constructed.push(options);
      hoisted.instance = this;
    }
  }
  class PimlicoFeeEstimator {}
  return { Safe4337Pack, createBundlerClient: hoisted.createBundlerClient, PimlicoFeeEstimator };
});

vi.mock('@safe-global/protocol-kit', () => ({
  default: { init: hoisted.safeInit },
}));

import {
  FIXED_CREATE2_SALT_NONCE,
  initSafe4337Pack,
} from '@/lib/safe/execute-safe-4337-env';

const SEPOLIA = 11155111;
const ETHEREUM = 1;
const BUNDLER = 'https://api.pimlico.io/v2/1/rpc?apikey=test';
const SAFE = '0x5587bea87231106C2a5AC9403e733f8B123C1DA1' as Address;

const SIGNER: PasskeySigner = {
  rawId: 'cred-1',
  coordinates: { x: '1', y: '2' },
  verifierAddress: '0x4444444444444444444444444444444444444444' as Address,
};

const L1_SINGLETON = SAFE_DEPLOYMENTS['1.4.1'].safeSingleton.value;
const L1_SINGLETON_ADDRESS = '0x41675C099F32341bf84BFc5382aF534df5C7461a';

interface SeedInput {
  readonly options: {
    readonly owners: string[];
    readonly threshold: number;
    readonly saltNonce?: string;
  };
  readonly customContracts: {
    readonly entryPointAddress: string;
    readonly safe4337ModuleAddress: string;
    readonly safeModulesSetupAddress: string;
    readonly safeWebAuthnSharedSignerAddress: string;
  };
}

interface SafeInitInput {
  readonly contractNetworks: Record<string, { safeSingletonAddress: string }>;
  readonly predictedSafe: {
    readonly safeAccountConfig: {
      readonly owners: string[];
      readonly fallbackHandler?: string;
    };
    readonly safeDeploymentConfig?: { readonly saltNonce?: string };
  };
}

/**
 * The canonical Safe v1.4.1 `MultiSend` deployment, as relay-kit resolves it.
 * The predicted Safe's initializer `to` is this contract for a passkey, because
 * enabling the 4337 module and configuring the shared signer are two calls.
 */
const MULTI_SEND_ADDRESS = '0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526';
const MULTI_SEND_ABI = parseAbi(['function multiSend(bytes transactions)']);

/** Encode one user's multiSend sub-transaction, protocol-kit's packed layout. */
function encodeMetaTransaction(tx: {
  readonly operation: number;
  readonly to: string;
  readonly value: bigint;
  readonly data: Hex;
}): string {
  return encodePacked(
    ['uint8', 'address', 'uint256', 'uint256', 'bytes'],
    [tx.operation, tx.to as Address, tx.value, BigInt((tx.data.length - 2) / 2), tx.data],
  ).slice(2);
}

/**
 * A relay-kit seed faithful to the SDK for a passkey signer.
 *
 * For a passkey, relay-kit always sets up **two** calls — `enableModules` on the
 * module setup address and the shared signer's `configure` — so `isBatch` is
 * true and the predicted Safe's initializer is a `multiSend(bytes)` call to the
 * MultiSend contract, not a single `to`/`data` pair. It also appends the shared
 * signer to the owners and uses the module address it was given as the fallback
 * handler. This seed reproduces that shape.
 */
function relayKitSeed(input: SeedInput): unknown {
  const owners = [...input.options.owners];
  const shared = input.customContracts.safeWebAuthnSharedSignerAddress;
  if (!owners.includes(shared)) owners.push(shared);
  const setupTransactions = [
    {
      operation: 1, // DelegateCall: enable the 4337 module.
      to: SAFE_4337_MODULE.safeModuleSetup.value,
      value: 0n,
      data: '0x1234' as Hex,
    },
    {
      operation: 1, // DelegateCall: configure the shared WebAuthn signer.
      to: shared,
      value: 0n,
      data: '0x5678' as Hex,
    },
  ];
  const batchData = encodeFunctionData({
    abi: MULTI_SEND_ABI,
    functionName: 'multiSend',
    args: [
      `0x${setupTransactions.map(encodeMetaTransaction).join('')}` as Hex,
    ],
  });
  return {
    protocolKit: {
      getPredictedSafe: () => ({
        safeAccountConfig: {
          owners,
          threshold: input.options.threshold,
          to: MULTI_SEND_ADDRESS,
          data: batchData,
          fallbackHandler: input.customContracts.safe4337ModuleAddress,
          paymentToken: '0x0000000000000000000000000000000000000000',
          payment: 0,
          paymentReceiver: '0x0000000000000000000000000000000000000000',
        },
        safeDeploymentConfig: {
          safeVersion: '1.4.1',
          saltNonce: input.options.saltNonce,
        },
      }),
    },
  };
}

function init(chainId: number, safeAddress: Address | null): Promise<unknown> {
  return initSafe4337Pack({
    chainId,
    signer: SIGNER,
    safeAddress,
    bundlerUrl: BUNDLER,
  });
}

function seedInput(index: number): SeedInput {
  return hoisted.init.mock.calls[index]?.[0] as SeedInput;
}

function safeInitInput(index: number): SafeInitInput {
  return hoisted.safeInit.mock.calls[index]?.[0] as SafeInitInput;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  hoisted.init.mockReset();
  hoisted.safeInit.mockReset();
  hoisted.constructed.length = 0;
  hoisted.instance = null;
  hoisted.init.mockImplementation(async (input: unknown) => {
    const options = (input as { options?: Record<string, unknown> }).options;
    // The existing-Safe path passes `safeAddress`, not owners; relay-kit
    // returns the Safe pack for it directly, with no predicted config.
    if (!options || !('owners' in options)) return { existingSafe: true };
    return relayKitSeed(input as SeedInput);
  });
  hoisted.safeInit.mockResolvedValue({ pinned: true });
  process.env.SEPOLIA_RPC_URL = 'https://sepolia.example';
  process.env.ETHEREUM_RPC_URL = 'https://mainnet.example';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('create-Safe address pinning', () => {
  it('pins the fixed salt and the L1 singleton on the create path', async () => {
    await init(SEPOLIA, null);

    const seed = seedInput(0);
    expect(seed.options.saltNonce).toBe(FIXED_CREATE2_SALT_NONCE);
    expect(seed.options.saltNonce).toBe('0');

    // The seed was given our constants explicitly, so relay-kit cannot resolve
    // a per-chain module address behind our back.
    expect(seed.customContracts.safe4337ModuleAddress).toBe(
      SAFE_4337_MODULE.safe4337Module.value,
    );
    expect(seed.customContracts.entryPointAddress).toBe(
      SAFE_4337_MODULE.entryPoint.value,
    );
    expect(seed.customContracts.safeModulesSetupAddress).toBe(
      SAFE_4337_MODULE.safeModuleSetup.value,
    );
    expect(seed.customContracts.safeWebAuthnSharedSignerAddress).toBe(
      SAFE_PASSKEY_MODULE.safeWebAuthnSharedSigner.value,
    );

    const pinned = safeInitInput(0);
    expect(
      pinned.contractNetworks[String(SEPOLIA)]?.safeSingletonAddress,
    ).toBe(L1_SINGLETON);
    // The literal from the shared record, cited so a change to it is visible.
    expect(L1_SINGLETON).toBe(L1_SINGLETON_ADDRESS);
    // The copied predicted config carries the fixed salt, not the chain default.
    expect(pinned.predictedSafe.safeDeploymentConfig?.saltNonce).toBe('0');
  });

  it('passes the same singleton pin for Ethereum mainnet and Sepolia', async () => {
    await init(SEPOLIA, null);
    await init(ETHEREUM, null);

    const sepolia = safeInitInput(0);
    const mainnet = safeInitInput(1);

    expect(sepolia.contractNetworks[String(SEPOLIA)]?.safeSingletonAddress).toBe(
      L1_SINGLETON,
    );
    expect(mainnet.contractNetworks[String(ETHEREUM)]?.safeSingletonAddress).toBe(
      L1_SINGLETON,
    );
    // The salt is the same fixed value on both chains, so the one remaining
    // address input (the initializer) is the same too.
    expect(seedInput(0).options.saltNonce).toBe(seedInput(1).options.saltNonce);
  });

  it('keeps the constructor module address equal to the initializer fallback handler', async () => {
    await init(SEPOLIA, null);

    const fallbackHandler =
      safeInitInput(0).predictedSafe.safeAccountConfig.fallbackHandler;
    const constructed = hoisted.constructed[0] as {
      safe4337ModuleAddress: string;
      safeWebAuthnSharedSignerAddress: string;
      entryPointAddress: string;
      chainId: bigint;
    };

    expect(fallbackHandler).toBe(SAFE_4337_MODULE.safe4337Module.value);
    // One source of truth: the constructor reads the same constant the
    // initializer's fallback handler was built from.
    expect(constructed.safe4337ModuleAddress).toBe(fallbackHandler);
    expect(constructed.safeWebAuthnSharedSignerAddress).toBe(
      SAFE_PASSKEY_MODULE.safeWebAuthnSharedSigner.value,
    );
    expect(constructed.entryPointAddress).toBe(SAFE_4337_MODULE.entryPoint.value);
    expect(constructed.chainId).toBe(BigInt(SEPOLIA));
  });

  it('returns the pack assembled through the public constructor', async () => {
    const result = await init(SEPOLIA, null);

    expect(hoisted.constructed).toHaveLength(1);
    expect(result).toBe(hoisted.instance);
  });

  it('leaves the existing-Safe path unchanged', async () => {
    const result = await init(SEPOLIA, SAFE);

    // No prediction, no pinned protocolKit, no constructor: the pack is
    // whatever relay-kit's own init returned.
    expect(hoisted.safeInit).not.toHaveBeenCalled();
    expect(hoisted.constructed).toHaveLength(0);

    const input = seedInput(0);
    expect(input.options).toEqual({ safeAddress: SAFE });
    expect(input.options.saltNonce).toBeUndefined();
    expect(
      (input as unknown as { customContracts?: unknown }).customContracts,
    ).toBeUndefined();
    expect(result).toBe(await hoisted.init.mock.results[0]?.value);
  });
});
