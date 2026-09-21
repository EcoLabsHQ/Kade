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
 * `signer_address` is deliberately refused a direct write by the `authenticated` role
 * (migration 20260916000013): it is server-written from the public key. The
 * database store writes the resident's own columns with the session-scoped
 * client and then writes the derived signer through the SECURITY DEFINER
 * `save_passkey_signer` function (migration 20260916000017), which can only
 * touch the caller's own row. If that write fails the credential stays saved
 * and the outcome says the signer was not persisted; it is never faked. No
 * service-role client is involved.
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
  /**
   * Technical reason the signer was not persisted. Server-log detail only; the
   * UI renders the product-language reason from `./credential`.
   */
  readonly signerError?: string;
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

      // `signer_address` is not granted to `authenticated`. The SECURITY
      // DEFINER function writes it for the caller's own row only (migration
      // 20260916000017); the session client is enough, and the scoping is the
      // function's, not the caller's. A failure here does not undo the saved
      // credential, so it is reported rather than thrown.
      const signer = await client.rpc('save_passkey_signer', {
        p_credential_id: record.credentialId,
        p_signer_address: record.signerAddress,
      });
      if (signer.error) {
        return {
          signerAddressPersisted: false,
          signerError: `Storing the derived signer address failed: ${signer.error.message}`,
        };
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

/** The session-scoped client, already verified by a caller. */
export interface PasskeyStoreClients {
  readonly client: SupabaseClient;
}

/**
 * The active store.
 *
 * With no Supabase configuration the in-memory seam is returned, preserving
 * the pre-database behaviour. When Supabase is configured the database store
 * is returned; its client is resolved lazily through a dynamic import so that
 * merely importing this module never constructs a server client.
 */
export function passkeyStore(clients?: PasskeyStoreClients): PasskeyStore {
  if (clients) {
    return createDatabasePasskeyStore({
      getClient: async () => clients.client,
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
  });
}
