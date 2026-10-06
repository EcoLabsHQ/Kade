import { AdminSwitchControl } from './AdminSwitchControl';
import { ShellSlotFallback } from './ShellSlotFallback';
import { loadReviewBar } from '@/lib/review/review-bar';

/**
 * The sidebar's Admin affordance, resolved as an async Server Component so the
 * shell frame does not wait for the reviewers read.
 *
 * `(resident)/layout.tsx` renders this inside `<Suspense>`, in the footer's
 * Admin slot. `adminActive` is always false here: the resident route group is
 * never under `/admin` (the Admin page renders its own `AppShell`), so the
 * control's link is never the active route.
 */
export async function ShellAdminSwitch({ userId }: { readonly userId: string }) {
  const { isReviewer } = await loadReviewBar(userId);
  return <AdminSwitchControl isReviewer={isReviewer} />;
}

/**
 * What the Admin slot shows while `ShellAdminSwitch` resolves. A neutral shape
 * the width of the switch's Admin half, never the disabled "not a reviewer"
 * state (which would be a fabricated claim while the reviewers row is unknown).
 */
export function ShellAdminFallback() {
  return (
    <ShellSlotFallback
      height={34}
      radius={9}
      testId="shell-admin-fallback"
      style={{ flex: 1, width: 'auto' }}
    />
  );
}
