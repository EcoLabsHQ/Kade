import { redirect } from 'next/navigation';
import { ContentContainer } from '@/components/shell/ContentContainer';
import { CardScreen } from '@/components/finance/card/CardScreen';
import { getSessionUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * The Card & Banking route (D21).
 *
 * Auth-gated exactly like `/invest`: a signed-out visitor is redirected to
 * `/login`. The authenticated frame now comes from the shared
 * `(resident)/layout.tsx`, so the page only gates the session.
 *
 * The screen itself is a **declared presentational mock** (Finance is beyond
 * the frozen Week 2 scope, week-2 contract §2.1). The page deliberately loads
 * no chain or finance data, so it stays truthful about what exists.
 */
export default async function CardPage() {
  const session = await getSessionUser();
  if (!session) {
    redirect('/login');
  }

  return (
    <ContentContainer>
      <CardScreen />
    </ContentContainer>
  );
}
