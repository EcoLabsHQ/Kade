import { randomBytes } from 'node:crypto';
import { getAddress, isAddress, recoverMessageAddress, type Hex } from 'viem';
import { readAuthEnv } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Signed-wallet ownership proof (Week 2 contract section 2.2, D17).
 *
 * A linked wallet becomes eligible for Holdings only when the resident proves
 * control of it by signing a **server-issued** challenge (EIP-191 over an
 * EIP-4361-style message). This module is the whole path:
 *
 *   - `issueOwnershipChallenge(address)` makes a one-time nonce, builds the
 *     message, and stores both server-side (`wallet_ownership_challenges`).
 *   - `verifyWalletOwnership({ address, message, signature })` recovers the
 *     signing address with viem, requires it to match, and — only then — calls
 *     the `SECURITY DEFINER` RPC that sets `wallets.siwe_sig` and
 *     `wallets.verified_at`.
 *
 * It does not touch the resident Safe. The signature is not a login and confers
 * no authority (week-2 contract 2.2 items 2 and 4; week-1 section 8.10). The
 * pasted paths never call this module, so a pasted row keeps `verified_at NULL`
 * by construction.
 *
 * Server-side only: it reads the request session and writes the database. Front
 * 04 (Holdings) consumes the two exported functions from a server action or a
 * server component.
 */

/**
 * The chain id written into the EIP-4361 message. Holdings reads Ethereum
 * mainnet in Week 2 (week-2 contract 2.2 item 1). It is intentionally fixed:
 * the frozen interface takes no chain argument.
 */
export const OWNERSHIP_PROOF_CHAIN_ID = 1;

/** [arbitrary] a challenge is short-lived; 10 minutes is plenty to sign. */
export const OWNERSHIP_CHALLENGE_TTL_MS = 10 * 60 * 1000;

export interface OwnershipChallenge {
  readonly nonce: string;
  readonly message: string;
}

export interface OwnershipVerificationInput {
  readonly address: string;
  readonly message: string;
  readonly signature: string;
}

export interface OwnershipVerificationResult {
  readonly ok: boolean;
  readonly error?: string;
}

export interface OwnershipMessageParams {
  readonly domain: string;
  readonly address: string;
  readonly uri: string;
  readonly chainId: number;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

/** [arbitrary] the product-voice line of the signed message. */
const OWNERSHIP_STATEMENT = 'Prove you control this wallet for Kade holdings.';

/** The nonce line of the message, as issued. */
const NONCE_LINE = /^Nonce: (.+)$/m;

/**
 * Build the exact message the resident signs. Pure, so a test can pin its shape.
 *
 * The format is EIP-4361 ("Sign-In with Ethereum")-style, which is the
 * EIP-191 personal-sign envelope viem's `recoverMessageAddress` understands.
 */
export function buildOwnershipMessage(params: OwnershipMessageParams): string {
  return [
    `${params.domain} wants you to sign in with your Ethereum account:`,
    params.address,
    '',
    OWNERSHIP_STATEMENT,
    '',
    `URI: ${params.uri}`,
    'Version: 1',
    `Chain ID: ${params.chainId}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${params.issuedAt}`,
    `Expiration Time: ${params.expiresAt}`,
  ].join('\n');
}

/** Read the nonce back out of a message, or null when it is not one of ours. */
export function readNonceFromMessage(message: string): string | null {
  const match = NONCE_LINE.exec(message);
  const nonce = match?.[1]?.trim();
  return nonce ? nonce : null;
}

/** Canonicalise an EVM address, or null when it is not one. */
function canonicalAddress(value: string): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!isAddress(trimmed)) return null;
  try {
    return getAddress(trimmed);
  } catch {
    return null;
  }
}

/** The domain and URI written into the message, derived from the app origin. */
function resolveSite(): { readonly domain: string; readonly uri: string } {
  const { siteUrl } = readAuthEnv();
  let url: URL;
  try {
    url = new URL(siteUrl);
  } catch {
    url = new URL('http://localhost:3000');
  }
  return { domain: url.host, uri: url.toString() };
}

/** A fresh, unguessable nonce. 16 bytes is well beyond guessing. */
function createNonce(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Issue a challenge for `address` to the signed-in resident.
 *
 * The address does not have to be linked yet, but verification requires a linked
 * row (the address a signature proves control of must already be registered).
 *
 * @throws when there is no session or the address is not a valid EVM address.
 */
export async function issueOwnershipChallenge(
  address: string,
): Promise<OwnershipChallenge> {
  const canonical = canonicalAddress(address);
  if (!canonical) {
    throw new Error('That is not a recognised EVM address.');
  }

  const client = await createSupabaseServerClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) {
    throw new Error('Proving a wallet requires a signed-in session.');
  }

  const nonce = createNonce();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + OWNERSHIP_CHALLENGE_TTL_MS);
  const { domain, uri } = resolveSite();

  const message = buildOwnershipMessage({
    domain,
    address: canonical,
    uri,
    chainId: OWNERSHIP_PROOF_CHAIN_ID,
    nonce,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });

  const { error } = await client
    .from('wallet_ownership_challenges')
    .insert({
      profile_id: user.id,
      address: canonical,
      nonce,
      message,
      expires_at: expiresAt.toISOString(),
    });
  if (error) {
    throw new Error(`Issuing the ownership challenge failed: ${error.message}`);
  }

  return { nonce, message };
}

/**
 * Verify a signed challenge and, on success, mark the wallet verified.
 *
 * Returns `{ ok: false, error }` for every expected failure — an unknown or
 * mismatched challenge, a signature that does not recover to `address`, or a
 * database refusal — rather than throwing, so front 04 can render the reason.
 */
export async function verifyWalletOwnership(
  input: OwnershipVerificationInput,
): Promise<OwnershipVerificationResult> {
  const canonical = canonicalAddress(input.address);
  if (!canonical) {
    return { ok: false, error: 'That is not a recognised EVM address.' };
  }

  const nonce = readNonceFromMessage(input.message);
  if (!nonce) {
    return { ok: false, error: 'The message is not a Kade challenge.' };
  }

  const client = await createSupabaseServerClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) {
    return { ok: false, error: 'Proving a wallet requires a signed-in session.' };
  }

  // The signature must be over the exact message this server issued: a live,
  // unconsumed, unexpired challenge for this address and nonce. Without this an
  // old or substituted message would be accepted by the recovery check alone.
  const { data: challenge, error: challengeError } = await client
    .from('wallet_ownership_challenges')
    .select('message, expires_at, consumed_at')
    .eq('profile_id', user.id)
    .eq('address', canonical)
    .eq('nonce', nonce)
    .maybeSingle();

  if (challengeError) {
    return {
      ok: false,
      error: `Reading the ownership challenge failed: ${challengeError.message}`,
    };
  }
  if (!challenge) {
    return { ok: false, error: 'There is no live challenge for this address.' };
  }
  if (challenge.message !== input.message) {
    return { ok: false, error: 'The signed message is not the issued challenge.' };
  }
  if (challenge.consumed_at) {
    return { ok: false, error: 'This challenge has already been used.' };
  }
  if (new Date(challenge.expires_at).getTime() <= Date.now()) {
    return { ok: false, error: 'This challenge has expired.' };
  }

  let recovered: string;
  try {
    recovered = await recoverMessageAddress({
      message: input.message,
      signature: input.signature as Hex,
    });
  } catch {
    return { ok: false, error: 'The signature could not be verified.' };
  }

  if (getAddress(recovered) !== canonical) {
    return {
      ok: false,
      error: 'The signature does not match the wallet address.',
    };
  }

  const { error: rpcError } = await client.rpc('record_wallet_ownership', {
    p_address: canonical,
    p_nonce: nonce,
    p_message: input.message,
    p_signature: input.signature,
  });
  if (rpcError) {
    return {
      ok: false,
      error: `Recording the ownership proof failed: ${rpcError.message}`,
    };
  }

  return { ok: true };
}
