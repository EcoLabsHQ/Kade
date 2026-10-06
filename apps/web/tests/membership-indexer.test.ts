import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, type Hex } from 'viem';
import {
  decodeMembershipChangedLog,
  membershipEventKey,
  operationForEvent,
  reconcileMembershipEvents,
  type MembershipLogClient,
  type RawMembershipLog,
} from '@/lib/membership/indexer';
import { MEMBERSHIP_MANAGER_ABI } from '@/lib/membership/abi';
import type {
  MembershipEventInput,
  MembershipTransitionStore,
} from '@/lib/membership/store';

/**
 * The `MembershipChanged` indexer.
 *
 * The properties under test: a decodable log becomes an event; an undecodable
 * log is skipped, never guessed; a failed chain read is `unread`, never "no
 * membership"; and reconciling the same range twice is idempotent.
 */

const MANAGER = '0x2222222222222222222222222222222222222222';
const ACCOUNT = '0x1111111111111111111111111111111111111111';
const TX_HASH = `0x${'ab'.repeat(32)}` as Hex;

function buildLog(input: {
  account: string;
  previous: number;
  current: number;
  logIndex?: number;
  txHash?: Hex;
}): RawMembershipLog {
  const topics = encodeEventTopics({
    abi: MEMBERSHIP_MANAGER_ABI,
    eventName: 'MembershipChanged',
    args: { account: input.account as `0x${string}` },
  });
  const data = encodeAbiParameters(
    [{ type: 'uint8' }, { type: 'uint8' }],
    [input.previous, input.current],
  );
  return {
    address: MANAGER,
    topics: topics as readonly Hex[],
    data,
    transactionHash: input.txHash ?? TX_HASH,
    logIndex: input.logIndex ?? 0,
    blockNumber: 100n,
  };
}

/** A store that records event keys and dedups replays, like the real table. */
function fakeStore(): MembershipTransitionStore & {
  readonly events: MembershipEventInput[];
} {
  const events: MembershipEventInput[] = [];
  const seen = new Set<string>();
  return {
    events,
    async residentAccount() {
      return null;
    },
    async recordIntent() {},
    async recordEvent(input) {
      events.push(input);
      const key = `${input.chainId}:${input.eventKey}`;
      if (seen.has(key)) return { recorded: false };
      seen.add(key);
      return { recorded: true };
    },
  };
}

describe('membershipEventKey', () => {
  it('is txHash:logIndex, lowercased', () => {
    expect(membershipEventKey('0xAB', 7)).toBe('0xab:7');
  });
});

describe('operationForEvent', () => {
  it('maps the manager state machine', () => {
    expect(operationForEvent('none', 'resident')).toBe('issue-resident');
    expect(operationForEvent('resident', 'citizen')).toBe('promote-to-citizen');
    expect(operationForEvent('citizen', 'none')).toBe('revoke');
  });

  it('returns null for a pair the manager never emits', () => {
    expect(operationForEvent('none', 'citizen')).toBeNull();
    expect(operationForEvent('resident', 'resident')).toBeNull();
  });
});

describe('decodeMembershipChangedLog', () => {
  it('decodes a valid issue event', () => {
    const event = decodeMembershipChangedLog(
      buildLog({ account: ACCOUNT, previous: 0, current: 1 }),
    );
    expect(event).not.toBeNull();
    expect(event?.operation).toBe('issue-resident');
    expect(event?.account.toLowerCase()).toBe(ACCOUNT.toLowerCase());
    expect(event?.eventKey).toBe(membershipEventKey(TX_HASH, 0));
  });

  it('returns null for a log that is not a MembershipChanged event', () => {
    const log = buildLog({ account: ACCOUNT, previous: 0, current: 1 });
    expect(
      decodeMembershipChangedLog({ ...log, data: '0x1234' as Hex }),
    ).toBeNull();
  });

  it('returns null for a pair the manager never emits', () => {
    const log = buildLog({ account: ACCOUNT, previous: 0, current: 2 });
    expect(decodeMembershipChangedLog(log)).toBeNull();
  });
});

describe('reconcileMembershipEvents', () => {
  const client = (logs: readonly RawMembershipLog[]): MembershipLogClient => ({
    async getLogs() {
      return logs;
    },
  });

  it('applies a decodable event and skips an undecodable one', async () => {
    const store = fakeStore();
    const result = await reconcileMembershipEvents({
      publicClient: client([
        buildLog({ account: ACCOUNT, previous: 0, current: 1 }),
        { address: MANAGER, topics: [], data: '0x' as Hex, transactionHash: TX_HASH, logIndex: 1, blockNumber: 100n },
      ]),
      store,
      managerAddress: MANAGER,
      chainId: 11155111,
      fromBlock: 0n,
      toBlock: 'latest',
    });
    expect(result).toEqual({ status: 'read', applied: 1, skipped: 1 });
    expect(store.events).toHaveLength(1);
  });

  it('is idempotent: reconciling the same range twice applies nothing the second time', async () => {
    const store = fakeStore();
    const logs = [buildLog({ account: ACCOUNT, previous: 0, current: 1 })];
    const args = {
      publicClient: client(logs),
      store,
      managerAddress: MANAGER,
      chainId: 11155111,
      fromBlock: 0n,
      toBlock: 'latest' as const,
    };
    const first = await reconcileMembershipEvents(args);
    const second = await reconcileMembershipEvents(args);
    expect(first).toEqual({ status: 'read', applied: 1, skipped: 0 });
    expect(second).toEqual({ status: 'read', applied: 0, skipped: 1 });
  });

  it('reports a failed chain read as unread, never as no membership', async () => {
    const store = fakeStore();
    const result = await reconcileMembershipEvents({
      publicClient: {
        async getLogs() {
          throw new Error('RPC unavailable');
        },
      },
      store,
      managerAddress: MANAGER,
      chainId: 11155111,
      fromBlock: 0n,
      toBlock: 'latest',
    });
    expect(result.status).toBe('unread');
    expect(store.events).toHaveLength(0);
  });

  it('reports an unconfigured manager address as unread', async () => {
    const result = await reconcileMembershipEvents({
      publicClient: client([]),
      store: fakeStore(),
      managerAddress: 'not-an-address',
      chainId: 11155111,
      fromBlock: 0n,
      toBlock: 'latest',
    });
    expect(result.status).toBe('unread');
  });
});
