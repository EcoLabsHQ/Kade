import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/lib/supabase/server';
import {
  EMPTY_COLOSSEUM_PROGRESS,
  type ColosseumProgress,
} from '@/components/residency/colosseum-progress';
import { loadResidencySnapshot } from '@/lib/residency/server';
import { unmetMembershipChecks } from '@/lib/membership/mint';

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
 *   - the demo writes go through resident-scoped `SECURITY DEFINER` functions
 *     that derive the account from `auth.uid()`; no profile id is accepted from
 *     the client. They record values the resident is entitled to set (their own
 *     demo pass/certificate and documents flag).
 *   - the **window start is different**: it is a gate, not a demo value, so it
 *     is not resident-callable. `startColosseumWindow` re-derives the four real
 *     checks server-side and writes through the service-role
 *     `record_colosseum_resident_since` writer (migration `20261006000002`).
 *
 * Every read degrades honestly: a failed read yields the empty demo state
 * rather than inventing one. A write that fails throws, so the caller can keep
 * its optimistic state and report the failure rather than pretending the state
 * persisted.
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

/**
 * Raised when a window start is attempted for a resident whose four real
 * residency checks are not all green. It is a refusal, not a failure: the
 * server re-derived the checks and declined to start the clock.
 */
export class ColosseumWindowNotEligibleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ColosseumWindowNotEligibleError';
  }
}

/**
 * Start the compliance window once (the four-checks-green transition).
 *
 * SECURITY: the clock must not be startable by a client that merely claims to be
 * eligible. This re-derives the four real residency checks **server-side**, from
 * the same `loadResidencySnapshot` source the Citizen mint uses, with the same
 * `unmetMembershipChecks` gate — so a signed-in resident cannot pre-start the
 * window and satisfy the 2-minute gate early. Only when all four are `met` is
 * the window written, and the write goes through the service-role
 * `record_colosseum_resident_since` writer (the same authority migration
 * `20261006000002` established for the clock); there is no resident-callable
 * window writer.
 */
export async function startColosseumWindow(profileId: string): Promise<ColosseumState> {
  const snapshot = await loadResidencySnapshot(profileId);
  const checks = snapshot?.view.checks ?? [];
  const unmet = unmetMembershipChecks(checks);
  if (unmet.length > 0) {
    throw new ColosseumWindowNotEligibleError(
      'the four residency checks are not all met, so the compliance window is ' +
        'not started: ' +
        unmet.map((check) => `${check.id} (${check.state})`).join(', ') +
        '.',
    );
  }

  const client = await createSupabaseServiceClient();
  const { error } = await client.rpc('record_colosseum_resident_since', {
    p_profile_id: profileId,
  });
  if (error) {
    throw new Error(
      `record_colosseum_resident_since failed: ${error.message}`,
    );
  }
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
