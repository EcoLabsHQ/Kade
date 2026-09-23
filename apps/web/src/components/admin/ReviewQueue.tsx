'use client';

import { useState } from 'react';
import { chainByChainId } from '@kade/shared';
import { tokens } from '@/components/ui/tokens';
import {
  applicantName,
  availableActions,
  feeState,
  residencyState,
  wealthState,
  type ApplicationStatus,
  type ReviewQueueItem,
} from '@/lib/review/decision';
import { submitReview, type SubmitReviewResult } from '@/app/admin/review-actions';

/**
 * The Admin review queue (D19).
 *
 * Read-only presentation plus the three review actions. The action is a server
 * call; this component never writes status, and the status shown after an action
 * is the one the database returned.
 */

export interface ReviewQueueProps {
  readonly items: readonly ReviewQueueItem[];
}

interface ActionResult {
  readonly status: ApplicationStatus;
  readonly result: SubmitReviewResult;
}

const STATUS_LABEL: Record<ApplicationStatus, string> = {
  draft: 'Draft',
  pre_approved: 'Pre-approved',
  submitted: 'Submitted',
  approved: 'Approved',
  blocked: 'Blocked',
};

function statusTone(status: ApplicationStatus): string {
  switch (status) {
    case 'approved':
      return tokens.success;
    case 'blocked':
      return '#B42318';
    default:
      return tokens.warning;
  }
}

function chainLabel(chain: number): string {
  if (chain === 0) return 'Bitcoin';
  return chainByChainId(chain)?.name ?? `Chain ${chain}`;
}

function shorten(value: string, head = 10, tail = 6): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function statusAfter(action: string): ApplicationStatus {
  if (action === 'approve') return 'approved';
  if (action === 'block') return 'blocked';
  return 'pre_approved';
}

export function ReviewQueue({ items }: ReviewQueueProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ActionResult>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function handleAction(
    applicationId: string,
    action: 'approve' | 'block' | 'reopen',
  ) {
    setBusy(`${applicationId}:${action}`);
    setErrors((current) => {
      const next = { ...current };
      delete next[applicationId];
      return next;
    });
    try {
      const result = await submitReview({ applicationId, action });
      setResults((current) => ({
        ...current,
        [applicationId]: { status: statusAfter(action), result },
      }));
    } catch (cause) {
      setErrors((current) => ({
        ...current,
        [applicationId]: cause instanceof Error ? cause.message : 'Review failed.',
      }));
    } finally {
      setBusy(null);
    }
  }

  if (items.length === 0) {
    return (
      <p style={{ color: tokens.muted }}>No applications are waiting for review.</p>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {items.map((item) => {
        const action = results[item.application.id];
        const status = action?.status ?? item.application.status;
        const fee = feeState(item.application);
        const wealth = wealthState(item.wallets);
        const residency = residencyState(item);
        return (
          <section
            key={item.application.id}
            aria-label={`Application ${item.application.ref ?? item.application.id}`}
            style={{
              border: `1px solid ${tokens.border}`,
              borderRadius: '14px',
              padding: '16px',
              background: '#fff',
            }}
          >
            <header
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '12px',
                flexWrap: 'wrap',
                alignItems: 'baseline',
              }}
            >
              <div>
                <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700 }}>
                  {applicantName(item.applicant)}
                </h2>
                <div style={{ fontSize: '12.5px', color: tokens.muted }}>
                  {item.applicant.email ?? 'no email'} ·{' '}
                  {item.application.ref ?? item.application.id} · tier{' '}
                  {item.application.tier}
                </div>
              </div>
              <span
                style={{
                  fontSize: '12.5px',
                  fontWeight: 700,
                  color: statusTone(status),
                  whiteSpace: 'nowrap',
                }}
              >
                {STATUS_LABEL[status]}
              </span>
            </header>

            <dl
              style={{
                margin: '14px 0 0',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '12px',
                fontSize: '13px',
              }}
            >
              <div>
                <dt style={{ color: tokens.muted, fontSize: '11.5px' }}>Fee state</dt>
                <dd style={{ margin: '4px 0 0', fontWeight: 600 }}>
                  {fee.kind === 'recorded'
                    ? `${fee.amountUsdc ?? '?'} USDC · ${shorten(fee.txHash)}`
                    : 'Not recorded'}
                </dd>
                <div style={{ color: tokens.muted, fontSize: '11.5px' }}>
                  fee_tx is a claim; the receipt is re-read by the resident path.
                </div>
              </div>

              <div>
                <dt style={{ color: tokens.muted, fontSize: '11.5px' }}>
                  Proof of wealth
                </dt>
                <dd style={{ margin: '4px 0 0', fontWeight: 600 }}>
                  {wealth.total === 0
                    ? 'No addresses'
                    : `${wealth.verified} verified · ${wealth.pasted} pasted`}
                </dd>
                <div style={{ color: tokens.muted, fontSize: '11.5px' }}>
                  {item.wallets
                    .map((wallet) => `${shorten(wallet.address, 8, 4)} (${chainLabel(wallet.chain)})`)
                    .join(', ') || '—'}
                </div>
              </div>

              <div>
                <dt style={{ color: tokens.muted, fontSize: '11.5px' }}>
                  Residency checks
                </dt>
                <dd style={{ margin: '4px 0 0', fontWeight: 600 }}>
                  {residency.residences} residence
                  {residency.residences === 1 ? '' : 's'} ·{' '}
                  {residency.citizenships} citizenship
                  {residency.citizenships === 1 ? '' : 's'}
                </dd>
                <div style={{ color: tokens.muted, fontSize: '11.5px' }}>
                  {residency.checks
                    .map((check) => `${check.met ? '✓' : '—'} ${check.label}`)
                    .join(' · ')}
                </div>
              </div>

              <div>
                <dt style={{ color: tokens.muted, fontSize: '11.5px' }}>
                  Latest review
                </dt>
                <dd style={{ margin: '4px 0 0', fontWeight: 600 }}>
                  {item.latestReview
                    ? `${item.latestReview.action} · ${new Date(item.latestReview.createdAt).toISOString().slice(0, 10)}`
                    : 'None'}
                </dd>
                <div style={{ color: tokens.muted, fontSize: '11.5px' }}>
                  {item.latestReview?.attestationUid
                    ? shorten(item.latestReview.attestationUid)
                    : 'no attestation UID'}
                </div>
              </div>
            </dl>

            <div
              style={{
                marginTop: '14px',
                display: 'flex',
                gap: '8px',
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              {availableActions(status).map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => handleAction(item.application.id, candidate)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: '999px',
                    border: `1px solid ${tokens.border}`,
                    background: candidate === 'approve' ? tokens.brandPrimary : '#fff',
                    color: candidate === 'approve' ? '#fff' : tokens.ink,
                    fontFamily: 'inherit',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: busy !== null ? 'not-allowed' : 'pointer',
                    textTransform: 'capitalize',
                  }}
                >
                  {busy === `${item.application.id}:${candidate}`
                    ? 'Working…'
                    : candidate}
                </button>
              ))}

              {action ? (
                <span style={{ fontSize: '12.5px', color: tokens.muted }}>
                  Recorded as {STATUS_LABEL[action.status]}.
                  {action.result.attestation === 'blocked'
                    ? ' kade.review.v1 issuance blocked (Onchain gate).'
                    : ` kade.review.v1 ${shorten(action.result.attestationUid ?? '')}.`}
                </span>
              ) : null}

              {errors[item.application.id] ? (
                <span style={{ fontSize: '12.5px', color: '#B42318' }}>
                  {errors[item.application.id]}
                </span>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}
