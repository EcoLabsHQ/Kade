import { describe, expect, it } from 'vitest';
import {
  buildMembershipCall,
  buildMembershipTransitionPlan,
  encodeMembershipCall,
  operationForTransition,
} from '@/lib/membership/plan';

/**
 * The owner-Safe membership call and its plan.
 *
 * These pin the exact function selectors (computed independently of the ABI
 * object) and the "prepare, never send" shape: every plan is `sent: false`.
 */

const MANAGER = '0x2222222222222222222222222222222222222222';
const ACCOUNT = '0x1111111111111111111111111111111111111111';

// keccak256(signature)[0:4], pinned from the Solidity signatures.
const SELECTOR = {
  issueResident: '0xdc8970be',
  promoteToCitizen: '0xb2197c3e',
  revokeMembership: '0xc5ae086a',
} as const;

const PADDED_ACCOUNT = ACCOUNT.slice(2).padStart(64, '0');

describe('membership calldata', () => {
  it('encodes issueResident with the pinned selector', () => {
    expect(encodeMembershipCall('issue-resident', ACCOUNT)).toBe(
      `${SELECTOR.issueResident}${PADDED_ACCOUNT}`,
    );
  });

  it('encodes promoteToCitizen with the pinned selector', () => {
    expect(encodeMembershipCall('promote-to-citizen', ACCOUNT)).toBe(
      `${SELECTOR.promoteToCitizen}${PADDED_ACCOUNT}`,
    );
  });

  it('encodes revokeMembership with the pinned selector', () => {
    expect(encodeMembershipCall('revoke', ACCOUNT)).toBe(
      `${SELECTOR.revokeMembership}${PADDED_ACCOUNT}`,
    );
  });

  it('builds a zero-value SafeCall to the manager', () => {
    const call = buildMembershipCall({
      managerAddress: MANAGER,
      account: ACCOUNT,
      operation: 'issue-resident',
    });
    expect(call.to).toBe(MANAGER);
    expect(call.value).toBe(0n);
    expect(call.data.startsWith(SELECTOR.issueResident)).toBe(true);
  });
});

describe('buildMembershipTransitionPlan', () => {
  it('produces a single-call, reviewable plan that is never sent', () => {
    const plan = buildMembershipTransitionPlan({
      chainId: 11155111,
      managerAddress: MANAGER,
      account: ACCOUNT,
      operation: 'promote-to-citizen',
      membershipBefore: 'resident',
    });
    expect(plan.sent).toBe(false);
    expect(plan.calls).toHaveLength(1);
    expect(plan.calldata).toBe(plan.calls[0]?.data);
    expect(plan.membershipBefore).toBe('resident');
  });

  it('fails closed on a malformed manager address', () => {
    expect(() =>
      buildMembershipTransitionPlan({
        chainId: 11155111,
        managerAddress: 'not-an-address',
        account: ACCOUNT,
        operation: 'issue-resident',
      }),
    ).toThrow(/managerAddress/);
  });

  it('fails closed on a malformed account', () => {
    expect(() =>
      buildMembershipTransitionPlan({
        chainId: 11155111,
        managerAddress: MANAGER,
        account: '0x1234',
        operation: 'issue-resident',
      }),
    ).toThrow(/account/);
  });

  it('fails closed on a non-positive chain id', () => {
    expect(() =>
      buildMembershipTransitionPlan({
        chainId: 0,
        managerAddress: MANAGER,
        account: ACCOUNT,
        operation: 'issue-resident',
      }),
    ).toThrow(/chainId/);
  });
});

describe('operationForTransition', () => {
  it('maps None → Resident to issueResident', () => {
    expect(operationForTransition('none', 'resident')).toEqual({
      operation: 'issue-resident',
    });
  });

  it('maps Resident → Citizen to promoteToCitizen', () => {
    expect(operationForTransition('resident', 'citizen')).toEqual({
      operation: 'promote-to-citizen',
    });
  });

  it('maps Resident|Citizen → None to revoke', () => {
    expect(operationForTransition('resident', 'none')).toEqual({ operation: 'revoke' });
    expect(operationForTransition('citizen', 'none')).toEqual({ operation: 'revoke' });
  });

  it('refuses a no-op transition', () => {
    expect(operationForTransition('resident', 'resident')).toHaveProperty('reason');
  });

  it('refuses an invalid jump', () => {
    expect(operationForTransition('none', 'citizen')).toHaveProperty('reason');
  });
});
