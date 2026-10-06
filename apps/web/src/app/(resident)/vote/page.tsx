import { redirect } from 'next/navigation';
import { ContentContainer } from '@/components/shell/ContentContainer';
import { VoteScreen } from '@/components/vote/VoteScreen';
import { getSessionUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * The Vote route (D20 / VOTE-1).
 *
 * Auth-gated exactly like `/invest`: a signed-out visitor is redirected to
 * `/login`. The authenticated frame now comes from the shared
 * `(resident)/layout.tsx`, so the page only gates the session.
 *
 * The screen itself is a **declared presentational mock** (the Week 3 contract
 * declares the divergence; see `docs/week-3-frozen-delivery-contract.md`). The
 * page deliberately loads no consultation or Snapshot data, so it stays
 * truthful about what exists.
 */
export default async function VotePage() {
  const session = await getSessionUser();
  if (!session) {
    redirect('/login');
  }

  return (
    <ContentContainer>
      <VoteScreen />
    </ContentContainer>
  );
}
