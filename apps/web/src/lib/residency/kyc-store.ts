import { getAddress, type Address } from 'viem';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { KycAttestationStore, SelfVerificationRecord } from './kyc-emitter';

/**
 * The Supabase-backed store for the `kade.kyc.v1` emitter.
 *
 * The emitter's own module stays free of Supabase and `next/*` imports; this is
 * the wiring. It reads the real state rather than asserting it:
 *
 *   - the facts come from the latest **valid** `self_verifications` row for the
 *     resident (`verified_at` descending, `id` as the tie-break);
 *   - the recipient comes from `safe_deployments`;
 *   - a confirmed attestation is mirrored into `identity_attestations` through
 *     `record_identity_attestation`, a `SECURITY DEFINER` function granted only to
 *     `service_role` (migration `20260924000020`).
 *
 * The server path has no resident session here, so the store uses the elevated
 * service client — it bypasses RLS, so every query is explicitly scoped to the
 * profile id the caller resolved. Both clients are injected, so a test can pass a
 * fake without a database or a key.
 */

interface VerificationRow {
  readonly profile_id: string;
  readonly nationality: string | null;
  readonly over18: boolean | null;
  readonly not_sanctioned: boolean | null;
  readonly self_nullifier: string | null;
  readonly expires_at: string | null;
}

interface SafeRow {
  readonly safe_address: string;
}

export interface KycStoreClients {
  readonly getClient: () => Promise<SupabaseClient>;
}

export function createKycAttestationStore(
  clients: KycStoreClients,
): KycAttestationStore {
  return {
    async latestValidVerification(profileId): Promise<SelfVerificationRecord | null> {
      const client = await clients.getClient();
      const { data, error } = await client
        .from('self_verifications')
        .select('profile_id,nationality,over18,not_sanctioned,self_nullifier,expires_at')
        .eq('profile_id', profileId)
        .eq('status', 'valid')
        .order('verified_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        throw new Error(`loading the Self verification failed: ${error.message}`);
      }
      if (!data) return null;
      const row = data as VerificationRow;
      return {
        profileId: row.profile_id,
        nationality: row.nationality,
        over18: row.over18,
        notSanctioned: row.not_sanctioned,
        selfNullifier: row.self_nullifier,
        expiresAt: row.expires_at,
      };
    },

    async residentSafe(profileId): Promise<Address | null> {
      const client = await clients.getClient();
      const { data, error } = await client
        .from('safe_deployments')
        .select('safe_address')
        .eq('profile_id', profileId)
        .order('predicted_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        throw new Error(`loading the resident Safe failed: ${error.message}`);
      }
      if (!data) return null;
      return getAddress((data as SafeRow).safe_address);
    },

    async recordIssuedAttestation(input): Promise<void> {
      const client = await clients.getClient();
      const { error } = await client.rpc('record_identity_attestation', {
        p_profile_id: input.profileId,
        p_attestation_uid: input.attestationUid,
        p_chain: input.chain,
        p_nationality: input.nationality,
        p_over18: input.over18,
        p_not_sanctioned: input.notSanctioned,
        p_self_nullifier: input.selfNullifier,
        p_expires_at: input.expiresAt,
      });
      if (error) {
        throw new Error(`mirroring the attestation failed: ${error.message}`);
      }
    },
  };
}

/**
 * The store backed by the real service client.
 *
 * The service-role key is required: `identity_attestations` is not writable by a
 * resident, and the emitter's server path carries no session. The dynamic import
 * keeps `next/headers` out of the emitter's module load.
 */
export function kycAttestationStore(): KycAttestationStore {
  return createKycAttestationStore({
    getClient: async () => {
      const { createSupabaseServiceClient } = await import('@/lib/supabase/server');
      return createSupabaseServiceClient();
    },
  });
}
