'use client';

import { useEffect, useState } from 'react';
import { tokens } from '@/components/ui/tokens';
import {
  documentsFlagKey,
  readColosseumProgress,
  readDocumentsComplete,
} from '@/components/residency/colosseum-progress';
import type { OverviewInput, OverviewStage } from '@/lib/review/overview';
import { buildOverview, demoBadgeLabel } from '@/lib/review/overview';

/**
 * The "Getting ready for residency" tracker rows, with the persisted demo state
 * read on the client.
 *
 * The Overview page is a Server Component: it can read the database and the
 * chain, but it cannot read `localStorage`. The two facts that live only in the
 * browser are the Residency step's demo "Documents complete" flag and the
 * Colosseum demo progress (`./colosseum-progress`) — both declared demo state.
 * This component receives the server-derived rows and the profile key, reads the
 * persisted state on mount, and passes it back through the page's own derivation
 * so the extra rows are computed by the same pure `buildOverview`, not re-typed
 * here.
 *
 * Nothing is fabricated: before hydration the persisted rows are absent, and a
 * value that is not set stays "not started".
 */

export interface OverviewTrackerProps {
  /**
   * The full, serializable Overview input the page assembled on the server. The
   * tracker re-derives the rows from it plus the persisted demo state, so the
   * demo rows come from the same pure `buildOverview` the tests exercise.
   */
  readonly input: OverviewInput;
  /** The profile key the persisted demo state is scoped under. */
  readonly profileKey: string | null;
}

export function OverviewTracker({ input, profileKey }: OverviewTrackerProps) {
  const [rows, setRows] = useState<readonly OverviewStage[]>(
    buildOverview(input).stages,
  );
  const [demoBadge, setDemoBadge] = useState<string | null>(null);

  useEffect(() => {
    const documentsComplete = readDocumentsComplete(documentsFlagKey(profileKey));
    const progress = readColosseumProgress(profileKey);
    const hasProgress =
      progress.residentSince !== null || progress.citizenAt !== null;
    const model = buildOverview({
      ...input,
      documentsComplete,
      colosseum: hasProgress ? progress : null,
    });
    setRows(model.stages);
    // The honour chip is derived from the same model, so a persisted demo row
    // cannot be shown without it.
    setDemoBadge(demoBadgeLabel(model));
  }, [input, profileKey]);

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
