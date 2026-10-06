import { PreApprovedBanner } from './PreApprovedBanner';
import { loadReviewBar } from '@/lib/review/review-bar';

/**
 * The top pre-approved banner, resolved as an async Server Component so the
 * shell frame does not wait for the applications read.
 *
 * `(resident)/layout.tsx` renders this inside `<Suspense>`. Like the sidebar
 * notice it is conditional, so its boundary has no placeholder: it renders
 * nothing while it waits and appears only when the resident actually has an
 * application whose intake review is not cleared.
 */
export async function ShellReviewBanner({ userId }: { readonly userId: string }) {
  const review = await loadReviewBar(userId);
  if (!review.show) return null;
  return <PreApprovedBanner reference={review.reference} />;
}
