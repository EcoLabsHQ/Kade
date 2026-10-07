import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MembershipClaimTarget } from '@/lib/membership/plan';

/**
 * The claim server action's runtime target guard.
 *
 * A server action's argument crosses the network, so the type annotation is not
 * a guard. The action must refuse `none`/`revoke`/anything unknown before the
 * mint is reached, and must pass a legitimate target through unchanged.
 */

const hoisted = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  mint: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  getSessionUser: hoisted.getSessionUser,
}));
vi.mock('next/cache', () => ({ revalidatePath: hoisted.revalidatePath }));
vi.mock('@/lib/membership/mint', () => ({
  mintMembershipForClaimFromEnv: hoisted.mint,
}));
// The membership manager is on Arbitrum One in the deployed environment; the
// action resolves the explorer base from the configured chain id.
vi.mock('@/lib/env', () => ({
  readMembershipChainId: () => 42161,
}));

import { claimMembershipAction } from '@/app/residency/actions';

beforeEach(() => {
  hoisted.getSessionUser.mockResolvedValue({ userId: 'profile-1' });
  hoisted.mint.mockReset();
  hoisted.revalidatePath.mockReset();
});

describe('claimMembershipAction — the runtime target guard', () => {
  it('refuses target "none" before the mint is reached', async () => {
    const outcome = await claimMembershipAction(
      'none' as unknown as MembershipClaimTarget,
    );
    expect(outcome.status).toBe('blocked');
    expect(outcome.sent).toBe(false);
    expect(outcome.reason).toMatch(/not a Colosseum claim target/i);
    expect(hoisted.mint).not.toHaveBeenCalled();
    expect(hoisted.revalidatePath).not.toHaveBeenCalled();
  });

  it('refuses an unknown target before the mint is reached', async () => {
    const outcome = await claimMembershipAction(
      'revoke' as unknown as MembershipClaimTarget,
    );
    expect(outcome.status).toBe('blocked');
    expect(hoisted.mint).not.toHaveBeenCalled();
  });

  it('passes a legitimate target to the mint and revalidates on sent', async () => {
    hoisted.mint.mockResolvedValue({
      status: 'sent',
      sent: true,
      reason: 'confirmed',
      operation: 'issue-resident',
      account: '0x1111111111111111111111111111111111111111',
      txHash: `0x${'ab'.repeat(32)}`,
      blockNumber: 1n,
      eventKey: 'k',
    });

    const outcome = await claimMembershipAction('resident');
    expect(hoisted.mint).toHaveBeenCalledWith('profile-1', 'resident');
    expect(outcome.status).toBe('sent');
    expect(hoisted.revalidatePath).toHaveBeenCalledWith('/residency');
  });

  it('surfaces the Arbiscan base for the configured membership chain', async () => {
    hoisted.mint.mockResolvedValue({
      status: 'sent',
      sent: true,
      reason: 'confirmed',
      operation: 'issue-resident',
      account: '0x1111111111111111111111111111111111111111',
      txHash: `0x${'ab'.repeat(32)}`,
      blockNumber: 1n,
      eventKey: 'k',
    });

    const outcome = await claimMembershipAction('resident');
    expect(outcome.explorerUrl).toBe('https://arbiscan.io');
    // The raw mint outcome is otherwise unchanged.
    if (outcome.status !== 'sent') throw new Error('expected a sent outcome');
    expect(outcome.txHash).toBe(`0x${'ab'.repeat(32)}`);
    expect(outcome.account).toBe('0x1111111111111111111111111111111111111111');
  });

  it('surfaces the explorer base on a refused claim too, never a fabricated one', async () => {
    hoisted.mint.mockResolvedValue({
      status: 'blocked',
      sent: false,
      reason: 'the four residency checks are not all met.',
    });

    const outcome = await claimMembershipAction('resident');
    expect(outcome.status).toBe('blocked');
    expect(outcome.explorerUrl).toBe('https://arbiscan.io');
    expect(outcome.sent).toBe(false);
  });

  it('reports unauthenticated without calling the mint', async () => {
    hoisted.getSessionUser.mockResolvedValue(null);
    const outcome = await claimMembershipAction('resident');
    expect(outcome.status).toBe('unauthenticated');
    expect(hoisted.mint).not.toHaveBeenCalled();
  });
});
