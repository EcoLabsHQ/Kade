import { tokens } from '@/components/ui/tokens';

/**
 * What is known about the resident's account.
 *
 * `anonymous` is the only honest state before authentication: there is no
 * account to describe, so the summary says so rather than showing an example
 * address. The deployed address is the only state that renders an address.
 */
export type AccountState =
  | { readonly kind: 'anonymous' }
  | { readonly kind: 'setting-up' }
  | {
      readonly kind: 'deployed';
      readonly address: string;
      readonly network: string;
    }
  | { readonly kind: 'pending' }
  | { readonly kind: 'error'; readonly message: string };

const BADGES: Record<
  Exclude<AccountState['kind'], 'anonymous'>,
  { label: string; color: string; background: string }
> = {
  deployed: { label: 'Deployed', color: tokens.success, background: '#EAF6F0' },
  'setting-up': {
    label: 'Setting up…',
    color: tokens.warning,
    background: '#FDF6E7',
  },
  pending: { label: 'Pending', color: tokens.warning, background: '#FDF6E7' },
  error: { label: 'Needs attention', color: tokens.danger, background: '#FEF3F2' },
};

export interface AccountSummaryProps {
  readonly state: AccountState;
}

/**
 * The Onchain Island account row.
 *
 * Before authentication it states that the account does not exist yet. After
 * authentication it reflects real state — a deployed address is shown only when
 * one exists, never a placeholder.
 */
export function AccountSummary({ state }: AccountSummaryProps) {
  const badge = state.kind === 'anonymous' ? null : BADGES[state.kind];

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '12px',
        background: '#fff',
        border: `1px solid ${tokens.border}`,
        borderRadius: '12px',
        padding: '14px 16px',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '12px', color: tokens.muted }}>
          Your Onchain Island account
        </div>
        <div
          style={{
            fontSize: '14px',
            fontWeight: 600,
            marginTop: '2px',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {state.kind === 'anonymous' ? (
            'Your account will be set up after you sign in'
          ) : state.kind === 'deployed' ? (
            `Safe · ${state.address} · ${state.network}`
          ) : state.kind === 'setting-up' ? (
            'Setting up your account…'
          ) : state.kind === 'pending' ? (
            'Setup in progress'
          ) : (
            state.message
          )}
        </div>
      </div>
      {badge ? (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            background: badge.background,
            color: badge.color,
            fontSize: '11.5px',
            fontWeight: 600,
            padding: '4px 9px',
            borderRadius: '999px',
            whiteSpace: 'nowrap',
          }}
        >
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: badge.color,
            }}
          />
          {badge.label}
        </span>
      ) : null}
    </div>
  );
}
