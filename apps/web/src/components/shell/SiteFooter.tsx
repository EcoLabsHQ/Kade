import { tokens } from '@/components/ui/tokens';

/**
 * The main footer: divider, the EcoLabs copyright, the office location and the
 * legal labels.
 *
 * The year is computed at render time, so the notice never goes stale.
 *
 * The Privacy and Terms labels are deliberately **not** links yet: the human
 * has not supplied their destination URLs, so rendering an `href` (or a `"#"`)
 * would invent one. They become links once the URLs are provided.
 *
 * The footer owns the spacing below itself (`padding: 18px 40px`) so that gap is
 * a fixed value regardless of how much content is above it. `marginTop: auto`
 * still pins it to the bottom of the shell's flex column on short pages; on
 * long pages it follows the content with the same 18px below. It must be
 * rendered as a sibling of the padded content column, never inside its
 * `36px 40px 64px` padding, or the two spacings stack.
 */
export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer
      style={{
        marginTop: 'auto',
        borderTop: `1px solid ${tokens.border}`,
        padding: '18px 40px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: '16px',
        flexWrap: 'wrap',
        fontSize: '11.5px',
        color: tokens.muted,
      }}
    >
      <span>© {year} EcoLabs B.V.</span>
      <span>Willemstad, Curaçao</span>
      <span style={{ display: 'flex', gap: '16px' }}>
        {/*
          Link targets pending: the human has not supplied the Privacy and
          Terms URLs, so these render as plain labels with no href (never "#")
          until the destinations are known.
        */}
        <span>Privacy</span>
        <span>Terms</span>
      </span>
    </footer>
  );
}
