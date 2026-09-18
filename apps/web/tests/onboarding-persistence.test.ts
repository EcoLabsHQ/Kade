import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createNotConfiguredOnboardingStore,
  createSupabaseOnboardingStore,
  PersistenceNotConfiguredError,
  type OnboardingSnapshot,
} from '@/lib/onboarding/persistence';

/**
 * Persistence seam tests.
 *
 * There is no reachable Supabase in this repository's test environment, so the
 * write path is exercised against a recording fake. The assertions are about
 * the contract: the client writes only the columns it is allowed to, never the
 * fee, and a missing backend can never report a successful save.
 */

interface RecordedCall {
  readonly table: string;
  readonly method: string;
  readonly args: readonly unknown[];
}

interface FakeResponses {
  readonly fee?: number;
  readonly applicationId?: string;
  readonly hasApplication?: boolean;
  readonly profile?: Record<string, unknown> | null;
  readonly application?: Record<string, unknown> | null;
  readonly citizenships?: readonly unknown[];
  readonly residences?: readonly unknown[];
  readonly members?: readonly unknown[];
}

/**
 * A minimal thenable stand-in for a Supabase query builder. It records every
 * call and returns plausible rows keyed by the table and the selected columns.
 */
class FakeQuery {
  private readonly selectCols: string[] = [];
  private singleMode = false;
  private inserted = false;
  private readonly calls: { method: string; args: readonly unknown[] }[] = [];

  constructor(
    private readonly table: string,
    private readonly ops: RecordedCall[],
    private readonly responses: FakeResponses,
  ) {}

  select(...args: unknown[]): this {
    this.record('select', args);
    if (typeof args[0] === 'string') this.selectCols.push(args[0]);
    return this;
  }

  insert(...args: unknown[]): this {
    this.inserted = true;
    this.record('insert', args);
    return this;
  }

  update(...args: unknown[]): this {
    this.record('update', args);
    return this;
  }

  upsert(...args: unknown[]): this {
    this.record('upsert', args);
    return this;
  }

  delete(...args: unknown[]): this {
    this.record('delete', args);
    return this;
  }

  eq(...args: unknown[]): this {
    this.record('eq', args);
    return this;
  }

  maybeSingle(): this {
    this.record('maybeSingle', []);
    return this;
  }

  single(): this {
    this.singleMode = true;
    this.record('single', []);
    return this;
  }

  private record(method: string, args: readonly unknown[]): void {
    const call = { method, args };
    this.calls.push(call);
    this.ops.push({ table: this.table, ...call });
  }

  then(
    resolve: (value: unknown) => unknown,
    reject?: (reason: unknown) => unknown,
  ): Promise<unknown> {
    return Promise.resolve({ data: this.data(), error: null }).then(
      resolve,
      reject,
    );
  }

  private data(): unknown {
    const r = this.responses;
    const cols = this.selectCols.join(',');
    if (this.table === 'applications') {
      if (cols.includes('preapproval_usdc')) {
        return { preapproval_usdc: r.fee ?? 1.75 };
      }
      if (cols.includes('tier')) {
        return r.application ?? null;
      }
      if (this.singleMode) return { id: r.applicationId ?? 'app-1' };
      if (r.hasApplication) return { id: r.applicationId ?? 'app-1' };
      return null;
    }
    if (this.table === 'profiles' && this.selectCols.length > 0) {
      return r.profile ?? null;
    }
    if (this.table === 'profile_citizenships' && this.selectCols.length > 0) {
      return r.citizenships ?? [];
    }
    if (this.table === 'profile_residences' && this.selectCols.length > 0) {
      return r.residences ?? [];
    }
    if (this.table === 'household_members' && this.selectCols.length > 0) {
      return r.members ?? [];
    }
    return null;
  }
}

function createFakeSupabase(responses: FakeResponses = {}): {
  readonly client: SupabaseClient;
  readonly ops: RecordedCall[];
} {
  const ops: RecordedCall[] = [];
  const client = {
    from(table: string) {
      return new FakeQuery(table, ops, responses);
    },
  };
  return { client: client as unknown as SupabaseClient, ops };
}

const snapshot: OnboardingSnapshot = {
  profile: { firstName: 'Ada', lastName: 'Lovelace', dob: '1990-01-01' },
  citizenships: ['NL', 'DE'],
  residences: [{ countryCode: 'NL', fromYear: 2000, toYear: 'present' }],
  tier: 2,
  members: [
    { name: 'Grace', relation: 'Daughter', dob: '2015-05-05', citizenship: 'DE' },
  ],
};

describe('not-configured store', () => {
  it('never reports a successful save', async () => {
    const store = createNotConfiguredOnboardingStore();
    expect(store.mode).toBe('not-configured');
    expect(await store.load('user-1')).toBeNull();
    await expect(store.save('user-1', snapshot)).rejects.toBeInstanceOf(
      PersistenceNotConfiguredError,
    );
  });
});

describe('supabase store', () => {
  it('writes only the client-allowed columns and never the fee', async () => {
    const { client, ops } = createFakeSupabase({
      fee: 1.75,
      applicationId: 'app-1',
    });
    const store = createSupabaseOnboardingStore(() => client);
    const result = await store.save('user-1', snapshot);

    expect(result).toEqual({ applicationId: 'app-1', preapprovalUsdc: 1.75 });

    const profileUpsert = ops.find(
      (op) => op.table === 'profiles' && op.method === 'upsert',
    );
    expect(profileUpsert?.args[0]).toEqual({
      id: 'user-1',
      first_name: 'Ada',
      last_name: 'Lovelace',
      dob: '1990-01-01',
    });

    const appInsert = ops.find(
      (op) => op.table === 'applications' && op.method === 'insert',
    );
    expect(appInsert?.args[0]).toEqual({
      profile_id: 'user-1',
      tier: 'indefinite',
    });
    expect(appInsert?.args[0]).not.toHaveProperty('preapproval_usdc');
    expect(appInsert?.args[0]).not.toHaveProperty('amount');
  });

  it('maps the "present" sentinel to a NULL to_year', async () => {
    const { client, ops } = createFakeSupabase();
    const store = createSupabaseOnboardingStore(() => client);
    await store.save('user-1', snapshot);

    const residenceInsert = ops.find(
      (op) => op.table === 'profile_residences' && op.method === 'insert',
    );
    expect(residenceInsert?.args[0]).toEqual([
      { profile_id: 'user-1', country_code: 'NL', from_year: 2000, to_year: null },
    ]);
  });

  it('updates the tier only, when an application already exists', async () => {
    const { client, ops } = createFakeSupabase({ hasApplication: true });
    const store = createSupabaseOnboardingStore(() => client);
    await store.save('user-1', snapshot);

    expect(
      ops.some((op) => op.table === 'applications' && op.method === 'insert'),
    ).toBe(false);
    const appUpdate = ops.find(
      (op) => op.table === 'applications' && op.method === 'update',
    );
    expect(appUpdate?.args[0]).toEqual({ tier: 'indefinite' });
  });

  it('rejects a snapshot that carries a client-supplied amount', async () => {
    const { client } = createFakeSupabase();
    const store = createSupabaseOnboardingStore(() => client);
    const tampered = {
      ...snapshot,
      amount: 0.01,
    } as unknown as OnboardingSnapshot;

    await expect(store.save('user-1', tampered)).rejects.toThrow(
      /client may not supply the fee/i,
    );
  });

  it('restores a saved draft, reading a NULL to_year back as "present"', async () => {
    const { client } = createFakeSupabase({
      profile: { first_name: 'Ada', last_name: 'Lovelace', dob: '1990-01-01' },
      application: { id: 'app-1', tier: '5-year' },
      citizenships: [{ country_code: 'NL' }],
      residences: [
        { country_code: 'NL', from_year: 2019, to_year: null },
        { country_code: 'DE', from_year: 2021, to_year: 2023 },
      ],
      members: [
        {
          name: 'Grace',
          relation: 'Daughter',
          dob: '2015-05-05',
          citizenship: 'DE',
        },
      ],
    });
    const store = createSupabaseOnboardingStore(() => client);
    const loaded = await store.load('user-1');

    expect(loaded?.tier).toBe(1);
    expect(loaded?.residences).toEqual([
      { countryCode: 'NL', fromYear: 2019, toYear: 'present' },
      { countryCode: 'DE', fromYear: 2021, toYear: 2023 },
    ]);
    expect(loaded?.citizenships).toEqual(['NL']);
    expect(loaded?.members).toHaveLength(1);
  });
});
