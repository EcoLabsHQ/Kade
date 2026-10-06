import { beforeEach, describe, expect, it } from 'vitest';
import { EVM_READ_CONCURRENCY } from '@/lib/wealth/evm';
import { loadVaultHoldings } from '@/lib/wealth/vault-holdings';
import type { MorphoVaultConfig } from '@/lib/invest/morpho-config';

/**
 * `loadVaultHoldings` overlaps the independent reads.
 *
 * The Safe's balances and its per-rail Morpho positions are independent reads,
 * but the loader used to await the balance read and then each rail in series, so
 * a navigation paid the sum of every read's latency. They now run together with
 * a small concurrency bound, while the rows keep the registry order.
 *
 * The tests record when each read is in flight and fail unless they overlap. A
 * serial implementation cannot have the balance read open while a rail is read,
 * nor two rails open at once, so the assertions are the negative control for the
 * old serial code.
 */

const SAFE = '0x5Af1000000000000000000000000000000000c09D';

const CHAINS = [
  { chainId: 1, name: 'Ethereum', symbol: 'ETH' },
  { chainId: 8453, name: 'Base', symbol: 'ETH' },
  { chainId: 42161, name: 'Arbitrum One', symbol: 'ETH' },
] as const;

const inFlight = new Set<string>();
const moments: string[][] = [];

beforeEach(() => {
  inFlight.clear();
  moments.length = 0;
});

function enter(tag: string): void {
  inFlight.add(tag);
  moments.push([...inFlight]);
}

function leave(tag: string): void {
  inFlight.delete(tag);
}

/** Resolve after a macrotask, so a concurrent read can enter while it is open. */
function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function maxConcurrent(prefix: string): number {
  return moments.reduce(
    (max, moment) =>
      Math.max(max, moment.filter((tag) => tag.startsWith(prefix)).length),
    0,
  );
}

function overlaps(...tags: readonly string[]): boolean {
  return moments.some((moment) => tags.every((tag) => moment.includes(tag)));
}

function config(chainId: number): MorphoVaultConfig {
  return {
    vault: `0x${String(chainId).padStart(40, '0')}` as `0x${string}`,
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    chainId,
  };
}

describe('loadVaultHoldings overlaps balances and rails', () => {
  it('has the balance read and the vault rails in flight together', async () => {
    await loadVaultHoldings(SAFE, {
      chains: CHAINS,
      morphoConfigs: [config(1), config(8453), config(42161)],
      readBalances: async () => {
        enter('balances');
        await settle();
        leave('balances');
        return [];
      },
      readMorpho: async ({ config: rail }) => {
        const tag = `morpho:${rail.chainId}`;
        enter(tag);
        await settle();
        leave(tag);
        return { status: 'read', shares: 0n, assetsUsdc: 0n };
      },
    });

    // The balance read used to complete before any rail was attempted.
    expect(overlaps('balances', 'morpho:1')).toBe(true);
    // And the rails overlap one another instead of running in series.
    expect(overlaps('morpho:1', 'morpho:8453')).toBe(true);
    expect(maxConcurrent('morpho:')).toBeGreaterThanOrEqual(2);
  });

  it('keeps the rails under the bound and preserves registry order', async () => {
    const rows = await loadVaultHoldings(SAFE, {
      chains: CHAINS,
      morphoConfigs: [config(1), config(8453), config(42161)],
      readBalances: async () => [],
      readMorpho: async ({ config: rail }) => {
        const tag = `morpho:${rail.chainId}`;
        enter(tag);
        await settle();
        leave(tag);
        return {
          status: 'read',
          shares: 1_000_000n,
          assetsUsdc: BigInt(rail.chainId) * 1_000_000n,
        };
      },
    });

    expect(maxConcurrent('morpho:')).toBeLessThanOrEqual(EVM_READ_CONCURRENCY);
    // The rows keep the registry order even though the reads complete out of
    // order.
    expect(
      rows.filter((row) => row.kind === 'morpho').map((row) => row.chainId),
    ).toEqual([1, 8453, 42161]);
  });
});
