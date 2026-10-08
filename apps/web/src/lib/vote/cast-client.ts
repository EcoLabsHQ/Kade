import type { Address, Hex } from 'viem';
import type { SnapshotVoteResult } from '@/lib/vote/submit';
import { beginVoteAction, completeVoteAction } from '@/app/(resident)/vote/actions';
import {
  signSafeMessageWithPasskey,
  type PasskeySignerArg,
} from '@/lib/safe/passkey-sign-message';

/**
 * The client half of the resident-authorised vote.
 *
 * The passkey lives in the browser, so this is where the vote is actually
 * authorised. The flow is the two server actions around a browser ceremony:
 *
 *   1. `beginVoteAction` validates everything and returns the canonical `Vote`
 *      typed data plus the passkey details; a refusal is returned as-is and
 *      **nothing is signed**.
 *   2. the resident's passkey produces the Safe EIP-1271 signature over that
 *      typed data (`@safe-global/protocol-kit`'s message API).
 *   3. `completeVoteAction` submits that signature to the Snapshot sequencer.
 *
 * `submitted: true` appears only when the sequencer accepted the signature; a
 * refusal — including a dismissed passkey prompt — is reported honestly and
 * never claims the vote was recorded.
 */

/**
 * The chain's read endpoint, used by the Safe SDK to resolve the resident's
 * Safe while it signs. It is a public, key-free Arbitrum One endpoint (the
 * network both programme spaces live on); the private key never leaves the
 * device, so only a read endpoint is needed here. Overridable at build time with
 * `NEXT_PUBLIC_ARBITRUM_RPC_URL`.
 */
export const VOTE_SIGNING_RPC_URL =
  process.env.NEXT_PUBLIC_ARBITRUM_RPC_URL?.trim() || 'https://arb1.arbitrum.io/rpc';

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Cast one vote: validate, sign with the resident's passkey, submit.
 *
 * Returns the real outcome. A build refusal short-circuits without touching the
 * passkey; a signing failure is reported without submitting; only a real
 * sequencer acceptance returns `submitted: true`.
 */
export async function castVoteWithPasskey(input: {
  readonly spaceId: string;
  readonly proposalId: string;
  readonly choice: number;
}): Promise<SnapshotVoteResult> {
  const begin = await beginVoteAction(input);
  if (begin.status !== 'ready') {
    return begin;
  }

  const signer: PasskeySignerArg = {
    rawId: begin.credentialId,
    coordinates: begin.coordinates,
    verifierAddress: begin.verifierAddress,
  };

  let signature: Hex;
  try {
    signature = await signSafeMessageWithPasskey({
      rpcUrl: VOTE_SIGNING_RPC_URL,
      safeAddress: begin.voter as Address,
      signer,
      message: begin.typedData,
    });
  } catch (cause) {
    // A dismissed or failed passkey prompt must say so; nothing is submitted.
    return {
      status: 'failed',
      submitted: false,
      reason: `Your passkey did not authorise the vote: ${describe(cause)}`,
    };
  }

  return completeVoteAction({ token: begin.token, signature });
}
