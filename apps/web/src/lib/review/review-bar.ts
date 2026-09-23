import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Whether the shell should show the pre-approved banner.
 *
 * Mirrors the reference (`showReviewBar = !admin && dash && !reviewed`): the
 * banner is shown to a resident who has an application whose intake review has
 * not been cleared. No application, a cleared review, or an unreadable state
 * means no banner — it is never shown unconditionally.
 */
export interface ReviewBarState {
  readonly show: boolean;
  /** The resident's own application reference, or null. */
  readonly reference: string | null;
}

export async function loadReviewBar(profileId: string): Promise<ReviewBarState> {
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client
      .from('applications')
      .select('ref, status')
      .eq('profile_id', profileId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = data as { ref: string | null; status: string | null } | null;
    if (!row) return { show: false, reference: null };
    return { show: row.status !== 'approved', reference: row.ref };
  } catch (cause) {
    console.warn(
      '[kade] Could not read the review-bar state:',
      cause instanceof Error ? cause.message : cause,
    );
    return { show: false, reference: null };
  }
}
