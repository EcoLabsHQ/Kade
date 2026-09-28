import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAIN_IDS } from '@kade/shared';
import type { Address } from 'viem';
import type { PasskeySigner } from '@/lib/safe/passkey-signer';

/**
 * The environment-wired `Safe4337Pack.init`: the RPC resolution and the Pimlico
 * paymaster options.
 *
 * The SDK is mocked at the module seam, so no bundler and no network are
 * touched. The assertions are about the two defects this task fixes: mainnet
 * must resolve its own RPC variable (and an unsupported chain must refuse), and
 * the configured Pimlico sponsorship policy must actually be forwarded to the
 * SDK rather than silently dropped.
 */

const hoisted = vi.hoisted(() => ({ init: vi.fn() }));

vi.mock('@safe-global/relay-kit', () => ({
  Safe4337Pack: { init: hoisted.init },
}));

import { initSafe4337Pack } from '@/lib/safe/execute-safe-4337-env';

const BUNDLER = 'https://api.pimlico.io/v2/1/rpc?apikey=test';

const SIGNER: PasskeySigner = {
  rawId: 'cred-1',
  coordinates: { x: '1', y: '2' },
  verifierAddress: '0x4444444444444444444444444444444444444444' as Address,
};

const RPC_KEYS = ['SEPOLIA_RPC_URL', 'ETHEREUM_RPC_URL'] as const;
const PIMLICO_KEYS = ['PIMLICO_API_KEY', 'PIMLICO_POLICY_ID'] as const;

const ORIGINAL_ENV = { ...process.env };

interface InitInput {
  readonly provider: string;
  readonly paymasterOptions: Record<string, unknown>;
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
  hoisted.init.mockResolvedValue({});
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

  it('refuses an unsupported chain and names the chain', async () => {
    process.env.ETHEREUM_RPC_URL = 'https://mainnet.example';

    await expect(init(CHAIN_IDS.base)).rejects.toThrow(String(CHAIN_IDS.base));
    await expect(init(CHAIN_IDS.base)).rejects.toThrow(/no RPC variable/);
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
