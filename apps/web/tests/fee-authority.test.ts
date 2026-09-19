import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { assertNoClientSuppliedAmount } from '@/server/fee-authority';
import { preapprovalBreakdownFromSchedule } from '@/lib/onboarding/fee';
import {
  loadPreapprovalFeeSchedule,
  resolvePreapprovalFeeBreakdown,
  resolvePreapprovalFeeTotal,
} from '@/lib/onboarding/fee-server';

describe('client-supplied fee guard', () => {
  it('cannot be overridden by a client-supplied amount', () => {
    const tampered = { mode: 'demo', householdSize: 3, amount: 0.01 } as const;
    expect(() => assertNoClientSuppliedAmount(tampered)).toThrow(
      /client may not supply the fee/i,
    );
  });

  it('rejects every forbidden fee key', () => {
    for (const key of ['amount', 'fee', 'total', 'value', 'usdc']) {
      expect(() => assertNoClientSuppliedAmount({ [key]: 1 })).toThrow();
    }
    expect(() => assertNoClientSuppliedAmount({ householdSize: 3 })).not.toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* The runtime reads `fee_schedule`, not the shared constants                 */
/* -------------------------------------------------------------------------- */

interface FeeRow {
  readonly mode: string;
  readonly key: string;
  readonly base_amount: number;
  readonly per_member_amount: number;
  readonly rounding_scale: number;
}

/** The seeded demo pre-approval row. */
const DEMO_ROW: FeeRow = {
  mode: 'demo',
  key: 'preapproval',
  base_amount: 1,
  per_member_amount: 0.25,
  rounding_scale: 2,
};

/**
 * A fake Supabase client that owns a `fee_schedule` table and implements
 * `preapproval_fee_usdc` from those rows, so the test exercises the real server
 * code against a database boundary rather than a live connection.
 */
function createFakeFeeDatabase(
  rows: readonly FeeRow[],
  options: { readonly rpcValue?: number } = {},
): SupabaseClient {
  const client = {
    from(table: string) {
      if (table !== 'fee_schedule') {
        throw new Error(`unexpected table ${table}`);
      }
      const filters: Record<string, unknown> = {};
      const builder = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return builder;
        },
        async maybeSingle() {
          const row = rows.find(
            (candidate) =>
              candidate.mode === filters.mode && candidate.key === filters.key,
          );
          return { data: row ?? null, error: null };
        },
      };
      return builder;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      if (name !== 'preapproval_fee_usdc') {
        throw new Error(`unexpected rpc ${name}`);
      }
      if (options.rpcValue !== undefined) {
        return { data: options.rpcValue, error: null };
      }
      const row = rows.find(
        (candidate) =>
          candidate.mode === args.p_mode && candidate.key === 'preapproval',
      );
      if (!row) return { data: null, error: null };
      const factor = 10 ** row.rounding_scale;
      const value =
        Math.round(
          (row.base_amount +
            row.per_member_amount * Number(args.p_household_size)) *
            factor,
        ) / factor;
      return { data: value, error: null };
    },
  };
  return client as unknown as SupabaseClient;
}

describe('configured fee schedule (the runtime authority)', () => {
  it('reads the active pre-approval row instead of the shared constants', async () => {
    const client = createFakeFeeDatabase([DEMO_ROW]);
    await expect(loadPreapprovalFeeSchedule('demo', client)).resolves.toEqual({
      mode: 'demo',
      baseUsdc: 1,
      perMemberUsdc: 0.25,
      roundingScale: 2,
    });
  });

  it('reproduces the contract example from the schedule (household of 3 -> 1.75)', async () => {
    const client = createFakeFeeDatabase([DEMO_ROW]);
    const breakdown = await resolvePreapprovalFeeBreakdown('demo', 3, client);

    expect(breakdown).not.toBeNull();
    expect(breakdown?.baseUsdc).toBe(1);
    expect(breakdown?.perMemberUsdc).toBe(0.25);
    expect(breakdown?.householdUsdc).toBe(0.75);
    expect(breakdown?.totalUsdc).toBe(1.75);
  });

  it('changes the displayed total when the schedule changes', async () => {
    const changed: FeeRow = { ...DEMO_ROW, per_member_amount: 0.5 };
    const client = createFakeFeeDatabase([changed]);
    const breakdown = await resolvePreapprovalFeeBreakdown('demo', 3, client);

    // 1.00 + 0.50 x 3. The shared formula would still say 1.75; the schedule
    // is what the server shows.
    expect(breakdown?.totalUsdc).toBe(2.5);
  });

  it('uses the database function for the total, not local arithmetic', async () => {
    const client = createFakeFeeDatabase([DEMO_ROW], { rpcValue: 42 });
    const breakdown = await resolvePreapprovalFeeBreakdown('demo', 3, client);

    expect(breakdown?.totalUsdc).toBe(42);
    // The display lines still come from the schedule row.
    expect(breakdown?.baseUsdc).toBe(1);
  });

  it('asks the database function for the mode and household size', async () => {
    const client = createFakeFeeDatabase([DEMO_ROW]);
    await expect(resolvePreapprovalFeeTotal('demo', 3, client)).resolves.toBe(
      1.75,
    );
  });

  it('returns null rather than inventing a value when no row is configured', async () => {
    const client = createFakeFeeDatabase([]);
    await expect(
      loadPreapprovalFeeSchedule('production', client),
    ).resolves.toBeNull();
    await expect(
      resolvePreapprovalFeeBreakdown('production', 3, client),
    ).resolves.toBeNull();
  });

  it('previews the schedule arithmetic and rejects an invalid household size', () => {
    const schedule = {
      mode: 'demo',
      baseUsdc: 1,
      perMemberUsdc: 0.25,
      roundingScale: 2,
    } as const;
    expect(preapprovalBreakdownFromSchedule(schedule, 3).totalUsdc).toBe(1.75);
    expect(() => preapprovalBreakdownFromSchedule(schedule, 0)).toThrow(
      RangeError,
    );
  });
});
