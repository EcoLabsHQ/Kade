import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  deriveResidencyView,
  type ResidencyFacts,
} from '@/lib/residency/checks';
import type { ResidencySnapshot } from '@/lib/residency/server';
import type { ColosseumMembership } from '@/lib/colosseum/server';

/**
 * The Colosseum server actions, tested directly.
 *
 * The client screen is covered elsewhere with the actions mocked, so these
 * tests pin the enforcement that only lives on the server. Each action must
 * re-check the environment gate, re-read the session, and recompute the four
 * real residency checks from `loadResidencySnapshot` before it reaches the
 * database RPC. No client-supplied boolean, timestamp or serial exists in the
 * action signatures, so a caller cannot claim eligibility the records do not
 * support.
 *
 * Every collaborator is mocked, so nothing touches the network, the database or
 * a bundler. The snapshots are built with the **real** `deriveResidencyView`, so
 * "all four met" is a genuine derivation and not a hand-written boolean.
 */

const hoisted = vi.hoisted(() => ({
  isColosseumEnabled: vi.fn(),
  getSessionUser: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  loadResidencySnapshot: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/colosseum/gate', () => ({
  isColosseumEnabled: hoisted.isColosseumEnabled,
}));
vi.mock('@/lib/supabase/server', () => ({
  getSessionUser: hoisted.getSessionUser,
  createSupabaseServerClient: hoisted.createSupabaseServerClient,
}));
vi.mock('@/lib/residency/server', () => ({
  loadResidencySnapshot: hoisted.loadResidencySnapshot,
}));
vi.mock('next/cache', () => ({ revalidatePath: hoisted.revalidatePath }));

import {
  becomeColosseumCitizenAction,
  registerColosseumResidencyAction,
  syncColosseumResidencyAction,
} from '@/app/colosseum/actions';

/** The four real checks, all green, as `deriveResidencyView` sees them. */
const ALL_MET: ResidencyFacts = {
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
};

function facts(overrides: Partial<ResidencyFacts> = {}): ResidencyFacts {
  return { ...ALL_MET, ...overrides };
}

function snapshot(overrides: Partial<ResidencyFacts> = {}): ResidencySnapshot {
  return {
    applicationId: 'app-1',
    applicationRef: 'CW-2026-0409',
    tier: ALL_MET.tier,
    status: 'pre_approved',
    view: deriveResidencyView(facts(overrides), true),
    preapprovalPaid: true,
    serviceFeeAmountUsdc: 10,
    preapprovalUsdc: 447,
    serviceFeeConfigured: true,
    selfConfigured: false,
    permit: {
      status: 'not-configured',
      reason: 'No permit issuance approval is recorded in this environment.',
    },
  };
}

const MEMBERSHIP_ROW = {
  resident_since: '2026-09-30T12:00:00.000Z',
  citizen_at: '2026-09-30T12:05:00.000Z',
  passport_serial: 'KADE-CL-ABCDEF123456',
};

const MEMBERSHIP: ColosseumMembership = {
  residentSince: MEMBERSHIP_ROW.resident_since,
  citizenAt: MEMBERSHIP_ROW.citizen_at,
  passportSerial: MEMBERSHIP_ROW.passport_serial,
};

const SESSION = {
  domain: 'application-session' as const,
  provider: 'email' as const,
  userId: 'user-1',
  email: 'resident@example.com',
};

interface RpcError {
  readonly message: string;
}

interface RpcResult {
  readonly data: unknown;
  readonly error: RpcError | null;
}

type Rpc = (name: string, args?: Record<string, unknown>) => Promise<RpcResult>;

interface FakeResult {
  readonly data?: unknown;
  readonly error?: RpcError | null;
}

function createFakeClient(result: FakeResult = {}): {
  readonly client: SupabaseClient;
  readonly rpc: ReturnType<typeof vi.fn<Rpc>>;
} {
  const rpc = vi.fn<Rpc>(async () => ({
    data: result.data ?? null,
    error: result.error ?? null,
  }));
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

interface SeedOptions {
  readonly enabled?: boolean;
  readonly session?: typeof SESSION | null;
  readonly snapshot?: ResidencySnapshot | null;
  readonly rpc?: FakeResult;
}

/** Put the world in the given state and hand back the RPC spy to assert on. */
function seed(options: SeedOptions = {}): ReturnType<typeof createFakeClient> {
  hoisted.isColosseumEnabled.mockReturnValue(options.enabled ?? true);
  hoisted.getSessionUser.mockResolvedValue(
    options.session === undefined ? SESSION : options.session,
  );
  const fake = createFakeClient(
    options.rpc ?? { data: MEMBERSHIP_ROW, error: null },
  );
  hoisted.createSupabaseServerClient.mockResolvedValue(fake.client);
  hoisted.loadResidencySnapshot.mockResolvedValue(
    options.snapshot === undefined ? snapshot() : options.snapshot,
  );
  return fake;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Colosseum actions: environment gate', () => {
  it('refuses every action and never touches the database when the gate is off', async () => {
    const { rpc } = seed({ enabled: false });

    const register = await registerColosseumResidencyAction();
    const sync = await syncColosseumResidencyAction();
    const become = await becomeColosseumCitizenAction();

    for (const result of [register, sync, become]) {
      expect(result.status).toBe('refused');
      if (result.status !== 'refused') throw new Error('expected refused');
      expect(result.reason).toMatch(/not enabled in this environment/i);
    }
    // The gate runs first: no session read, no client, no RPC.
    expect(hoisted.getSessionUser).not.toHaveBeenCalled();
    expect(hoisted.createSupabaseServerClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('Colosseum actions: session re-read', () => {
  it('refuses every action without a session and never calls an RPC', async () => {
    const { rpc } = seed({ session: null });

    const register = await registerColosseumResidencyAction();
    const sync = await syncColosseumResidencyAction();
    const become = await becomeColosseumCitizenAction();

    for (const result of [register, sync, become]) {
      expect(result.status).toBe('refused');
      if (result.status !== 'refused') throw new Error('expected refused');
      expect(result.reason).toMatch(/must be signed in/i);
    }
    expect(hoisted.getSessionUser).toHaveBeenCalledTimes(3);
    expect(hoisted.createSupabaseServerClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('registerColosseumResidencyAction', () => {
  it('calls the owner-scoped RPC and returns ok', async () => {
    const { rpc } = seed({ rpc: { data: null, error: null } });

    const result = await registerColosseumResidencyAction();

    expect(result).toEqual({ status: 'ok' });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('register_colosseum_residency');
    expect(hoisted.revalidatePath).toHaveBeenCalledWith('/colosseum');
  });

  it('maps an RPC refusal honestly instead of reporting success', async () => {
    const { rpc } = seed({
      rpc: { data: null, error: { message: 'no application for user' } },
    });

    const result = await registerColosseumResidencyAction();

    expect(rpc).toHaveBeenCalledWith('register_colosseum_residency');
    expect(result.status).toBe('refused');
    if (result.status !== 'refused') throw new Error('expected refused');
    expect(result.reason).toMatch(/no residency application is recorded/i);
    expect(hoisted.revalidatePath).not.toHaveBeenCalled();
  });
});

describe('syncColosseumResidencyAction', () => {
  it('derives all four checks as met from the real view before calling the RPC', () => {
    // Guards the premise of the test below: the snapshot is genuinely all-met.
    expect(snapshot().view.checks.every((check) => check.state === 'met')).toBe(
      true,
    );
  });

  it('sends p_met: true when all four checks are met, with no client input', async () => {
    const { rpc } = seed();

    const result = await syncColosseumResidencyAction();

    expect(hoisted.loadResidencySnapshot).toHaveBeenCalledWith('user-1');
    expect(rpc).toHaveBeenCalledTimes(1);
    const call = rpc.mock.calls.at(0);
    expect(call?.[0]).toBe('sync_colosseum_residency');
    expect(call?.[1]).toEqual({ p_met: true });
    // The RPC receives only the server-derived boolean, nothing else.
    expect(Object.keys(call?.[1] ?? {})).toEqual(['p_met']);
    expect(result).toEqual({ status: 'ok', membership: MEMBERSHIP });
    // The action accepts no argument, so a client cannot pass `met`.
    expect(syncColosseumResidencyAction).toHaveLength(0);
  });

  const NOT_MET: ReadonlyArray<readonly [string, Partial<ResidencyFacts>]> = [
    [
      'identity',
      {
        identity: {
          provider: 'self',
          status: 'invalid',
          verifiedAt: null,
          selfNullifier: null,
        },
      },
    ],
    ['funds', { qualified: { status: 'known', usd: 0 } }],
    ['review', { review: 'pending' }],
    [
      'service-fee',
      { serviceFee: { recorded: false, verified: false, amountUsdc: 10 } },
    ],
  ];

  for (const [label, override] of NOT_MET) {
    it(`sends p_met: false when the ${label} check is not met`, async () => {
      const { rpc } = seed({ snapshot: snapshot(override) });

      const result = await syncColosseumResidencyAction();

      expect(rpc).toHaveBeenCalledWith('sync_colosseum_residency', {
        p_met: false,
      });
      expect(result.status).toBe('ok');
    });
  }

  it('refuses when there is no residency application, without calling the RPC', async () => {
    const { rpc } = seed({ snapshot: null });

    const result = await syncColosseumResidencyAction();

    expect(result.status).toBe('refused');
    if (result.status !== 'refused') throw new Error('expected refused');
    expect(result.reason).toMatch(/no residency application is recorded/i);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('becomeColosseumCitizenAction', () => {
  it('refuses before the RPC when the four checks are not all met', async () => {
    const { rpc } = seed({ snapshot: snapshot({ review: 'pending' }) });

    const result = await becomeColosseumCitizenAction();

    expect(result.status).toBe('refused');
    if (result.status !== 'refused') throw new Error('expected refused');
    expect(result.reason).toMatch(/four residency checks/i);
    expect(rpc).not.toHaveBeenCalled();
    expect(hoisted.revalidatePath).not.toHaveBeenCalled();
  });

  it('records the citizen through the RPC when all four checks are met', async () => {
    const { rpc } = seed();

    const result = await becomeColosseumCitizenAction();

    expect(hoisted.loadResidencySnapshot).toHaveBeenCalledWith('user-1');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('record_colosseum_citizen');
    expect(result).toEqual({ status: 'ok', membership: MEMBERSHIP });
    expect(hoisted.revalidatePath).toHaveBeenCalledWith('/colosseum');
    // The action accepts no argument, so the serial/eligibility cannot be forged.
    expect(becomeColosseumCitizenAction).toHaveLength(0);
  });

  it('maps the RPC 2-minute refusal to an honest refusal, never a success', async () => {
    const { rpc } = seed({
      rpc: {
        data: null,
        error: {
          message: 'record_colosseum_citizen requires 2 minutes of residency',
        },
      },
    });

    const result = await becomeColosseumCitizenAction();

    expect(rpc).toHaveBeenCalledWith('record_colosseum_citizen');
    expect(result.status).toBe('refused');
    if (result.status !== 'refused') throw new Error('expected refused');
    expect(result.reason).toMatch(/2-minute compliance window has not elapsed/i);
    expect(result).not.toHaveProperty('membership');
    expect(hoisted.revalidatePath).not.toHaveBeenCalled();
  });

  it('refuses when there is no residency application, without calling the RPC', async () => {
    const { rpc } = seed({ snapshot: null });

    const result = await becomeColosseumCitizenAction();

    expect(result.status).toBe('refused');
    if (result.status !== 'refused') throw new Error('expected refused');
    expect(result.reason).toMatch(/no residency application is recorded/i);
    expect(rpc).not.toHaveBeenCalled();
  });
});
