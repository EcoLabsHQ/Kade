import { describe, expect, it, vi } from 'vitest';

/**
 * The vault rail's readiness predicate on the Invest route.
 *
 * The owner's model is mixed (contract v1.9, §8): the Morpho vault is on
 * Ethereum mainnet while the pre-approval fee and the remaining Sepolia tooling
 * stay on the testnet. `KADE_CHAIN_ENV` therefore cannot gate the vault rail —
 * it is legitimately `testnet` while the mainnet vault is configured — so the
 * predicate must key off the vault configuration and the mainnet RPC alone.
 *
 * The page's heavy collaborators are mocked so only the predicate is exercised;
 * every case supplies its own env, so no global state is touched.
 */

vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ getSessionUser: vi.fn() }));
vi.mock('@/lib/safe/shell', () => ({ loadShellSafe: vi.fn() }));
vi.mock('@/lib/review/review-bar', () => ({ loadReviewBar: vi.fn() }));
vi.mock('@/components/shell/AppShell', () => ({ AppShell: () => null }));
vi.mock('@/components/shell/ContentContainer', () => ({ ContentContainer: () => null }));
vi.mock('@/components/invest/InvestScreen', () => ({ InvestScreen: () => null }));

import { isMainnetRailConfigured } from '@/app/invest/page';

const VAULT = '0x1111222233334444555566667777888899990000';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const RPC = 'https://mainnet.example';

function env(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return values as unknown as NodeJS.ProcessEnv;
}

const CONFIGURED_VAULT = {
  KADE_MORPHO_VAULT_ADDRESS: VAULT,
  KADE_MORPHO_USDC_ADDRESS: USDC,
};

describe('isMainnetRailConfigured', () => {
  it('is true with a configured vault and the mainnet RPC, even on a testnet chain env', () => {
    expect(
      isMainnetRailConfigured(
        env({ ...CONFIGURED_VAULT, ETHEREUM_RPC_URL: RPC, KADE_CHAIN_ENV: 'testnet' }),
      ),
    ).toBe(true);
  });

  it('does not turn on from KADE_CHAIN_ENV=mainnet alone', () => {
    expect(
      isMainnetRailConfigured(env({ ETHEREUM_RPC_URL: RPC, KADE_CHAIN_ENV: 'mainnet' })),
    ).toBe(false);
    expect(
      isMainnetRailConfigured(env({ ...CONFIGURED_VAULT, KADE_CHAIN_ENV: 'mainnet' })),
    ).toBe(false);
  });

  it('is false without the mainnet RPC, even when the vault is configured', () => {
    expect(isMainnetRailConfigured(env({ ...CONFIGURED_VAULT }))).toBe(false);
  });

  it('is false for a blank mainnet RPC', () => {
    expect(
      isMainnetRailConfigured(env({ ...CONFIGURED_VAULT, ETHEREUM_RPC_URL: '   ' })),
    ).toBe(false);
  });

  it('is false when the vault is partially configured', () => {
    expect(
      isMainnetRailConfigured(
        env({ KADE_MORPHO_VAULT_ADDRESS: VAULT, ETHEREUM_RPC_URL: RPC }),
      ),
    ).toBe(false);
  });
});
