import type { CSSProperties } from 'react';

/**
 * The shell-free loading placeholder.
 *
 * `/login` and `/onboarding` render their own setup flow, not the resident
 * `AppShell`, so a resident sidebar skeleton would be wrong and misleading
 * there. This renders a neutral, centered form-shaped placeholder instead — no
 * sidebar, no shell frame, no footer — with an honest visually-hidden status. It
 * carries no text or data of its own.
 *
 * It is also the root segment's fallback, for the moment before the resident
 * `(resident)/layout.tsx` resolves and for any route outside the group that has
 * no closer boundary (`/admin`, `/vault/withdraw`). It is deliberately
 * shell-free: the resident shell is now provided by the persistent layout, so a
 * fallback here must not fabricate a sidebar or a Safe card. Resident routes get
 * their content-only skeleton from `(resident)/loading.tsx` instead.
 *
 * The component is a named export so `login/loading.tsx` and
 * `onboarding/loading.tsx` share one definition; the default export is what the
 * root segment's boundary renders.
 */
export function PlainLoading() {
  return (
    <div
      data-testid="route-loading-plain"
      style={{
        minHeight: '100vh',
        background: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* The screens' own responsive padding, centred. */}
      <div
        className="kade-content-padding"
        style={{
          width: '100%',
          maxWidth: 420,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Bar width={160} height={28} radius={10} />
        <Bar width="100%" height={14} style={{ marginTop: '16px' }} />
        <Bar width="100%" height={48} radius={12} style={{ marginTop: '28px' }} />
        <Bar width="100%" height={48} radius={12} style={{ marginTop: '12px' }} />
        <Bar width="100%" height={44} radius={12} style={{ marginTop: '24px' }} />
      </div>

      <div role="status" aria-live="polite" style={visuallyHidden}>
        Loading
      </div>
    </div>
  );
}

export default function RootLoading() {
  return <PlainLoading />;
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
