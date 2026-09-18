import { REQUIRED_AUTH_ENV } from '@/lib/env';
import { tokens } from '@/components/ui/tokens';

export interface NotConfiguredNoticeProps {
  readonly detail?: string;
  /** Defaults to the missing-environment case. */
  readonly title?: string;
}

/**
 * Explicit "sign-in cannot start" state.
 *
 * Contract section 5 lists the Supabase project as a project-supplied
 * dependency. Until it exists, the app renders this instead of attempting a
 * sign-in that cannot succeed. It never crashes and never claims a session.
 */
export function NotConfiguredNotice({ detail, title }: NotConfiguredNoticeProps) {
  return (
    <div
      role="status"
      style={{
        background: '#FDF6E7',
        border: `1px solid ${tokens.warning}`,
        borderRadius: '12px',
        padding: '14px 16px',
        marginBottom: '18px',
      }}
    >
      <div
        style={{
          fontSize: '12px',
          fontWeight: 700,
          color: tokens.warning,
          letterSpacing: '.04em',
          textTransform: 'uppercase',
        }}
      >
        {title ?? 'Authentication not configured'}
      </div>
      <p
        style={{
          margin: '6px 0 0',
          fontSize: '13px',
          color: tokens.chipFg,
          lineHeight: 1.55,
        }}
      >
        {detail ??
          'No Supabase project is connected, so Google sign-in cannot start. ' +
            'The app will not fake a signed-in state.'}
      </p>
      {title ? null : (
        <p
          style={{
            margin: '8px 0 0',
            fontSize: '12px',
            color: tokens.muted,
          }}
        >
          Required variables:{' '}
          <code style={{ fontFamily: 'ui-monospace, monospace' }}>
            {REQUIRED_AUTH_ENV.join(', ')}
          </code>
          . See <code style={{ fontFamily: 'ui-monospace, monospace' }}>.env.example</code>.
        </p>
      )}
    </div>
  );
}
