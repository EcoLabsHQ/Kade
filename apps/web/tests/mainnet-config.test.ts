import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHAIN_ENV_CONFIG } from '@kade/shared';
import { isMainnetConfigured, readMainnetConfig } from '@/lib/config/mainnet';

/**
 * The server-side mainnet configuration (EXE-010).
 *
 * The module must only report a live rail when both the project-supplied RPC
 * and treasury are present, must take the token and chain id from the frozen
 * registry, and must never fall back to the testnet values. Nothing here is a
 * real mainnet value.
 */

const ORIGINAL_ENV = { ...process.env };

/** A valid EVM address for tests. Not a real treasury. */
const ADDRESS = '0x37d9bcb63118cbd2cde1d0e24379a876d687738a';
const RPC = 'https://mainnet.example';

function configure(overrides: Record<string, string | undefined> = {}): void {
  delete process.env.MAINNET_TREASURY_ADDRESS;
  delete process.env.ETHEREUM_RPC_URL;
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe('readMainnetConfig', () => {
  it('is null when nothing is configured', () => {
    configure();
    expect(readMainnetConfig()).toBeNull();
  });

  it('is null when only the treasury is present', () => {
    configure({ MAINNET_TREASURY_ADDRESS: ADDRESS });
    expect(readMainnetConfig()).toBeNull();
  });

  it('is null when only the RPC endpoint is present', () => {
    configure({ ETHEREUM_RPC_URL: RPC });
    expect(readMainnetConfig()).toBeNull();
  });

  it('is null when the treasury is malformed, and invents nothing', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    configure({ MAINNET_TREASURY_ADDRESS: 'not-an-address', ETHEREUM_RPC_URL: RPC });
    expect(readMainnetConfig()).toBeNull();
  });

  it('does not fall back to the Sepolia rail', () => {
    configure({
      TREASURY_ADDRESS: ADDRESS,
      SEPOLIA_RPC_URL: 'https://sepolia.example',
    });
    expect(readMainnetConfig()).toBeNull();
  });

  it('assembles the full config from the registry when configured', () => {
    configure({ MAINNET_TREASURY_ADDRESS: ADDRESS, ETHEREUM_RPC_URL: RPC });

    expect(readMainnetConfig()).toEqual({
      chainId: 1,
      treasury: ADDRESS,
      token: CHAIN_ENV_CONFIG.mainnet.chain.usdcAddress.value,
      rpcUrl: RPC,
    });
  });

  it('isMainnetConfigured mirrors readMainnetConfig', () => {
    configure();
    expect(isMainnetConfigured()).toBe(false);

    configure({ MAINNET_TREASURY_ADDRESS: ADDRESS, ETHEREUM_RPC_URL: RPC });
    expect(isMainnetConfigured()).toBe(true);
  });
});
