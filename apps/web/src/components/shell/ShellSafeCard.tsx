import { SafeAddressCard } from './SafeAddressCard';
import { ShellSlotFallback } from './ShellSlotFallback';
import { loadShellSafe } from '@/lib/safe/shell';
import { loadReviewBar } from '@/lib/review/review-bar';

/**
 * The sidebar's Safe card, resolved as an async Server Component so the shell
 * frame does not wait for the deployment-record read.
 *
 * `(resident)/layout.tsx` renders this inside `<Suspense>`, in the slot where
 * `AppShell` otherwise draws `SafeAddressCard` from value props. The layout
 * used to await `loadShellSafe` before rendering *anything*, which is the floor
 * this removes.
 *
 * The card also needs `isReviewer` for the account menu's Admin item. Both
 * loaders are `cache()`-wrapped and request-scoped, so reading the review state
 * here shares one read with the review-notice and Admin-switch slots instead of
 * repeating it.
 */
export async function ShellSafeCard({
  userId,
  network,
}: {
  readonly userId: string;
  readonly network: string;
}) {
  const [safe, review] = await Promise.all([
    loadShellSafe(userId),
    loadReviewBar(userId),
  ]);

  return (
    <SafeAddressCard
      address={safe.address}
      network={network}
      deployed={safe.deployed}
      status={safe.status}
      explorerUrl={safe.explorerUrl}
      isReviewer={review.isReviewer}
    />
  );
}

/**
 * What the Safe-card slot shows while `ShellSafeCard` resolves. An empty shape
 * of the card's height, never the "no account yet"/`0x…` state.
 */
export function ShellSafeCardFallback() {
  return (
    <ShellSlotFallback
      height={66}
      radius={12}
      testId="shell-safe-card-fallback"
    />
  );
}
