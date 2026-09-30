import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VaultHoldingRow } from '@/lib/wealth/vault-holdings';

/**
 * The residency tier check reads the qualified total **from the chain**, through
 * the same reader and the same reduction the Holdings card uses.
 *
 * `container_balances` has no writer, so a read of it always returned nothing
 * while the Safe visibly held assets: that is the defect. This test drives
 * `loadResidencyFacts` with the on-chain reader injected and asserts that (a)
 * the qualified position is the reader's reduced value, and (b) the dead
 * `container_balances` table is never queried.
 */

const hoisted = vi.hoisted(() => ({
  safe: '0x5Af1000000000000000000000000000000000c09D',
  rows: [] as unknown[],
  queriedTables: new Set<string>(),
  loadVaultHoldings: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    from(table: string) {
      hoisted.queriedTables.add(table);
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return chain;
    },
  })),
}));

vi.mock('@/lib/safe/shell', () => ({
  loadShellSafe: vi.fn(async () => ({
    address: hoisted.safe,
    deployed: true,
    status: 'deployed',
    explorerUrl: null,
  })),
}));

vi.mock('@/lib/wealth/vault-holdings', () => ({
  loadVaultHoldings: hoisted.loadVaultHoldings,
}));

vi.mock('@/lib/residency/service-fee-server', () => ({
  isResidencyServiceFeeConfigured: () => false,
  resolveResidencyServiceFeeAmount: async () => null,
  loadResidencyServiceFeePayment: async () => ({ status: 'none' }),
}));

vi.mock('@/lib/payments/server', () => ({
  loadFeePayment: async () => ({ status: 'none' }),
}));

import {
  loadResidencyFacts,
  type ApplicationResidencyRow,
} from '@/lib/residency/server';

const ROW: ApplicationResidencyRow = {
  id: 'app-1',
  ref: 'CW-2026-0409',
  tier: '3-year',
  status: 'pre_approved',
  service_tx: null,
  service_uid: null,
  preapproval_usdc: 447,
};

beforeEach(() => {
  hoisted.queriedTables.clear();
  hoisted.rows = [
    {
      key: `${hoisted.safe}:1:native`,
      kind: 'native',
      chainId: 1,
      chainName: 'Ethereum',
      symbol: 'ETH',
      name: 'Ether',
      amount: '0.500000 ETH',
      usd: 42000,
      readError: null,
    },
  ];
  hoisted.loadVaultHoldings.mockReset();
  hoisted.loadVaultHoldings.mockImplementation(
    async () => hoisted.rows as readonly VaultHoldingRow[],
  );
});

describe('loadResidencyFacts qualified source', () => {
  it('reads the Safe position through the shared reader and never queries container_balances', async () => {
    const facts = await loadResidencyFacts('resident-1', ROW, 10);

    expect(hoisted.loadVaultHoldings).toHaveBeenCalledWith(hoisted.safe);
    expect(facts.qualified).toEqual({ status: 'known', usd: 42000 });
    expect(hoisted.queriedTables.has('container_balances')).toBe(false);
  });

  it('keeps a failed position read unknown, with its reason, rather than a $0', async () => {
    hoisted.rows = [
      {
        key: `${hoisted.safe}:1:unread`,
        kind: 'unread',
        chainId: 1,
        chainName: 'Ethereum',
        symbol: '—',
        name: 'Ethereum',
        amount: '—',
        usd: null,
        readError: 'The vault balance on Ethereum could not be read.',
      },
    ];

    const facts = await loadResidencyFacts('resident-1', ROW, 10);

    expect(facts.qualified.status).toBe('unknown');
    if (facts.qualified.status !== 'unknown') throw new Error('unreachable');
    expect(facts.qualified.reason).toContain(
      'The vault balance on Ethereum could not be read.',
    );
  });
});
