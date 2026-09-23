/**
 * The pre-approved banner from the deployed baseline.
 *
 * Rendered at the top of the shell's main column so it is visible on every
 * screen, exactly as the reference does. The copy and colours are the
 * reference's; the reference number is the demo one it shows.
 */
export function PreApprovedBanner() {
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
      <span
        style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
      >
        Ref CW-2026-0409
      </span>
    </div>
  );
}
