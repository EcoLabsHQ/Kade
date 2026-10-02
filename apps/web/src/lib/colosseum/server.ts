import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * The Colosseum membership read.
 *
 * `public.colosseum_memberships` is owner-only SELECT (RLS `profile_id =
 * auth.uid()`), so this reads the signed-in resident's own row and nothing else.
 * A missing row is "not a Colosseum resident" — never a fabricated membership.
 *
 * The clock and the passport are server-written: this module only reads. The
 * writers are the `SECURITY DEFINER` RPCs the Colosseum actions call
 * (`register_colosseum_residency`, `sync_colosseum_residency`,
 * `record_colosseum_citizen`).
 */
export interface ColosseumMembership {
  /** Start of the current continuous qualifying period, or null. */
  readonly residentSince: string | null;
  /** When the resident became a Colosseum Citizen, or null. */
  readonly citizenAt: string | null;
  /** The server-generated virtual passport serial, or null. */
  readonly passportSerial: string | null;
}

/** The database row shape, mapped to the camelCase membership. */
export interface ColosseumMembershipRow {
  readonly resident_since: string | null;
  readonly citizen_at: string | null;
  readonly passport_serial: string | null;
}

/**
 * Map a membership row (from the table or an RPC return) to the membership the
 * surface renders. Exported so the actions can reuse it on the RPC's returned
 * row without a second read.
 */
export function toColosseumMembership(
  row: ColosseumMembershipRow,
): ColosseumMembership {
  return {
    residentSince: row.resident_since,
    citizenAt: row.citizen_at,
    passportSerial: row.passport_serial,
  };
}

/**
 * The signed-in resident's Colosseum membership, or null when they have none.
 *
 * Throws when the read itself fails, so a broken read is never mistaken for
 * "not a resident": showing the registration call-to-action to an existing
 * citizen would misstate their state.
 */
export async function loadColosseumMembership(
  profileId: string,
): Promise<ColosseumMembership | null> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from('colosseum_memberships')
    .select('resident_since, citizen_at, passport_serial')
    .eq('profile_id', profileId)
    .maybeSingle();
  if (error) {
    throw new Error(`Loading the Colosseum membership failed: ${error.message}`);
  }
  return data ? toColosseumMembership(data as ColosseumMembershipRow) : null;
}
