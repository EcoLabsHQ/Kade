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
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Passkey credential persistence, executed on the server.
 *
 * The browser creates the credential with WebAuthn and sends only what it is
 * allowed to name: the credential id, its public key, transports and the
 * user-verification flag. The signer address is derived here, from the public
 * key, through the deployed Safe signer factory; a value supplied by the
 * browser is neither read nor stored. `signer_address` is written through the
 * `SECURITY DEFINER` `save_passkey_signer` function (migration
 * 20260916000017), which can only touch the caller's own credential, because
 * the `authenticated` role is deliberately denied that column (migration
 * 20260916000013). No service-role key is involved.
 *
 * When the signer write fails the resident's own columns are still written with
 * the session-scoped client and the signer stays NULL. The result reports that
 * explicitly instead of pretending the signer was stored.
 */

/**
 * The technical reason a derived signer was not stored. This is a server-side
 * explanation and must never reach the resident's screen: it can name a
 * database detail or an environment variable. `PasskeyEnrolmentPanel` renders
 * the product-language `SIGNER_NOT_STORED_REASON` from
 * `@/lib/passkey/credential` instead, and the full detail is available here in
 * the server log.
 */

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
): Promise<ResolvedSigner> {
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

  const resolved = await resolveSignerAddress(input.publicKey, user.id);

  // `passkeyStore` is used with the client this action already holds, so the
  // session is verified once and no second client is constructed.
  const store = passkeyStore({ client });
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
          reason:
            outcome.signerError ??
            resolved.reason ??
            SIGNER_NOT_STORED_REASON,
        };

  // The reason string may name server configuration or a database detail, so it
  // is logged here rather than shown. Callers render the product-language
  // explanation.
  if (signer.status === 'not-persisted') {
    console.warn('[kade] Passkey signer not persisted:', signer.reason);
  }

  return { credential: stored, signer };
}

/**
 * Read the signed-in resident's stored credential, or null when none exists.
 *
 * Returns null (rather than throwing) when there is no session, no Supabase
 * configuration, or the read itself fails. The account page and the onboarding
 * page both render an ordinary "create" state from null, so a database outage
 * degrades to a usable screen instead of a 500 or a blocked flow.
 *
 * `passkey_credentials` has no unique constraint on `profile_id`, so a
 * `.maybeSingle()` read errors when more than one row exists. That is treated
 * exactly like any other read failure: the read is not authoritative, so the
 * caller is told "none known" rather than a false "no credential".
 */
export async function loadPasskeyCredential(): Promise<StoredPasskeyCredential | null> {
  const env = readAuthEnv();
  if (!isAuthConfigured(env)) {
    return null;
  }
  try {
    const client = await createSupabaseServerClient();
    const {
      data: { user },
    } = await client.auth.getUser();
    if (!user) {
      return null;
    }
    // SELECT is granted to the authenticated role, so the session client
    // suffices to read the resident's own row.
    const store = passkeyStore({ client });
    return await store.getByUser(user.id);
  } catch (cause) {
    // The detailed reason belongs in the server log, not on the screen. A
    // failed read is not evidence that no credential exists, but the caller
    // cannot act on it, so degrade to the create state rather than error.
    console.warn(
      '[kade] Could not load the stored passkey credential:',
      cause instanceof Error ? cause.message : cause,
    );
    return null;
  }
}
