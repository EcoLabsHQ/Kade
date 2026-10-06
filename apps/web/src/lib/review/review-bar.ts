import { cache } from 'react';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * The shell's review state for a resident.
 *
 * Mirrors the reference (`showReviewBar = !admin && dash && !reviewed`): the
 * pre-approved banner is shown to a resident who has an application whose intake
 * review has not been cleared. No application, a cleared review, or an
 * unreadable state means no banner — it is never shown unconditionally.
 *
 * `isReviewer` lets the shell offer the Admin surface to a user with a
 * `public.reviewers` row. It is a display flag only: RLS is the real gate.
 *
 * Wrapped in React's per-request `cache()`, so the shared `(resident)/layout.tsx`
 * and any page that also needs the review state (the withdraw route) share a
 * single read per request instead of repeating the applications/reviewers
 * queries. The cache is request-scoped: it never carries a resident's review
 * state into another request.
 */
export interface ReviewBarState {
  readonly show: boolean;
  /** The resident's own application reference, or null. */
  readonly reference: string | null;
  /**
   * True when the application exists and its intake review has cleared
   * (status 'approved'). The sidebar notice's cleared variant reads this, from
   * the same row that derives `show`, so the banner and the notice cannot
   * disagree. A `blocked` application is not cleared: it stays in review.
   */
  readonly reviewed: boolean;
  /** Whether the user has a reviewers row, so the shell can offer /admin. */
  readonly isReviewer: boolean;
}

export const loadReviewBar = cache(
  async (profileId: string): Promise<ReviewBarState> => {
    try {
      const client = await createSupabaseServerClient();
      const [application, reviewer] = await Promise.all([
        client
          .from('applications')
          .select('ref, status')
          .eq('profile_id', profileId)
          .maybeSingle(),
        client
          .from('reviewers')
          .select('id')
          .eq('id', profileId)
          .maybeSingle(),
      ]);
      if (application.error) throw new Error(application.error.message);
      const row = application.data as
        | { ref: string | null; status: string | null }
        | null;
      return {
        show: row !== null && row.status !== 'approved',
        reference: row?.ref ?? null,
        reviewed: row !== null && row.status === 'approved',
        isReviewer: reviewer.error === null && reviewer.data !== null,
      };
    } catch (cause) {
      console.warn(
        '[kade] Could not read the review-bar state:',
        cause instanceof Error ? cause.message : cause,
      );
      return { show: false, reference: null, reviewed: false, isReviewer: false };
    }
  },
);
