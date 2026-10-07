import { redirect } from 'next/navigation';
import { ContentContainer } from '@/components/shell/ContentContainer';
import { VoteScreen } from '@/components/vote/VoteScreen';
import { getSessionUser } from '@/lib/supabase/server';
import { loadShellSafe } from '@/lib/safe/shell';
import { loadVoteData, loadVoteViewerMembership } from '@/lib/vote/server';
import { CITIZEN_SPACE_ID, RESIDENT_SPACE_ID } from '@/lib/vote/spaces';
import { castVoteAction } from './actions';

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
 * The Snapshot source is real (`@/lib/vote/server`): the page loads the
 * proposals for both spaces and the viewer's voting power through the real
 * adapter, then hands the screen serialisable data. Casting is the real server
 * action (`./actions`), passed to the screen as a prop so the browser never
 * imports the signer or the sequencer; the hub client, the read-only chain
 * client and the owner-Safe signer all stay on the server.
 */
export default async function VotePage() {
  const session = await getSessionUser();
  if (!session) {
    redirect('/login');
  }

  const shellSafe = await loadShellSafe(session.userId);
  const membership = await loadVoteViewerMembership(shellSafe.address);
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
        castVote={castVoteAction}
      />
    </ContentContainer>
  );
}
