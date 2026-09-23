import type { ApplicationStatus } from './decision';

/**
 * The resident-side gate, derived from the application status the reviewer's
 * action produced. `applications.status` is trigger-written from
 * `review_events`, so this is the same value the reviewer's action flipped.
 */
export type ResidentGate = 'pending' | 'approved' | 'blocked' | 'unknown';

export function residentGate(status: ApplicationStatus | null): ResidentGate {
  switch (status) {
    case 'approved':
      return 'approved';
    case 'blocked':
      return 'blocked';
    case 'draft':
    case 'pre_approved':
    case 'submitted':
      return 'pending';
    default:
      return 'unknown';
  }
}

export function residentGateLabel(gate: ResidentGate): string {
  switch (gate) {
    case 'approved':
      return 'Approved';
    case 'blocked':
      return 'Blocked';
    case 'pending':
      return 'In review';
    case 'unknown':
    default:
      return 'Not submitted';
  }
}

/**
 * Whether the reviewer's action changes what the resident should see, so the
 * watcher refreshes only on a real transition rather than on every event.
 */
export function gateChanged(
  previous: ApplicationStatus | null,
  next: ApplicationStatus | null,
): boolean {
  return previous !== next;
}
