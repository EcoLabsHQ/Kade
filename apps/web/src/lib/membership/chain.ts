import { getAddress, type Address } from 'viem';
import {
  MEMBERSHIP_MANAGER_ABI,
  membershipFromOrdinal,
  type Membership,
} from './abi';

/**
 * Read a membership from the manager.
 *
 * The result distinguishes a **known** membership from an **unread** one. This
 * matters: the spec requires that before a retry the app consults `membershipOf`
 * to avoid a duplicate issuance, and an unreadable chain state must never be
 * collapsed into "no membership" — that would let a retry re-issue.
 */

export type MembershipRead =
  | { readonly status: 'known'; readonly membership: Membership }
  | { readonly status: 'unread'; readonly reason: string };

/** The minimal client surface this read needs. */
export interface MembershipReadClient {
  readContract(args: {
    readonly address: Address;
    readonly abi: readonly unknown[];
    readonly functionName: string;
    readonly args: readonly unknown[];
  }): Promise<unknown>;
}

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export async function readMembership(input: {
  readonly publicClient: MembershipReadClient;
  readonly managerAddress: string;
  readonly account: string;
}): Promise<MembershipRead> {
  if (!ADDRESS_PATTERN.test(input.managerAddress)) {
    return {
      status: 'unread',
      reason: `The manager address "${input.managerAddress}" is not a 20-byte hex address.`,
    };
  }
  if (!ADDRESS_PATTERN.test(input.account)) {
    return {
      status: 'unread',
      reason: `The account "${input.account}" is not a 20-byte hex address.`,
    };
  }

  try {
    const raw = await input.publicClient.readContract({
      address: getAddress(input.managerAddress),
      abi: MEMBERSHIP_MANAGER_ABI,
      functionName: 'membershipOf',
      args: [getAddress(input.account)],
    });
    if (typeof raw !== 'number' && typeof raw !== 'bigint') {
      return {
        status: 'unread',
        reason: 'membershipOf returned a value that is not an enum ordinal.',
      };
    }
    const membership = membershipFromOrdinal(raw);
    if (membership === null) {
      return {
        status: 'unread',
        reason: `membershipOf returned an unknown ordinal ${String(raw)}.`,
      };
    }
    return { status: 'known', membership };
  } catch (cause) {
    return {
      status: 'unread',
      reason:
        'membershipOf could not be read: ' +
        (cause instanceof Error ? cause.message : String(cause)),
    };
  }
}
