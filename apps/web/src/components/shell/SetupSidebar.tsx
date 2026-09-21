import { tokens } from '@/components/ui/tokens';
import { Logo } from './Logo';
import { NavDrawerControls } from './NavDrawerControls';
import { NetworkChip } from './NetworkChip';
import { PreRegistrationStepper, type StepperItem } from '@/components/onboarding/PreRegistrationStepper';
import type { AccountState } from '@/components/auth/AccountSummary';

export interface SetupSidebarProps {
  readonly steps: readonly StepperItem[];
  readonly network: string;
  readonly accountState: AccountState;
}

/**
 * The sidebar for the pre-registration flow.
 *
 * Matches the reference: official wordmark, network chip, the four setup steps,
 * the account card, the Resident/Admin switch, and the platform credit.
 *
 * The Resident/Admin switch is presentation only. It confers no permission —
 * admin access requires a real authorisation on the server, and nothing here
 * changes what the session may read or write.
 */
export function SetupSidebar({ steps, network, accountState }: SetupSidebarProps) {
  // An authenticated resident without a deployed Safe is not "signed out"; the
  // card says what is actually true at each stage.
  const headline =
    accountState.kind === 'deployed'
      ? accountState.address
      : accountState.kind === 'anonymous'
        ? 'Not signed in'
        : 'Safe pending';
  const accountLabel =
    accountState.kind === 'deployed'
      ? `Safe · ${accountState.network}`
      : accountState.kind === 'anonymous'
        ? 'No account yet'
        : 'Setup in progress';

  return (
    <>
      <NavDrawerControls />
      <aside className="kade-sidebar">
        <div style={{ padding: '0 6px 18px' }}>
          <Logo />
        </div>

        <div style={{ margin: '0 6px 18px' }}>
          <NetworkChip label={network} />
        </div>

        <PreRegistrationStepper items={steps} />

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
          <span
            aria-hidden
            style={{
              width: '22px',
              height: '22px',
              borderRadius: '50%',
              background:
                accountState.kind === 'deployed'
                  ? `linear-gradient(135deg, ${tokens.brandPrimary}, #8FC2FF)`
                  : tokens.chipBg,
              flex: '0 0 auto',
            }}
          />
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: '12.5px',
                fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {headline}
            </div>
            <div style={{ fontSize: '11px', color: tokens.muted }}>
              {accountLabel}
            </div>
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
          <span
            style={{
              flex: 1,
              padding: '8px 6px',
              borderRadius: '9px',
              fontSize: '12.5px',
              fontWeight: 600,
              textAlign: 'center',
              background: '#fff',
              color: tokens.brandPrimary,
            }}
          >
            Resident
          </span>
          <span
            aria-disabled="true"
            title="Admin access requires authorisation; this switch grants nothing."
            style={{
              flex: 1,
              padding: '8px 6px',
              borderRadius: '9px',
              fontSize: '12.5px',
              fontWeight: 600,
              textAlign: 'center',
              color: tokens.locked,
              cursor: 'not-allowed',
            }}
          >
            Admin
          </span>
        </div>

        <div
          style={{
            fontSize: '11px',
            color: tokens.muted,
            padding: '14px 6px 0',
            lineHeight: 1.6,
          }}
        >
          Onchain Island Resident Platform
          <br />
          powered by{' '}
          <a
            href="https://www.kade.global"
            target="_blank"
            rel="noreferrer"
            style={{ fontWeight: 500 }}
          >
            Kade
          </a>
        </div>
      </aside>
    </>
  );
}
