import { describe, expect, it } from 'vitest';
import {
  loadVaultHoldings,
  type MorphoPositionRead,
} from '@/lib/wealth/vault-holdings';
import type { MorphoVaultConfig } from '@/lib/invest/morpho-config';
import type { EvmChainBalance } from '@/lib/wealth/types';

/**
 * The Safe's "Qualified vaults" read.
 *
 * Nothing persists a vault position, so the section is fed by an on-chain read
 * pointed at the Safe. These tests stub the read seam, so they are offline and
 * deterministic, and pin the three honesty cases the section must get right:
 *
 *   1. a read that produced a balance / a Morpho position yields chain +
 *      instrument + amount rows;
 *   2. a successful empty read yields no rows, so the truthful empty state stays;
 *   3. a failed read yields a row with the real reason and `—`, never a `0`.
 */

const SAFE = '0x5Af1000000000000000000000000000000000c09D';

/** The two chains the app reads, matching `EVM_READ_CHAINS`. */
const CHAINS = [
  { chainId: 1, name: 'Ethereum', symbol: 'ETH' },
  { chainId: 8453, name: 'Base', symbol: 'ETH' },
] as const;

/** The mainnet MetaMorpho rail, as `readMorphoVaultConfig` would resolve it. */
const MORPHO: MorphoVaultConfig = {
  vault: '0x1111111111111111111111111111111111111111',
  usdc: '0x2222222222222222222222222222222222222222',
  chainId: 1,
};

function chainBalance(
  overrides: Partial<EvmChainBalance> & { chainId: number; name: string },
): EvmChainBalance {
  return {
    nativeSymbol: 'ETH',
    nativeAmount: '0.000000',
    nativeUsd: 0,
    // A successful read of an empty USDC balance; pass `usdc: null` to model a
    // failed sub-read.
    usdc: { symbol: 'USDC', amount: '0.000000', usd: 0 },
    usd: 0,
    ...overrides,
  };
}

/** A Safe holding a real balance on Ethereum and some ETH on Base. */
function fundedSafe(): EvmChainBalance[] {
  return [
    chainBalance({
      chainId: 1,
      name: 'Ethereum',
      nativeAmount: '1.500000',
      nativeUsd: 5000,
      usdc: { symbol: 'USDC', amount: '2500.000000', usd: 2500 },
      usd: 7500,
    }),
    chainBalance({
      chainId: 8453,
      name: 'Base',
      nativeAmount: '0.500000',
      nativeUsd: 1500,
      usd: 1500,
    }),
  ];
}

describe('loadVaultHoldings', () => {
  it('reads the Safe’s balances and Morpho position into chain + instrument + amount rows', async () => {
    const rows = await loadVaultHoldings(SAFE, {
      chains: CHAINS,
      morphoConfig: MORPHO,
      readBalances: async () => fundedSafe(),
      readMorpho: async () => ({
        status: 'read',
        shares: 1_000_000n,
        assetsUsdc: 25_000_000_000n,
      }),
    });

    // Nothing unread: every row is a real holding on a named chain.
    expect(rows.every((row) => row.readError === null)).toBe(true);
    expect(rows.map((row) => row.kind)).toEqual([
      'native',
      'usdc',
      'native',
      'morpho',
    ]);

    const ether = rows.find(
      (row) => row.kind === 'native' && row.chainId === 1,
    )!;
    expect(ether).toMatchObject({
      chainName: 'Ethereum',
      symbol: 'ETH',
      name: 'Ether',
      amount: '1.500000 ETH',
    });

    const usdc = rows.find((row) => row.kind === 'usdc')!;
    expect(usdc).toMatchObject({
      chainId: 1,
      chainName: 'Ethereum',
      symbol: 'USDC',
      amount: '2500.000000 USDC',
    });

    const baseEth = rows.find(
      (row) => row.kind === 'native' && row.chainId === 8453,
    )!;
    expect(baseEth).toMatchObject({ chainName: 'Base', amount: '0.500000 ETH' });

    // The Morpho position is converted to USDC and sits on the rail's chain;
    // it is never implied to be on another chain.
    const morpho = rows.find((row) => row.kind === 'morpho')!;
    expect(morpho).toMatchObject({
      chainId: 1,
      chainName: 'Ethereum',
      symbol: 'MM',
      name: 'MetaMorpho USDC vault',
      amount: '25000.000000 USDC',
      usd: 25000,
    });
  });

  it('returns no rows when the read succeeds and the Safe holds nothing', async () => {
    const rows = await loadVaultHoldings(SAFE, {
      chains: CHAINS,
      morphoConfig: MORPHO,
      readBalances: async () => [
        chainBalance({ chainId: 1, name: 'Ethereum' }),
        chainBalance({ chainId: 8453, name: 'Base' }),
      ],
      readMorpho: async () => ({ status: 'read', shares: 0n, assetsUsdc: 0n }),
    });

    // A genuine zero is an empty state, never a `0` row.
    expect(rows).toEqual([]);
  });

  it('shows a real reason for a chain the read did not produce, and never a 0', async () => {
    const rows = await loadVaultHoldings(SAFE, {
      chains: CHAINS,
      morphoConfig: null,
      // The provider produced nothing at all.
      readBalances: async () => [],
    });

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.kind).toBe('unread');
      expect(row.amount).toBe('—');
      expect(row.readError).toBeTruthy();
      expect(row.amount).not.toBe('0');
    }
    expect(rows[0]!.readError).toMatch(/could not be read/);
  });

  it('carries the thrown reason of a failed balance read', async () => {
    const rows = await loadVaultHoldings(SAFE, {
      chains: CHAINS,
      morphoConfig: null,
      readBalances: async () => {
        throw new Error('The explorer returned HTTP 503.');
      },
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]!.readError).toContain('HTTP 503');
    expect(rows.every((row) => row.amount === '—')).toBe(true);
  });

  it('surfaces a failed USDC sub-read as an unread row, not a silent gap', async () => {
    const rows = await loadVaultHoldings(SAFE, {
      chains: CHAINS,
      morphoConfig: null,
      readBalances: async () => [
        // The native read worked (zero) but the USDC read failed.
        chainBalance({ chainId: 1, name: 'Ethereum', usdc: null }),
        chainBalance({ chainId: 8453, name: 'Base', usdc: null }),
      ],
    });

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.kind === 'unread')).toBe(true);
    expect(rows[0]!.name).toBe('USDC');
    expect(rows[0]!.chainName).toBe('Ethereum');
    expect(rows[0]!.amount).toBe('—');
    expect(rows[0]!.readError).toMatch(
      /USDC balance on Ethereum could not be read/,
    );
  });

  it('surfaces the specific token sub-read reason instead of the generic sentence', async () => {
    const message =
      'Base (chain 8453): the balance provider is rate limiting this read (HTTP 429).';
    const rows = await loadVaultHoldings(SAFE, {
      chains: CHAINS,
      morphoConfig: null,
      readBalances: async () => [
        chainBalance({ chainId: 1, name: 'Ethereum', usdc: null }),
        chainBalance({
          chainId: 8453,
          name: 'Base',
          usdc: null,
          tokenFailure: {
            chainId: 8453,
            chainName: 'Base',
            reason: 'rejected',
            message,
          },
        }),
      ],
    });

    expect(rows).toHaveLength(2);
    const base = rows.find((row) => row.chainId === 8453)!;
    // The real reason, not "The USDC balance on Base could not be read."
    expect(base.readError).toBe(message);
    expect(base.amount).toBe('—');
    // The chain without a carrier keeps the generic fallback, unchanged.
    const ethereum = rows.find((row) => row.chainId === 1)!;
    expect(ethereum.readError).toMatch(
      /USDC balance on Ethereum could not be read/,
    );
  });

  it('shows a failed Morpho read with its reason and no amount', async () => {
    const rows = await loadVaultHoldings(SAFE, {
      chains: CHAINS,
      morphoConfig: MORPHO,
      readBalances: async () => [
        chainBalance({ chainId: 1, name: 'Ethereum' }),
        chainBalance({ chainId: 8453, name: 'Base' }),
      ],
      readMorpho: async (): Promise<MorphoPositionRead> => ({
        status: 'failed',
        reason: 'The vault position could not be read: execution reverted.',
      }),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!).toMatchObject({
      kind: 'morpho',
      chainName: 'Ethereum',
      amount: '—',
    });
    expect(rows[0]!.readError).toContain('execution reverted');
  });

  it('omits the Morpho row entirely when the rail is not configured', async () => {
    const rows = await loadVaultHoldings(SAFE, {
      chains: CHAINS,
      morphoConfig: null,
      readBalances: async () => [
        chainBalance({ chainId: 1, name: 'Ethereum' }),
        chainBalance({ chainId: 8453, name: 'Base' }),
      ],
      readMorpho: async () => {
        throw new Error('must not be called when the rail is absent');
      },
    });

    expect(rows).toEqual([]);
  });

  it('reads nothing for a missing Safe address', async () => {
    const rows = await loadVaultHoldings(null, {
      chains: CHAINS,
      morphoConfig: MORPHO,
      readBalances: async () => {
        throw new Error('must not be called without a Safe address');
      },
      readMorpho: async () => {
        throw new Error('must not be called without a Safe address');
      },
    });

    expect(rows).toEqual([]);
  });

  it('fails closed with a real reason when no mainnet RPC is configured', async () => {
    const previous = process.env.ETHEREUM_RPC_URL;
    delete process.env.ETHEREUM_RPC_URL;
    try {
      // No `readMorpho` injected: the real seam runs, and with no RPC it must
      // refuse before any network call rather than fabricate a position.
      const rows = await loadVaultHoldings(SAFE, {
        chains: CHAINS,
        morphoConfig: MORPHO,
        readBalances: async () => [
          chainBalance({ chainId: 1, name: 'Ethereum' }),
          chainBalance({ chainId: 8453, name: 'Base' }),
        ],
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]!).toMatchObject({ kind: 'morpho', amount: '—' });
      expect(rows[0]!.readError).toMatch(/RPC endpoint is not configured/);
    } finally {
      if (previous === undefined) delete process.env.ETHEREUM_RPC_URL;
      else process.env.ETHEREUM_RPC_URL = previous;
    }
  });
});
