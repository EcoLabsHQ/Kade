import { ReviewStatusChip } from './ReviewStatusChip';
import { loadReviewBar } from '@/lib/review/review-bar';

/**
 * The sidebar's review-status notice, resolved as an async Server Component so
 * the shell frame does not wait for the applications/reviewers read.
 *
 * `(resident)/layout.tsx` renders this inside `<Suspense>`. The notice is
 * conditional — most residents have no application and therefore no notice — so
 * its boundary has no placeholder: a neutral block that appeared and then
 * vanished would be a worse flash than the notice simply arriving. The existing
 * `app/loading.tsx` shell skeleton makes the same choice.
 */
export async function ShellReviewNotice({ userId }: { readonly userId: string }) {
  const review = await loadReviewBar(userId);
  return <ReviewStatusChip review={review} />;
}
