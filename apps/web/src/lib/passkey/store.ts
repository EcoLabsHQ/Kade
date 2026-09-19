import type { SupabaseClient } from '@supabase/supabase-js';
import { isAuthConfigured, readAuthEnv } from '@/lib/env';
import type { StoredPasskeyCredential } from './credential';

/**
 * Passkey credential persistence seam.
 *
 * D3 requires credential metadata to survive reload. Two implementations sit
 * behind this interface:
 *
 * - `createDatabasePasskeyStore` is the real one: `public.passkey_credentials`.
 * - `inMemoryPasskeyStore` is honest about its limits: it does NOT survive a
 *   reload and must not be presented as satisfying D3.
 *
 * `signer_address` is deliberately not writable by the `authenticated` role
 * (migration 20260916000013): it is server-written from the public key. The
 * database store therefore writes the resident's own columns with the
 * session-scoped client and, only when a service-role client is available,
 * writes the derived signer with the elevated client. When that capability is
 * absent the signer stays NULL and the outcome says so; it is never faked.
 */

export type PasskeyStoreKind = 'in-memory' | 'database';

/** The columns a credential save may carry, with the derived signer. */
export interface PasskeyCredentialWrite {
  readonly credentialId: string;
  readonly publicKey: string;
  /** Derived server-side; null when it could not be resolved or persisted. */
  readonly signerAddress: string | null;
  readonly transports: readonly string[];
  readonly userVerification: boolean;
}

/** What actually happened to the derived signer during a save. */
export interface SavePasskeyOutcome {
  readonly signerAddressPersisted: boolean;
}

export interface PasskeyStore {
  readonly kind: PasskeyStoreKind;
  /** Persist the credential metadata for a user. */
  save(
    userId: string,
    record: PasskeyCredentialWrite,
  ): Promise<SavePasskeyOutcome>;
  /** Read the stored credential, or null when none exists. */
  getByUser(userId: string): Promise<StoredPasskeyCredential | null>;
}

/* -------------------------------------------------------------------------- */
/* In-memory (tests and the unconfigured fallback)                            */
/* -------------------------------------------------------------------------- */

const memory = new Map<string, StoredPasskeyCredential>();

export const inMemoryPasskeyStore: PasskeyStore = {
  kind: 'in-memory',
  async save(userId, record) {
    memory.set(userId, {
      credentialId: record.credentialId,
      publicKey: record.publicKey,
      signerAddress: record.signerAddress,
      transports: record.transports,
      userVerification: record.userVerification,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    });
    return { signerAddressPersisted: record.signerAddress !== null };
  },
  async getByUser(userId) {
    return memory.get(userId) ?? null;
  },
};

/** Testing helper: clear the in-memory store. */
export function resetInMemoryPasskeyStore(): void {
  memory.clear();
}

/* -------------------------------------------------------------------------- */
/* Database                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The row shape PostgREST returns for a selected credential.
 *
 * `signer_address`, `last_used_at` and the timestamps are nullable in the
 * schema; the REST response reflects that.
 */
interface PasskeyCredentialRow {
  readonly credential_id: string;
  readonly public_key: string;
  readonly signer_address: string | null;
  readonly transports: string[] | null;
  readonly user_verification: boolean;
  readonly created_at: string;
  readonly last_used_at: string | null;
}

export interface DatabasePasskeyStoreOptions {
  /** Session-scoped client; row level security applies as the resident. */
  readonly getClient: () => Promise<SupabaseClient>;
  /**
   * Elevated client, or null when no service-role key is configured. Called
   * only when there is a derived signer to write.
   */
  readonly getServiceClient?: () => Promise<SupabaseClient | null>;
}

export function createDatabasePasskeyStore(
  options: DatabasePasskeyStoreOptions,
): PasskeyStore {
  return {
    kind: 'database',

    async save(userId, record) {
      const client = await options.getClient();

      // The passkey is onboarding step 1; the profile row is only written at
      // step 2. The credential's foreign key needs the profile, so create an
      // empty one first. `ignoreDuplicates` maps to ON CONFLICT DO NOTHING and
      // therefore needs only the INSERT privilege the resident already has.
      const profile = await client.from('profiles').upsert(
        { id: userId },
        { onConflict: 'id', ignoreDuplicates: true },
      );
      if (profile.error) {
        throw new Error(
          `Ensuring the profile for the passkey failed: ${profile.error.message}`,
        );
      }

      const insert = await client.from('passkey_credentials').insert({
        profile_id: userId,
        credential_id: record.credentialId,
        public_key: record.publicKey,
        transports: [...record.transports],
        user_verification: record.userVerification,
      });
      if (insert.error) {
        throw new Error(
          `Saving the passkey credential failed: ${insert.error.message}`,
        );
      }

      if (record.signerAddress === null) {
        return { signerAddressPersisted: false };
      }

      const serviceClient = options.getServiceClient
        ? await options.getServiceClient()
        : null;
      if (serviceClient === null) {
        // The resident's own columns are stored. The derived signer is not,
        // because `signer_address` is not granted to the authenticated role.
        return { signerAddressPersisted: false };
      }

      const update = await serviceClient
        .from('passkey_credentials')
        .update({ signer_address: record.signerAddress })
        .eq('profile_id', userId)
        .eq('credential_id', record.credentialId);
      if (update.error) {
        throw new Error(
          `Storing the derived signer address failed: ${update.error.message}`,
        );
      }

      return { signerAddressPersisted: true };
    },

    async getByUser(userId) {
      const client = await options.getClient();
      const result = await client
        .from('passkey_credentials')
        .select(
          'credential_id, public_key, signer_address, transports, ' +
            'user_verification, created_at, last_used_at',
        )
        .eq('profile_id', userId)
        .maybeSingle();
      if (result.error) {
        throw new Error(
          `Loading the passkey credential failed: ${result.error.message}`,
        );
      }
      const row = result.data as PasskeyCredentialRow | null;
      if (!row) return null;
      return {
        credentialId: row.credential_id,
        publicKey: row.public_key,
        signerAddress: row.signer_address,
        transports: row.transports ?? [],
        userVerification: row.user_verification,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
      };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Selection                                                                   */
/* -------------------------------------------------------------------------- */

/** Clients already verified by a caller, so no second request is made. */
export interface PasskeyStoreClients {
  readonly client: SupabaseClient;
  readonly serviceClient: SupabaseClient | null;
}

/**
 * The active store.
 *
 * With no Supabase configuration the in-memory seam is returned, preserving
 * the pre-database behaviour. When Supabase is configured the database store
 * is returned; its clients are resolved lazily through a dynamic import so
 * that merely importing this module never constructs a server client.
 */
export function passkeyStore(clients?: PasskeyStoreClients): PasskeyStore {
  if (clients) {
    return createDatabasePasskeyStore({
      getClient: async () => clients.client,
      getServiceClient: async () => clients.serviceClient,
    });
  }

  if (!isAuthConfigured(readAuthEnv())) {
    return inMemoryPasskeyStore;
  }

  return createDatabasePasskeyStore({
    getClient: async () => {
      const { createSupabaseServerClient } = await import(
        '@/lib/supabase/server'
      );
      return createSupabaseServerClient();
    },
    getServiceClient: async () => {
      const { createSupabaseServiceClient, isServiceRoleConfigured } =
        await import('@/lib/supabase/server');
      if (!isServiceRoleConfigured()) return null;
      return createSupabaseServiceClient();
    },
  });
}
