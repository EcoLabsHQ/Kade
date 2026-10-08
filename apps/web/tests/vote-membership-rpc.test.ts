import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `loadVoteViewerMembership` must read the manager and the RPC for the **same**
 * chain.
 *
 * The live defect: the manager (`0x140277…`) is deployed on Arbitrum One, but the
 * membership read resolved its RPC from the active chain environment
 * (`readRpcUrlFor(readChainEnv())` → Sepolia under `KADE_CHAIN_ENV=testnet`).
 * The read was issued against the wrong chain, found nothing, and failed closed —
 * refusing a resident who is genuinely a Citizen with "Colosseum Citizens only".
 *
 * The source is mocked, so these tests never dial a network. They pin that the
 * RPC is resolved through `readRpcUrlForChain(chainId)` for the membership chain,
 * never through the chain environment's endpoint.
 */

const state = vi.hoisted(() => ({
  rpcCalls: [] as string[],
  httpUrls: [] as string[],
  membershipReads: [] as Array<{ managerAddress: string; account: string }>,
  chainId: 42161 as number,
  chainRpc: 'https://arbitrum.example' as string | null,
}));

const ARBITRUM_RPC = 'https://arbitrum.example';
const SEPOLIA_RPC = 'https://sepolia.example';
const MANAGER = '0x140277660f4f8bFD751CbDEa3De12E174BEEfdA8';
const ACCOUNT = '0x60b70Ae000a0E3372c3468e4A3446363a921DEf7';

vi.mock('viem', () => ({
  createPublicClient: (config: unknown) => ({ config }),
  http: (url: string) => {
    state.httpUrls.push(url);
    return { url };
  },
  getAddress: (address: string) => address,
}));

vi.mock('@/lib/env', () => ({
  readMembershipManagerAddress: () => MANAGER,
  readMembershipChainId: () => state.chainId,
  readRpcUrlForChain: (chainId: number) => {
    state.rpcCalls.push(`chain:${chainId}`);
    return state.chainRpc;
  },
  // The defective source. If `loadVoteViewerMembership` ever calls this again,
  // the assertions below fail rather than silently reading the wrong chain.
  readRpcUrlFor: (env: string) => {
    state.rpcCalls.push(`env:${env}`);
    return SEPOLIA_RPC;
  },
  readChainEnv: () => 'testnet',
}));

vi.mock('@/lib/membership/chain', () => ({
  readMembership: async (input: { managerAddress: string; account: string }) => {
    state.membershipReads.push({
      managerAddress: input.managerAddress,
      account: input.account,
    });
    return { status: 'known', membership: 'citizen' };
  },
}));

import { loadVoteViewerMembership } from '@/lib/vote/server';

describe('loadVoteViewerMembership reads the manager and the RPC for the same chain', () => {
  beforeEach(() => {
    state.rpcCalls.length = 0;
    state.httpUrls.length = 0;
    state.membershipReads.length = 0;
    state.chainId = 42161;
    state.chainRpc = ARBITRUM_RPC;
  });

  it('resolves the RPC for the membership chain, not the chain environment', async () => {
    const membership = await loadVoteViewerMembership(ACCOUNT);

    expect(membership).toBe('citizen');
    // Only the chain-aware resolver is consulted, with the manager's chain id.
    expect(state.rpcCalls).toEqual(['chain:42161']);
    // The client is built over the Arbitrum endpoint, never Sepolia.
    expect(state.httpUrls).toEqual([ARBITRUM_RPC]);
    expect(state.httpUrls).not.toContain(SEPOLIA_RPC);
    // And the manager read uses that chain id's manager.
    expect(state.membershipReads).toEqual([
      { managerAddress: MANAGER, account: ACCOUNT },
    ]);
  });

  it('fails closed when the membership chain has no RPC configured', async () => {
    state.chainRpc = null;

    await expect(loadVoteViewerMembership(ACCOUNT)).resolves.toBe('none');
    // No read is attempted, and the chain environment is never consulted.
    expect(state.membershipReads).toEqual([]);
    expect(state.rpcCalls).toEqual(['chain:42161']);
  });

  it('does not read anything for a disconnected wallet', async () => {
    await expect(loadVoteViewerMembership(null)).resolves.toBe('none');
    expect(state.rpcCalls).toEqual([]);
    expect(state.membershipReads).toEqual([]);
  });
});
