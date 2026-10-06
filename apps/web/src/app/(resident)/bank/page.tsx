import { redirect } from 'next/navigation';
import { ContentContainer } from '@/components/shell/ContentContainer';
import { BankScreen } from '@/components/finance/bank/BankScreen';
import { getSessionUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * The Bank ↔ Crypto route.
 *
 * A **declared presentational mock**: Finance (D21) is beyond the frozen Week 2
 * scope, so the screen renders the reference's GOS layout from demo values and
 * creates no capability — no server action, no Supabase read for the screen, no
 * wallet or chain code.
 *
 * The authenticated frame (session gate, Safe, review bar) now comes from the
 * shared `(resident)/layout.tsx`, so this page only gates the session and renders
 * its own content. It therefore loads no data of its own, as before.
 */
export default async function BankPage() {
  const session = await getSessionUser();
  if (!session) {
    redirect('/login');
  }

  return (
    <ContentContainer>
      <BankScreen />
    </ContentContainer>
  );
}
