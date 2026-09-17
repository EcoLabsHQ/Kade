import { authoritativePreapprovalFee } from '@/server/fee-authority';
import { tokens } from '@/components/ui/tokens';
import type { FeeMode } from '@kade/shared';

export interface FeeSummaryProps {
  readonly mode: FeeMode;
  readonly householdSize: number;
}

/**
 * Pre-approval fee display.
 *
 * Contract section 2.1: the fee is computed server-side from the frozen shared
 * formula and the client only displays it. This component accepts no amount
 * prop, so a browser cannot override the value.
 */
export function FeeSummary({ mode, householdSize }: FeeSummaryProps) {
  const amount = authoritativePreapprovalFee({ mode, householdSize });
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: '12px',
        padding: '12px 0',
        borderTop: `1px solid ${tokens.border}`,
      }}
    >
      <div>
        <div style={{ fontSize: '13.5px', fontWeight: 600 }}>
          Pre-approval fee
        </div>
        <div style={{ fontSize: '11.5px', color: tokens.muted }}>
          {mode} schedule · household of {householdSize} · computed server-side
        </div>
      </div>
      <div
        style={{
          fontSize: '17px',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {amount.toFixed(2)} USDC
      </div>
    </div>
  );
}
