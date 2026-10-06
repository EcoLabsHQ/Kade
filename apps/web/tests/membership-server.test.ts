import { describe, expect, it } from 'vitest';
import {
  assertMembershipIssuanceApproved,
  readMembershipIssuanceGate,
} from '@/lib/membership/gate';
import { prepareMembershipTransition } from '@/lib/membership/server';
import type { MembershipReadClient } from '@/lib/membership/chain';
import type { MembershipTransitionStore } from '@/lib/membership/store';

/**
 * The membership prepare path.
 *
 * The properties under test: it refuses without the approval gate; it reads
 * `membershipOf` before preparing and blocks on an unread read rather than
 * assuming "none"; it derives the operation from the read; and it returns a
 * plan with `sent: false`, persisting the intent.
 */

const MANAGER = '0x2222222222222222222222222222222222222222';
const ACCOUNT = '0x1111111111111111111111111111111111111111';
const PROFILE = '11111111-1111-1111-1111-111111111111';

const APPROVED = {
  onchainGateApproved: true,
  approvedBy: 'owner',
  approvedAt: '2026-10-06',
} as const;

function fakeStore(overrides: Partial<MembershipTransitionStore> = {}): MembershipTransitionStore & {
  readonly intents: unknown[];
} {
  const intents: unknown[] = [];
  return {
    intents,
    async residentAccount() {
      return ACCOUNT as `0x${string}`;
    },
    async recordIntent(input) {
      intents.push(input);
    },
    async recordEvent() {
      return { recorded: true };
    },
    ...overrides,
  };
}

/** A read client that answers `membershipOf` with a fixed ordinal. */
function readClient(ordinal: number): MembershipReadClient {
  return {
    async readContract() {
      return ordinal;
    },
  };
}

describe('membership issuance gate', () => {
  it('is null when no approval is recorded', () => {
    expect(readMembershipIssuanceGate({})).toBeNull();
  });

  it('reads the approval record', () => {
    expect(
      readMembershipIssuanceGate({
        KADE_MEMBERSHIP_ISSUANCE_APPROVED: 'true',
        KADE_MEMBERSHIP_ISSUANCE_APPROVED_BY: 'owner',
        KADE_MEMBERSHIP_ISSUANCE_APPROVED_AT: '2026-10-06',
      }),
    ).toEqual(APPROVED);
  });

  it('asserts approval and the approver', () => {
    expect(() => assertMembershipIssuanceApproved(APPROVED)).not.toThrow();
    expect(() =>
      assertMembershipIssuanceApproved({ ...APPROVED, onchainGateApproved: false }),
    ).toThrow(/blocked/);
    expect(() =>
      assertMembershipIssuanceApproved({ ...APPROVED, approvedBy: '' }),
    ).toThrow(/who approved/);
  });
});

describe('prepareMembershipTransition', () => {
  it('reports not-configured without the gate', async () => {
    const outcome = await prepareMembershipTransition({
      profileId: PROFILE,
      target: 'resident',
      deps: { store: fakeStore(), managerAddress: MANAGER, chainId: 11155111, gate: null },
    });
    expect(outcome.status).toBe('not-configured');
    expect(outcome.sent).toBe(false);
  });

  it('blocks when the gate is not approved', async () => {
    const outcome = await prepareMembershipTransition({
      profileId: PROFILE,
      target: 'resident',
      deps: {
        store: fakeStore(),
        managerAddress: MANAGER,
        chainId: 11155111,
        gate: { ...APPROVED, onchainGateApproved: false },
      },
    });
    expect(outcome.status).toBe('blocked');
  });

  it('reports not-configured without a manager address or chain', async () => {
    const outcome = await prepareMembershipTransition({
      profileId: PROFILE,
      target: 'resident',
      deps: { store: fakeStore(), managerAddress: null, chainId: null, gate: APPROVED },
    });
    expect(outcome.status).toBe('not-configured');
  });

  it('blocks when the resident has no recorded Safe', async () => {
    const outcome = await prepareMembershipTransition({
      profileId: PROFILE,
      target: 'resident',
      deps: {
        store: fakeStore({ residentAccount: async () => null }),
        managerAddress: MANAGER,
        chainId: 11155111,
        gate: APPROVED,
        readClient: readClient(0),
      },
    });
    expect(outcome.status).toBe('blocked');
    expect(outcome.reason).toMatch(/Safe is not recorded/);
  });

  it('blocks on an unread membership rather than assuming none', async () => {
    const outcome = await prepareMembershipTransition({
      profileId: PROFILE,
      target: 'resident',
      deps: {
        store: fakeStore(),
        managerAddress: MANAGER,
        chainId: 11155111,
        gate: APPROVED,
        readClient: {
          async readContract() {
            throw new Error('RPC down');
          },
        },
      },
    });
    expect(outcome.status).toBe('blocked');
    expect(outcome.reason).toMatch(/not assumed to be none/);
  });

  it('prepares an issue-resident plan for a None account and records the intent', async () => {
    const store = fakeStore();
    const outcome = await prepareMembershipTransition({
      profileId: PROFILE,
      target: 'resident',
      deps: {
        store,
        managerAddress: MANAGER,
        chainId: 11155111,
        gate: APPROVED,
        readClient: readClient(0),
      },
    });
    expect(outcome.status).toBe('prepared');
    if (outcome.status !== 'prepared') throw new Error('expected prepared');
    expect(outcome.sent).toBe(false);
    expect(outcome.plan.operation).toBe('issue-resident');
    expect(outcome.plan.membershipBefore).toBe('none');
    expect(store.intents).toHaveLength(1);
  });

  it('refuses a duplicate issuance for an account already Resident', async () => {
    const store = fakeStore();
    const outcome = await prepareMembershipTransition({
      profileId: PROFILE,
      target: 'resident',
      deps: {
        store,
        managerAddress: MANAGER,
        chainId: 11155111,
        gate: APPROVED,
        readClient: readClient(1),
      },
    });
    expect(outcome.status).toBe('blocked');
    expect(outcome.reason).toMatch(/already resident/);
    expect(store.intents).toHaveLength(0);
  });

  it('reports failed when the intent cannot be recorded', async () => {
    const outcome = await prepareMembershipTransition({
      profileId: PROFILE,
      target: 'resident',
      deps: {
        store: fakeStore({
          recordIntent: async () => {
            throw new Error('write failed');
          },
        }),
        managerAddress: MANAGER,
        chainId: 11155111,
        gate: APPROVED,
        readClient: readClient(0),
      },
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.sent).toBe(false);
  });
});
