import type { ReactNode } from 'react';

/**
 * The reference's content column: 1160px max width, 36/40/64 padding.
 *
 * The 64px bottom padding is the gap between the content and the footer, so a
 * footer supplied via `footer` is rendered *outside* that padding as a sibling
 * of the padded content. The space below the footer is then owned by the footer
 * itself (a fixed value), not borrowed from this container's padding — which is
 * what made the bottom gap change with the length of the page.
 */
export function ContentContainer({
  children,
  footer,
}: {
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div
      style={{
        maxWidth: '1160px',
        width: '100%',
        margin: '0 auto',
        flex: '1 1 auto',
        display: 'flex',
        flexDirection: 'column',
        animation: 'fadeUp .2s ease-out',
      }}
    >
      <div style={{ padding: '36px 40px 64px' }}>{children}</div>
      {footer}
    </div>
  );
}
