import type { ReactNode } from 'react';

/**
 * The reference's content column: 1160px max width, 36/40/64 padding.
 *
 * The padding lives in `.kade-content-padding` (globals.css) rather than inline, because
 * it has to change at the responsive breakpoint and an inline style cannot carry
 * a media query. It must therefore be applied **once**: an earlier version also
 * padded an inner wrapper, which compounded to 80px horizontally and 72px
 * vertically and changed every desktop page against the frozen reference.
 *
 * The 64px bottom padding is the gap between the content and the footer, so a
 * footer supplied via `footer` is rendered *outside* that padding as a sibling
 * of the padded content. The space below the footer is then owned by the footer
 * itself (a fixed value), not borrowed from this container's padding — which is
 * what made the bottom gap depend on the page.
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
      className="kade-content"
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
      {/*
        The padded region is the content only. The footer is its sibling, so the
        container's bottom padding sits between the two rather than below the
        footer, and the footer's own spacing is the only thing under it.
      */}
      <div className="kade-content-padding">{children}</div>
      {footer}
    </div>
  );
}
