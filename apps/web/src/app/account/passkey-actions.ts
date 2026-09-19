'use server';

import { deriveAccount } from '@/app/onboarding/signer-actions';
import { isAuthConfigured, readAuthEnv } from '@/lib/env';
import { PasskeyPersistenceNotConfiguredError } from '@/lib/passkey/errors';
import { parseP256PublicKey } from '@/lib/passkey/public-key';
import { passkeyStore } from '@/lib/passkey/store';
import type {
  SavePasskeyCredentialInput,
  SavePasskeyCredentialResult,
  SignerPersistence,
  StoredPasskeyCredential,
} from '@/lib/passkey/credential';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
  isServiceRoleConfigured,
} from '@/lib/supabase/server';

/**
 * Passkey credential persistence, executed on the server.
 *
 * The browser creates the credential with WebAuthn and sends only what it is
 * allowed to name: the credential id, its public key, transports and the
 * user-verification flag. The signer address is derived here, from the public
 * key, through the deployed Safe signer factory; a value supplied by the
 * browser is neither read nor stored. `signer_address` is written with the
 * service-role client because the `authenticated` role is deliberately denied
 * that column (migration 20260916000013).
 *
 * When SUPABASE_SERVICE_ROLE_KEY is absent the resident's own columns are still
 * written with the session-scoped client and the signer stays NULL. The result
 * reports that explicitly instead of pretending the signer was stored.
 */

const SERVICE_ROLE_MISSING_REASON =
  'The credential metadata was saved, but the derived signer address was not ' +
  'stored because SUPABASE_SERVICE_ROLE_KEY is not configured in this ' +
  'environment.';

const NO_PUBLIC_KEY_REASON =
  'The credential did not include a public key, so the signer address could ' +
  'not be derived.';

const SIGNER_NOT_STORED_REASON = 'The derived signer address was not stored.';

interface ResolvedSigner {
  readonly address: string | null;
  readonly reason: string | null;
}

async function resolveSignerAddress(
  publicKey: string,
  userId: string,
  canPersist: boolean,
): Promise<ResolvedSigner> {
  if (!canPersist) {
    return { address: null, reason: SERVICE_ROLE_MISSING_REASON };
  }
  if (!publicKey) {
    return { address: null, reason: NO_PUBLIC_KEY_REASON };
  }
  try {
    const { x, y } = parseP256PublicKey(publicKey);
    const derived = await deriveAccount(x.toString(), y.toString(), userId);
    return { address: derived.signerAddress, reason: null };
  } catch (cause) {
    return {
      address: null,
      reason:
        cause instanceof Error
          ? `The signer address could not be derived: ${cause.message}`
          : 'The signer address could not be derived.',
    };
  }
}

export async function savePasskeyCredential(
  input: SavePasskeyCredentialInput,
): Promise<SavePasskeyCredentialResult> {
  const env = readAuthEnv();
  if (!isAuthConfigured(env)) {
    throw new PasskeyPersistenceNotConfiguredError();
  }

  // D3: the transaction passkey must require user verification. The field is
  // accepted from the browser, so enforce it here rather than trusting it.
  if (input.userVerification !== true) {
    throw new Error(
      'The transaction passkey must require user verification (contract D3).',
    );
  }

  const client = await createSupabaseServerClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) {
    throw new Error('Saving a passkey credential requires a signed-in session.');
  }

  // The elevated client is optional; absence degrades the signer write, not
  // the credential save.
  const serviceClient = isServiceRoleConfigured()
    ? await createSupabaseServiceClient()
    : null;

  const resolved = await resolveSignerAddress(
    input.publicKey,
    user.id,
    serviceClient !== null,
  );

  // `passkeyStore` is used with clients this action already holds, so the
  // session is verified once and no second client is constructed.
  const store = passkeyStore({ client, serviceClient });
  const outcome = await store.save(user.id, {
    credentialId: input.credentialId,
    publicKey: input.publicKey,
    signerAddress: resolved.address,
    transports: input.transports,
    userVerification: input.userVerification,
  });

  const stored = await store.getByUser(user.id);
  if (!stored) {
    throw new Error(
      'The passkey credential was saved but could not be read back.',
    );
  }

  const signer: SignerPersistence =
    outcome.signerAddressPersisted && stored.signerAddress
      ? { status: 'persisted', address: stored.signerAddress }
      : {
          status: 'not-persisted',
          reason: resolved.reason ?? SIGNER_NOT_STORED_REASON,
        };

  return { credential: stored, signer };
}

/**
 * Read the signed-in resident's stored credential, or null when none exists.
 *
 * Returns null (rather than throwing) when there is no session or no Supabase
 * configuration, so the account page can render the ordinary "create" state.
 */
export async function loadPasskeyCredential(): Promise<StoredPasskeyCredential | null> {
  const env = readAuthEnv();
  if (!isAuthConfigured(env)) {
    return null;
  }
  const client = await createSupabaseServerClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) {
    return null;
  }
  // SELECT is granted to the authenticated role, so the session client
  // suffices to read the resident's own row.
  const store = passkeyStore({ client, serviceClient: null });
  return store.getByUser(user.id);
}
