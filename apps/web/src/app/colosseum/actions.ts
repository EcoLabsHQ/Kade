'use server';

import { revalidatePath } from 'next/cache';
import {
  createSupabaseServiceClient,
  getSessionUser,
  isServiceRoleConfigured,
} from '@/lib/supabase/server';
import { isColosseumEnabled } from '@/lib/colosseum/gate';
import {
  toColosseumMembership,
  type ColosseumMembership,
  type ColosseumMembershipRow,
} from '@/lib/colosseum/server';
import {
  loadResidencySnapshot,
  type ResidencySnapshot,
} from '@/lib/residency/server';
import type { ResidencyCheckId } from '@/lib/residency/checks';

/**
 * The Colosseum residency server actions.
 *
 * The surface is a declared demo layer that reuses the real residency checks,
 * but the actions follow the same discipline as every other writer in this
 * app: each one re-checks the environment gate, re-reads the session, and
 * recomputes eligibility from records server-side. No client-supplied boolean,
 * timestamp or serial is trusted.
 *
 * The database RPCs are the authority and are **server-only**: each is granted
 * only to `service_role`, so a signed-in resident cannot call it through the
 * Supabase REST/RPC endpoint with their own JWT. The actions reach them with
 * `createSupabaseServiceClient()` and pass `session.userId` explicitly as
 * `p_profile_id`, because a service-role call has no `auth.uid()`:
 *   - `register_colosseum_residency(p_profile_id)` sets the resident's tier to
 *     `colosseum`;
 *   - `sync_colosseum_residency(p_profile_id, p_met)` starts/clears the
 *     2-minute clock; `p_met` is recomputed here, never supplied by the client;
 *   - `record_colosseum_citizen(p_profile_id)` issues the citizen stamp and
 *     passport, and refuses until `resident_since` is at least 2 minutes old.
 *
 * The service-role key is required for the feature to work at all; when it is
 * absent the actions return a distinct, honest refusal and touch nothing.
 *
 * A refusal is returned as a discriminated `refused` result with the honest
 * reason; the actions never fabricate success.
 */

/** The four real residency checks the Colosseum tier reuses. */
const REQUIRED_CHECKS: readonly ResidencyCheckId[] = [
  'identity',
  'funds',
  'review',
  'service-fee',
];

/** The environment gate is off: nothing may run. */
const DISABLED_REASON =
  'The Colosseum residency is not enabled in this environment.';

const NO_SESSION_REASON =
  'You must be signed in to use the Colosseum residency.';

const NO_APPLICATION_REASON =
  'No residency application is recorded for this account.';

/**
 * The server has no `service_role` key, so the server-only RPCs cannot be
 * reached. The feature is inert in this environment; the resident is told so
 * honestly rather than shown a failure that looks like their fault.
 */
const NOT_CONFIGURED_REASON =
  'The Colosseum residency is not configured in this environment.';

/** The result of registering for Colosseum residency. */
export type RegisterColosseumResult =
  | { readonly status: 'ok' }
  | { readonly status: 'refused'; readonly reason: string };

/** The result of a membership-mutating action, carrying the current row. */
export type ColosseumMembershipResult =
  | { readonly status: 'ok'; readonly membership: ColosseumMembership }
  | { readonly status: 'refused'; readonly reason: string };

function disabled(): { readonly status: 'refused'; readonly reason: string } {
  return { status: 'refused', reason: DISABLED_REASON };
}

/**
 * Whether all four real checks are `met`. The client's countdown is cosmetic;
 * this is the server-side judgement the RPCs act on, computed from the same
 * `loadResidencySnapshot` the Residency step renders.
 */
function allChecksMet(snapshot: ResidencySnapshot): boolean {
  return REQUIRED_CHECKS.every((id) =>
    snapshot.view.checks.some((check) => check.id === id && check.state === 'met'),
  );
}

/** An honest message for a register refusal, without leaking internals. */
function registerRefusal(message: string): string {
  if (/no application/i.test(message)) return NO_APPLICATION_REASON;
  if (/authenticated user|profile id/i.test(message)) return NO_SESSION_REASON;
  return `Registering for Colosseum residency was refused: ${message}`;
}

/** An honest message for a citizen refusal, including the 2-minute rule. */
function citizenRefusal(message: string): string {
  if (/2 minutes/i.test(message)) {
    return 'The 2-minute compliance window has not elapsed yet, so you are not eligible to become a Colosseum Citizen.';
  }
  if (/residency clock/i.test(message)) {
    return 'Your Colosseum residency clock has not started, so you are not eligible to become a Colosseum Citizen.';
  }
  if (/authenticated user|profile id/i.test(message)) return NO_SESSION_REASON;
  return `Becoming a Colosseum Citizen was refused: ${message}`;
}

/**
 * Register the signed-in resident for Colosseum residency.
 *
 * Sets the resident's own `applications.tier = 'colosseum'` through the
 * server-only RPC. This replaces the resident's recorded tier; the production
 * tier definitions and their minima are unchanged.
 */
export async function registerColosseumResidencyAction(): Promise<RegisterColosseumResult> {
  if (!isColosseumEnabled()) return disabled();

  const session = await getSessionUser();
  if (!session) return { status: 'refused', reason: NO_SESSION_REASON };

  if (!isServiceRoleConfigured()) {
    return { status: 'refused', reason: NOT_CONFIGURED_REASON };
  }

  const client = await createSupabaseServiceClient();
  const { error } = await client.rpc('register_colosseum_residency', {
    p_profile_id: session.userId,
  });
  if (error) {
    return { status: 'refused', reason: registerRefusal(error.message) };
  }

  revalidatePath('/colosseum');
  return { status: 'ok' };
}

/**
 * Sync the resident's Colosseum clock from their real check state.
 *
 * The `met` boolean is recomputed here from `loadResidencySnapshot`; the client
 * cannot pass it. The RPC starts the clock when met and clears it on decay while
 * the resident is not yet a citizen.
 */
export async function syncColosseumResidencyAction(): Promise<ColosseumMembershipResult> {
  if (!isColosseumEnabled()) return disabled();

  const session = await getSessionUser();
  if (!session) return { status: 'refused', reason: NO_SESSION_REASON };

  if (!isServiceRoleConfigured()) {
    return { status: 'refused', reason: NOT_CONFIGURED_REASON };
  }

  const snapshot = await loadResidencySnapshot(session.userId);
  if (!snapshot) return { status: 'refused', reason: NO_APPLICATION_REASON };

  const client = await createSupabaseServiceClient();
  const { data, error } = await client.rpc('sync_colosseum_residency', {
    p_profile_id: session.userId,
    p_met: allChecksMet(snapshot),
  });
  if (error) {
    return {
      status: 'refused',
      reason: `Synchronising the Colosseum residency clock was refused: ${error.message}`,
    };
  }

  return {
    status: 'ok',
    membership: toColosseumMembership(data as ColosseumMembershipRow),
  };
}

/**
 * Become a Colosseum Citizen.
 *
 * The four checks are recomputed server-side and must all be `met` before the
 * RPC is called; the RPC then enforces the 2-minute window from
 * `resident_since` and issues the server-generated passport serial. Both gates
 * must pass, so a client cannot claim eligibility early.
 */
export async function becomeColosseumCitizenAction(): Promise<ColosseumMembershipResult> {
  if (!isColosseumEnabled()) return disabled();

  const session = await getSessionUser();
  if (!session) return { status: 'refused', reason: NO_SESSION_REASON };

  if (!isServiceRoleConfigured()) {
    return { status: 'refused', reason: NOT_CONFIGURED_REASON };
  }

  const snapshot = await loadResidencySnapshot(session.userId);
  if (!snapshot) return { status: 'refused', reason: NO_APPLICATION_REASON };

  if (!allChecksMet(snapshot)) {
    return {
      status: 'refused',
      reason:
        'All four residency checks must be met before you can become a Colosseum Citizen.',
    };
  }

  const client = await createSupabaseServiceClient();
  const { data, error } = await client.rpc('record_colosseum_citizen', {
    p_profile_id: session.userId,
  });
  if (error) {
    return { status: 'refused', reason: citizenRefusal(error.message) };
  }

  revalidatePath('/colosseum');
  return {
    status: 'ok',
    membership: toColosseumMembership(data as ColosseumMembershipRow),
  };
}
