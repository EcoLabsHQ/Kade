import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHAIN_ENV_CONFIG } from '@kade/shared';
import {
  readEthereumRpcUrl,
  readMainnetTreasuryAddress,
  readRpcUrlFor,
  readTreasuryAddress,
  readTreasuryAddressFor,
} from '@/lib/env';

/**
 * The mainnet environment readers (EXE-010).
 *
 * The existing Sepolia behaviour must be untouched, the new mainnet keys must
 * be read as server-only values, and a missing or malformed value must resolve
 * to null rather than a fabricated address or endpoint.
 */

const ORIGINAL_ENV = { ...process.env };

/** A valid EVM address for tests. Not a real treasury. */
const ADDRESS = '0x37d9bcb63118cbd2cde1d0e24379a876d687738a';

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe('readEthereumRpcUrl', () => {
  it('is null when unset and trims when set', () => {
    delete process.env.ETHEREUM_RPC_URL;
    expect(readEthereumRpcUrl()).toBeNull();

    process.env.ETHEREUM_RPC_URL = '  https://mainnet.example  ';
    expect(readEthereumRpcUrl()).toBe('https://mainnet.example');
  });
});

describe('readMainnetTreasuryAddress', () => {
  it('is null when unset', () => {
    delete process.env.MAINNET_TREASURY_ADDRESS;
    expect(readMainnetTreasuryAddress()).toBeNull();
  });

  it('returns a well-formed address, whitespace-trimmed', () => {
    process.env.MAINNET_TREASURY_ADDRESS = `  ${ADDRESS}  `;
    expect(readMainnetTreasuryAddress()).toBe(ADDRESS);
  });

  it('ignores a malformed address instead of using it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.MAINNET_TREASURY_ADDRESS = 'not-an-address';

    expect(readMainnetTreasuryAddress()).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('does not fall back to the testnet treasury', () => {
    process.env.TREASURY_ADDRESS = ADDRESS;
    delete process.env.MAINNET_TREASURY_ADDRESS;

    expect(readTreasuryAddress()).toBe(ADDRESS);
    expect(readMainnetTreasuryAddress()).toBeNull();
  });
});

describe('readTreasuryAddress (Sepolia, unchanged)', () => {
  it('reads TREASURY_ADDRESS and rejects a malformed value', () => {
    process.env.TREASURY_ADDRESS = ADDRESS;
    expect(readTreasuryAddress()).toBe(ADDRESS);

    vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.TREASURY_ADDRESS = '0x1234';
    expect(readTreasuryAddress()).toBeNull();
  });
});

describe('chain-aware readers', () => {
  it('reads the treasury for the environment it is asked about', () => {
    process.env.TREASURY_ADDRESS = ADDRESS;
    process.env.MAINNET_TREASURY_ADDRESS = '0x1111111111111111111111111111111111111111';

    expect(readTreasuryAddressFor('testnet')).toBe(ADDRESS);
    expect(readTreasuryAddressFor('mainnet')).toBe(
      '0x1111111111111111111111111111111111111111',
    );
  });

  it('reads the RPC endpoint for the environment it is asked about', () => {
    process.env.SEPOLIA_RPC_URL = 'https://sepolia.example';
    process.env.ETHEREUM_RPC_URL = 'https://mainnet.example';

    expect(readRpcUrlFor('testnet')).toBe('https://sepolia.example');
    expect(readRpcUrlFor('mainnet')).toBe('https://mainnet.example');
  });

  it('agrees with the shared environment contract on every variable name', () => {
    for (const env of ['testnet', 'mainnet'] as const) {
      const config = CHAIN_ENV_CONFIG[env];
      process.env[config.treasuryEnvVar] = ADDRESS;
      process.env[config.rpcUrlEnvVar] = `https://${env}.example`;

      expect(readTreasuryAddressFor(env)).toBe(ADDRESS);
      expect(readRpcUrlFor(env)).toBe(`https://${env}.example`);

      delete process.env[config.treasuryEnvVar];
      delete process.env[config.rpcUrlEnvVar];
    }
  });
});
