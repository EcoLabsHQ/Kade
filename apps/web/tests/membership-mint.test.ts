import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, type Address, type Hex } from 'viem';
import {
  COLOSSEUM_COMPLIANCE_WINDOW_MS,
  complianceWindowElapsed,
  mintMembershipForClaim,
  unmetMembershipChecks,
  type MembershipClaimDependencies,
} from '@/lib/membership/mint';
import { MEMBERSHIP_MANAGER_ABI } from '@/lib/membership/abi';
import { deriveResidencyView, type ResidencyFacts } from '@/lib/residency/checks';
import type { MembershipClaimTarget } from '@/lib/membership/plan';
import type {
  MembershipEventInput,
  MembershipIntentInput,
  MembershipTransitionLookup,
} from '@/lib/membership/store';
import type { MembershipLogClient, RawMembershipLog } from '@/lib/membership/indexer';
import type { MembershipReadClient } from '@/lib/membership/chain';
import type {
  SafeOwnerExecutionResult,
  SafeOwnerExecutor,
} from '@/lib/safe/owner-execute';

/**
 * The claim-triggered mint.
 *
 * The properties under test are the ones the task fixes: a claim with an unmet
 * check mints nothing; an unread chain state never mints; a claim with all four
 * checks met builds and executes exactly one owner-Safe transaction; a second
 * claim does not duplicate; the intent is recorded before the send and the row
 * is confirmed from the indexed event; and the compliance window is enforced
 * server-side when it is recorded.
 */

const MANAGER = '0x2222222222222222222222222222222222222222';
const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address;
const PROFILE = '11111111-1111-1111-1111-111111111111';
const CHAIN_ID = 42161;
const TX_HASH = `0x${'ab'.repeat(32)}` as Hex;
const NOW = Date.parse('2026-10-06T12:00:00.000Z');

const APPROVED = {
  onchainGateApproved: true,
} as const;

function facts(overrides: Partial<ResidencyFacts> = {}): ResidencyFacts {
  return {
    tier: 'colosseum',
    identity: {
      provider: 'self',
      status: 'valid',
      verifiedAt: '2026-09-20T00:00:00Z',
      selfNullifier: 'n',
    },
    qualified: { status: 'known', usd: 10 },
    review: 'cleared',
    serviceFee: { recorded: true, verified: true, amountUsdc: 10 },
    permit: { issued: false, uid: null },
    ...overrides,
  };
}

function checks(f: ResidencyFacts = facts()) {
  return deriveResidencyView(f, true).checks;
}

/** A read client that answers `membershipOf` with a fixed ordinal. */
function readClient(ordinal: number): MembershipReadClient {
  return {
    async readContract() {
      return ordinal;
    },
  };
}

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

/** A log client that returns one decodable `MembershipChanged` event. */
function logClient(previous: number, current: number): MembershipLogClient {
  const logs = [buildLog({ account: ACCOUNT, previous, current })];
  return {
    async getLogs() {
      return logs;
    },
  };
}

interface StoreOptions {
  readonly initialTransition?: MembershipTransitionLookup | null;
  readonly since?: string | null;
  readonly sinceUnread?: string | null;
  readonly failIntent?: boolean;
}

function makeStore(options: StoreOptions = {}, order: string[] = []) {
  const intents: MembershipIntentInput[] = [];
  const events: MembershipEventInput[] = [];
  let transition = options.initialTransition ?? null;
  let since = options.since ?? null;

  const store = {
    async residentAccount() {
      return ACCOUNT;
    },
    async recordIntent(input: MembershipIntentInput) {
      if (options.failIntent) throw new Error('write failed');
      intents.push(input);
      order.push('intent');
      transition = {
        status: 'prepared',
        txHash: null,
        eventKey: null,
        membershipAfter: null,
      };
    },
    async recordEvent(input: MembershipEventInput) {
      events.push(input);
      transition = {
        status: 'confirmed',
        txHash: input.txHash,
        eventKey: input.eventKey,
        membershipAfter: input.membershipAfter,
      };
      return { recorded: true };
    },
    async transitionFor() {
      return transition;
    },
    async colosseumResidentSince() {
      if (options.sinceUnread) {
        return { status: 'unread' as const, reason: options.sinceUnread };
      }
      return { status: 'known' as const, since };
    },
    async recordColosseumResidentSince() {
      if (since === null) since = new Date(NOW).toISOString();
    },
  };

  return { store, intents, events, order, getSince: () => since };
}

function makeExecutor(
  options: { success?: boolean } = {},
  order: string[] = [],
) {
  const calls: { chainId: number; to: string }[] = [];
  const executor: SafeOwnerExecutor = async (input) => {
    order.push('execute');
    calls.push({ chainId: input.chainId, to: input.call.to });
    const result: SafeOwnerExecutionResult = {
      txHash: TX_HASH,
      blockNumber: 100n,
      success: options.success ?? true,
    };
    return result;
  };
  return { executor, calls, order };
}

function deps(
  overrides: Partial<MembershipClaimDependencies> = {},
): MembershipClaimDependencies {
  return {
    store: makeStore().store,
    checks: async () => checks(),
    managerAddress: MANAGER,
    chainId: CHAIN_ID,
    readClient: readClient(0),
    logClient: logClient(0, 1),
    executor: makeExecutor().executor,
    gate: APPROVED,
    now: () => NOW,
    ...overrides,
  };
}

describe('unmetMembershipChecks', () => {
  it('is empty when the four real checks are met', () => {
    expect(unmetMembershipChecks(checks())).toHaveLength(0);
  });

  it('names every required check that is not met', () => {
    const unmet = unmetMembershipChecks(
      checks(facts({ identity: null, review: 'pending' })),
    );
    expect(unmet.map((check) => check.id).sort()).toEqual(['identity', 'review']);
  });
});

describe('complianceWindowElapsed', () => {
  it('is null without a usable start instant', () => {
    expect(complianceWindowElapsed(null, NOW)).toBeNull();
    expect(complianceWindowElapsed('not-a-date', NOW)).toBeNull();
  });

  it('is false before and true at the window', () => {
    const justStarted = new Date(NOW - 1_000).toISOString();
    const elapsed = new Date(NOW - COLOSSEUM_COMPLIANCE_WINDOW_MS).toISOString();
    expect(complianceWindowElapsed(justStarted, NOW)).toBe(false);
    expect(complianceWindowElapsed(elapsed, NOW)).toBe(true);
  });
});

describe('mintMembershipForClaim — the four real checks', () => {
  it('mints nothing when a required check is not met', async () => {
    const store = makeStore();
    const executor = makeExecutor();
    const outcome = await mintMembershipForClaim({
      profileId: PROFILE,
      target: 'resident',
      deps: deps({
        store: store.store,
        checks: async () => checks(facts({ review: 'pending' })),
        executor: executor.executor,
      }),
    });

    expect(outcome.status).toBe('blocked');
    expect(outcome.sent).toBe(false);
    expect(outcome.reason).toMatch(/four residency checks are not all met/i);
    expect(outcome.reason).toMatch(/review/);
    expect(executor.calls).toHaveLength(0);
    expect(store.intents).toHaveLength(0);
  });

  it('blocks when the checks cannot be read at all', async () => {
    const executor = makeExecutor();
    const outcome = await mintMembershipForClaim({
      profileId: PROFILE,
      target: 'resident',
      deps: deps({
        checks: async () => {
          throw new Error('db down');
        },
        executor: executor.executor,
      }),
    });
    expect(outcome.status).toBe('blocked');
    expect(executor.calls).toHaveLength(0);
  });

  it('fails closed on an empty or partial check list (no application)', async () => {
    const store = makeStore();
    const executor = makeExecutor();
    const outcome = await mintMembershipForClaim({
      profileId: PROFILE,
      target: 'resident',
      deps: deps({
        store: store.store,
        checks: async () => [],
        executor: executor.executor,
      }),
    });
    expect(outcome.status).toBe('blocked');
    expect(outcome.reason).toMatch(/identity/);
    expect(outcome.reason).toMatch(/missing/);
    expect(executor.calls).toHaveLength(0);
    expect(store.intents).toHaveLength(0);
  });
});

describe('mintMembershipForClaim — the chain read', () => {
  it('never mints on an unread membership state', async () => {
    const executor = makeExecutor();
    const outcome = await mintMembershipForClaim({
      profileId: PROFILE,
      target: 'resident',
      deps: deps({
        readClient: {
          async readContract() {
            throw new Error('RPC down');
          },
        },
        executor: executor.executor,
      }),
    });
    expect(outcome.status).toBe('blocked');
    expect(outcome.reason).toMatch(/not assumed to be none/i);
    expect(executor.calls).toHaveLength(0);
  });

  it('blocks when no chain client is configured', async () => {
    const outcome = await mintMembershipForClaim({
      profileId: PROFILE,
      target: 'resident',
      deps: deps({ readClient: null }),
    });
    expect(outcome.status).toBe('blocked');
    expect(outcome.reason).toMatch(/no chain client/i);
  });

  it('blocks when the resident has no recorded Safe', async () => {
    const store = makeStore();
    const outcome = await mintMembershipForClaim({
      profileId: PROFILE,
      target: 'resident',
      deps: deps({
        store: { ...store.store, residentAccount: async () => null },
      }),
    });
    expect(outcome.status).toBe('blocked');
    expect(outcome.reason).toMatch(/Safe is not recorded/i);
  });
});

describe('mintMembershipForClaim — the claim target is validated at runtime', () => {
  // The dangerous case: on-chain Resident + target 'none' would otherwise derive
  // `revoke` and burn the soulbound credential. It must be refused before any
  // read of the operation, and the executor must never run.
  it('refuses target "none" (revoke) and executes nothing', async () => {
    const store = makeStore();
    const executor = makeExecutor();
    const outcome = await mintMembershipForClaim({
      profileId: PROFILE,
      target: 'none' as unknown as MembershipClaimTarget,
      deps: deps({
        store: store.store,
        readClient: readClient(1),
        executor: executor.executor,
      }),
    });

    expect(outcome.status).toBe('blocked');
    expect(outcome.sent).toBe(false);
    expect(outcome.reason).toMatch(/not a Colosseum claim target/i);
    expect(executor.calls).toHaveLength(0);
    expect(store.intents).toHaveLength(0);
  });

  it('refuses an unknown string target and executes nothing', async () => {
    const store = makeStore();
    const executor = makeExecutor();
    const outcome = await mintMembershipForClaim({
      profileId: PROFILE,
      target: 'revoke' as unknown as MembershipClaimTarget,
      deps: deps({ store: store.store, executor: executor.executor }),
    });

    expect(outcome.status).toBe('blocked');
    expect(executor.calls).toHaveLength(0);
    expect(store.intents).toHaveLength(0);
  });

  it('refuses a non-string target and executes nothing', async () => {
    const executor = makeExecutor();
    const outcome = await mintMembershipForClaim({
      profileId: PROFILE,
      target: { operation: 'revoke' } as unknown as MembershipClaimTarget,
      deps: deps({ executor: executor.executor }),
    });

    expect(outcome.status).toBe('blocked');
    expect(executor.calls).toHaveLength(0);
  });

  it('still mints the legitimate targets', async () => {
    const resident = makeExecutor();
    const residentOutcome = await mintMembershipForClaim({
      profileId: PROFILE,
      target: 'resident',
      deps: deps({ executor: resident.executor }),
    });
    expect(residentOutcome.status).toBe('sent');

    const store = makeStore({ since: new Date(NOW - 130_000).toISOString() });
    const citizen = makeExecutor();
    const citizenOutcome = await mintMembershipForClaim({
      profileId: PROFILE,
      target: 'citizen',
      deps: deps({
        store: store.store,
        readClient: readClient(1),
        logClient: logClient(1, 2),
        executor: citizen.executor,
      }),
    });
    expect(citizenOutcome.status).toBe('sent');
  });
});

describe('mintMembershipForClaim — the mint', () => {
  it('executes exactly one owner-Safe transaction when all four checks are met', async () => {
    const order: string[] = [];
    const store = makeStore({}, order);
    const executor = makeExecutor({}, order);
    const outcome = await mintMembershipForClaim({
      profileId: PROFILE,
      target: 'resident',
      deps: deps({ store: store.store, executor: executor.executor }),
    });

    expect(outcome.status).toBe('sent');
    if (outcome.status !== 'sent') throw new Error('expected sent');
    expect(outcome.sent).toBe(true);
    expect(outcome.operation).toBe('issue-resident');
    expect(outcome.account).toBe(ACCOUNT);
    expect(outcome.txHash).toBe(TX_HASH);

    // Exactly one Safe transaction, and the intent was recorded before it.
    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0]?.to).toBe(MANAGER);
    expect(store.intents).toHaveLength(1);
    expect(store.events).toHaveLength(1);
    expect(store.order).toEqual(['intent', 'execute']);
  });

  it('promotes a Resident to Citizen through the same path', async () => {
    const store = makeStore({ since: new Date(NOW - 130_000).toISOString() });
    const executor = makeExecutor();
    const outcome = await mintMembershipForClaim({
      profileId: PROFILE,
      target: 'citizen',
      deps: deps({
        store: store.store,
        readClient: readClient(1),
        logClient: logClient(1, 2),
        executor: executor.executor,
      }),
    });
    expect(outcome.status).toBe('sent');
    if (outcome.status !== 'sent') throw new Error('expected sent');
    expect(outcome.operation).toBe('promote-to-citizen');
    expect(executor.calls).toHaveLength(1);
  });

  it('records the compliance window after a Resident mint', async () => {
    const store = makeStore({ since: null });
    const outcome = await mintMembershipForClaim({
      profileId: PROFILE,
      target: 'resident',
      deps: deps({ store: store.store }),
    });
    expect(outcome.status).toBe('sent');
    expect(store.getSince()).not.toBeNull();
  });
});

describe('mintMembershipForClaim — duplicate protection', () => {
  it('refuses a second claim when the transition record is already confirmed', async () => {
    // The chain read lags (still "none") but the record says it is done.
    const store = makeStore({
      initialTransition: {
        status: 'confirmed',
        txHash: TX_HASH,
        eventKey: `${TX_HASH}:0`,
        membershipAfter: 'resident',
      },
    });
    const executor = makeExecutor();
    const outcome = await mintMembershipForClaim({
      profileId: PROFILE,
      target: 'resident',
      deps: deps({ store: store.store, executor: executor.executor }),
    });

    expect(outcome.status).toBe('blocked');
    expect(outcome.reason).toMatch(/already confirmed/i);
    expect(executor.calls).toHaveLength(0);
    expect(store.intents).toHaveLength(0);
  });

  it('refuses a duplicate issuance when the chain already says Resident', async () => {
    const store = makeStore();
    const executor = makeExecutor();
    const outcome = await mintMembershipForClaim({
      profileId: PROFILE,
      target: 'resident',
      deps: deps({
        store: store.store,
        readClient: readClient(1),
        executor: executor.executor,
      }),
    });
    expect(outcome.status).toBe('blocked');
    expect(outcome.reason).toMatch(/already resident/i);
    expect(executor.calls).toHaveLength(0);
  });
});

describe('mintMembershipForClaim — the compliance window', () => {
  it('refuses a Citizen claim before two minutes have elapsed server-side', async () => {
    const store = makeStore({ since: new Date(NOW - 30_000).toISOString() });
    const executor = makeExecutor();
    const outcome = await mintMembershipForClaim({
      profileId: PROFILE,
      target: 'citizen',
      deps: deps({
        store: store.store,
        readClient: readClient(1),
        executor: executor.executor,
      }),
    });
    expect(outcome.status).toBe('blocked');
    expect(outcome.reason).toMatch(/compliance window has not elapsed/i);
    expect(executor.calls).toHaveLength(0);
  });

  it('fails closed on a readable-but-null window: starts the clock and refuses', async () => {
    const store = makeStore({ since: null });
    const executor = makeExecutor();
    const outcome = await mintMembershipForClaim({
      profileId: PROFILE,
      target: 'citizen',
      deps: deps({
        store: store.store,
        readClient: readClient(1),
        executor: executor.executor,
      }),
    });

    expect(outcome.status).toBe('blocked');
    expect(outcome.sent).toBe(false);
    expect(outcome.reason).toMatch(/started now/i);
    expect(outcome.reason).toMatch(/two minutes/i);
    expect(executor.calls).toHaveLength(0);
    // The clock is started so a later claim can pass.
    expect(store.getSince()).not.toBeNull();
  });

  it('degrades honestly when the window cannot be read, never inventing one', async () => {
    const store = makeStore({ sinceUnread: 'column does not exist' });
    const executor = makeExecutor();
    const outcome = await mintMembershipForClaim({
      profileId: PROFILE,
      target: 'citizen',
      deps: deps({
        store: store.store,
        readClient: readClient(1),
        logClient: logClient(1, 2),
        executor: executor.executor,
      }),
    });
    expect(outcome.status).toBe('sent');
    if (outcome.status !== 'sent') throw new Error('expected sent');
    expect(outcome.reason).toMatch(/could not be read server-side/i);
    expect(executor.calls).toHaveLength(1);
  });
});

describe('mintMembershipForClaim — failures are honest', () => {
  it('reports a reverted Safe transaction with sent: false', async () => {
    const store = makeStore();
    const executor = makeExecutor({ success: false });
    const outcome = await mintMembershipForClaim({
      profileId: PROFILE,
      target: 'resident',
      deps: deps({ store: store.store, executor: executor.executor }),
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.sent).toBe(false);
    if (outcome.status !== 'failed') throw new Error('expected failed');
    expect(outcome.txHash).toBe(TX_HASH);
    expect(outcome.reason).toMatch(/reverted/i);
  });

  it('stays sent:false when the intent cannot be recorded', async () => {
    const store = makeStore({ failIntent: true });
    const executor = makeExecutor();
    const outcome = await mintMembershipForClaim({
      profileId: PROFILE,
      target: 'resident',
      deps: deps({ store: store.store, executor: executor.executor }),
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.sent).toBe(false);
    expect(executor.calls).toHaveLength(0);
  });

  it('reports not-configured without the issuance gate', async () => {
    const outcome = await mintMembershipForClaim({
      profileId: PROFILE,
      target: 'resident',
      deps: deps({ gate: null }),
    });
    expect(outcome.status).toBe('not-configured');
    expect(outcome.sent).toBe(false);
  });

  it('reports not-configured without an executor, recording no intent', async () => {
    const store = makeStore();
    const outcome = await mintMembershipForClaim({
      profileId: PROFILE,
      target: 'resident',
      deps: deps({ store: store.store, executor: null }),
    });
    expect(outcome.status).toBe('not-configured');
    expect(outcome.sent).toBe(false);
    expect(store.intents).toHaveLength(0);
  });

  it('reports not-configured without a log client, recording no intent', async () => {
    const store = makeStore();
    const outcome = await mintMembershipForClaim({
      profileId: PROFILE,
      target: 'resident',
      deps: deps({ store: store.store, logClient: null }),
    });
    expect(outcome.status).toBe('not-configured');
    expect(outcome.sent).toBe(false);
    expect(store.intents).toHaveLength(0);
  });
});
