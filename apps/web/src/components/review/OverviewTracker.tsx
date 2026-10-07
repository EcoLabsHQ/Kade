import { tokens } from '@/components/ui/tokens';
import type { OverviewInput, OverviewStage } from '@/lib/review/overview';
import { buildOverview, demoBadgeLabel } from '@/lib/review/overview';

/**
 * The "Getting ready for residency" tracker rows.
 *
 * The Overview page is a Server Component: it reads the database and the chain,
 * and it now reads the two demo facts that used to live only in the browser (the
 * Residency step's demo "Documents complete" flag and the Colosseum demo state)
 * from the server, per account, and includes them in `input`. This component is
 * therefore a pure renderer: it derives the rows with the same pure
 * `buildOverview` the tests exercise, and nothing is fabricated. Because the
 * state is server-read, two browsers signed into the same account see the same
 * rows.
 */

export interface OverviewTrackerProps {
  /**
   * The full, serializable Overview input the page assembled on the server,
   * including the demo state. The tracker derives the rows from it with the
   * pure `buildOverview`, so the demo rows come from the same derivation the
   * tests exercise.
   */
  readonly input: OverviewInput;
}

export function OverviewTracker({ input }: OverviewTrackerProps) {
  const model = buildOverview(input);
  const rows: readonly OverviewStage[] = model.stages;
  const demoBadge = demoBadgeLabel(model);

  return (
    <div style={{ marginTop: '10px' }}>
      {rows.map((stage, index) => (
        <div
          key={stage.title}
          style={{
            display: 'grid',
            gridTemplateColumns: '26px 1fr auto',
            gap: '12px',
            alignItems: 'center',
            padding: '11px 0',
            borderTop: `1px solid ${tokens.border}`,
            opacity: stage.state === 'queued' ? 0.6 : 1,
          }}
        >
          <span
            aria-hidden
            style={{
              width: '22px',
              height: '22px',
              borderRadius: '50%',
              background:
                stage.state === 'done'
                  ? tokens.brandPrimary
                  : stage.state === 'active'
                    ? '#FDF6E7'
                    : tokens.chipBg,
              color:
                stage.state === 'done'
                  ? '#fff'
                  : stage.state === 'active'
                    ? tokens.warning
                    : tokens.muted,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '11px',
              fontWeight: 700,
            }}
          >
            {stage.state === 'done' ? '✓' : index + 1}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '13.5px', fontWeight: 600 }}>
              {stage.title}
            </div>
            <div style={{ fontSize: '12px', color: tokens.muted }}>
              {stage.meta}
            </div>
          </div>
          <span
            style={{
              fontSize: '12px',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              color:
                stage.state === 'done'
                  ? tokens.success
                  : stage.state === 'active'
                    ? tokens.warning
                    : tokens.muted,
            }}
          >
            {stage.status}
          </span>
        </div>
      ))}
      {demoBadge ? (
        <div
          data-testid="overview-tracker-demo"
          style={{ marginTop: '12px', fontSize: '12px', color: tokens.muted }}
        >
          {demoBadge}
        </div>
      ) : null}
    </div>
  );
}
