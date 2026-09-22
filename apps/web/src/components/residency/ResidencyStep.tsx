'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Hex } from 'viem';
import { Card } from '@/components/ui/Card';
import { Chip, type ChipTone } from '@/components/ui/Chip';
import { StatCard } from '@/components/ui/StatCard';
import { tokens } from '@/components/ui/tokens';
import type {
  ResidencyCheckState,
  ResidencyStageState,
} from '@/lib/residency/checks';
import type { ResidencySnapshot } from '@/lib/residency/server';
import type { SelfVerificationOutcome } from '@/lib/residency/self';
import type { PermitIssuanceResult } from '@/lib/residency/permit';
import {
  issueResidencyPermitAction,
  startSelfVerificationAction,
} from '@/app/residency/actions';
import { ServiceFeePayment } from './ServiceFeePayment';

/**
 * The Residency step (D16 / EXE-012).
 *
 * Renders the four checks (identity, funds, review, service fee), the
 * service-fee card, the permit status and the six-stage tracker, all from the
 * `snapshot` the server derived from records. It invents no state: a check it
 * cannot prove stays pending, and the Self and permit actions surface the gate
 * they hit rather than a fabricated success.
 */

export interface ResidencyStepProps {
  readonly snapshot: ResidencySnapshot;
  readonly network: string;
  /** True when the wallet modal and the service-fee rail are both configured. */
  readonly paymentConfigured: boolean;
  /** The Kade treasury, resolved on the server; null when unconfigured. */
  readonly treasuryAddress: string | null;
  /** The chain the server resolved for the rail; 0 when unconfigured. */
  readonly chainId: number;
  readonly usdcAddress: string;
  readonly explorerUrl: string;
}

const CHECK_TONES: Record<ResidencyCheckState, ChipTone> = {
  met: 'success',
  pending: 'warning',
  blocked: 'danger',
};

const CHECK_LABELS: Record<ResidencyCheckState, string> = {
  met: 'Ready',
  pending: 'Pending',
  blocked: 'Blocked',
};

const STAGE_TONES: Record<ResidencyStageState, ChipTone> = {
  done: 'success',
  active: 'brand',
  queued: 'muted',
  blocked: 'danger',
};

const STAGE_LABELS: Record<ResidencyStageState, string> = {
  done: 'Done',
  active: 'In progress',
  queued: 'Queued',
  blocked: 'Blocked',
};

function selfMessage(outcome: SelfVerificationOutcome): string {
  switch (outcome.status) {
    case 'not-configured':
      return 'Self is not configured in this environment, so identity cannot be verified yet.';
    case 'unavailable':
      return outcome.reason;
    case 'unauthenticated':
      return 'Your session expired. Sign in again.';
    default:
      return 'Identity verification is unavailable.';
  }
}

function permitMessage(result: PermitIssuanceResult): string {
  switch (result.status) {
    case 'issued':
      return `Permit issued · ${result.uid}`;
    case 'blocked':
      return result.reason;
    case 'not-configured':
      return result.reason;
    case 'unauthenticated':
      return 'Your session expired. Sign in again.';
    default:
      return 'Permit issuance is unavailable.';
  }
}

export function ResidencyStep({
  snapshot,
  network,
  paymentConfigured,
  treasuryAddress,
  chainId,
  usdcAddress,
  explorerUrl,
}: ResidencyStepProps) {
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const { view, permit } = snapshot;

  const handlePaid = (_txHash: Hex) => {
    void _txHash;
    router.refresh();
  };

  async function verifyWithSelf() {
    const outcome = await startSelfVerificationAction();
    setNotice(selfMessage(outcome));
  }

  async function issuePermit() {
    const result = await issueResidencyPermitAction();
    setNotice(permitMessage(result));
  }

  const serviceFeeCheck = view.checks.find((c) => c.id === 'service-fee');
  const identityCheck = view.checks.find((c) => c.id === 'identity');
  const permitReady = identityCheck?.state === 'met' && serviceFeeCheck?.state === 'met';
  // Pre-approval gates the whole step: even green readiness checks cannot open
  // the service fee before the pre-approval fee has been verified.
  const serviceFeeUnlocked = snapshot.preapprovalPaid && view.serviceFeeUnlocked;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div>
        <div style={eyebrow}>Residency</div>
        <h1 style={heading}>Start Residency</h1>
        <p style={lead}>
          Four readiness checks stand between your pre-approval and your
          residency application. The service fee unlocks only when identity,
          qualified holdings and intake review are green.
        </p>
      </div>

      {!snapshot.preapprovalPaid ? (
        <Card background="#FDF6E7" style={{ borderColor: '#F2D9A8' }}>
          <strong style={{ color: tokens.warning }}>Pre-approval pending.</strong>{' '}
          <span style={{ color: tokens.chipFg, fontSize: '13.5px' }}>
            Verify your pre-approval fee before starting residency. Use the
            Residency setup page to complete it.
          </span>
        </Card>
      ) : null}

      <div className="kade-grid-dashboard" style={{ gap: '16px', alignItems: 'start' }}>
        <Card>
          <h2 style={cardHeading}>Readiness checks</h2>
          <div style={{ marginTop: '8px' }}>
            {view.checks.map((check) => (
              <div
                key={check.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: '12px',
                  alignItems: 'center',
                  padding: '12px 0',
                  borderTop: `1px solid ${tokens.border}`,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '13.5px', fontWeight: 600 }}>
                    {check.label}
                  </div>
                  <div style={{ fontSize: '12px', color: tokens.muted }}>
                    {check.detail}
                  </div>
                </div>
                <Chip tone={CHECK_TONES[check.state]} dot>
                  {CHECK_LABELS[check.state]}
                </Chip>
              </div>
            ))}
          </div>
        </Card>

        <div style={{ display: 'grid', gap: '16px' }}>
          <div
            style={{
              background: tokens.ink,
              borderRadius: '16px',
              padding: '22px 24px',
              color: '#fff',
            }}
          >
            <div style={darkEyebrow}>Residency service fee</div>
            <div style={{ marginTop: '8px', fontSize: '28px', fontWeight: 700 }}>
              {snapshot.serviceFeeAmountUsdc === null
                ? '—'
                : `${snapshot.serviceFeeAmountUsdc} USDC`}
            </div>
            <p style={{ margin: '8px 0 16px', fontSize: '13px', color: '#D0D5DD' }}>
              {serviceFeeCheck?.state === 'met'
                ? 'Paid and verified on chain.'
                : serviceFeeUnlocked
                  ? `Send the service fee on ${network} to submit your residency application.`
                  : 'Unlocks when identity, qualified holdings and intake review are green.'}
            </p>

            {serviceFeeCheck?.state === 'met' ? (
              <Chip tone="success" dot>
                Service fee verified
              </Chip>
            ) : !serviceFeeUnlocked ? (
              <p style={{ margin: 0, fontSize: '13px', color: '#98A2B3' }}>
                Locked
              </p>
            ) : snapshot.serviceFeeAmountUsdc === null ? (
              <p style={{ margin: 0, fontSize: '13px', color: '#FECDCA' }}>
                The configured service fee could not be read.
              </p>
            ) : !paymentConfigured || !treasuryAddress ? (
              <p style={{ margin: 0, fontSize: '13px', color: '#D0D5DD' }}>
                Payment is not configured in this environment.
              </p>
            ) : (
              <ServiceFeePayment
                amountUsdc={String(snapshot.serviceFeeAmountUsdc)}
                chainId={chainId}
                treasuryAddress={treasuryAddress as `0x${string}`}
                usdcAddress={usdcAddress as `0x${string}`}
                explorerUrl={explorerUrl}
                onPaid={handlePaid}
              />
            )}
          </div>

          <Card>
            <h2 style={cardHeading}>Self identity proof</h2>
            <p style={cardBody}>
              {snapshot.selfConfigured
                ? 'Self is configured. Start verification to prove your passport.'
                : 'Self is not configured in this environment, so identity verification is unavailable.'}
            </p>
            <button
              type="button"
              onClick={() => void verifyWithSelf()}
              style={{ ...primaryButton, width: '100%' }}
            >
              Verify with Self
            </button>
          </Card>

          <Card>
            <h2 style={cardHeading}>Permit</h2>
            <p style={cardBody}>
              {view.permitIssued
                ? 'Your kade.permit.v1 attestation has been issued.'
                : 'Issued once the checks are green.'}
            </p>
            <button
              type="button"
              onClick={() => void issuePermit()}
              disabled={!permitReady}
              style={{
                ...secondaryButton,
                width: '100%',
                opacity: permitReady ? 1 : 0.55,
                cursor: permitReady ? 'pointer' : 'not-allowed',
              }}
            >
              Issue permit
            </button>
            {permit.status !== 'issued' ? (
              <p style={{ ...cardBody, marginTop: '8px', fontSize: '12px' }}>
                {permitMessage(permit)}
              </p>
            ) : null}
          </Card>
        </div>
      </div>

      <Card>
        <h2 style={cardHeading}>Residency tracker</h2>
        <div style={{ marginTop: '8px' }}>
          {view.tracker.map((stage, index) => (
            <div
              key={stage.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '24px 1fr auto',
                gap: '12px',
                alignItems: 'center',
                padding: '10px 0',
                borderTop: `1px solid ${tokens.border}`,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: '22px',
                  height: '22px',
                  borderRadius: '50%',
                  background:
                    stage.state === 'done' ? tokens.brandPrimary : tokens.chipBg,
                  color: stage.state === 'done' ? '#fff' : tokens.muted,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '11px',
                  fontWeight: 700,
                }}
              >
                {stage.state === 'done' ? '✓' : index + 1}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '13.5px', fontWeight: 600 }}>
                  {stage.title}
                </div>
                <div style={{ fontSize: '12px', color: tokens.muted }}>
                  {stage.meta}
                </div>
              </div>
              <Chip tone={STAGE_TONES[stage.state]}>{STAGE_LABELS[stage.state]}</Chip>
            </div>
          ))}
        </div>
      </Card>

      <div className="kade-grid-4" style={{ gap: '14px' }}>
        <StatCard
          label="Application"
          value={snapshot.applicationRef ?? '—'}
          sub={snapshot.tier ? `Tier ${snapshot.tier}` : 'Tier not set'}
        />
        <StatCard
          label="Checks ready"
          value={`${view.checks.filter((c) => c.state === 'met').length} / ${view.checks.length}`}
        />
        <StatCard
          label="Service fee"
          value={view.permitIssued ? 'Submitted' : serviceFeeUnlocked ? 'Unlocked' : 'Locked'}
        />
        <StatCard label="Permit" value={view.permitIssued ? 'Issued' : 'Pending'} />
      </div>

      {notice ? (
        <p role="status" style={{ ...cardBody, color: tokens.chipFg }}>
          {notice}
        </p>
      ) : null}
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

const heading: React.CSSProperties = {
  margin: '8px 0 6px',
  fontSize: '32px',
  fontWeight: 700,
  letterSpacing: '-.02em',
};

const lead: React.CSSProperties = {
  margin: 0,
  color: tokens.muted,
  maxWidth: '62ch',
  textWrap: 'pretty',
};

const cardHeading: React.CSSProperties = {
  margin: 0,
  fontSize: '17px',
  fontWeight: 600,
};

const cardBody: React.CSSProperties = {
  margin: '8px 0 12px',
  fontSize: '13px',
  lineHeight: 1.5,
  color: tokens.muted,
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
