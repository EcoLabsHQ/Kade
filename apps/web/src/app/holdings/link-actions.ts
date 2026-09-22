'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  issueOwnershipChallenge,
  verifyWalletOwnership,
} from '@/lib/wallet/ownership';

/**
 * The Holdings ownership-proof server actions.
 *
 * These are the **only** place in this front that consumes front 03's frozen
 * interface (`@/lib/wallet/ownership`). 03 owns the challenge/nonce, the
 * EIP-191 / EIP-4361-style verification, and the write that sets
 * `wallets.verified_at` — and only 03 may set it. This file does not re-implement
 * any of that: it guards the caller's session, delegates to 03, and revalidates
 * the screen.
 *
 * Front 03's frozen interface (merged on week-2):
 *
 *   issueOwnershipChallenge(address: string): Promise<OwnershipChallenge>
 *     // { nonce, message }
 *   verifyWalletOwnership(input: {
 *     address: string; message: string; signature: string;
 *   }): Promise<OwnershipVerificationResult>
 *     // { ok: boolean; error?: string }
 *
 * 03 sets `wallets.verified_at` as a side effect of a verified proof; this file
 * never writes it. On failure it relays 03's own error text rather than
 * replacing it with a generic message.
 */

/** The signed-in resident, or a thrown error. No proof without a session. */
async function requireUserId(): Promise<void> {
  const client = await createSupabaseServerClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) {
    throw new Error('Linking a wallet requires a signed-in session.');
  }
}

/** Ask 03 for the challenge this address must sign. */
export async function beginWalletLink(
  address: string,
): Promise<{ readonly message: string }> {
  await requireUserId();
  const challenge = await issueOwnershipChallenge(address);
  return { message: challenge.message };
}

/**
 * Hand 03 the signature. 03 is the authority on whether it verifies and on the
 * `wallets.verified_at` write; this action only relays the result and refreshes
 * the aggregate.
 */
export async function completeWalletLink(input: {
  readonly address: string;
  readonly message: string;
  readonly signature: string;
}): Promise<{ readonly ok: true }> {
  await requireUserId();
  const verified = await verifyWalletOwnership(input);
  if (!verified.ok) {
    throw new Error(
      verified.error ?? 'The signature did not verify; the wallet was not linked.',
    );
  }
  revalidatePath('/holdings');
  return { ok: true };
}
