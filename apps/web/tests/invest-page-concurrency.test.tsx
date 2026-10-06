import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

/**
 * The Invest route issues its three independent read groups in one stage.
 *
 * The Safe's position, the review bar and each configured rail's Morpho yield
 * depend only on the session and the (synchronous) rail configuration, not on
 * one another. The yields used to be awaited *after* the position read had
 * finished, adding a Morpho round-trip to every navigation. This test records
 * when each read is in flight and fails unless a yield overlaps the position
 * read — which the old staged order could not produce.
 */

const hoisted = vi.hoisted(() => ({
  moments: [] as string[][],
  inFlight: new Set<string>(),
  loadVaultHoldings: vi.fn(),
  loadReviewBar: vi.fn(),
  readMorphoVaultYield: vi.fn(),
}));

function enter(tag: string) {
  hoisted.inFlight.add(tag);
  hoisted.moments.push([...hoisted.inFlight]);
}
function leave(tag: string) {
  hoisted.inFlight.delete(tag);
}
function tracked<T>(tag: string, value: T): Promise<T> {
  enter(tag);
  return new Promise((resolve) => {
    setTimeout(() => {
      leave(tag);
      resolve(value);
    }, 0);
  });
}

vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  getSessionUser: vi.fn(async () => ({ userId: 'resident-1', email: 'r@example.com' })),
}));
vi.mock('@/lib/safe/shell', () => ({
  loadShellSafe: vi.fn(async () => ({
    address: '0x5Af1000000000000000000000000000000000c09D',
    deployed: true,
    status: 'deployed',
    explorerUrl: null,
  })),
}));
vi.mock('@/lib/wealth/vault-holdings', () => ({
  loadVaultHoldings: hoisted.loadVaultHoldings,
}));
vi.mock('@/lib/review/review-bar', () => ({
  loadReviewBar: hoisted.loadReviewBar,
}));
// Every pinned rail is configured so the yield reads are actually issued.
vi.mock('@/lib/invest/morpho-config', () => ({
  isMorphoRailConfiguredForChain: () => true,
  morphoChainName: (chainId: number) => `Chain ${chainId}`,
  readMorphoVaultConfigForChain: (chainId: number) => ({
    vault: '0x1111111111111111111111111111111111111111',
    usdc: '0x2222222222222222222222222222222222222222',
    chainId,
  }),
}));
vi.mock('@/lib/invest/morpho-yield', () => ({
  readMorphoVaultYield: hoisted.readMorphoVaultYield,
}));
vi.mock('@/components/shell/ContentContainer', () => ({
  ContentContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/invest/InvestScreen', () => ({
  InvestScreen: () => null,
}));

import InvestPage from '@/app/(resident)/invest/page';

beforeEach(() => {
  hoisted.moments.length = 0;
  hoisted.inFlight.clear();
  hoisted.loadVaultHoldings.mockReset();
  hoisted.loadVaultHoldings.mockImplementation(() => tracked('position', []));
  hoisted.loadReviewBar.mockReset();
  hoisted.loadReviewBar.mockImplementation(() =>
    tracked('review', { show: false, reference: null, isReviewer: false }),
  );
  hoisted.readMorphoVaultYield.mockReset();
  hoisted.readMorphoVaultYield.mockImplementation((chainId: number) =>
    tracked(`yield:${chainId}`, { status: 'known', netApy: 0.05 }),
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('InvestPage — independent reads are concurrent', () => {
  it('reads a rail yield while the Safe position read is still in flight', async () => {
    render((await InvestPage()) as ReactElement);

    // The old order awaited the position read before the yields began, so a
    // moment containing both tags was impossible.
    expect(
      hoisted.moments.some(
        (m) => m.includes('position') && m.some((t) => t.startsWith('yield:')),
      ),
    ).toBe(true);
    // The position read is still issued exactly once, and every configured rail
    // is read once.
    expect(hoisted.loadVaultHoldings).toHaveBeenCalledTimes(1);
    expect(hoisted.readMorphoVaultYield.mock.calls.length).toBeGreaterThan(0);
  });
});
