'use server';

import { CHAIN_IDS } from '@kade/shared';
import { createSupabaseServerClient, getSessionUser } from '@/lib/supabase/server';
import { loadPasskeyCredential } from '@/app/account/passkey-actions';
import { parseP256PublicKey } from '@/lib/passkey/public-key';
import { toPasskeySigner } from '@/lib/safe/passkey-signer';
import { deriveAccountFromPasskey } from '@/lib/safe/derive-account';

/**
 * Record the resident's account address, derived by Safe's SDK.
 *
 * Step 1 runs this once the passkey exists. It **deploys nothing**: the account
 * is an address until its first user operation, so the row is written as
 * `predicted` and the shell shows it as created.
 *
 * Why an RPC rather than the existing store
 *   `safeDeploymentStore().recordPrediction` is built for Kade's own create2
 *   derivation and takes `initializer`, `initializerHash`, `saltNonce`, `salt`
 *   and `initCodeHash`. Safe's SDK composes those itself and does not report
 *   them, so the store cannot be used without fabricating six values. This
 *   writes only what the SDK reports — the address, the chain, the status and
 *   the caller's own profile_id — and leaves the rest NULL. The store and its
 *   callers are untouched.
 *
 *   The write goes through `record_safe_sdk_address`, a SECURITY DEFINER
 *   function scoped to `profile_id = auth.uid()`. A direct insert is refused:
 *   `authenticated` has no column privilege on `safe_address`, so it could
 *   never have written this row on a fresh database.
 *
 * Explicit refresh, never a silent overwrite
 *   The address is re-derived on every call and compared with the recorded row.
 *   A match is `already-recorded` and writes nothing (idempotent). A mismatch is
 *   written as a **new** row and reported as `refreshed` with the previous
 *   address: the old row is left in place, because an address that may already
 *   hold funds must never be silently overwritten. This is how the record
 *   follows a corrected Safe derivation — see `execute-safe-4337-env.ts` and
 *   `FIXED_CREATE2_SALT_NONCE`, which made the derivation chain-independent.
 *
 * The credential is read from the database, never taken from the caller.
 */

export type RecordAccountStatus =
  | 'recorded'
  /** The address moved because the derivation changed; the new row was written. */
  | 'refreshed'
  | 'already-recorded'
  /** No session, or no stored credential. */
  | 'unavailable'
  | 'failed';

export interface RecordAccountOutcome {
  readonly status: RecordAccountStatus;
  readonly safeAddress: string | null;
  readonly deployed: boolean;
  /**
   * The address the record held before an explicit refresh. Present only for
   * `refreshed`, so a caller can report that the Safe address moved.
   */
  readonly previousAddress?: string;
}

export async function deriveAndRecordAccount(): Promise<RecordAccountOutcome> {
  const session = await getSessionUser();
  if (!session) {
    return { status: 'unavailable', safeAddress: null, deployed: false };
  }

  const stored = await loadPasskeyCredential();
  if (!stored?.publicKey || !stored.credentialId) {
    return { status: 'unavailable', safeAddress: null, deployed: false };
  }

  const client = await createSupabaseServerClient();

  // The recorded row is read, not trusted blindly: an existing row is only
  // `already-recorded` once the address is re-derived and it still matches.
  const existing = await client
    .from('safe_deployments')
    .select('safe_address, status')
    .eq('profile_id', session.userId)
    .order('predicted_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing.error) {
    console.warn('[kade] reading the account row failed:', existing.error.message);
    return { status: 'failed', safeAddress: null, deployed: false };
  }
  const previous = existing.data
    ? (existing.data as { safe_address: string; status: string })
    : null;

  // Derive on every call. The SDK derivation is chain-independent, so this is
  // how the record follows a corrected derivation instead of being pinned to
  // whatever was written first.
  let derived;
  try {
    const { x, y } = parseP256PublicKey(stored.publicKey);
    const signer = toPasskeySigner({
      rawId: stored.credentialId,
      coordinates: { x: x.toString(), y: y.toString() },
    });
    derived = await deriveAccountFromPasskey(signer, {
      chainId: CHAIN_IDS.sepolia,
    });
  } catch (cause) {
    // Surfaced, never stored as if it had worked: an account the resident sees
    // must correspond to the signer they hold. If a row already exists, keep it
    // — an RPC outage must not take a recorded account away.
    console.warn('[kade] account derivation failed:', cause);
    if (previous) {
      return {
        status: 'already-recorded',
        safeAddress: previous.safe_address,
        deployed: previous.status === 'deployed',
      };
    }
    return { status: 'failed', safeAddress: null, deployed: false };
  }

  if (
    previous &&
    previous.safe_address.toLowerCase() === derived.safeAddress.toLowerCase()
  ) {
    return {
      status: 'already-recorded',
      safeAddress: previous.safe_address,
      deployed: previous.status === 'deployed',
    };
  }

  // `record_safe_sdk_address` is insert-idempotent on the address, so a repeat
  // refresh writes nothing new. A moved address is written as a new row: the old
  // row is left in place rather than updated, so an address that may already
  // hold funds is never silently overwritten.
  const { error } = await client.rpc('record_safe_sdk_address', {
    p_safe_address: derived.safeAddress,
    p_deployment_chain_id: derived.chainId,
    // The account is an address until its first user operation deploys it.
    p_status: derived.deployed ? 'deployed' : 'predicted',
  });

  if (error) {
    console.warn('[kade] recording the account address failed:', error.message);
    return { status: 'failed', safeAddress: derived.safeAddress, deployed: false };
  }

  if (previous) {
    // Explicit, not silent: the move is logged with both addresses so an
    // operator can see that the recorded Safe changed and check the old one.
    console.warn(
      '[kade] the SDK-derived Safe address changed; recorded the new address. ' +
        'The previous row was left in place.',
      { from: previous.safe_address, to: derived.safeAddress },
    );
    return {
      status: 'refreshed',
      safeAddress: derived.safeAddress,
      deployed: derived.deployed,
      previousAddress: previous.safe_address,
    };
  }

  return {
    status: 'recorded',
    safeAddress: derived.safeAddress,
    deployed: derived.deployed,
  };
}
