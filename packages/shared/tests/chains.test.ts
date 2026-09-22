import { describe, expect, it } from 'vitest';
import {
  CHAIN_IDS,
  chainByChainId,
  chainsForEnv,
  deferredChains,
  MAINNET_CHAINS,
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

  it('iteration 1 activates Ethereum Sepolia and Base Sepolia', () => {
    // Contract v1.6: Arbitrum was dropped from the iteration-1 set, which is
    // what makes Safe v1.5.0 usable (it has no Arbitrum Sepolia deployment).
    expect(chainsForEnv('testnet').map((c) => c.chainId)).toEqual([11155111, 84532]);
    expect(chainsForEnv('testnet').every((c) => c.active)).toBe(true);
  });

  it('keeps Arbitrum defined but deferred, so it can be switched back on', () => {
    const deferred = deferredChains('testnet');
    expect(deferred.map((c) => c.chainId)).toEqual([421614]);
    expect(deferred.every((c) => !c.active)).toBe(true);
    // The definitions are still complete.
    expect(TESTNET_CHAINS.map((c) => c.chainId)).toEqual([11155111, 421614, 84532]);
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

describe('mainnet chain registry (iteration 2)', () => {
  it('defines Ethereum chain id 1 and leaves Arbitrum deferred', () => {
    const ethereum = MAINNET_CHAINS.find((c) => c.chainId === CHAIN_IDS.ethereum);
    expect(ethereum?.env).toBe('mainnet');
    expect(ethereum?.active).toBe(true);
    expect(ethereum?.name).toBe('Ethereum');
    // Arbitrum stays defined but switched off (week-2 contract section 2.2).
    expect(deferredChains('mainnet').map((c) => c.chainId)).toContain(
      CHAIN_IDS.arbitrum,
    );
  });

  it('sources the Ethereum mainnet USDC address externally, not locally', () => {
    const ethereum = chainByChainId(CHAIN_IDS.ethereum);
    expect(ethereum?.usdcAddress.value).toBe(
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    );
    expect(ethereum?.usdcAddress.provenance).toBe('external');
  });

  it('does not claim a mainnet EAS address that Week 1 did not verify', () => {
    // The mainnet EAS/registry addresses stay [arbitrary] until verified; the
    // config agent must not invent one (week-2 contract Appendix C1).
    const ethereum = chainByChainId(CHAIN_IDS.ethereum);
    expect(ethereum?.easAddress.provenance).toBe('arbitrary');
    expect(ethereum?.schemaRegistryAddress.provenance).toBe('arbitrary');
  });
});
