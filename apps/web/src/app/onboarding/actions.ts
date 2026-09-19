'use server';

import { revalidatePath } from 'next/cache';
import { tierDatabaseValue } from '@kade/shared';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAuthConfigured, readAuthEnv, readFeeMode } from '@/lib/env';
import {
  PersistenceNotConfiguredError,
  type OnboardingSnapshot,
  type PersistedOnboarding,
} from '@/lib/onboarding/persistence';
import { resolvePreapprovalFeeBreakdown } from '@/lib/onboarding/fee-server';
import type { PreapprovalFeeBreakdown } from '@/lib/onboarding/fee';

/**
 * The Step 2 write, executed on the server.
 *
 * Writes do not originate in the browser. The browser used to call PostgREST
 * directly, and an upsert there assigns every column in the payload — including
 * the conflict target — so Postgres demanded an UPDATE privilege on `id` that
 * the `authenticated` role deliberately does not have. It failed with
 * `42501 permission denied for table profiles`.
 *
 * The whole save now happens inside `public.save_onboarding_step2`, one
 * transaction, explicit columns. SECURITY INVOKER, so row level security still
 * applies as the resident: this grants no capability the session did not
 * already have.
 */
export async function saveOnboardingStep2(
  snapshot: OnboardingSnapshot,
): Promise<PersistedOnboarding> {
  const env = readAuthEnv();
  if (!isAuthConfigured(env)) {
    throw new PersistenceNotConfiguredError();
  }

  const client = await createSupabaseServerClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) {
    throw new Error('Saving Step 2 requires a signed-in session.');
  }

  const { data: applicationId, error } = await client.rpc(
    'save_onboarding_step2',
    {
      p_first_name: snapshot.profile.firstName,
      p_last_name: snapshot.profile.lastName,
      p_dob: snapshot.profile.dob,
      p_citizenships: [...snapshot.citizenships],
      p_residences: snapshot.residences.map((residence) => ({
        countryCode: residence.countryCode,
        fromYear: residence.fromYear,
        toYear: residence.toYear,
      })),
      p_tier: tierDatabaseValue(snapshot.tier),
      p_members: snapshot.members.map((member) => ({
        name: member.name,
        relation: member.relation ?? '',
        dob: member.dob ?? '',
        citizenship: member.citizenship ?? '',
      })),
    },
  );

  if (error) {
    throw new Error(`Saving Step 2 failed: ${error.message}`);
  }

  // Read the fee back rather than computing it here: the household trigger is
  // the single writer of `applications.preapproval_usdc`.
  const { data: feeRow } = await client
    .from('applications')
    .select('preapproval_usdc')
    .eq('id', applicationId)
    .maybeSingle();

  revalidatePath('/onboarding');

  return {
    applicationId: applicationId as string,
    preapprovalUsdc:
      feeRow && feeRow.preapproval_usdc !== null
        ? Number(feeRow.preapproval_usdc)
        : null,
  };
}

/**
 * The pre-approval fee for a household size, resolved by the database.
 *
 * The client may call this to preview the fee as the household changes, but the
 * household size is the only thing it supplies: the mode comes from
 * `KADE_FEE_MODE` on the server and the amount comes from `fee_schedule` via
 * `public.preapproval_fee_usdc`. A caller can never supply a fee. Returns null
 * (rather than throwing) when the database cannot answer, so the screen says
 * the fee is unavailable instead of inventing one.
 */
export async function previewPreapprovalFee(
  householdSize: number,
): Promise<PreapprovalFeeBreakdown | null> {
  if (!Number.isInteger(householdSize) || householdSize < 1) {
    return null;
  }
  try {
    return await resolvePreapprovalFeeBreakdown(
      readFeeMode(),
      householdSize,
    );
  } catch {
    return null;
  }
}
