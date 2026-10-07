import { redirect } from 'next/navigation';
import { createPublicClient, http } from 'viem';
import { ContentContainer } from '@/components/shell/ContentContainer';
import { VoteScreen } from '@/components/vote/VoteScreen';
import { getSessionUser } from '@/lib/supabase/server';
import { loadShellSafe } from '@/lib/safe/shell';
import {
  readChainEnv,
  readMembershipChainId,
  readMembershipManagerAddress,
  readRpcUrlFor,
} from '@/lib/env';
import { readMembership } from '@/lib/membership/chain';
import type { VoteViewerMembership } from '@/lib/vote/eligibility';
import { loadVoteData } from '@/lib/vote/server';
import { CITIZEN_SPACE_ID, RESIDENT_SPACE_ID } from '@/lib/vote/spaces';

export const dynamic = 'force-dynamic';

/**
 * The Vote route.
 *
 * Auth-gated exactly like `/invest`: a signed-out visitor is redirected to
 * `/login`. The authenticated frame comes from the shared `(resident)/layout.tsx`,
 * so the page only gates the session and resolves the inputs the screen needs:
 *
 *   - the **wallet** is the resident's Safe address (from the deployment
 *     record), so a resident with no account sees the disconnected state; and
 *   - the **membership** is read from the manager when it is configured. An
 *     unread membership is treated as `none` for the citizen-only rule: on a
 *     read error, eligibility is not assumed.
 *
 * The Snapshot source is now **real** (`@/lib/vote/server`): the page loads the
 * proposals for both spaces and the viewer's voting power through the real
 * adapter, then hands the screen serialisable data. The hub client and the
 * read-only chain client stay on the server; the screen never imports them.
 */
async function loadViewerMembership(
  account: string | null,
): Promise<VoteViewerMembership> {
  if (account === null) return 'none';
  const managerAddress = readMembershipManagerAddress();
  const chainId = readMembershipChainId();
  const rpcUrl = readRpcUrlFor(readChainEnv());
  if (managerAddress === null || chainId === null || rpcUrl === null) return 'none';
  const read = await readMembership({
    publicClient: createPublicClient({ transport: http(rpcUrl) }),
    managerAddress,
    account,
  });
  // Fail closed: an unread membership is not a Citizen for the citizen-only rule.
  return read.status === 'known' ? read.membership : 'none';
}

export default async function VotePage() {
  const session = await getSessionUser();
  if (!session) {
    redirect('/login');
  }

  const shellSafe = await loadShellSafe(session.userId);
  const membership = await loadViewerMembership(shellSafe.address);
  const voteData = await loadVoteData({
    wallet: shellSafe.address,
    spaceIds: [RESIDENT_SPACE_ID, CITIZEN_SPACE_ID],
  });

  return (
    <ContentContainer>
      <VoteScreen
        wallet={shellSafe.address}
        membership={membership}
        proposals={voteData.proposals}
        powers={voteData.powers}
        error={voteData.error}
      />
    </ContentContainer>
  );
}
