/**
 * The `MembershipManager` surface the app needs.
 *
 * Copied from `packages/contracts/src/MembershipManager.sol` (compiled and
 * Foundry-tested; not deployed). The manager is `Ownable2Step`, the Safe is the
 * owner, and every membership-changing function is `onlyOwner`. The manager is
 * the only account the two soulbound collections accept as a minter/burner.
 *
 * `Membership` is a Solidity enum, which encodes as `uint8`:
 *   0 = None, 1 = Resident, 2 = Citizen.
 */

/** The Solidity enum, as the app's string union. */
export const MEMBERSHIP_VALUES = ['none', 'resident', 'citizen'] as const;
export type Membership = (typeof MEMBERSHIP_VALUES)[number];

/** The enum ordinal the contract stores. */
export const MEMBERSHIP_ORDINAL: Readonly<Record<Membership, number>> = {
  none: 0,
  resident: 1,
  citizen: 2,
};

/** The ordinal → union mapping; an unknown ordinal returns null. */
export function membershipFromOrdinal(ordinal: number | bigint): Membership | null {
  const value = typeof ordinal === 'bigint' ? Number(ordinal) : ordinal;
  return MEMBERSHIP_VALUES[value] ?? null;
}

export const MEMBERSHIP_MANAGER_ABI = [
  {
    type: 'function',
    name: 'issueResident',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'promoteToCitizen',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'revokeMembership',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setCollections',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'resident_', type: 'address' },
      { name: 'citizen_', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'membershipOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'resident',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'citizen',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'event',
    name: 'MembershipChanged',
    inputs: [
      { name: 'account', type: 'address', indexed: true },
      { name: 'previous', type: 'uint8', indexed: false },
      { name: 'current', type: 'uint8', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'CollectionsSet',
    inputs: [
      { name: 'resident', type: 'address', indexed: true },
      { name: 'citizen', type: 'address', indexed: true },
    ],
  },
] as const;
