'use server';

import type { Address } from 'viem';
import { getSessionUser } from '@/lib/supabase/server';
import { loadShellSafe } from '@/lib/safe/shell';
import { ownerSafeMessageSigner } from '@/lib/safe/owner-sign-message';
import { readMembershipSignerPrivateKey, readRpcUrlForChain } from '@/lib/env';
import { VOTE_CHAIN_ID } from '@/lib/vote/spaces';
import {
  createServerVoteAdapter,
  loadVoteViewerMembership,
} from '@/lib/vote/server';
import { createSnapshotSequencerClient } from '@/lib/vote/sequencer';
import { serverVoteDuplicateGuard } from '@/lib/vote/guard';
import {
  castSnapshotVote,
  type SnapshotVoteResult,
} from '@/lib/vote/submit';

/**
 * The Vote server action.
 *
 * The screen sends only three identifiers — the space, the proposal and the
 * choice. Everything that authorises the vote is resolved server-side: the voter
 * Safe comes from the resident's deployment record (never the client), the
 * signer key from the server environment, and the Snapshot adapter and
 * sequencer are built here. The action re-derives the Citizen-only rule and
 * re-reads the proposal, so a client cannot assert eligibility or a vote type.
 *
 * The result is the cast outcome verbatim: `submitted: true` appears only for a
 * sequencer acceptance. The signer key never enters the result.
 */

export async function castVoteAction(input: {
  readonly spaceId: string;
  readonly proposalId: string;
  readonly choice: number;
}): Promise<SnapshotVoteResult> {
  const session = await getSessionUser();
  if (!session) {
    return {
      status: 'unauthenticated',
      submitted: false,
      reason: 'Your session expired. Sign in again to vote.',
    };
  }

  // The voter is the resident's Safe, resolved from the deployment record. A
  // resident with no Safe has no credential to vote with; the cast path reports
  // that rather than inventing an address.
  const shellSafe = await loadShellSafe(session.userId);
  const voter = shellSafe.address === null ? null : (shellSafe.address as Address);
  const membership = await loadVoteViewerMembership(voter);

  const chainId = VOTE_CHAIN_ID;
  const rpcUrl = readRpcUrlForChain(chainId);
  const privateKey = readMembershipSignerPrivateKey();
  const signer =
    voter !== null && rpcUrl !== null && privateKey !== null
      ? ownerSafeMessageSigner({ rpcUrl, safeAddress: voter, privateKey })
      : null;

  return castSnapshotVote(
    {
      spaceId: input.spaceId,
      proposalId: input.proposalId,
      choice: input.choice,
    },
    {
      adapter: createServerVoteAdapter(),
      chainId,
      safeAddress: voter,
      membership,
      signer,
      sequencer: createSnapshotSequencerClient({ fetch: globalThis.fetch }),
      duplicateGuard: serverVoteDuplicateGuard(),
    },
  );
}
