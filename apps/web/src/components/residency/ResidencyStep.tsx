'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Hex } from 'viem';
import { tokens } from '@/components/ui/tokens';
import { tierMinimumUsdc, type ResidencyCheck } from '@/lib/residency/checks';
import type { MembershipClaimTarget } from '@/lib/membership/plan';
import { usd, usd2, usdc2 } from '@/lib/wealth/format';
import type { ResidencySnapshot } from '@/lib/residency/server';
import type { PermitIssuanceResult } from '@/lib/residency/permit';
import {
  claimMembershipAction,
  createSelfSessionAction,
  issueResidencyPermitAction,
  type SelfSessionActionOutcome,
} from '@/app/residency/actions';
import { ServiceFeePayment } from './ServiceFeePayment';
import { ColosseumResidency } from './ColosseumResidency';
import { documentsFlagKey, readDocumentsComplete, writeDocumentsComplete } from './colosseum-progress';
import {
  SelfVerificationModal,
  type SelfModalState,
} from './SelfVerificationModal';

/**
 * The Residency step (D16 / EXE-012), laid out to match the deployed baseline.
 *
 * The header, the readiness pill, the "Before you can start" card and the
 * service-fee card are the reference's. The readiness rows derive their state
 * from the records the server assembled; documents are not tracked in this
 * iteration, so that row mirrors the baseline and Upload is a no-op. The service
 * fee is the real server-resolved amount, payable only once the prerequisites
 * are green.
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

function toSelfModalState(outcome: SelfSessionActionOutcome): SelfModalState {
  switch (outcome.status) {
    case 'created':
      return { status: 'created', verificationUrl: outcome.verificationUrl };
    case 'not-configured':
      return { status: 'not-configured' };
    case 'unavailable':
      return { status: 'unavailable', reason: outcome.reason };
    case 'unauthenticated':
      return { status: 'unauthenticated' };
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

/**
 * The funds row meta in the baseline's wording: "$X of $Y · $Z to go". The
 * numbers come from the derived check, which formats the balance with two
 * decimals ("$X of $Y."); the shortfall is recomputed here so the copy matches
 * the reference. The pattern accepts a decimal balance, so a fractional figure
 * keeps the "to go" rewrite instead of silently falling back to the detail.
 */
function fundsMeta(check: ResidencyCheck | undefined): string {
  if (!check) return 'No qualifying tier is set.';
  const match = check.detail.match(
    /^\$([\d,]+(?:\.\d+)?) of \$([\d,]+(?:\.\d+)?)\.$/,
  );
  if (!match) return check.detail;
  const haveRaw = match[1] ?? '0';
  const needRaw = match[2] ?? '0';
  const have = Number(haveRaw.replace(/,/g, ''));
  const need = Number(needRaw.replace(/,/g, ''));
  const toGo = Math.max(0, need - have);
  return `$${haveRaw} of $${needRaw} · ${usd2(toGo)} to go`;
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
  const [selfOpen, setSelfOpen] = useState(false);
  const [selfState, setSelfState] = useState<SelfModalState | null>(null);
  // Demo-only: documents are not collected in this build, so Upload marks the
  // row complete in local state. The presence flag is persisted (localStorage)
  // so the Overview tracker can read it too; the count stays session-only.
  const [documentsUploaded, setDocumentsUploaded] = useState(false);
  const { view } = snapshot;

  // The stable key the Colosseum demo progress (and the documents flag) are
  // stored under — the same `applications.id` the Overview page reads.
  const profileKey = snapshot.applicationId ?? null;

  useEffect(() => {
    setDocumentsUploaded(readDocumentsComplete(documentsFlagKey(profileKey)));
  }, [profileKey]);

  const identity = view.checks.find((c) => c.id === 'identity');
  const funds = view.checks.find((c) => c.id === 'funds');
  const review = view.checks.find((c) => c.id === 'review');
  const serviceFee = view.checks.find((c) => c.id === 'service-fee');

  const serviceFeeMet = serviceFee?.state === 'met';
  // "Submitted" is real only when the kade.permit.v1 attestation exists; a
  // verified service fee alone is not a submission.
  const submitted = view.permitIssued;
  const serviceFeeUnlocked = snapshot.preapprovalPaid && view.serviceFeeUnlocked;
  const tierLabel = snapshot.tier ?? '5-year';
  // The recorded tier's real minimum, for the required amount beside the
  // qualified row's "Ready" status. Null when no/unknown tier: no amount shown.
  const tierMinimum = tierMinimumUsdc(snapshot.tier);

  // Documents are not tracked in this iteration; the row mirrors the baseline.
  const readiness = [
    {
      key: 'identity',
      title: 'Identity verified',
      meta: identity?.state === 'met'
        ? 'Verified with Self onchain'
        : 'Passport scan with Self · onchain proof',
      done: identity?.state === 'met',
      action: 'Verify with Self',
      onClick: () => void openSelf(),
    },
    {
      key: 'funds',
      // The recorded tier's real required amount sits immediately after the
      // label, derived from the tier config rather than a literal and rendered
      // whole-dollar like the threshold. Null/unknown tier appends nothing.
      title:
        tierMinimum === null
          ? `Qualified holdings meet ${tierLabel} tier`
          : `Qualified holdings meet ${tierLabel} tier · ${usd(tierMinimum)}`,
      meta: fundsMeta(funds),
      done: funds?.state === 'met',
      action: 'Move funds',
      onClick: () => router.push('/holdings'),
    },
    {
      key: 'documents',
      title: 'Documents complete',
      // Demo-only: Upload marks this row complete in local state for the demo.
      meta: documentsUploaded
        ? 'Marked complete in the demo · no document is uploaded'
        : '0 of 6 uploaded · hashed & pinned',
      done: documentsUploaded,
      action: 'Upload',
      onClick: () => {
        setDocumentsUploaded(true);
        writeDocumentsComplete(documentsFlagKey(profileKey), true);
      },
    },
    {
      key: 'review',
      title: 'Intake review cleared',
      meta: 'Admin reviews within 3 days — nothing to do',
      done: review?.state === 'met',
      action: null,
      onClick: null,
    },
  ] as const;

  const readyCount = readiness.filter((row) => row.done).length;

  const handlePaid = (_txHash: Hex) => {
    void _txHash;
    router.refresh();
  };

  async function openSelf() {
    setSelfOpen(true);
    setSelfState(null);
    const outcome = await createSelfSessionAction();
    setSelfState(toSelfModalState(outcome));
  }

  async function issuePermit() {
    const result = await issueResidencyPermitAction();
    setNotice(permitMessage(result));
  }

  /**
   * The Colosseum claim trigger. The server re-validates the four real checks
   * and mints the credential; it is fire-and-forget so the reveal is never
   * delayed. A failure is logged without any secret (the outcome never carries
   * the signer key) and does not disturb the demo reveal.
   */
  const claimMembership = useCallback((target: MembershipClaimTarget) => {
    const report = (cause: unknown) =>
      console.warn(
        '[kade] the Colosseum membership claim could not be submitted:',
        cause instanceof Error ? cause.message : cause,
      );
    try {
      const result = claimMembershipAction(target);
      void result.catch(report);
    } catch (cause) {
      report(cause);
    }
  }, []);

  return (
    <div style={{ animation: 'fadeUp .2s ease-out' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          gap: '24px',
          marginBottom: '24px',
        }}
      >
        <div>
          <h1 style={heading}>{submitted ? 'Residency' : 'Start Residency'}</h1>
          <p style={lead}>
            {submitted
              ? 'Your package is with the Immigration Service — every stage is attested onchain.'
              : 'Clear all four checks, pay the service fee, and we submit your full package.'}
          </p>
        </div>
        <span
          style={{
            ...pill,
            background: submitted ? '#EAF6F0' : '#FDF6E7',
            color: submitted ? tokens.success : '#B7791F',
          }}
        >
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: submitted ? tokens.success : '#B7791F',
            }}
          />
          {submitted ? 'Submitted · in review' : `${readyCount} of 4 ready`}
        </span>
      </div>

      <div className="kade-grid-dashboard" style={{ gap: '16px', alignItems: 'stretch' }}>
        <div style={card}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
            }}
          >
            <h2 style={cardHeading}>Before you can start</h2>
            <span style={{ fontSize: '12.5px', color: tokens.muted }}>
              {readyCount} of 4 ready
            </span>
          </div>
          <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column' }}>
            {readiness.map((row) => (
              <div
                key={row.key}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '26px 1fr auto',
                  gap: '14px',
                  alignItems: 'center',
                  padding: '12px 0',
                  borderTop: `1px solid ${tokens.border}`,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    background: row.done ? tokens.brandPrimary : tokens.chipBg,
                    color: row.done ? '#fff' : tokens.muted,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '11px',
                    fontWeight: 700,
                  }}
                >
                  {row.done ? '✓' : ''}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '14px', fontWeight: 600 }}>{row.title}</div>
                  <div style={{ fontSize: '12px', color: tokens.muted }}>{row.meta}</div>
                </div>
                {row.done ? (
                  <span
                    style={{ fontSize: '11.5px', fontWeight: 600, color: tokens.success }}
                  >
                    Ready
                  </span>
                ) : row.action && row.onClick ? (
                  <button type="button" onClick={row.onClick} style={rowButton}>
                    {row.action}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div style={{ ...card, display: 'flex', flexDirection: 'column' }}>
          <div style={feeEyebrow}>Residency service fee</div>
          <div style={feeAmount}>
            {snapshot.serviceFeeAmountUsdc === null
              ? '—'
              : `${usdc2(snapshot.serviceFeeAmountUsdc)} USDC`}
          </div>
          <div style={{ fontSize: '12.5px', color: tokens.muted, marginTop: '2px' }}>
            Payable once — only when all four checks are ready
          </div>
          <div style={feeBody}>
            Covers compilation and submission of your full package, household
            permits, biometrics scheduling and Kranshi registration. Pre-approval
            fee already paid:{' '}
            {snapshot.preapprovalUsdc === null
              ? '—'
              : usdc2(snapshot.preapprovalUsdc)}{' '}
            USDC.
          </div>
          <div style={{ flex: 1 }} />

          {serviceFeeMet ? (
            <div>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  color: tokens.success,
                }}
              >
                <span
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: tokens.success,
                  }}
                />
                Service fee verified
              </span>
              <button
                type="button"
                onClick={() => void issuePermit()}
                style={{ ...rowButton, width: '100%', marginTop: '12px', height: '40px' }}
              >
                Issue permit
              </button>
            </div>
          ) : serviceFeeUnlocked &&
            paymentConfigured &&
            treasuryAddress &&
            snapshot.serviceFeeAmountUsdc !== null ? (
            <ServiceFeePayment
              amountUsdc={String(snapshot.serviceFeeAmountUsdc)}
              chainId={chainId}
              treasuryAddress={treasuryAddress as `0x${string}`}
              usdcAddress={usdcAddress as `0x${string}`}
              explorerUrl={explorerUrl}
              onPaid={handlePaid}
            />
          ) : (
            <button type="button" disabled style={lockedButton}>
              Complete the checks above to unlock
            </button>
          )}
        </div>
      </div>

      <SelfVerificationModal
        open={selfOpen}
        onClose={() => setSelfOpen(false)}
        state={selfState}
      />

      {/*
        The mocked Colosseum sub-section, anchored to the real "Start Residency"
        milestone. It reuses the four real checks and their derived state; its
        2-minute clock and certificate are client-side demo state (see the file).
      */}
      <ColosseumResidency
        checks={view.checks}
        tier={snapshot.tier}
        profileKey={profileKey}
        onClaimMembership={claimMembership}
      />

      {notice ? (
        <p role="status" style={{ ...feeBody, color: tokens.chipFg, marginTop: '16px' }}>
          {notice}
        </p>
      ) : null}
    </div>
  );
}

const heading: React.CSSProperties = {
  margin: 0,
  fontSize: '36px',
  lineHeight: 1.1,
  fontWeight: 700,
  letterSpacing: '-.02em',
};

const lead: React.CSSProperties = {
  margin: '10px 0 0',
  color: tokens.muted,
  maxWidth: '64ch',
  textWrap: 'pretty',
};

const pill: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '11px',
  fontWeight: 700,
  padding: '5px 10px',
  borderRadius: '999px',
  whiteSpace: 'nowrap',
};

const card: React.CSSProperties = {
  background: tokens.surface,
  border: `1px solid ${tokens.border}`,
  borderRadius: '14px',
  padding: '22px 24px',
};

const cardHeading: React.CSSProperties = {
  margin: 0,
  fontSize: '17px',
  fontWeight: 600,
};

const rowButton: React.CSSProperties = {
  height: '32px',
  padding: '0 14px',
  border: `1px solid ${tokens.border}`,
  borderRadius: '999px',
  background: '#fff',
  fontFamily: 'inherit',
  fontSize: '12.5px',
  fontWeight: 600,
  cursor: 'pointer',
  color: tokens.ink,
  whiteSpace: 'nowrap',
};

const feeEyebrow: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: tokens.muted,
};

const feeAmount: React.CSSProperties = {
  fontSize: '30px',
  fontWeight: 700,
  marginTop: '8px',
  fontVariantNumeric: 'tabular-nums',
};

const feeBody: React.CSSProperties = {
  fontSize: '13.5px',
  lineHeight: 1.7,
  marginTop: '14px',
  color: tokens.chipFg,
};

const lockedButton: React.CSSProperties = {
  marginTop: '18px',
  width: '100%',
  height: '46px',
  border: 0,
  borderRadius: '999px',
  background: tokens.locked,
  color: '#fff',
  fontFamily: 'inherit',
  fontSize: '14px',
  fontWeight: 600,
  cursor: 'not-allowed',
};
