import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MembershipTransitionStore } from '@/lib/membership/store';

/**
 * The prepare path's RPC resolution.
 *
 * The manager is on Arbitrum One, so the prepare path must resolve its RPC from
 * the **manager's chain id**, not the app's active chain environment: under
 * `KADE_CHAIN_ENV=mainnet` the chain-environment lookup returned
 * `ETHEREUM_RPC_URL`, the wrong chain. This pins the corrected wiring.
 */

const hoisted = vi.hoisted(() => ({ capturedUrls: [] as string[] }));

vi.mock('viem', async (importActual) => {
  const actual = await importActual<typeof import('viem')>();
  return {
    ...actual,
    http: (url: string) => {
      hoisted.capturedUrls.push(url);
      return actual.http(url);
    },
    createPublicClient: () =>
      ({
        readContract: async () => 0,
      }) as never,
  };
});

import {
  membershipRpcUrl,
  prepareMembershipTransitionFromEnv,
} from '@/lib/membership/server';

const PROFILE = '11111111-1111-1111-1111-111111111111';
const MANAGER = '0x2222222222222222222222222222222222222222';
const ACCOUNT = '0x1111111111111111111111111111111111111111';

const MANAGED_KEYS = [
  'KADE_CHAIN_ENV',
  'ETHEREUM_RPC_URL',
  'ARBITRUM_RPC_URL',
  'KADE_MEMBERSHIP_MANAGER_ADDRESS',
  'KADE_MEMBERSHIP_CHAIN_ID',
  'KADE_MEMBERSHIP_ISSUANCE_APPROVED',
  'KADE_MEMBERSHIP_ISSUANCE_APPROVED_BY',
  'KADE_MEMBERSHIP_ISSUANCE_APPROVED_AT',
] as const;

const saved: Record<string, string | undefined> = {};

function fakeStore(): MembershipTransitionStore {
  return {
    async residentAccount() {
      return ACCOUNT as `0x${string}`;
    },
    async recordIntent() {},
    async recordEvent() {
      return { recorded: true };
    },
  };
}

beforeEach(() => {
  hoisted.capturedUrls.length = 0;
  for (const key of MANAGED_KEYS) saved[key] = process.env[key];
  process.env.KADE_CHAIN_ENV = 'mainnet';
  process.env.ETHEREUM_RPC_URL = 'https://eth.example';
  process.env.ARBITRUM_RPC_URL = 'https://arb.example';
  process.env.KADE_MEMBERSHIP_MANAGER_ADDRESS = MANAGER;
  process.env.KADE_MEMBERSHIP_CHAIN_ID = '42161';
  process.env.KADE_MEMBERSHIP_ISSUANCE_APPROVED = 'true';
  process.env.KADE_MEMBERSHIP_ISSUANCE_APPROVED_BY = 'owner';
  process.env.KADE_MEMBERSHIP_ISSUANCE_APPROVED_AT = '2026-10-06';
});

afterEach(() => {
  for (const key of MANAGED_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('membershipRpcUrl', () => {
  it('resolves by the manager chain id, not the chain environment', () => {
    expect(membershipRpcUrl(42161)).toBe('https://arb.example');
    expect(membershipRpcUrl(null)).toBeNull();
  });

  it('is null for a chain with no supported RPC variable', () => {
    expect(membershipRpcUrl(999999)).toBeNull();
  });
});

describe('prepareMembershipTransitionFromEnv', () => {
  it('reads the manager chain RPC even under KADE_CHAIN_ENV=mainnet', async () => {
    const outcome = await prepareMembershipTransitionFromEnv(
      PROFILE,
      'resident',
      fakeStore(),
    );

    expect(hoisted.capturedUrls).toContain('https://arb.example');
    expect(hoisted.capturedUrls).not.toContain('https://eth.example');
    expect(outcome.status).toBe('prepared');
  });
});
