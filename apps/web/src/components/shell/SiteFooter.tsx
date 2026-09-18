import { tokens } from '@/components/ui/tokens';

/**
 * The main footer: divider, Kade credit, and the ecosystem references.
 *
 * Matches the reference's footer. The ecosystem labels name the integrations the
 * product is built on; they are not links, because none of them is deployed yet.
 */
export function SiteFooter() {
  return (
    <footer
      style={{
        marginTop: 'auto',
        borderTop: `1px solid ${tokens.border}`,
        paddingTop: '18px',
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
