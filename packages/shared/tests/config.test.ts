import { describe, expect, it } from 'vitest';
import {
  CHAIN_IDS,
  CHAIN_ENV_CONFIG,
  CHAIN_ENVIRONMENTS,
  DEFAULT_CHAIN_ENV,
  chainByChainId,
  chainEnvironmentConfig,
} from '../src/index.js';

/**
 * The chain-environment contract (EXE-010).
 *
 * These tests pin the *names* and the chain selection, and they deliberately
 * assert that no treasury address or RPC URL is stored in the shared config:
 * the contract says mainnet funding is not supplied, so the only correct
 * behaviour is for the value to come from the environment at runtime, or not at
 * all.
 */

describe('chain environments', () => {
  it('lists testnet then mainnet, and keeps testnet the default', () => {
    expect([...CHAIN_ENVIRONMENTS]).toEqual(['testnet', 'mainnet']);
    // Iteration 1 was all-testnet; enabling mainnet is explicit, never a
    // fallback (week-1 contract section 2 item 7).
    expect(DEFAULT_CHAIN_ENV).toBe('testnet');
  });

  it('settles testnet on Sepolia with the original variable names', () => {
    const config = CHAIN_ENV_CONFIG.testnet;
    expect(config.chain.chainId).toBe(CHAIN_IDS.sepolia);
    expect(config.isMainnet).toBe(false);
    expect(config.rpcUrlEnvVar).toBe('SEPOLIA_RPC_URL');
    expect(config.treasuryEnvVar).toBe('TREASURY_ADDRESS');
  });

  it('settles mainnet on Ethereum chain id 1 with its own variables', () => {
    const config = CHAIN_ENV_CONFIG.mainnet;
    expect(config.chain.chainId).toBe(CHAIN_IDS.ethereum);
    expect(config.chain.chainId).toBe(1);
    expect(config.chain.env).toBe('mainnet');
    expect(config.isMainnet).toBe(true);
    expect(config.rpcUrlEnvVar).toBe('ETHEREUM_RPC_URL');
    expect(config.treasuryEnvVar).toBe('MAINNET_TREASURY_ADDRESS');
  });

  it('resolves the mainnet chain from the registry, not a duplicate', () => {
    expect(CHAIN_ENV_CONFIG.mainnet.chain).toBe(chainByChainId(1));
  });

  it('reads mainnet USDC from the external Circle deployment', () => {
    const usdc = CHAIN_ENV_CONFIG.mainnet.chain.usdcAddress;
    expect(usdc.provenance).toBe('external');
    expect(usdc.value).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
  });

  it('stores variable names only, never a treasury value', () => {
    for (const env of CHAIN_ENVIRONMENTS) {
      const config = CHAIN_ENV_CONFIG[env];
      expect(Object.keys(config).sort()).toEqual([
        'chain',
        'env',
        'isMainnet',
        'rpcUrlEnvVar',
        'treasuryEnvVar',
      ]);
      // The two environment-variable fields are names, not addresses/URLs.
      expect(config.treasuryEnvVar).not.toMatch(/^0x/);
      expect(config.rpcUrlEnvVar).not.toMatch(/^https?:/);
    }
  });

  it('exposes a pure accessor for one environment', () => {
    expect(chainEnvironmentConfig('mainnet')).toBe(CHAIN_ENV_CONFIG.mainnet);
    expect(chainEnvironmentConfig('testnet')).toBe(CHAIN_ENV_CONFIG.testnet);
  });
});
