import Link from 'next/link';
import { tokens } from '@/components/ui/tokens';

/**
 * The main footer: divider, the EcoLabs copyright, the office location and the
 * legal labels.
 *
 * The year is computed at render time, so the notice never goes stale.
 *
 * Privacy links to the in-app `/privacy` policy route. Terms remains a plain
 * label: its destination is still unknown, so rendering an `href` (or a `"#"`)
 * would invent one. It becomes a link once its URL is provided.
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
          Privacy links to the in-app policy route. Terms stays a plain label:
          its destination is still unknown, so it must not render an href (never
          "#") until it is known.
        */}
        <Link href="/privacy" style={{ color: 'inherit' }}>
          Privacy
        </Link>
        <span>Terms</span>
      </span>
    </footer>
  );
}
