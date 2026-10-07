import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  EMPTY_COLOSSEUM_PROGRESS,
  type ColosseumProgress,
} from '@/components/residency/colosseum-progress';

/**
 * The Colosseum demo state, read and written server-side, per account.
 *
 * The state used to live only in the browser (`localStorage`); it now lives in
 * the server record so it follows the account, not the browser. This module is
 * the only place the demo state is read or written:
 *
 *   - the compliance window (`residentSince`) is the existing
 *     `applications.colosseum_resident_since` column the Citizen mint already
 *     reads — the single source of truth for the 2-minute window;
 *   - the demo certificate/pass instants and serials and the documents flag are
 *     the `colosseum_progress` row (migration `20261008000001`);
 *   - every write goes through a resident-scoped `SECURITY DEFINER` function
 *     that derives the account from `auth.uid()`. No profile id is accepted from
 *     the client, and the functions are granted only to `authenticated`.
 *
 * Every read degrades honestly: a failed read (for example the migration is not
 * applied yet) yields the empty demo state rather than inventing one. A write
 * that fails throws, so the caller can keep its optimistic state and report the
 * failure rather than pretending the state persisted.
 */

export interface ColosseumState {
  readonly progress: ColosseumProgress;
  /** The demo "Documents complete" flag. */
  readonly documentsComplete: boolean;
}

export const EMPTY_COLOSSEUM_STATE: ColosseumState = {
  progress: EMPTY_COLOSSEUM_PROGRESS,
  documentsComplete: false,
};

interface ProgressRow {
  readonly citizen_at: string | null;
  readonly passport_serial: string | null;
  readonly residency_pass_at: string | null;
  readonly residency_pass_serial: string | null;
  readonly documents_complete: boolean | null;
}

/**
 * Read the demo state for a profile.
 *
 * `residentSince` comes from `applications.colosseum_resident_since`; the rest
 * from `colosseum_progress`. A failed read of either yields the empty state (the
 * demo simply shows nothing), never a fabricated value.
 */
export async function loadColosseumState(profileId: string): Promise<ColosseumState> {
  try {
    const client = await createSupabaseServerClient();
    const [application, progress] = await Promise.all([
      client
        .from('applications')
        .select('colosseum_resident_since')
        .eq('profile_id', profileId)
        .maybeSingle(),
      client
        .from('colosseum_progress')
        .select(
          'citizen_at,passport_serial,residency_pass_at,residency_pass_serial,documents_complete',
        )
        .eq('profile_id', profileId)
        .maybeSingle(),
    ]);

    if (application.error) {
      throw new Error(application.error.message);
    }
    if (progress.error) {
      throw new Error(progress.error.message);
    }

    const applicationRow = application.data as
      | { colosseum_resident_since: string | null }
      | null;
    const row = (progress.data as ProgressRow | null) ?? null;

    return {
      progress: {
        residentSince: applicationRow?.colosseum_resident_since ?? null,
        citizenAt: row?.citizen_at ?? null,
        passportSerial: row?.passport_serial ?? null,
        residencyPassAt: row?.residency_pass_at ?? null,
        residencyPassSerial: row?.residency_pass_serial ?? null,
      },
      documentsComplete: row?.documents_complete === true,
    };
  } catch (cause) {
    console.warn(
      '[kade] Could not read the Colosseum demo state:',
      cause instanceof Error ? cause.message : cause,
    );
    return EMPTY_COLOSSEUM_STATE;
  }
}

async function rpc(
  name: string,
  args: Record<string, unknown> = {},
): Promise<void> {
  const client = await createSupabaseServerClient();
  const { error } = await client.rpc(name, args);
  if (error) {
    throw new Error(`${name} failed: ${error.message}`);
  }
}

/** Start the compliance window once (the four-checks-green transition). */
export async function startColosseumWindow(profileId: string): Promise<ColosseumState> {
  await rpc('start_colosseum_window');
  return loadColosseumState(profileId);
}

/** Clear the compliance window before citizenship (the decay). */
export async function clearColosseumWindow(profileId: string): Promise<ColosseumState> {
  await rpc('clear_colosseum_window');
  return loadColosseumState(profileId);
}

/** Record the residency-pass claim once. */
export async function claimColosseumResidencyPass(
  profileId: string,
  serial: string,
): Promise<ColosseumState> {
  await rpc('claim_colosseum_residency_pass', { p_serial: serial });
  return loadColosseumState(profileId);
}

/** Record citizenship once. */
export async function becomeColosseumCitizen(
  profileId: string,
  serial: string,
): Promise<ColosseumState> {
  await rpc('become_colosseum_citizen', { p_serial: serial });
  return loadColosseumState(profileId);
}

/** Set the demo "Documents complete" flag. */
export async function setColosseumDocumentsComplete(
  profileId: string,
  complete: boolean,
): Promise<ColosseumState> {
  await rpc('set_colosseum_documents_complete', { p_complete: complete });
  return loadColosseumState(profileId);
}
