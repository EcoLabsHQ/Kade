/**
 * The pre-approved banner from the deployed baseline.
 *
 * Shown by the shell only while the resident has an application whose intake
 * review is not cleared (see `@/lib/review/review-bar`), matching the
 * reference's `showReviewBar`. The copy and colours are the reference's; the
 * reference number is the resident's own application ref, not a literal.
 */
export function PreApprovedBanner({ reference }: { reference?: string | null }) {
  return (
    <div
      style={{
        background: '#FDF6E7',
        color: '#8A5A12',
        fontSize: '13px',
        padding: '10px 32px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '16px',
      }}
    >
      <span>
        <strong>Pre-approved.</strong> Use the platform now — card issuance,
        bank payouts and borrowing unlock once intake review completes.
      </span>
      {reference ? (
        <span
          style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
        >
          Ref {reference}
        </span>
      ) : null}
    </div>
  );
}
