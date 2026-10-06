import type { CSSProperties } from 'react';
import { Card } from '@/components/ui/Card';
import { ContentContainer } from '@/components/shell/ContentContainer';

/**
 * The resident content skeleton.
 *
 * Every resident route now shares the `(resident)/layout.tsx` frame, so this
 * fallback covers **only the content area**: the sidebar, the top banner and the
 * footer are already rendered by the persistent layout and must not be drawn
 * again. That is the whole point of the route group — navigating between
 * resident screens keeps the chrome mounted instead of reproducing it here.
 *
 * Honesty (the app's demo-honesty rules): the fallback renders **no data at
 * all**. It is neutral grey placeholder shapes with empty text, so nothing on
 * screen can be mistaken for a real balance, name, address, status or figure. It
 * deliberately does not render `AppShell` with empty props: that would flash the
 * Safe card's "no account yet" status and "0x…" placeholder for a resident whose
 * account does exist.
 *
 * Layout is reused from the real content (`ContentContainer`, `Card`, the same
 * grid classes) so the column does not jump when the page arrives.
 *
 * The component is a named export so tests can render it directly; the default
 * export is what the segment's boundary renders.
 */
export function ResidentContentLoading() {
  return (
    <>
      <ContentContainer>
        <div data-testid="route-loading">
          {/* Page header. */}
          <Bar width={300} height={36} radius={10} />
          <Bar width="min(460px, 70%)" height={14} style={{ marginTop: '14px' }} />

          {/* KPI row. */}
          <div
            className="kade-grid-4"
            style={{ gap: '14px', margin: '24px 0 16px' }}
          >
            {[0, 1, 2, 3].map((key) => (
              <Card key={key} radius={14}>
                <Bar width="52%" height={11} />
                <Bar width="78%" height={26} style={{ marginTop: '14px' }} />
                <Bar width="64%" height={10} style={{ marginTop: '10px' }} />
              </Card>
            ))}
          </div>

          {/* Main + side columns. */}
          <div className="kade-grid-dashboard" style={{ gap: '16px' }}>
            <Card radius={14}>
              <Bar width="40%" height={16} />
              <Bar width="100%" height={132} style={{ marginTop: '18px' }} />
            </Card>
            <div style={{ display: 'grid', gap: '16px' }}>
              <Card radius={14}>
                <Bar width="52%" height={16} />
                <Bar width="70%" height={26} style={{ marginTop: '14px' }} />
                <Bar width="60%" height={10} style={{ marginTop: '10px' }} />
              </Card>
              <Card radius={14}>
                <Bar width="44%" height={16} />
                <Bar width="100%" height={14} style={{ marginTop: '16px' }} />
                <Bar width="100%" height={14} style={{ marginTop: '10px' }} />
                <Bar width="100%" height={14} style={{ marginTop: '10px' }} />
              </Card>
            </div>
          </div>
        </div>
      </ContentContainer>

      {/*
        The only text in the fallback: an honest status for assistive tech. It
        states no figure, name or balance, and is visually hidden.
      */}
      <div role="status" aria-live="polite" style={visuallyHidden}>
        Loading
      </div>
    </>
  );
}

export default function ResidentLoading() {
  return <ResidentContentLoading />;
}

/** A neutral placeholder block. Decorative, so never announced. */
function Bar({
  width,
  height,
  radius = 6,
  style,
}: {
  readonly width: number | string;
  readonly height: number;
  readonly radius?: number;
  readonly style?: CSSProperties;
}) {
  return (
    <div
      aria-hidden
      style={{
        width,
        height,
        borderRadius: radius,
        background: '#E7EBF0',
        ...style,
      }}
    />
  );
}

const visuallyHidden: CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};
