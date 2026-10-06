import { encodeFunctionData, getAddress, type Address, type Hex } from 'viem';
import type { SafeCall } from '@/lib/safe/execute-safe-4337';
import {
  MEMBERSHIP_MANAGER_ABI,
  membershipFromOrdinal,
  type Membership,
} from './abi';

/**
 * Build the exact manager call for a membership transition.
 *
 * The call is produced in the repository's established "prepare and verify,
 * never send" shape: a {@link SafeCall} (`{ to, value, data }`), the same shape
 * the resident-Safe engine (`@/lib/safe/execute-safe-4337`) consumes. Nothing
 * here signs or broadcasts; the returned plan is always `sent: false`.
 *
 * The manager is `Ownable2Step` and the Safe is its owner, so the call must be
 * executed **by the Safe** (Safe{Wallet} or the owner's execution path). This
 * module does not own that path; it produces the reviewable calldata for it.
 */

export const MEMBERSHIP_OPERATIONS = [
  'issue-resident',
  'promote-to-citizen',
  'revoke',
] as const;

export type MembershipOperation = (typeof MEMBERSHIP_OPERATIONS)[number];

/** The manager function each operation calls. */
export const OPERATION_FUNCTION = {
  'issue-resident': 'issueResident',
  'promote-to-citizen': 'promoteToCitizen',
  revoke: 'revokeMembership',
} as const satisfies Record<MembershipOperation, string>;

export interface MembershipTransitionPlan {
  readonly chainId: number;
  readonly managerAddress: Address;
  readonly account: Address;
  readonly operation: MembershipOperation;
  /**
   * The membership read before the operation, when known. `null` means the read
   * did not happen or could not be trusted — it is **not** "None".
   */
  readonly membershipBefore: Membership | null;
  /** The calls to execute, in order (one call per transition). */
  readonly calls: readonly SafeCall[];
  /** The exact calldata of the single call, for review. */
  readonly calldata: Hex;
  /** Always false: this module prepares and never sends. */
  readonly sent: false;
}

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

function assertAddress(value: string, field: string): Address {
  if (typeof value !== 'string' || !ADDRESS_PATTERN.test(value)) {
    throw new Error(`${field} must be a 20-byte hex address, got "${String(value)}".`);
  }
  return getAddress(value);
}

/** Encode one manager call for `operation` against `account`. */
export function encodeMembershipCall(
  operation: MembershipOperation,
  account: Address,
): Hex {
  return encodeFunctionData({
    abi: MEMBERSHIP_MANAGER_ABI,
    functionName: OPERATION_FUNCTION[operation],
    args: [account],
  });
}

/** Build the single {@link SafeCall} for a transition. */
export function buildMembershipCall(input: {
  readonly managerAddress: string;
  readonly account: string;
  readonly operation: MembershipOperation;
}): SafeCall {
  const managerAddress = assertAddress(input.managerAddress, 'managerAddress');
  const account = assertAddress(input.account, 'account');
  return {
    to: managerAddress,
    value: 0n,
    data: encodeMembershipCall(input.operation, account),
  };
}

/**
 * Build the complete, reviewable transition plan.
 *
 * Fails closed on a malformed address, an unknown operation or a non-positive
 * chain id. It never produces a plan with `sent: true`.
 */
export function buildMembershipTransitionPlan(input: {
  readonly chainId: number;
  readonly managerAddress: string;
  readonly account: string;
  readonly operation: MembershipOperation;
  readonly membershipBefore?: Membership | null;
}): MembershipTransitionPlan {
  if (!Number.isInteger(input.chainId) || input.chainId <= 0) {
    throw new Error(`chainId must be a positive integer, got "${input.chainId}".`);
  }
  if (!MEMBERSHIP_OPERATIONS.includes(input.operation)) {
    throw new Error(`Unknown membership operation "${input.operation}".`);
  }
  const managerAddress = assertAddress(input.managerAddress, 'managerAddress');
  const account = assertAddress(input.account, 'account');
  const call = buildMembershipCall({
    managerAddress,
    account,
    operation: input.operation,
  });
  return {
    chainId: input.chainId,
    managerAddress,
    account,
    operation: input.operation,
    membershipBefore: input.membershipBefore ?? null,
    calls: [call],
    calldata: call.data,
    sent: false,
  };
}

/**
 * The operation that reaches `target` from `current`, or a reason it is invalid.
 *
 * The manager's state machine is:
 *   None --issueResident--> Resident --promoteToCitizen--> Citizen
 *   Resident|Citizen --revokeMembership--> None
 * An unknown current membership cannot be turned into an operation: the caller
 * must read the chain first, so a retry cannot duplicate an issuance.
 */
export function operationForTransition(
  current: Membership,
  target: Membership,
):
  | { readonly operation: MembershipOperation }
  | { readonly reason: string } {
  if (current === target) {
    return { reason: `The account is already ${target}; there is nothing to prepare.` };
  }
  if (target === 'resident' && current === 'none') {
    return { operation: 'issue-resident' };
  }
  if (target === 'citizen' && current === 'resident') {
    return { operation: 'promote-to-citizen' };
  }
  if (target === 'none' && (current === 'resident' || current === 'citizen')) {
    return { operation: 'revoke' };
  }
  return {
    reason: `The manager has no transition from ${current} to ${target}.`,
  };
}

/** Re-exported so callers can decode a stored ordinal without a second import. */
export { membershipFromOrdinal };
