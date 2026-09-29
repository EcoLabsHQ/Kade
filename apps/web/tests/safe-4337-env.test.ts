import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAIN_IDS } from '@kade/shared';
import type { Address } from 'viem';
import type { PasskeySigner } from '@/lib/safe/passkey-signer';

/**
 * The environment-wired `Safe4337Pack.init`: the RPC resolution and the Pimlico
 * paymaster options.
 *
 * The SDK is mocked at the module seam, so no bundler and no network are
 * touched. The assertions cover the per-chain RPC resolution the multichain
 * vault rail needs — Ethereum mainnet, Base and Arbitrum One each resolve their
 * own variable, Sepolia is unchanged, and an unsupported chain refuses — plus
 * that the configured Pimlico sponsorship policy is forwarded to the SDK rather
 * than silently dropped.
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
  return { Safe4337Pack, createBundlerClient: hoisted.createBundlerClient };
});

vi.mock('@safe-global/protocol-kit', () => ({
  default: { init: hoisted.safeInit },
}));

import { initSafe4337Pack } from '@/lib/safe/execute-safe-4337-env';

const BUNDLER = 'https://api.pimlico.io/v2/1/rpc?apikey=test';

const SIGNER: PasskeySigner = {
  rawId: 'cred-1',
  coordinates: { x: '1', y: '2' },
  verifierAddress: '0x4444444444444444444444444444444444444444' as Address,
};

/**
 * A minimal relay-kit seed: the create path reads the predicted config relay-kit
 * composed, so the mock must expose it. The fallback handler is taken from the
 * `customContracts` the seed was given, exactly as relay-kit does.
 */
function seedFor(input: {
  readonly options: { readonly saltNonce?: string };
  readonly customContracts?: { readonly safe4337ModuleAddress: string };
}): unknown {
  return {
    protocolKit: {
      getPredictedSafe: () => ({
        safeAccountConfig: {
          owners: [],
          threshold: 1,
          fallbackHandler: input.customContracts?.safe4337ModuleAddress,
        },
        safeDeploymentConfig: { safeVersion: '1.4.1', saltNonce: input.options.saltNonce },
      }),
    },
  };
}

const RPC_KEYS = [
  'SEPOLIA_RPC_URL',
  'ETHEREUM_RPC_URL',
  'BASE_RPC_URL',
  'ARBITRUM_RPC_URL',
] as const;
const PIMLICO_KEYS = ['PIMLICO_API_KEY', 'PIMLICO_POLICY_ID'] as const;

const ORIGINAL_ENV = { ...process.env };

interface InitInput {
  readonly provider: string;
  readonly paymasterOptions: Record<string, unknown>;
  readonly options: { readonly saltNonce?: string };
}

function lastInitInput(): InitInput {
  const [input] = hoisted.init.mock.calls.at(-1) ?? [];
  return input as InitInput;
}

function init(chainId: number): Promise<unknown> {
  return initSafe4337Pack({
    chainId,
    signer: SIGNER,
    safeAddress: null,
    bundlerUrl: BUNDLER,
  });
}

beforeEach(() => {
  hoisted.init.mockReset();
  hoisted.init.mockImplementation(async (input: unknown) => seedFor(input as never));
  hoisted.safeInit.mockReset();
  hoisted.safeInit.mockResolvedValue({});
  hoisted.constructed.length = 0;
  for (const key of [...RPC_KEYS, ...PIMLICO_KEYS]) delete process.env[key];
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('initSafe4337Pack RPC resolution', () => {
  it('resolves Ethereum mainnet to ETHEREUM_RPC_URL', async () => {
    process.env.ETHEREUM_RPC_URL = 'https://mainnet.example';

    await init(CHAIN_IDS.ethereum);

    expect(lastInitInput().provider).toBe('https://mainnet.example');
  });

  it('resolves Sepolia to SEPOLIA_RPC_URL', async () => {
    process.env.SEPOLIA_RPC_URL = 'https://sepolia.example';

    await init(CHAIN_IDS.sepolia);

    expect(lastInitInput().provider).toBe('https://sepolia.example');
  });

  it('resolves Base to BASE_RPC_URL (the per-chain vault rail)', async () => {
    process.env.BASE_RPC_URL = 'https://base.example';

    await init(CHAIN_IDS.base);

    expect(lastInitInput().provider).toBe('https://base.example');
  });

  it('resolves Arbitrum One to ARBITRUM_RPC_URL (the per-chain vault rail)', async () => {
    process.env.ARBITRUM_RPC_URL = 'https://arbitrum.example';

    await init(CHAIN_IDS.arbitrum);

    expect(lastInitInput().provider).toBe('https://arbitrum.example');
  });

  it('refuses an unsupported chain and names the chain', async () => {
    process.env.ETHEREUM_RPC_URL = 'https://mainnet.example';

    // Base Sepolia is deliberately still unsupported (Arbitrum/Base mainnet
    // were added to the vault rail, but the deferred testnets were not).
    await expect(init(CHAIN_IDS.baseSepolia)).rejects.toThrow(
      String(CHAIN_IDS.baseSepolia),
    );
    await expect(init(CHAIN_IDS.baseSepolia)).rejects.toThrow(/no RPC variable/);
    expect(hoisted.init).not.toHaveBeenCalled();
  });

  it('refuses a supported chain whose RPC variable is missing, naming it', async () => {
    await expect(init(CHAIN_IDS.ethereum)).rejects.toThrow(
      /ETHEREUM_RPC_URL is not set/,
    );
    expect(hoisted.init).not.toHaveBeenCalled();
  });
});

describe('initSafe4337Pack paymaster options', () => {
  it('forwards the configured Pimlico sponsorship policy', async () => {
    process.env.SEPOLIA_RPC_URL = 'https://sepolia.example';
    process.env.PIMLICO_API_KEY = 'pim_test';
    process.env.PIMLICO_POLICY_ID = 'sp_test';

    await init(CHAIN_IDS.sepolia);

    expect(lastInitInput().paymasterOptions).toMatchObject({
      isSponsored: true,
      sponsorshipPolicyId: 'sp_test',
    });
  });

  it('falls back to the env policy when readPimlicoConfig cannot yield one', async () => {
    // No API key, so `readPimlicoConfig` returns null; the env read is the
    // documented fallback and must still forward the policy.
    process.env.SEPOLIA_RPC_URL = 'https://sepolia.example';
    process.env.PIMLICO_POLICY_ID = 'sp_env_only';

    await init(CHAIN_IDS.sepolia);

    expect(lastInitInput().paymasterOptions).toMatchObject({
      isSponsored: true,
      sponsorshipPolicyId: 'sp_env_only',
    });
  });

  it('attaches no policy when none is configured, and stays sponsored', async () => {
    process.env.SEPOLIA_RPC_URL = 'https://sepolia.example';

    await init(CHAIN_IDS.sepolia);

    const options = lastInitInput().paymasterOptions;
    expect(options).not.toHaveProperty('sponsorshipPolicyId');
    expect(options.isSponsored).toBe(true);
  });
});
