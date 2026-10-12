import { describe, expect, it, vi } from 'vitest';

/**
 * The wallet must be able to reach every chain Holdings reads.
 *
 * A holding is moved on the chain it was read from, so a chain the balance read
 * targets but the wallet cannot reach would leave a displayed holding unmovable.
 * This pins that `WALLET_NETWORKS` covers every `EVM_READ_CHAINS` entry, and
 * that the **active settlement chain leads** — the fee/service-fee controls
 * (contract 8.9) now settle on whichever chain `KADE_CHAIN_ENV` selects and
 * switch to it explicitly, so the default entry is the mainnet settlement chain.
 */

vi.mock('@reown/appkit-adapter-wagmi', () => ({
  WagmiAdapter: class {},
}));

import {
  WALLET_NETWORKS,
  appkitNetworkForChainId,
} from '@/lib/wallet/appkit';
import { EVM_READ_CHAINS } from '@/lib/wealth/evm';

const MAINNET_ID = 1;
const SEPOLIA_ID = 11155111;
const ARBITRUM_ID = 42161;
const BASE_ID = 8453;

describe('WALLET_NETWORKS', () => {
  it('keeps Ethereum mainnet first, the settlement chain the fee controls lead with', () => {
    expect(Number(WALLET_NETWORKS[0]!.id)).toBe(MAINNET_ID);
  });

  it('reaches every chain the balance reads target, so no listed holding is unmovable', () => {
    const walletIds = new Set(WALLET_NETWORKS.map((network) => Number(network.id)));
    for (const chain of EVM_READ_CHAINS) {
      expect(walletIds.has(chain.chainId)).toBe(true);
    }
    // The invariant is a subset, not equality: the wallet may reach more.
    expect(EVM_READ_CHAINS.length).toBeGreaterThan(0);
  });

  it('includes Ethereum mainnet, Base and Arbitrum One explicitly', () => {
    const ids = WALLET_NETWORKS.map((network) => Number(network.id));
    expect(ids).toContain(1);
    expect(ids).toContain(8453);
    expect(ids).toContain(ARBITRUM_ID);
  });
});

describe('appkitNetworkForChainId', () => {
  it('maps each settlement chain id to its AppKit network', () => {
    expect(Number(appkitNetworkForChainId(MAINNET_ID)?.id)).toBe(MAINNET_ID);
    expect(Number(appkitNetworkForChainId(SEPOLIA_ID)?.id)).toBe(SEPOLIA_ID);
    expect(Number(appkitNetworkForChainId(BASE_ID)?.id)).toBe(BASE_ID);
    expect(Number(appkitNetworkForChainId(ARBITRUM_ID)?.id)).toBe(ARBITRUM_ID);
  });

  it('returns undefined for a chain AppKit cannot reach', () => {
    expect(appkitNetworkForChainId(999999)).toBeUndefined();
  });
});
