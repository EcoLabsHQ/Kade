import type { PasskeyCredentialRecord } from '@kade/shared';

/**
 * Passkey credential persistence seam.
 *
 * D3 requires credential metadata to survive reload. There is no reachable
 * database in this environment, so persistence is behind this interface.
 *
 * - `inMemoryPasskeyStore` is honest about its limits: it does NOT survive a
 *   reload and must not be presented as satisfying D3.
 * - `unsupportedPasskeyStore` fails loudly.
 *
 * The real implementation belongs on the FastAPI/Supabase side once the
 * Account gate approves the credential-storage policy (ADR 0003).
 */
export interface PasskeyStore {
  readonly kind: 'in-memory' | 'unsupported';
  /** Persist the credential-server-side shape for a user. */
  save(userId: string, record: PasskeyCredentialRecord): Promise<void>;
  /** Read the stored credential, or null when none exists. */
  getByUser(userId: string): Promise<PasskeyCredentialRecord | null>;
}

const memory = new Map<string, PasskeyCredentialRecord>();

export const inMemoryPasskeyStore: PasskeyStore = {
  kind: 'in-memory',
  async save(userId, record) {
    memory.set(userId, record);
  },
  async getByUser(userId) {
    return memory.get(userId) ?? null;
  },
};

export const unsupportedPasskeyStore: PasskeyStore = {
  kind: 'unsupported',
  async save() {
    throw new Error(
      'No passkey persistence backend is configured. Credential metadata ' +
        'cannot be stored, so D3 "survives reload" is not satisfied.',
    );
  },
  async getByUser() {
    return null;
  },
};

/** Testing helper: clear the in-memory store. */
export function resetInMemoryPasskeyStore(): void {
  memory.clear();
}

/**
 * The active store. This is the seam: swap `inMemoryPasskeyStore` for the
 * database-backed implementation when the Account gate approves it.
 */
export function passkeyStore(): PasskeyStore {
  return inMemoryPasskeyStore;
}
