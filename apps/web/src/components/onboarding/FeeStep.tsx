'use client';

import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { tokens } from '@/components/ui/tokens';

/**
 * Step 4 — pay the pre-approval fee.
 *
 * DEMO ONLY. "Paying" flips local state and nothing else: payment execution is
 * excluded from Week 1 (contract section 9), so no transaction is built, signed
 * or sent, and the copy does not claim one was. The amount is the authoritative
 * server value passed in, never a client constant.
 */
export interface FileRow {
  readonly label: string;
  readonly value: string;
  readonly status: string;
  readonly tone: 'success' | 'warning';
}

export interface FeeStepProps {
  readonly rows: readonly FileRow[];
  readonly feeUsdc: number;
  readonly mode: string;
  readonly paid: boolean;
  readonly onPay: () => void;
  readonly onEnter: () => void;
}

function usd(value: number): string {
  return `${value.toFixed(2)} USDC`;
}

export function FeeStep({
  rows,
  feeUsdc,
  mode,
  paid,
  onPay,
  onEnter,
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
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)',
          gap: '16px',
          alignItems: 'start',
          maxWidth: '960px',
        }}
      >
        <Card padding="18px 20px">
          <div style={eyebrow}>Your file</div>
          <div style={{ marginTop: '10px' }}>
            {rows.map((row) => (
              <div
                key={row.label}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '110px 1fr auto',
                  gap: '12px',
                  alignItems: 'center',
                  padding: '10px 0',
                  borderTop: `1px solid ${tokens.border}`,
                  fontSize: '13px',
                }}
              >
                <span style={{ color: tokens.muted }}>{row.label}</span>
                <span style={{ fontWeight: 500 }}>{row.value}</span>
                <span
                  style={{
                    fontSize: '11.5px',
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

          <div
            style={{
              marginTop: '16px',
              paddingTop: '14px',
              borderTop: `1px solid ${tokens.border}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
            }}
          >
            <span style={{ fontSize: '13px', color: tokens.muted }}>
              Pre-approval fee · {mode} pricing
            </span>
            <span
              style={{
                fontSize: '17px',
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {usd(feeUsdc)}
            </span>
          </div>
          <p
            style={{
              margin: '6px 0 0',
              fontSize: '11.5px',
              color: tokens.muted,
            }}
          >
            Calculated server-side from the active fee schedule. This demo does
            not send a transaction.
          </p>

          <div style={{ marginTop: '18px' }}>
            {paid ? (
              <button type="button" onClick={onEnter} style={primaryButton}>
                Enter the platform →
              </button>
            ) : (
              <button type="button" onClick={onPay} style={primaryButton}>
                Pay now to start pre-approval
              </button>
            )}
          </div>
        </Card>

        <div
          style={{
            background: tokens.ink,
            borderRadius: '16px',
            padding: '20px 22px',
            color: '#fff',
          }}
        >
          <div
            style={{
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '.08em',
              textTransform: 'uppercase',
              color: '#98A2B3',
            }}
          >
            Your pre-approval
          </div>
          <p
            style={{
              margin: '10px 0 16px',
              fontSize: '16px',
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
                gridTemplateColumns: '16px 1fr',
                gap: '8px',
                marginTop: '10px',
                fontSize: '13px',
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
          {paid ? (
            <div style={{ marginTop: '16px' }}>
              <Chip tone="success" dot>
                Paid
              </Chip>
            </div>
          ) : null}
        </div>
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
