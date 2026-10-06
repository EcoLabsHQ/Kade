import type { CSSProperties } from 'react';
import { ContentContainer } from '@/components/shell/ContentContainer';
import { tokens } from '@/components/ui/tokens';
import { ResidentContentLoading } from '@/app/(resident)/loading';

/**
 * The root segment's loading boundary.
 *
 * In Next.js 15.5.25 a segment's `loading.tsx` wraps that segment's **children**
 * (its pages), not the `layout.tsx` that sits in the same folder. The boundary
 * that covers `(resident)/layout.tsx` is therefore the *parent* segment's
 * loading boundary — this file, `app/loading.tsx`. Evidence:
 * `next/dist/server/app-render/create-component-tree.js` returns each segment's
 * `loadingData` to its parent, and
 * `next/dist/client/components/layout-router.js` renders the parent segment's
 * `parentCacheNode.loading` around the child slot. So while the async
 * `(resident)/layout.tsx` resolves, Next renders **this** default export — which
 * is why the resident shell used to flash the sign-in placeholder.
 *
 * The default export is consequently the resident shell skeleton, not the
 * setup-flow placeholder. The routes that fall through to this boundary
 * (`/admin`, `/vault/withdraw`, and the resident frame itself) all render
 * `AppShell`, so a shell-shaped fallback is the honest one for them. The
 * content area reuses `ResidentContentLoading` so the column matches the real
 * page exactly.
 *
 * `/login` and `/onboarding` have their own `loading.tsx` and render
 * `PlainLoading` instead: they are setup-flow screens (setup sidebar + main
 * column), never the resident shell.
 */

/**
 * The setup-flow loading placeholder.
 *
 * `/login` renders `LoginScreen` and `/onboarding` renders `OnboardingFlow`,
 * both inside a `kade-shell` with the setup `SetupSidebar` (logo, network chip,
 * the step list, the account card and the Resident/Admin switch) plus a main
 * content column. A centred form was not that screen's shape, so this mirrors
 * the real two-column structure with neutral grey blocks instead. It draws no
 * resident nav, no Safe card and no footer text: nothing here can be mistaken
 * for the resident shell or for real content.
 *
 * The component is a named export so `login/loading.tsx` and
 * `onboarding/loading.tsx` share one definition.
 */
export function PlainLoading() {
  return (
    <div
      className="kade-shell"
      data-testid="route-loading-plain"
      style={{ minHeight: '100vh', background: '#fff' }}
    >
      {/* The setup sidebar: wordmark, network chip, the step list, the account
          card and the Resident/Admin switch, all as empty shapes. */}
      <aside className="kade-sidebar" aria-hidden>
        <div style={{ padding: '0 6px 18px' }}>
          <Bar width={115} height={26} radius={6} />
        </div>
        <div style={{ margin: '0 6px 18px' }}>
          <Bar width={132} height={24} radius={999} />
        </div>
        <Bar width={92} height={10} style={{ margin: '6px 12px 8px' }} />
        {[0, 1, 2, 3].map((key) => (
          <div
            key={key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 12px',
            }}
          >
            <Bar width={20} height={20} radius={999} />
            <Bar width={key === 0 ? 104 : 96} height={12} />
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <Bar width="100%" height={46} radius={12} />
        <Bar width="100%" height={38} radius={12} style={{ marginTop: '12px' }} />
        <Bar width={120} height={10} style={{ margin: '14px 6px 0' }} />
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
          <div
            data-testid="route-loading-plain-content"
            style={{ display: 'flex', flexDirection: 'column' }}
          >
            {/* Step eyebrow, heading, body copy, then the sign-in panel. */}
            <Bar width={80} height={11} />
            <Bar width="min(420px, 70%)" height={32} radius={10} style={{ marginTop: '10px' }} />
            <Bar width="min(560px, 90%)" height={14} style={{ marginTop: '12px' }} />
            <Bar width="min(520px, 84%)" height={14} style={{ marginTop: '8px' }} />
            <Bar width="100%" height={140} radius={14} style={{ marginTop: '24px' }} />
          </div>
        </ContentContainer>
        <NeutralFooter />
      </main>

      <div role="status" aria-live="polite" style={visuallyHidden}>
        Loading
      </div>
    </div>
  );
}

/**
 * The resident shell skeleton, shown while the persistent frame resolves.
 *
 * It mirrors `AppShell`: the 240px `.kade-sidebar` rail (wordmark, network chip,
 * the grouped nav, the Safe card and the switch) plus the content column. The
 * content is the same `ResidentContentLoading` the group's own `loading.tsx`
 * renders, so the column does not jump when the real page arrives. Every shape
 * is decorative and empty — no balance, name, address, status or figure, and no
 * nav links or Safe card that could be mistaken for the real shell. The only
 * text is the honest visually-hidden status.
 */
export function ResidentShellLoading() {
  return (
    <div
      className="kade-shell"
      data-testid="route-loading-shell"
      style={{ minHeight: '100vh', background: '#fff' }}
    >
      <aside className="kade-sidebar" aria-hidden>
        <div style={{ padding: '0 6px 18px' }}>
          <Bar width={115} height={26} radius={6} />
        </div>
        <div style={{ margin: '0 6px 18px' }}>
          <Bar width={132} height={24} radius={999} />
        </div>
        <Bar width={64} height={10} style={{ margin: '16px 12px 6px' }} />
        {[0, 1, 2, 3, 4].map((key) => (
          <div
            key={key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 12px',
            }}
          >
            <Bar width={18} height={18} radius={5} />
            <Bar width={key % 2 === 0 ? 110 : 92} height={12} />
          </div>
        ))}
        <div style={{ flex: 1 }} />
        {/* The Safe card and the Resident/Admin switch. */}
        <Bar width="100%" height={66} radius={12} />
        <Bar width="100%" height={38} radius={12} style={{ marginTop: '12px' }} />
      </aside>

      <main
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <ResidentContentLoading />
        <NeutralFooter />
      </main>
    </div>
  );
}

export default function RootLoading() {
  return <ResidentShellLoading />;
}

/**
 * A footer-shaped neutral block. The real `SiteFooter` carries the copyright
 * year and legal labels (real text), which a loading fallback must not invent,
 * so this reserves the same space with empty shapes instead.
 */
function NeutralFooter() {
  return (
    <div
      aria-hidden
      style={{
        marginTop: 'auto',
        borderTop: `1px solid ${tokens.border}`,
        padding: '18px 40px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: '16px',
        flexWrap: 'wrap',
      }}
    >
      <Bar width={110} height={10} />
      <Bar width={90} height={10} />
      <Bar width={80} height={10} />
    </div>
  );
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
