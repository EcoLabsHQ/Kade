'use server';

import type { Address } from 'viem';
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
 * Why a direct insert rather than the existing store
 *   `safeDeploymentStore().recordPrediction` is built for Kade's own create2
 *   derivation and takes `initializer`, `initializerHash`, `saltNonce`, `salt`
 *   and `initCodeHash`. Safe's SDK composes those itself and does not report
 *   them, so the store cannot be used without fabricating six values. This
 *   writes the three fields the SDK does give — the address, the chain and the
 *   status — and leaves the rest NULL. The store and its callers are untouched.
 *
 * The credential is read from the database, never taken from the caller.
 */

export type RecordAccountStatus =
  | 'recorded'
  | 'already-recorded'
  /** No session, or no stored credential. */
  | 'unavailable'
  | 'failed';

export interface RecordAccountOutcome {
  readonly status: RecordAccountStatus;
  readonly safeAddress: string | null;
  readonly deployed: boolean;
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

  // The address is derived once and kept. A resident who reloads must see the
  // same account, so an existing row wins over a fresh derivation.
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
  if (existing.data) {
    const row = existing.data as { safe_address: string; status: string };
    return {
      status: 'already-recorded',
      safeAddress: row.safe_address,
      deployed: row.status === 'deployed',
    };
  }

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
    // must correspond to the signer they hold.
    console.warn('[kade] account derivation failed:', cause);
    return { status: 'failed', safeAddress: null, deployed: false };
  }

  const { error } = await client.from('safe_deployments').insert({
    profile_id: session.userId,
    safe_address: derived.safeAddress as Address,
    // The account is an address until its first user operation deploys it.
    status: derived.deployed ? 'deployed' : 'predicted',
    deployment_chain_id: derived.chainId,
  });

  if (error) {
    console.warn('[kade] recording the account address failed:', error.message);
    return { status: 'failed', safeAddress: derived.safeAddress, deployed: false };
  }

  return {
    status: 'recorded',
    safeAddress: derived.safeAddress,
    deployed: derived.deployed,
  };
}
