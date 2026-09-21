'use client';

import type { Hex } from 'viem';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { tokens } from '@/components/ui/tokens';
import type { PreapprovalFeeBreakdown } from '@/lib/onboarding/fee';
import { FeePayment } from './FeePayment';

/**
 * Step 4 — pay the pre-approval fee.
 *
 * The payment is a real on-chain USDC transfer to the Kade treasury on Ethereum
 * Sepolia, made from a connected wallet and verified from the receipt on the
 * server (contract section 8.9 / v1.9). The screen builds no amount and names
 * no recipient: both are resolved on the server and passed down. When the
 * environment is not configured for payment it says so rather than rendering a
 * button that could only fail.
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
  /** False when the wallet modal or the fee rail is not configured. */
  readonly paymentConfigured: boolean;
  /** The Kade treasury, resolved on the server; null when unconfigured. */
  readonly treasuryAddress: string | null;
  /** USDC on Ethereum Sepolia, from `@kade/shared` chain configuration. */
  readonly usdcAddress: string;
  readonly explorerUrl: string;
  readonly onPaid: (txHash: Hex) => void;
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
  paymentConfigured,
  treasuryAddress,
  usdcAddress,
  explorerUrl,
  onPaid,
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
                  Payment is an on-chain USDC transfer on Ethereum Sepolia,
                  verified from the transaction receipt.
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
            <span style={demoTagDark}>Testnet payment</span>
          </div>
          <p
            style={{
              margin: '10px 0 16px',
              fontSize: '17px',
              fontWeight: 700,
              lineHeight: 1.35,
            }}
          >
            Pay the fee to open your file for pre-approval.
          </p>
          {[
            ['Now', 'open your file and start pre-approval'],
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

          <p style={{ margin: '14px 0 0', fontSize: '11.5px', color: '#98A2B3' }}>
            The steps above are the product flow. Identity, containers, GOS,
            voting, card, payouts and borrowing are not live in this build.
          </p>

          <div style={{ marginTop: 'auto', paddingTop: '20px' }}>
            {paid ? (
              <button type="button" onClick={onEnter} style={{ ...primaryButton, width: '100%' }}>
                Enter the platform →
              </button>
            ) : breakdown === null ? (
              <p style={{ margin: 0, fontSize: '13px', color: '#FECDCA' }}>
                The configured fee could not be read, so payment is unavailable.
              </p>
            ) : !paymentConfigured || !treasuryAddress ? (
              <p style={{ margin: 0, fontSize: '13px', color: '#D0D5DD' }}>
                Payment is not configured in this environment.
              </p>
            ) : (
              <FeePayment
                amountUsdc={String(breakdown.totalUsdc)}
                treasuryAddress={treasuryAddress as `0x${string}`}
                usdcAddress={usdcAddress as `0x${string}`}
                explorerUrl={explorerUrl}
                onPaid={onPaid}
              />
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
