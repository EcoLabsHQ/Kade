import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createNotConfiguredOnboardingStore,
  createSupabaseOnboardingStore,
  PersistenceNotConfiguredError,
  type OnboardingSnapshot,
} from '@/lib/onboarding/persistence';

/**
 * Restore-seam tests.
 *
 * The live Step 2 write is `save_onboarding_step2` in
 * `@/app/onboarding/actions`, covered by the guard tests in
 * `onboarding-actions.test.ts`. Here we cover the read side that repopulates
 * the form, and pin that the read store cannot be mistaken for a writer.
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
  profile: {
    firstName: 'Ada',
    lastName: 'Lovelace',
    dob: '1990-01-01',
    gender: 'Female',
  },
  citizenships: ['NL', 'DE'],
  residences: [{ countryCode: 'NL', fromYear: 2000, toYear: 'present' }],
  tier: 2,
  members: [
    {
      name: 'Grace',
      relation: 'Child',
      dob: '2015-05-05',
      citizenship: 'DE',
      gender: 'Female',
    },
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
  it('is not the write boundary: save is unreachable by design', async () => {
    const { client } = createFakeSupabase();
    const store = createSupabaseOnboardingStore(() => client);

    await expect(store.save('user-1', snapshot)).rejects.toThrow(
      /save_onboarding_step2/,
    );
  });

  it('restores a saved draft, reading a NULL to_year back as "present"', async () => {
    const { client } = createFakeSupabase({
      profile: {
        first_name: 'Ada',
        last_name: 'Lovelace',
        dob: '1990-01-01',
        gender: 'Female',
      },
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
          gender: 'Female',
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
    // Legacy Son/Daughter load as Child, not as an invalid value.
    expect(loaded?.members[0]?.relation).toBe('Child');
    expect(loaded?.profile.gender).toBe('Female');
    expect(loaded?.members[0]?.gender).toBe('Female');
  });

  it('loads a NULL gender as unset instead of inventing a value', async () => {
    const { client } = createFakeSupabase({
      profile: {
        first_name: 'Ada',
        last_name: 'Lovelace',
        dob: '1990-01-01',
        gender: null,
      },
      application: { id: 'app-1', tier: '5-year' },
      citizenships: [{ country_code: 'NL' }],
      residences: [{ country_code: 'NL', from_year: 2019, to_year: null }],
      members: [
        {
          name: 'Pat',
          relation: 'Child',
          dob: '2015-05-05',
          citizenship: 'DE',
          gender: null,
        },
      ],
    });
    const store = createSupabaseOnboardingStore(() => client);
    const loaded = await store.load('user-1');

    expect(loaded?.profile.gender).toBe('');
    expect(loaded?.members[0]?.gender).toBe('');
  });

  it('preserves an unknown legacy relation so it can be re-selected', async () => {
    const { client } = createFakeSupabase({
      profile: {
        first_name: 'Ada',
        last_name: 'Lovelace',
        dob: '1990-01-01',
        gender: 'Female',
      },
      application: { id: 'app-1', tier: '5-year' },
      citizenships: [{ country_code: 'NL' }],
      residences: [{ country_code: 'NL', from_year: 2019, to_year: null }],
      members: [
        {
          name: 'Pat',
          relation: 'Dependent parent',
          dob: '1950-01-01',
          citizenship: 'NL',
          gender: 'Other',
        },
      ],
    });
    const store = createSupabaseOnboardingStore(() => client);
    const loaded = await store.load('user-1');

    // Not silently rewritten: the form must surface and correct it.
    expect(loaded?.members[0]?.relation).toBe('Dependent parent');
  });
});
