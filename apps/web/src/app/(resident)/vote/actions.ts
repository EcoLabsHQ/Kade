'use server';

import type { Address } from 'viem';
import { getSessionUser } from '@/lib/supabase/server';
import { loadPasskeyCredential } from '@/app/account/passkey-actions';
import { parseP256PublicKey } from '@/lib/passkey/public-key';
import { toPasskeySigner } from '@/lib/safe/passkey-signer';
import { loadShellSafe } from '@/lib/safe/shell';
import { VOTE_CHAIN_ID } from '@/lib/vote/spaces';
import {
  createServerVoteAdapter,
  loadVoteViewerMembership,
} from '@/lib/vote/server';
import { createSnapshotSequencerClient } from '@/lib/vote/sequencer';
import { serverVoteDuplicateGuard } from '@/lib/vote/guard';
import type { SnapshotVoteTypedData } from '@/lib/vote/snapshot';
import {
  abandonSnapshotVote,
  beginSnapshotVote,
  completeSnapshotVote,
  type SnapshotVoteResult,
} from '@/lib/vote/submit';

/**
 * The Vote server actions, in two phases.
 *
 * The **resident** authorises their own vote: the passkey lives in the browser,
 * so the signature is produced there and the server can neither make it nor
 * substitute it. The flow mirrors the Invest two-phase shape:
 *
 *   1. `beginVoteAction` — server, no signing. Resolves the resident's Safe and
 *      stored passkey, runs the whole vote gate (proposal, network, type, choice,
 *      Citizen-only, duplicate, power) and, only when it holds, returns the
 *      canonical `Vote` typed data plus the passkey details the browser needs to
 *      sign it. Nothing is signed and nothing is sent.
 *   2. `completeVoteAction` — server, after the browser signs. Takes the
 *      resident's EIP-1271 signature and submits it to the sequencer over the
 *      server-retained typed data.
 *
 * The backend holds no voting power and no key: the only signature it can submit
 * is one the resident's passkey produced. The result is the cast outcome
 * verbatim: `submitted: true` appears only for a sequencer acceptance.
 */

/**
 * What the client receives from the build phase.
 *
 * The `ready` variant carries only what the browser needs to produce the
 * signature: the canonical typed data, the passkey credential id and its
 * **public** coordinates, and the voter Safe. No secret material is present —
 * the passkey's private key never exists outside the platform authenticator.
 */
export type BeginVoteResult =
  | {
      readonly status: 'ready';
      /** A cryptographically random, single-use token for the retained vote. */
      readonly token: string;
      /** The canonical Snapshot `Vote` typed data the passkey must sign. */
      readonly typedData: SnapshotVoteTypedData;
      /** The voter Safe the sequencer verifies against. */
      readonly voter: string;
      /** The credential id Safe's SDK expects (bytes as lowercase hex). */
      readonly credentialId: string;
      /** The passkey's public P-256 coordinates. Not a secret. */
      readonly coordinates: { readonly x: string; readonly y: string };
      /** The P-256 verifier the signer is bound to. */
      readonly verifierAddress: string;
    }
  | SnapshotVoteResult;

/**
 * Phase 1 — validate and return the typed data the resident must sign.
 *
 * The signer is built from the resident's **stored credential**, never named by
 * the caller; the Safe comes from the deployment record. A resident with no
 * passkey or no Safe is refused honestly rather than having anything fabricated.
 */
export async function beginVoteAction(input: {
  readonly spaceId: string;
  readonly proposalId: string;
  readonly choice: number;
}): Promise<BeginVoteResult> {
  const session = await getSessionUser();
  if (!session) {
    return {
      status: 'unauthenticated',
      submitted: false,
      reason: 'Your session expired. Sign in again to vote.',
    };
  }

  // The passkey is the authorisation. Without it there is nothing to sign with,
  // so the vote is refused before any eligibility work is done.
  const stored = await loadPasskeyCredential();
  if (!stored?.publicKey || !stored.credentialId) {
    return {
      status: 'blocked',
      submitted: false,
      reason:
        'No voting passkey is stored for this account, so there is nothing to ' +
        'sign the vote with.',
    };
  }

  // The voter is the resident's Safe, resolved from the deployment record. A
  // resident with no Safe has no credential to vote with.
  const shellSafe = await loadShellSafe(session.userId);
  const voter = shellSafe.address === null ? null : (shellSafe.address as Address);
  const membership = await loadVoteViewerMembership(voter);

  const outcome = await beginSnapshotVote(
    {
      spaceId: input.spaceId,
      proposalId: input.proposalId,
      choice: input.choice,
    },
    {
      adapter: createServerVoteAdapter(),
      chainId: VOTE_CHAIN_ID,
      safeAddress: voter,
      membership,
      sequencer: createSnapshotSequencerClient({ fetch: globalThis.fetch }),
      duplicateGuard: serverVoteDuplicateGuard(),
    },
  );

  if (outcome.status !== 'ready') {
    return outcome;
  }

  let signer;
  try {
    const { x, y } = parseP256PublicKey(stored.publicKey);
    signer = toPasskeySigner({
      rawId: stored.credentialId,
      coordinates: { x: x.toString(), y: y.toString() },
    });
  } catch (cause) {
    // The detailed reason belongs in the server log, not on the screen.
    console.warn(
      '[kade] the stored passkey could not be used for the vote:',
      cause instanceof Error ? cause.message : cause,
    );
    return {
      status: 'blocked',
      submitted: false,
      reason: 'The stored passkey could not be used to authorise the vote.',
    };
  }

  return {
    status: 'ready',
    token: outcome.token,
    typedData: outcome.typedData,
    voter: outcome.voter,
    // `signer.rawId` is the credential id's bytes as hex — the form Safe's SDK
    // and the browser prompt both expect. The stored id is base64url.
    credentialId: signer.rawId,
    coordinates: signer.coordinates,
    verifierAddress: signer.verifierAddress,
  };
}

/**
 * Phase 2 — submit the resident's signature to the sequencer.
 *
 * The client supplies only `{ token, signature }`. The typed data submitted is
 * the server-retained one, so a signature over anything else is rejected by the
 * sequencer rather than recorded. The outcome is returned verbatim.
 */
export async function completeVoteAction(input: {
  readonly token: string;
  readonly signature: string;
}): Promise<SnapshotVoteResult> {
  const session = await getSessionUser();
  if (!session) {
    return {
      status: 'unauthenticated',
      submitted: false,
      reason: 'Your session expired. Sign in again to vote.',
    };
  }

  return completeSnapshotVote(
    { token: input.token, signature: input.signature },
    {
      sequencer: createSnapshotSequencerClient({ fetch: globalThis.fetch }),
      duplicateGuard: serverVoteDuplicateGuard(),
    },
  );
}

/**
 * Release the reservation for a vote the resident abandoned.
 *
 * Called by the client when the passkey prompt is dismissed, when signing
 * throws, or when a submit is refused for an expired session, so the resident
 * can try again immediately instead of being told a vote already exists. It is
 * keyed by the unguessable, single-use token from the build phase; an unknown or
 * already-used token is a no-op. Best-effort: it never throws, so a cleanup
 * failure cannot mask the outcome the resident sees.
 */
export async function abandonVoteAction(input: {
  readonly token: string;
}): Promise<void> {
  await abandonSnapshotVote(input.token, {
    duplicateGuard: serverVoteDuplicateGuard(),
  });
}
