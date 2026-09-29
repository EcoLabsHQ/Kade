import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import {
  CHAIN_IDS,
  chainByChainId,
  METAMORPHO_VAULT_DEPLOYMENTS,
  morphoVaultDeploymentForChain,
} from '@kade/shared';
import {
  isMorphoRailConfiguredForChain,
  isMorphoVaultConfiguredForChain,
  morphoChainName,
  readMorphoVaultConfigForChain,
  MORPHO_VAULT_ENV_KEYS,
} from '@/lib/invest/morpho-config';
import { prepareMorphoVaultDeposit } from '@/lib/invest/morpho-execution';

/**
 * The per-chain MetaMorpho vault rail (T23).
 *
 * The rail is one MetaMorpho USDC vault **per chain**: Ethereum mainnet, Base
 * and Arbitrum One. These tests are offline — no RPC, no network — and pin the
 * three properties the task requires:
 *
 *   1. each chain resolves to its **own** verified vault and USDC, from the
 *      pinned registry in `@kade/shared` (not from an address literal here);
 *   2. a chain with no vault fails closed with a message naming the chain and
 *      never borrows another chain's vault;
 *   3. the legacy env override still applies to Ethereum mainnet only, and a
 *      partial override fails closed rather than silently using the pinned one.
 *
 * The addresses below are the values the owner's research task verified; they
 * are duplicated here deliberately so a silent change to the registry fails.
 */

/** The three verified deployments, from the owner's verified table. */
const EXPECTED = {
  [CHAIN_IDS.ethereum]: {
    vault: '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB',
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  },
  [CHAIN_IDS.base]: {
    vault: '0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
  [CHAIN_IDS.arbitrum]: {
    vault: '0x5c0C306Aaa9F877de636f4d5822cA9F2E81563BA',
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  },
} as const;

const CHAINS = [CHAIN_IDS.ethereum, CHAIN_IDS.base, CHAIN_IDS.arbitrum];

const OTHER_VAULT = '0x1111222233334444555566667777888899990000';
const OTHER_USDC = '0x2222333344445555666677778888999900001111';

const SAFE = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';

describe('the pinned per-chain MetaMorpho vaults', () => {
  it('has a registry entry for exactly Ethereum, Base and Arbitrum', () => {
    expect(Object.keys(METAMORPHO_VAULT_DEPLOYMENTS).map(Number).sort()).toEqual(
      [...CHAINS].sort(),
    );
  });

  it('resolves each chain to its own verified vault and USDC', () => {
    for (const chainId of CHAINS) {
      const config = readMorphoVaultConfigForChain(chainId, {});
      expect(config, `chain ${chainId}`).not.toBeNull();
      expect(config?.chainId).toBe(chainId);
      expect(config?.vault).toBe(EXPECTED[chainId].vault);
      expect(config?.usdc).toBe(EXPECTED[chainId].usdc);
    }
  });

  it('stores EIP-55 canonical addresses that viem accepts unchanged', () => {
    for (const chainId of CHAINS) {
      const deployment = morphoVaultDeploymentForChain(chainId);
      expect(deployment).toBeDefined();
      expect(getAddress(deployment!.vault.value)).toBe(deployment!.vault.value);
      expect(getAddress(deployment!.usdc.value)).toBe(deployment!.usdc.value);
    }
  });

  it('keeps each vault distinct, so resolution cannot collapse to one chain', () => {
    const vaults = CHAINS.map(
      (chainId) => readMorphoVaultConfigForChain(chainId, {})?.vault,
    );
    expect(new Set(vaults).size).toBe(3);
  });

  it('agrees with the frozen chain registry on each chain’s canonical USDC', () => {
    for (const chainId of CHAINS) {
      expect(readMorphoVaultConfigForChain(chainId, {})?.usdc).toBe(
        chainByChainId(chainId)?.usdcAddress.value,
      );
    }
  });

  it('names each chain from the shared registry', () => {
    expect(morphoChainName(CHAIN_IDS.ethereum)).toBe('Ethereum');
    expect(morphoChainName(CHAIN_IDS.base)).toBe('Base');
    expect(morphoChainName(CHAIN_IDS.arbitrum)).toBe('Arbitrum One');
  });
});

describe('an unconfigured chain fails closed', () => {
  const UNKNOWN = 999999;

  it('resolves no vault for a chain with no pinned deployment', () => {
    expect(readMorphoVaultConfigForChain(UNKNOWN, {})).toBeNull();
    expect(isMorphoVaultConfiguredForChain(UNKNOWN, {})).toBe(false);
    // Even with an env override present, an unknown chain never borrows.
    expect(
      readMorphoVaultConfigForChain(UNKNOWN, {
        [MORPHO_VAULT_ENV_KEYS.vault]: OTHER_VAULT,
        [MORPHO_VAULT_ENV_KEYS.usdc]: OTHER_USDC,
      }),
    ).toBeNull();
  });

  it('refuses to build and names the chain, substituting no other vault', async () => {
    const result = await prepareMorphoVaultDeposit(
      { safeAddress: SAFE, amountUsdc: '10', chainId: UNKNOWN },
      { env: {}, mainnetConfigured: true },
    );

    expect(result.status).toBe('gated');
    if (result.status === 'gated') {
      expect(result.gate).toBe('vault-not-configured');
      expect(result.reason).toContain(String(UNKNOWN));
      expect(result.reason).toMatch(/no other chain/i);
      expect(result.plan).toBeUndefined();
    }
  });

  it('refuses a deferred chain (Base Sepolia) the same way', async () => {
    const result = await prepareMorphoVaultDeposit(
      { safeAddress: SAFE, amountUsdc: '10', chainId: CHAIN_IDS.baseSepolia },
      { env: {}, mainnetConfigured: true },
    );

    expect(result.status).toBe('gated');
    if (result.status === 'gated') {
      expect(result.gate).toBe('vault-not-configured');
      expect(result.reason).toContain(String(CHAIN_IDS.baseSepolia));
    }
  });
});

describe('explicit chain selection', () => {
  it('builds the named chain’s rail, not Ethereum’s', async () => {
    const result = await prepareMorphoVaultDeposit(
      { safeAddress: SAFE, amountUsdc: '10', chainId: CHAIN_IDS.base },
      { env: {}, mainnetConfigured: true },
    );

    expect(result.status).toBe('ready-to-execute');
    if (result.status === 'ready-to-execute') {
      expect(result.plan.chainId).toBe(CHAIN_IDS.base);
      expect(result.plan.vault).toBe(EXPECTED[CHAIN_IDS.base].vault);
      expect(result.plan.usdc).toBe(EXPECTED[CHAIN_IDS.base].usdc);
    }
  });

  it('reports per-chain rail readiness from that chain’s own RPC variable', () => {
    expect(
      isMorphoRailConfiguredForChain(CHAIN_IDS.base, {
        BASE_RPC_URL: 'https://base.example',
      }),
    ).toBe(true);
    // The Ethereum endpoint does not make the Base rail ready.
    expect(
      isMorphoRailConfiguredForChain(CHAIN_IDS.base, {
        ETHEREUM_RPC_URL: 'https://mainnet.example',
      }),
    ).toBe(false);
    expect(isMorphoRailConfiguredForChain(CHAIN_IDS.arbitrum, {})).toBe(false);
  });
});

describe('the legacy env override applies to Ethereum mainnet only', () => {
  const override = {
    [MORPHO_VAULT_ENV_KEYS.vault]: OTHER_VAULT,
    [MORPHO_VAULT_ENV_KEYS.usdc]: OTHER_USDC,
  };

  it('overrides the pinned Ethereum vault when both keys are present', () => {
    expect(readMorphoVaultConfigForChain(CHAIN_IDS.ethereum, override)).toEqual({
      vault: OTHER_VAULT,
      usdc: OTHER_USDC,
      chainId: CHAIN_IDS.ethereum,
    });
  });

  it('never overrides Base or Arbitrum', () => {
    for (const chainId of [CHAIN_IDS.base, CHAIN_IDS.arbitrum]) {
      const config = readMorphoVaultConfigForChain(chainId, override);
      expect(config?.vault).toBe(EXPECTED[chainId].vault);
      expect(config?.usdc).toBe(EXPECTED[chainId].usdc);
    }
  });

  it('fails closed on a partial override instead of using the pinned vault', () => {
    expect(
      readMorphoVaultConfigForChain(CHAIN_IDS.ethereum, {
        [MORPHO_VAULT_ENV_KEYS.vault]: OTHER_VAULT,
      }),
    ).toBeNull();
    expect(isMorphoVaultConfiguredForChain(CHAIN_IDS.ethereum, {})).toBe(true);
  });
});
