import { describe, expect, it } from 'vitest';
import {
  CHAIN_IDS,
  chainByChainId,
  chainsForEnv,
  productChainKeys,
  TESTNET_CHAINS,
} from '../src/index.js';

describe('chain registry', () => {
  it('freezes the six chain ids from the contract', () => {
    expect(CHAIN_IDS).toEqual({
      ethereum: 1,
      sepolia: 11155111,
      arbitrum: 42161,
      arbitrumSepolia: 421614,
      base: 8453,
      baseSepolia: 84532,
    });
  });

  it('iteration 1 activates exactly the three testnets', () => {
    expect(chainsForEnv('testnet')).toHaveLength(3);
    expect(TESTNET_CHAINS.map((c) => c.chainId)).toEqual([11155111, 421614, 84532]);
    expect(TESTNET_CHAINS.every((c) => c.env === 'testnet')).toBe(true);
  });

  it('covers the three product chains', () => {
    expect(productChainKeys()).toEqual(['ethereum', 'arbitrum', 'base']);
  });

  it('resolves a chain by id', () => {
    expect(chainByChainId(11155111)?.name).toBe('Ethereum Sepolia');
    expect(chainByChainId(999999)).toBeUndefined();
  });

  it('seeds a non-zero USDC address for every testnet, sourced externally', () => {
    for (const chain of TESTNET_CHAINS) {
      expect(chain.usdcAddress.value).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(chain.usdcAddress.value).not.toBe('0x0000000000000000000000000000000000000000');
      expect(chain.usdcAddress.provenance).toBe('external');
    }
  });

  it('does not claim a deployed KadeLock address in Week 1', () => {
    // KadeLock is compiled and tested only in Week 1 (contract section 6.2).
    for (const chain of TESTNET_CHAINS) {
      expect(chain.kadeLockAddress.value).toBeNull();
      expect(chain.kadeLockAddress.provenance).toBe('arbitrary');
    }
  });
});
