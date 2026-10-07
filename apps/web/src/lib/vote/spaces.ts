import type { VoteSpace, VoteSpaceConfig, VoteCredential } from './types';

/**
 * The two real Snapshot spaces, verified read-only against the Snapshot hub.
 *
 *   - `kadeglobal.eth` — "Curaçao Residents", network 42161. The **Residents**
 *     space. A proposal here is open to both: a Resident votes with the Resident
 *     collection and a Citizen with the Citizen collection.
 *   - `cwcitizen.eth` — "Curaçao Citizens", network 42161. The **Citizens**
 *     space. A proposal here requires the Citizen collection; a Resident is
 *     refused with the exact text "Colosseum Citizens only".
 *
 * The mapping from space to credential is **configuration**, not a hard-coded
 * title check: `VOTE_SPACE_CONFIGS` is the single place that says which
 * credential(s) a space's voting power is read from. Space creation and the
 * strategy configuration on Snapshot are a human gate; nothing in this
 * repository creates or mutates a Snapshot space.
 */
export const RESIDENT_SPACE_ID = 'kadeglobal.eth' as const;
export const CITIZEN_SPACE_ID = 'cwcitizen.eth' as const;

/** Both Colosseum collections live on Arbitrum One. */
export const VOTE_CHAIN_ID = 42161 as const;

/** The Resident soulbound collection. */
export const RESIDENT_CREDENTIAL: VoteCredential = {
  address: '0x068B747E70750f18C8e6E07a3fbd7Dd35D7FE0b3',
  symbol: 'Resident',
};

/** The Citizen soulbound collection. */
export const CITIZEN_CREDENTIAL: VoteCredential = {
  address: '0x36914467AF7EB4862A08da2F26B59b651EeD31BF',
  symbol: 'Citizen',
};

export const VOTE_SPACE_CONFIGS: readonly VoteSpaceConfig[] = [
  {
    id: RESIDENT_SPACE_ID,
    name: 'Curaçao Residents',
    category: 'resident',
    created: true,
    chainId: VOTE_CHAIN_ID,
    // Open to both: a Citizen always has a path, and a Resident votes with the
    // Resident collection. Power is the sum across the listed credentials.
    credentials: [RESIDENT_CREDENTIAL, CITIZEN_CREDENTIAL],
  },
  {
    id: CITIZEN_SPACE_ID,
    name: 'Curaçao Citizens',
    category: 'citizen',
    created: true,
    chainId: VOTE_CHAIN_ID,
    credentials: [CITIZEN_CREDENTIAL],
  },
];

/** The spaces as the screen sees them, without the chain/credential detail. */
export const VOTE_SPACES: readonly VoteSpace[] = VOTE_SPACE_CONFIGS.map(
  ({ id, name, category, created }) => ({ id, name, category, created }),
);

/** The configured space for an id, or null when the id is unknown. */
export function spaceById(spaceId: string): VoteSpace | null {
  return VOTE_SPACES.find((space) => space.id === spaceId) ?? null;
}

/** The full configuration for an id, or null when the id is unknown. */
export function voteSpaceConfigById(spaceId: string): VoteSpaceConfig | null {
  return VOTE_SPACE_CONFIGS.find((space) => space.id === spaceId) ?? null;
}

/** The configured space for a category, or null when none is configured. */
export function spaceForCategory(category: VoteSpace['category']): VoteSpace | null {
  return VOTE_SPACES.find((space) => space.category === category) ?? null;
}
