import { tokens } from '@/components/ui/tokens';

/**
 * The main footer: divider, Kade credit, and the ecosystem references.
 *
 * Matches the reference's footer. The ecosystem labels name the integrations the
 * product is built on; they are not links, because none of them is deployed yet.
 *
 * The footer owns the spacing below itself (`padding: 18px 40px`, as in the
 * reference) so that gap is a fixed value regardless of how much content is
 * above it. `marginTop: auto` still pins it to the bottom of the shell's flex
 * column on short pages; on long pages it follows the content with the same
 * 18px below. It must be rendered as a sibling of the padded content column,
 * never inside its `36px 40px 64px` padding, or the two spacings stack.
 */
export function SiteFooter() {
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
      <span>
        Onchain Island Resident Platform · powered by{' '}
        <a
          href="https://www.kade.global"
          target="_blank"
          rel="noreferrer"
          style={{ color: tokens.muted, fontWeight: 600 }}
        >
          Kade
        </a>
      </span>
      <span>Safe · EAS · GOS · Snapshot</span>
    </footer>
  );
}
