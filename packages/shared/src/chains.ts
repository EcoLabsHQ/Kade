/**
 * Chains, tokens and registries.
 *
 * Sources:
 *   - docs/week-1-frozen-delivery-contract.md section 3 (EXE-002): the three
 *     target chains and their testnets must be migration-seeded and readable
 *     by the application.
 *   - docs/planning/kade-mvp-build-document-v7.docx section 9, `chains` table:
 *     chain_id, name, usdc_address, kadelock_address, eas_address,
 *     paymaster_policy_id, explorer_url.
 *   - docs/week-1-frozen-delivery-contract.md section 2, item 7: iteration 1 is
 *     all-testnet. Ethereum Sepolia deploys; Base Sepolia is predicted only.
 *     Arbitrum was dropped from iteration 1 (contract v1.6) and is marked
 *     inactive below so it can be switched back on without code changes.
 *
 * USDC addresses are taken from Circle's published USDC contract address list.
 * EAS addresses are taken from the EAS project's published deployments.
 * KadeLock is compiled but not deployed in Week 1 (contract section 6.2), so
 * its address is an [arbitrary] placeholder.
 */

import { sourced, type Sourced } from './provenance.js';

/** Chain ids are frozen by the contract. */
export const CHAIN_IDS = {
  ethereum: 1,
  sepolia: 11155111,
  arbitrum: 42161,
  arbitrumSepolia: 421614,
  base: 8453,
  baseSepolia: 84532,
} as const;

export type ChainId = (typeof CHAIN_IDS)[keyof typeof CHAIN_IDS];

export type ChainFamily = 'ethereum' | 'arbitrum' | 'base';
export type ChainEnv = 'mainnet' | 'testnet';

export interface ChainConfig {
  /** Kade's product-chain key. Stable across mainnet/testnet pairs. */
  readonly key: ChainFamily;
  /**
   * Whether iteration 1 uses this chain.
   *
   * [documented] The project owner dropped Arbitrum from the iteration-1 set,
   * which is what lets the Safe release be v1.5.0: that version has no Arbitrum
   * Sepolia deployment. The definitions stay in the registry so the chain can be
   * switched back on by configuration (contract v1.6).
   */
  readonly active: boolean;
  readonly env: ChainEnv;
  readonly chainId: ChainId;
  readonly name: string;
  /** USDC. [external] Circle. */
  readonly usdcAddress: Sourced<`0x${string}`>;
  /** EAS core contract. [external] EAS. */
  readonly easAddress: Sourced<`0x${string}`>;
  /** EAS schema registry. [external] EAS. */
  readonly schemaRegistryAddress: Sourced<`0x${string}`>;
  /**
   * KadeLock. Week 1 is compile-and-test only, so this is an [arbitrary]
   * placeholder until the Onchain gate approves deployment.
   */
  readonly kadeLockAddress: Sourced<`0x${string}` | null>;
  /**
   * Pimlico policy id. Paymaster policy beyond the Week 1 Safe deployment is
   * out of scope (contract section 9).
   */
  readonly paymasterPolicyId: Sourced<string | null>;
  readonly explorerUrl: string;
}

const ZERO = '0x0000000000000000000000000000000000000000' as const;

/** Chains active in iteration 1. Testnet only (contract section 2, item 7). */
export const TESTNET_CHAINS: readonly ChainConfig[] = [
  {
    key: 'ethereum',
    env: 'testnet',
    active: true,
    chainId: CHAIN_IDS.sepolia,
    name: 'Ethereum Sepolia',
    usdcAddress: sourced(
      '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      'external',
      'Circle USDC contract addresses, testnet table',
    ),
    easAddress: sourced(
      '0xC2679fBD37d54388Ce493F1DB75320D236e1815e',
      'external',
      'EAS deployments, Sepolia v0.26',
    ),
    schemaRegistryAddress: sourced(
      '0x0a7E2Ff54e76B8E6659aedc9103FB21c038050D0',
      'external',
      'EAS deployments, Sepolia v0.26',
    ),
    kadeLockAddress: sourced(null, 'arbitrary', 'compiled and tested only in Week 1'),
    paymasterPolicyId: sourced(null, 'arbitrary', 'paymaster policy is out of Week 1 scope'),
    explorerUrl: 'https://sepolia.etherscan.io',
  },
  {
    key: 'arbitrum',
    env: 'testnet',
    active: false,
    chainId: CHAIN_IDS.arbitrumSepolia,
    name: 'Arbitrum Sepolia',
    usdcAddress: sourced(
      '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
      'external',
      'Circle USDC contract addresses, testnet table',
    ),
    easAddress: sourced(
      '0x4200000000000000000000000000000000000021',
      'external',
      'OP-stack EAS predeploy',
    ),
    schemaRegistryAddress: sourced(
      '0x4200000000000000000000000000000000000020',
      'external',
      'OP-stack schema registry predeploy',
    ),
    kadeLockAddress: sourced(null, 'arbitrary', 'L2 deployment is out of Week 1 scope'),
    paymasterPolicyId: sourced(null, 'arbitrary'),
    explorerUrl: 'https://sepolia.arbiscan.io',
  },
  {
    key: 'base',
    env: 'testnet',
    active: true,
    chainId: CHAIN_IDS.baseSepolia,
    name: 'Base Sepolia',
    usdcAddress: sourced(
      '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      'external',
      'Circle USDC contract addresses, testnet table',
    ),
    easAddress: sourced(
      '0x4200000000000000000000000000000000000021',
      'external',
      'OP-stack EAS predeploy',
    ),
    schemaRegistryAddress: sourced(
      '0x4200000000000000000000000000000000000020',
      'external',
      'OP-stack schema registry predeploy',
    ),
    kadeLockAddress: sourced(null, 'arbitrary', 'L2 deployment is out of Week 1 scope'),
    paymasterPolicyId: sourced(null, 'arbitrary'),
    explorerUrl: 'https://sepolia.basescan.org',
  },
];

/**
 * Reserved for the post-Week-1 mainnet iteration. Present so the chain list is
 * complete and mainnet can be switched on by configuration, per the build
 * guide's "adding a fourth chain must be a config change with no code edit".
 */
export const MAINNET_CHAINS: readonly ChainConfig[] = [
  {
    key: 'ethereum',
    env: 'mainnet',
    active: true,
    chainId: CHAIN_IDS.ethereum,
    name: 'Ethereum',
    usdcAddress: sourced(
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      'external',
      'Circle USDC contract addresses, mainnet table',
    ),
    easAddress: sourced(ZERO, 'arbitrary', 'mainnet EAS address not verified in Week 1'),
    schemaRegistryAddress: sourced(ZERO, 'arbitrary', 'mainnet registry not verified in Week 1'),
    kadeLockAddress: sourced(null, 'arbitrary', 'no mainnet deployment in Week 1'),
    paymasterPolicyId: sourced(null, 'arbitrary'),
    explorerUrl: 'https://etherscan.io',
  },
  {
    key: 'arbitrum',
    env: 'mainnet',
    active: false,
    chainId: CHAIN_IDS.arbitrum,
    name: 'Arbitrum One',
    usdcAddress: sourced(
      '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      'external',
      'Circle USDC contract addresses, mainnet table',
    ),
    easAddress: sourced(ZERO, 'arbitrary'),
    schemaRegistryAddress: sourced(ZERO, 'arbitrary'),
    kadeLockAddress: sourced(null, 'arbitrary', 'no mainnet deployment in Week 1'),
    paymasterPolicyId: sourced(null, 'arbitrary'),
    explorerUrl: 'https://arbiscan.io',
  },
  {
    key: 'base',
    env: 'mainnet',
    active: true,
    chainId: CHAIN_IDS.base,
    name: 'Base',
    usdcAddress: sourced(
      '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      'external',
      'Circle USDC contract addresses, mainnet table',
    ),
    easAddress: sourced(ZERO, 'arbitrary'),
    schemaRegistryAddress: sourced(ZERO, 'arbitrary'),
    kadeLockAddress: sourced(null, 'arbitrary', 'no mainnet deployment in Week 1'),
    paymasterPolicyId: sourced(null, 'arbitrary'),
    explorerUrl: 'https://basescan.org',
  },
];

export const ALL_CHAINS: readonly ChainConfig[] = [...TESTNET_CHAINS, ...MAINNET_CHAINS];

/** The chains iteration 1 actually uses. */
export function chainsForEnv(env: ChainEnv): readonly ChainConfig[] {
  return (env === 'testnet' ? TESTNET_CHAINS : MAINNET_CHAINS).filter(
    (chain) => chain.active,
  );
}

/**
 * Chains defined but switched off for iteration 1.
 *
 * Kept rather than deleted so re-enabling Arbitrum is a configuration change,
 * and so nothing has to pretend the chain does not exist.
 */
export function deferredChains(env: ChainEnv): readonly ChainConfig[] {
  return (env === 'testnet' ? TESTNET_CHAINS : MAINNET_CHAINS).filter(
    (chain) => !chain.active,
  );
}

export function chainByChainId(chainId: number): ChainConfig | undefined {
  return ALL_CHAINS.find((c) => c.chainId === chainId);
}

/**
 * D4 requires that the resident Safe resolves to the same address on every
 * configured chain. This guards the configuration, not the cryptography: the
 * address itself is derived from frozen deployment inputs.
 */
export function productChainKeys(chains: readonly ChainConfig[] = TESTNET_CHAINS): ChainFamily[] {
  return [...new Set(chains.map((c) => c.key))];
}
