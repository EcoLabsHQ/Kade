import type { ReviewAction } from './attestation';
import { CONNECTED_WALLET_PROVIDER } from '@/lib/wealth/types';

/**
 * Pure derivations for the Admin review queue (D19).
 *
 * These functions turn the raw rows the reviewer may read into the fields the
 * contract names — applicant, fee state, proof of wealth, residency checks — so
 * the decision logic is testable without a database or a browser. Nothing here
 * writes, and nothing here re-derives a fee amount or a balance: the amount is
 * the one the database stored, and a wallet is "verified" only when
 * `verified_at` is set.
 */

export type ApplicationStatus =
  | 'draft'
  | 'pre_approved'
  | 'submitted'
  | 'approved'
  | 'blocked';

export interface ReviewApplicant {
  readonly id: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly email: string | null;
}

export interface ReviewApplication {
  readonly id: string;
  readonly ref: string | null;
  readonly tier: string;
  readonly status: ApplicationStatus;
  readonly preapprovalUsdc: number | null;
  readonly serviceUsdc: number | null;
  readonly feeTx: string | null;
  readonly reviewUid: string | null;
  readonly serviceUid: string | null;
}

export interface ReviewWallet {
  readonly address: string;
  readonly chain: number;
  readonly provider: string | null;
  readonly verifiedAt: string | null;
}

export interface ReviewIdentity {
  readonly nationality: string | null;
  readonly over18: boolean | null;
  readonly notSanctioned: boolean | null;
  readonly expiresAt: string | null;
  readonly attestationUid: string | null;
}

export interface ReviewResidence {
  readonly countryCode: string;
  readonly fromYear: number;
  readonly toYear: number | null;
}

export interface ReviewEvent {
  readonly action: ReviewAction;
  readonly note: string | null;
  readonly attestationUid: string | null;
  readonly createdAt: string;
}

export interface ReviewQueueItem {
  readonly application: ReviewApplication;
  readonly applicant: ReviewApplicant;
  readonly wallets: readonly ReviewWallet[];
  readonly identity: ReviewIdentity | null;
  readonly residences: readonly ReviewResidence[];
  readonly citizenships: readonly string[];
  readonly latestReview: ReviewEvent | null;
}

export function applicantName(applicant: ReviewApplicant): string {
  const name = [applicant.firstName, applicant.lastName]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' ');
  return name || applicant.email || applicant.id;
}

/**
 * The fee state, from what is stored.
 *
 * `fee_tx` is a claim (20260921000003), so this reports it as recorded, never as
 * verified: the receipt is re-read by the resident's own server path, not here.
 * A missing `preapproval_usdc` is reported as unknown rather than defaulted.
 */
export type FeeState =
  | { readonly kind: 'recorded'; readonly amountUsdc: number | null; readonly txHash: string }
  | { readonly kind: 'none'; readonly amountUsdc: number | null };

export function feeState(application: ReviewApplication): FeeState {
  if (application.feeTx) {
    return {
      kind: 'recorded',
      amountUsdc: application.preapprovalUsdc,
      txHash: application.feeTx,
    };
  }
  return { kind: 'none', amountUsdc: application.preapprovalUsdc };
}

export interface WealthState {
  readonly total: number;
  /** Rows with `verified_at` set — the only rows an ownership proof produced. */
  readonly verified: number;
  /**
   * Connected, unverified rows (`verified_at` NULL, provider
   * `connected-wallet`, week-2 contract v1.2). A connection is not a signature:
   * these are never counted as verified wealth.
   */
  readonly connected: number;
  /**
   * Pasted, watch-only rows: proof of wealth for Step 3, never a holding. This
   * is the residual — every row that is neither verified nor connected.
   */
  readonly pasted: number;
}

/**
 * The three-way class of one stored wallet row, exactly.
 *
 * `verified_at` remains the only verified marker; a connected wallet is
 * classified by its distinct provider and is never VERIFIED.
 */
export type WalletClass = 'verified' | 'connected' | 'pasted';

export function walletClass(wallet: ReviewWallet): WalletClass {
  if (wallet.verifiedAt !== null) return 'verified';
  if (wallet.provider === CONNECTED_WALLET_PROVIDER) return 'connected';
  return 'pasted';
}

export function wealthState(wallets: readonly ReviewWallet[]): WealthState {
  let verified = 0;
  let connected = 0;
  for (const wallet of wallets) {
    const kind = walletClass(wallet);
    if (kind === 'verified') verified += 1;
    else if (kind === 'connected') connected += 1;
  }
  return {
    total: wallets.length,
    verified,
    connected,
    pasted: wallets.length - verified - connected,
  };
}

export interface ResidencyState {
  readonly identityVerified: boolean;
  readonly over18: boolean | null;
  readonly notSanctioned: boolean | null;
  readonly residences: number;
  readonly citizenships: number;
  /** The four checks D16 names: identity, funds, review, service fee. */
  readonly checks: readonly { readonly label: string; readonly met: boolean }[];
}

export function residencyState(item: ReviewQueueItem): ResidencyState {
  const identityVerified =
    item.identity !== null && item.identity.attestationUid !== null;
  const identity = item.identity;
  return {
    identityVerified,
    over18: identity?.over18 ?? null,
    notSanctioned: identity?.notSanctioned ?? null,
    residences: item.residences.length,
    citizenships: item.citizenships.length,
    checks: [
      { label: 'Identity', met: identityVerified },
      {
        label: 'Funds',
        met: item.application.preapprovalUsdc !== null,
      },
      {
        label: 'Review',
        met: item.application.status === 'approved',
      },
      {
        label: 'Service fee',
        met: item.application.serviceUid !== null,
      },
    ],
  };
}

/** The actions a reviewer may take for the current status. */
export function availableActions(status: ApplicationStatus): readonly ReviewAction[] {
  switch (status) {
    case 'approved':
      return ['block', 'reopen'];
    case 'blocked':
      return ['reopen', 'approve'];
    case 'draft':
    case 'pre_approved':
    case 'submitted':
    default:
      return ['approve', 'block'];
  }
}
