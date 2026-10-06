/**
 * Deterministic formatting for the Colosseum demo artifacts.
 *
 * The pass and certificate show an issue date. It is formatted in UTC from the
 * stored ISO instant so the same record renders identically regardless of the
 * viewer's timezone (and so tests are stable).
 */

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** Format an ISO instant as `05 Oct 2026`, or `—` when absent/invalid. */
export function formatIssueDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${day} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
