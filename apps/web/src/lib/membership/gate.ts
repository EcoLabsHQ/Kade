/**
 * The membership-issuance approval gate.
 *
 * Mirroring `@/lib/residency/kyc-attestation` (and the EAS registration gate),
 * membership changes are irreversible: minting a soulbound credential, promoting
 * a Resident to Citizen, or burning a credential cannot be undone without
 * another owner transaction. The repository therefore refuses to prepare a
 * *sendable* plan unless an explicit approval is recorded and names an approver
 * and a timestamp.
 *
 * There is no send path in this module — it prepares and verifies, never
 * broadcasts — so the gate is recorded for the future owner-Safe execution step
 * and reported honestly in every plan.
 */

export interface MembershipIssuanceGate {
  readonly onchainGateApproved: boolean;
  readonly approvedBy: string;
  readonly approvedAt: string;
}

export const MEMBERSHIP_APPROVAL_ENV = {
  approved: 'KADE_MEMBERSHIP_ISSUANCE_APPROVED',
  by: 'KADE_MEMBERSHIP_ISSUANCE_APPROVED_BY',
  at: 'KADE_MEMBERSHIP_ISSUANCE_APPROVED_AT',
} as const;

/** Read the issuance gate from the server environment, if recorded. */
export function readMembershipIssuanceGate(
  env: Readonly<Record<string, string | undefined>> = process.env,
): MembershipIssuanceGate | null {
  const approved = env[MEMBERSHIP_APPROVAL_ENV.approved]?.trim();
  if (!approved) return null;
  return {
    onchainGateApproved: approved === 'true',
    approvedBy: env[MEMBERSHIP_APPROVAL_ENV.by]?.trim() ?? '',
    approvedAt: env[MEMBERSHIP_APPROVAL_ENV.at]?.trim() ?? '',
  };
}

export function assertMembershipIssuanceApproved(gate: MembershipIssuanceGate): void {
  if (!gate.onchainGateApproved) {
    throw new Error(
      'Colosseum membership issuance blocked: the membership gate has not been ' +
        'approved. Issuance is irreversible.',
    );
  }
  if (!gate.approvedBy || !gate.approvedAt) {
    throw new Error(
      'Colosseum membership issuance blocked: approval must record who approved ' +
        'it and when.',
    );
  }
}
