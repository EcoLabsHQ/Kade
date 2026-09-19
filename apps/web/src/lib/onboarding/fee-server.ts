import type { SupabaseClient } from '@supabase/supabase-js';
import type { FeeMode } from '@kade/shared';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  preapprovalBreakdownFromSchedule,
  type PreapprovalFeeBreakdown,
  type PreapprovalFeeSchedule,
} from './fee';

/**
 * Server-side reads of the authoritative fee configuration.
 *
 * Contract section 2.1: "The fee is calculated server-side from the active
 * `fee_schedule`; the client may display it but cannot override it." This module
 * reads the `fee_schedule` row for the active mode and asks
 * `public.preapproval_fee_usdc` for the resolved amount. Nothing here accepts a
 * caller-supplied amount.
 *
 * Kept out of `./fee.ts` so the browser bundle never pulls in the cookie-bound
 * Supabase client.
 */

const PREAPPROVAL_COLUMNS =
  'mode, base_amount, per_member_amount, rounding_scale';

function isFeeMode(value: unknown): value is FeeMode {
  return value === 'demo' || value === 'production';
}

/**
 * The active pre-approval schedule row, or null when the mode has no row.
 *
 * Throws when the read itself fails, so a broken read is never mistaken for
 * "no fee configured".
 */
export async function loadPreapprovalFeeSchedule(
  mode: FeeMode,
  client?: SupabaseClient,
): Promise<PreapprovalFeeSchedule | null> {
  const supabase = client ?? (await createSupabaseServerClient());
  const { data, error } = await supabase
    .from('fee_schedule')
    .select(PREAPPROVAL_COLUMNS)
    .eq('mode', mode)
    .eq('key', 'preapproval')
    .maybeSingle();

  if (error) {
    throw new Error(`Reading the fee schedule failed: ${error.message}`);
  }
  if (!data) return null;

  const row = data as {
    mode: unknown;
    base_amount: unknown;
    per_member_amount: unknown;
    rounding_scale: unknown;
  };
  if (!isFeeMode(row.mode)) return null;

  const baseUsdc = Number(row.base_amount);
  const perMemberUsdc = Number(row.per_member_amount);
  const roundingScale = Number(row.rounding_scale);
  if (
    !Number.isFinite(baseUsdc) ||
    !Number.isFinite(perMemberUsdc) ||
    !Number.isInteger(roundingScale)
  ) {
    return null;
  }

  return { mode: row.mode, baseUsdc, perMemberUsdc, roundingScale };
}

/**
 * The database's own pre-approval total for a household size.
 *
 * This is the natural call when a resolved amount is needed: the function reads
 * `fee_schedule` and applies the frozen formula, so the value does not depend
 * on any arithmetic in this repository.
 */
export async function resolvePreapprovalFeeTotal(
  mode: FeeMode,
  householdSize: number,
  client?: SupabaseClient,
): Promise<number | null> {
  const supabase = client ?? (await createSupabaseServerClient());
  const { data, error } = await supabase.rpc('preapproval_fee_usdc', {
    p_mode: mode,
    p_household_size: householdSize,
  });

  if (error) {
    throw new Error(`Resolving the pre-approval fee failed: ${error.message}`);
  }
  if (data === null || data === undefined) return null;

  const total = Number(data);
  return Number.isFinite(total) ? total : null;
}

/**
 * The full display breakdown for a household size.
 *
 * The base and per-member lines come from the active `fee_schedule` row; the
 * total comes from the database function itself, so the number the client shows
 * is the database's answer even before anything is saved. Returns null when the
 * mode has no configured pre-approval row or the database cannot resolve it.
 */
export async function resolvePreapprovalFeeBreakdown(
  mode: FeeMode,
  householdSize: number,
  client?: SupabaseClient,
): Promise<PreapprovalFeeBreakdown | null> {
  const schedule = await loadPreapprovalFeeSchedule(mode, client);
  if (!schedule) return null;

  const breakdown = preapprovalBreakdownFromSchedule(schedule, householdSize);
  const totalUsdc = await resolvePreapprovalFeeTotal(
    mode,
    householdSize,
    client,
  );
  return totalUsdc === null ? breakdown : { ...breakdown, totalUsdc };
}
