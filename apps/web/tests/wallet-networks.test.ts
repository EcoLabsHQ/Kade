import { describe, expect, it, vi } from 'vitest';

/**
 * The wallet must be able to reach every chain Holdings reads.
 *
 * A holding is moved on the chain it was read from, so a chain the balance read
 * targets but the wallet cannot reach would leave a displayed holding unmovable.
 * This pins that `WALLET_NETWORKS` covers every `EVM_READ_CHAINS` entry, and
 * that Sepolia stays **first** — the fee/service-fee controls (contract 8.9)
 * connect and switch to it, and adding networks must not move them.
 */

vi.mock('@reown/appkit-adapter-wagmi', () => ({
  WagmiAdapter: class {},
}));

import { WALLET_NETWORKS } from '@/lib/wallet/appkit';
import { EVM_READ_CHAINS } from '@/lib/wealth/evm';

const SEPOLIA_ID = 11155111;

describe('WALLET_NETWORKS', () => {
  it('keeps Sepolia first, the chain the fee controls use', () => {
    expect(Number(WALLET_NETWORKS[0]!.id)).toBe(SEPOLIA_ID);
  });

  it('reaches every chain the balance reads target, so no listed holding is unmovable', () => {
    const walletIds = new Set(WALLET_NETWORKS.map((network) => Number(network.id)));
    for (const chain of EVM_READ_CHAINS) {
      expect(walletIds.has(chain.chainId)).toBe(true);
    }
  });

  it('includes Ethereum mainnet and Base explicitly', () => {
    const ids = WALLET_NETWORKS.map((network) => Number(network.id));
    expect(ids).toContain(1);
    expect(ids).toContain(8453);
  });
});
