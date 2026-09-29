/**
 * The shell's review state, as the shell renders it.
 *
 * This is the subset of `ReviewBarState` (`@/lib/review/review-bar`) the shell
 * needs to draw the review notice. Both the top banner and the sidebar chip
 * read this one value, so they cannot hold two different notions of the
 * resident's review state.
 */
export interface ShellReviewState {
  /** The banner's visibility: pre-approved and awaiting intake review. */
  readonly show: boolean;
  /** The resident's own application reference, or null. */
  readonly reference: string | null;
  /** The intake review has cleared (status 'approved'). */
  readonly reviewed: boolean;
}

/**
 * The sidebar's review-status notice, matching the MVP reference.
 *
 * It is driven by the *same* state as `PreApprovedBanner`: the amber
 * "Pre-approved · in review" chip appears exactly while `show` is true, so it
 * and the banner turn on together. The green "Intake review cleared" variant
 * appears only when the banner is hidden *because the review passed*
 * (`reviewed`), never when there is simply no application. That is why the
 * cleared branch is `!show && reviewed` rather than `reviewed` alone: an
 * application that does not exist must render no notice at all.
 *
 * Display-only: unlike the reference's demo toggle, this asserts nothing and
 * grants nothing — it mirrors the state the server already resolved.
 */
export function ReviewStatusChip({
  review,
}: {
  review?: ShellReviewState | null;
}) {
  if (!review) return null;

  const cleared = !review.show && review.reviewed;
  if (!review.show && !cleared) return null;

  return (
    <div
      data-testid="sidebar-review-notice"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        background: cleared ? '#EAF6F0' : '#FDF6E7',
        color: cleared ? '#1B7F5A' : '#B7791F',
        fontSize: '12px',
        fontWeight: 700,
        padding: '10px 12px',
        borderRadius: '10px',
        marginBottom: '12px',
      }}
    >
      <span
        aria-hidden
        style={{
          width: '7px',
          height: '7px',
          borderRadius: '50%',
          background: 'currentColor',
          flex: '0 0 auto',
        }}
      />
      <span style={{ minWidth: 0 }}>
        {cleared ? 'Intake review cleared' : 'Pre-approved · in review'}
      </span>
    </div>
  );
}
