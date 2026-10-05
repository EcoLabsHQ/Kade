import type { CSSProperties } from 'react';
import { Card } from '@/components/ui/Card';
import { tokens } from '@/components/ui/tokens';
import { ContentContainer } from '@/components/shell/ContentContainer';
import { NavDrawerControls } from '@/components/shell/NavDrawerControls';
import { SiteFooter } from '@/components/shell/SiteFooter';

/**
 * Route-level loading shells.
 *
 * Every authenticated route renders its own `AppShell` (there is no shared app
 * layout), and every one of those routes is `force-dynamic`. So a client-side
 * navigation used to block on the server render before any chrome appeared,
 * which the human experienced as a 1–2 second dead click.
 *
 * A `loading.tsx` in a segment is the App Router's Suspense fallback for that
 * segment. It paints immediately — the shell frame does not wait on data — and
 * is replaced by the real page once its reads resolve. That is the whole fix:
 * no data fetching, caching or server logic changes.
 *
 * Honesty (the app's demo-honesty rules): the fallback renders **no data at
 * all**. It is neutral grey placeholder shapes with an empty text content, so
 * nothing on screen can be mistaken for a real balance, name, address, status
 * or figure. In particular it does **not** render `AppShell` with empty props:
 * that would flash the Safe card's "no account yet" status and "0x…" placeholder
 * for a resident whose account does exist. The sidebar is reproduced as shapes
 * for the same reason.
 *
 * Layout is reused from the real shell (`.kade-shell`, `.kade-sidebar`,
 * `.kade-content`, `.kade-content-padding`, `Card`) so the frame does not jump
 * when the page arrives. The global `SiteFooter` is rendered exactly once here,
 * as it is in `AppShell`, never stacked.
 *
 * The component is a named export so the per-route `loading.tsx` files can
 * re-use it without duplicating the shell; the default export below is what the
 * root segment's boundary renders.
 */
export function RouteLoading() {
  return (
    <div
      className="kade-shell"
      style={{ minHeight: '100vh', background: '#fff' }}
    >
      {/*
        The same non-JavaScript drawer controls as the real shell, so the narrow
        breakpoint still offers the menu while the route loads. They carry no
        resident data.
      */}
      <NavDrawerControls />

      {/*
        A shape-only sidebar. `aria-hidden` because it is decoration: a screen
        reader is told the route is loading (below) rather than read a column of
        empty boxes.
      */}
      <aside className="kade-sidebar" aria-hidden data-testid="route-loading-sidebar">
        <div style={{ padding: '0 6px 18px' }}>
          <Bar width={124} height={30} radius={8} />
        </div>
        <div style={{ margin: '0 6px 18px' }}>
          <Bar width={150} height={28} radius={999} />
        </div>

        {/* Nav groups: labels and rows, matching RESIDENT_NAV's shape. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <NavRow />
          <NavGroup labelWidth={74} rows={2} />
          <NavGroup labelWidth={54} rows={2} />
          <NavGroup labelWidth={62} rows={2} />
        </div>

        {/* The real sidebar pins the account card and switch to the bottom. */}
        <div style={{ flex: 1 }} />

        <div
          style={{
            background: tokens.surface,
            border: `1px solid ${tokens.border}`,
            borderRadius: '12px',
            padding: '10px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <Bar width={22} height={22} radius={999} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <Bar width="72%" height={10} />
            <Bar width="92%" height={8} style={{ marginTop: '7px' }} />
          </div>
        </div>

        <div
          style={{
            background: tokens.surface,
            border: `1px solid ${tokens.border}`,
            borderRadius: '12px',
            padding: '4px',
            display: 'flex',
            gap: '4px',
            marginTop: '12px',
          }}
        >
          <Bar width="50%" height={30} radius={9} />
          <Bar width="50%" height={30} radius={9} />
        </div>
      </aside>

      <main
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
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
        <SiteFooter />
      </main>

      {/*
        The only text in the fallback: an honest status for assistive tech. It
        states no figure, name or balance, and is visually hidden.
      */}
      <div role="status" aria-live="polite" style={visuallyHidden}>
        Loading
      </div>
    </div>
  );
}

export default function RootLoading() {
  return <RouteLoading />;
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

function NavRow() {
  return (
    <div style={navRow}>
      <Bar width={5} height={5} radius={999} />
      <Bar width={92} height={10} />
    </div>
  );
}

function NavGroup({
  labelWidth,
  rows,
}: {
  readonly labelWidth: number;
  readonly rows: number;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <div style={{ padding: '16px 12px 6px' }}>
        <Bar width={labelWidth} height={9} />
      </div>
      {Array.from({ length: rows }, (_, index) => (
        <NavRow key={index} />
      ))}
    </div>
  );
}

const navRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  padding: '9px 12px',
};

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
