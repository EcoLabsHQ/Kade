/**
 * The controls that turn the sidebar into an off-canvas drawer on narrow
 * viewports.
 *
 * The checkbox is the drawer's state. It is rendered as a sibling of the
 * `.kade-sidebar` element so the stylesheet can slide the drawer in with
 * `.kade-nav-toggle:checked ~ .kade-sidebar`, and so the drawer opens without
 * any JavaScript or hydration. On desktop the checkbox is hidden from both
 * paint and the tab order, and the burger is not displayed, so the sidebar is
 * exactly the sticky column it has always been.
 */
export function NavDrawerControls() {
  return (
    <>
      <input
        type="checkbox"
        id="kade-nav-toggle"
        className="kade-nav-toggle"
        aria-label="Toggle navigation"
      />
      <label
        htmlFor="kade-nav-toggle"
        className="kade-nav-backdrop"
        aria-hidden="true"
      />
      <label
        htmlFor="kade-nav-toggle"
        className="kade-nav-burger"
        title="Navigation"
      >
        <span className="kade-nav-burger-bars" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </label>
    </>
  );
}
