'use client';

import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { tokens } from '@/components/ui/tokens';
import type { PreapprovalFeeBreakdown } from '@/lib/onboarding/fee';

/**
 * Step 4 — pay the pre-approval fee.
 *
 * DEMO ONLY. "Paying" flips local state and nothing else: payment execution is
 * excluded from Week 1 (contract section 9), so no transaction is built, signed
 * or sent, and the screen does not claim one was.
 *
 * The amounts are the server's, resolved from the active `fee_schedule` and
 * passed down. The screen holds no formula and no constant; when the server
 * cannot resolve the fee it shows that plainly rather than an amount.
 */
export interface FileRow {
  readonly label: string;
  readonly value: string;
  readonly status: string;
  readonly tone: 'success' | 'warning';
  /** True for a row whose value is demo state, never the resident's record. */
  readonly demo?: boolean;
}

export interface FeeStepProps {
  readonly rows: readonly FileRow[];
  /** The server-resolved fee, or null when it could not be read. */
  readonly breakdown: PreapprovalFeeBreakdown | null;
  readonly paid: boolean;
  readonly onPay: () => void;
  readonly onEnter: () => void;
  readonly onBack: () => void;
}

/** Whole amounts print without decimals; 1.75 keeps them. */
function usdc(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(2)} USDC`;
}

export function FeeStep({
  rows,
  breakdown,
  paid,
  onPay,
  onEnter,
  onBack,
}: FeeStepProps) {
  return (
    <div style={{ animation: 'fadeUp .2s ease-out' }}>
      <div style={eyebrow}>Step 4 of 4</div>
      <h1 style={heading}>Pay the pre-approval fee and go live</h1>
      <p style={lead}>
        Paying opens your file and pre-approves your account instantly. Our team
        reviews in the background and only steps in if something is wrong.
      </p>

      <div
        className="kade-grid-fee"
        style={{
          gap: '16px',
          alignItems: 'stretch',
          maxWidth: '1060px',
        }}
      >
        <Card padding="20px 24px">
          <div style={eyebrow}>Your file</div>
          <div style={{ marginTop: '10px' }}>
            {rows.map((row) => (
              <div
                key={row.label}
                className="kade-grid-file-row"
                style={{
                  gap: '12px',
                  alignItems: 'center',
                  padding: '11px 0',
                  borderTop: `1px solid ${tokens.border}`,
                  fontSize: '13.5px',
                }}
              >
                <span style={{ color: tokens.muted }}>{row.label}</span>
                <span
                  style={{
                    fontWeight: 500,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    flexWrap: 'wrap',
                  }}
                >
                  {row.value}
                  {row.demo ? <Chip tone="muted">Demo</Chip> : null}
                </span>
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color:
                      row.tone === 'success' ? tokens.success : tokens.warning,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {row.status}
                </span>
              </div>
            ))}
          </div>

          <div style={{ borderTop: `1px solid ${tokens.border}`, marginTop: '6px' }}>
            {breakdown ? (
              <>
                <div style={feeLine}>
                  <span>Pre-approval fee · investor permit</span>
                  <span style={feeValue}>{usdc(breakdown.baseUsdc)}</span>
                </div>
                <div style={feeLine}>
                  <span>
                    Household · {breakdown.householdSize} member
                    {breakdown.householdSize === 1 ? '' : 's'} at{' '}
                    {breakdown.perMemberUsdc} USDC each
                  </span>
                  <span style={feeValue}>{usdc(breakdown.householdUsdc)}</span>
                </div>
                <div
                  style={{
                    ...feeLine,
                    borderTop: `1px solid ${tokens.border}`,
                    marginTop: '6px',
                    paddingTop: '12px',
                    fontSize: '16px',
                    fontWeight: 700,
                  }}
                >
                  <span>Total due now</span>
                  <span style={{ ...feeValue, fontSize: '16px', fontWeight: 700 }}>
                    {usdc(breakdown.totalUsdc)}
                  </span>
                </div>
                <p style={{ margin: '10px 0 0', fontSize: '12px', color: tokens.muted }}>
                  This is the configured pre-approval fee for your household.
                  Paying is simulated in this demo and does not send a
                  transaction.
                </p>
              </>
            ) : (
              <p
                role="status"
                style={{
                  margin: '12px 0 0',
                  fontSize: '13px',
                  color: tokens.warning,
                }}
              >
                The configured pre-approval fee could not be read, so no amount
                is shown. Try again once the fee schedule is reachable.
              </p>
            )}
          </div>
        </Card>

        <div
          style={{
            background: tokens.ink,
            borderRadius: '16px',
            padding: '22px 24px',
            color: '#fff',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
            }}
          >
            <div style={darkEyebrow}>Your pre-approval</div>
            <span style={demoTagDark}>Demo payment</span>
          </div>
          <p
            style={{
              margin: '10px 0 16px',
              fontSize: '17px',
              fontWeight: 700,
              lineHeight: 1.35,
            }}
          >
            Paying pre-approves your account on the spot.
          </p>
          {[
            ['Now', 'use the platform: identity, containers, GOS, voting'],
            ['3 days', 'we review; we only step in if something is wrong'],
            ['After', 'card, bank payouts, borrowing, Start Residency'],
          ].map(([when, what]) => (
            <div
              key={when}
              style={{
                display: 'grid',
                gridTemplateColumns: '18px 1fr',
                gap: '8px',
                marginTop: '12px',
                fontSize: '13.5px',
                lineHeight: 1.5,
                color: '#D0D5DD',
              }}
            >
              <span aria-hidden>→</span>
              <span>
                <strong style={{ color: '#fff', fontWeight: 600 }}>{when}</strong>{' '}
                · {what}
              </span>
            </div>
          ))}

          <div style={{ marginTop: 'auto', paddingTop: '20px' }}>
            {paid ? (
              <button type="button" onClick={onEnter} style={{ ...primaryButton, width: '100%' }}>
                Enter the platform →
              </button>
            ) : (
              <button
                type="button"
                onClick={onPay}
                disabled={breakdown === null}
                title={
                  breakdown === null
                    ? 'The configured pre-approval fee is unavailable.'
                    : undefined
                }
                style={{
                  ...primaryButton,
                  width: '100%',
                  opacity: breakdown === null ? 0.5 : 1,
                  cursor: breakdown === null ? 'not-allowed' : 'pointer',
                }}
              >
                Pay now to start pre-approval
              </button>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginTop: '24px' }}>
        <button type="button" onClick={onBack} style={secondaryButton}>
          Back
        </button>
      </div>
    </div>
  );
}

const eyebrow: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: tokens.muted,
};

const darkEyebrow: React.CSSProperties = {
  ...eyebrow,
  color: '#98A2B3',
};

const demoTagDark: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  color: '#D0D5DD',
  border: '1px solid #667085',
  borderRadius: '999px',
  padding: '3px 8px',
  whiteSpace: 'nowrap',
};

const heading: React.CSSProperties = {
  margin: '8px 0 6px',
  fontSize: '30px',
  fontWeight: 700,
  letterSpacing: '-.02em',
};

const lead: React.CSSProperties = {
  margin: '0 0 24px',
  color: tokens.muted,
  maxWidth: '62ch',
  textWrap: 'pretty',
};

const feeLine: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: '12px',
  fontSize: '13.5px',
  paddingTop: '12px',
  color: tokens.chipFg,
};

const feeValue: React.CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
};

const primaryButton: React.CSSProperties = {
  height: '46px',
  padding: '0 22px',
  border: 0,
  borderRadius: '999px',
  background: tokens.action,
  color: '#fff',
  fontFamily: 'inherit',
  fontSize: '15px',
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryButton: React.CSSProperties = {
  height: '46px',
  padding: '0 22px',
  border: `1px solid ${tokens.border}`,
  borderRadius: '999px',
  background: '#fff',
  color: tokens.ink,
  fontFamily: 'inherit',
  fontSize: '15px',
  fontWeight: 600,
  cursor: 'pointer',
};
