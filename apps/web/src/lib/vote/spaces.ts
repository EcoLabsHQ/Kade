import type { VoteSpace } from './types';

/**
 * The two Snapshot spaces from the programme spec: one for Colosseum Residents
 * and one for Colosseum Citizens.
 *
 * **These spaces are not created yet.** `created: false` records that fact
 * rather than a placeholder id pretending to be live. The ids are the
 * configuration the programme will create when the membership contracts are
 * deployed and the spaces are set up; until then the mock adapter answers from
 * here and marks every read `mock`.
 *
 * Space creation is irreversible and is a human gate, exactly like schema
 * registration and membership issuance. Nothing in this repository creates or
 * mutates a Snapshot space.
 */
export const RESIDENT_SPACE_ID = 'onchainisland.eth' as const;
export const CITIZEN_SPACE_ID = 'onchainisland-citizens.eth' as const;

export const VOTE_SPACES: readonly VoteSpace[] = [
  {
    id: RESIDENT_SPACE_ID,
    name: 'Colosseum Residents',
    category: 'resident',
    created: false,
  },
  {
    id: CITIZEN_SPACE_ID,
    name: 'Colosseum Citizens',
    category: 'citizen',
    created: false,
  },
];

/** The configured space for an id, or null when the id is unknown. */
export function spaceById(spaceId: string): VoteSpace | null {
  return VOTE_SPACES.find((space) => space.id === spaceId) ?? null;
}

/** The configured space for a category, or null when none is configured. */
export function spaceForCategory(category: VoteSpace['category']): VoteSpace | null {
  return VOTE_SPACES.find((space) => space.category === category) ?? null;
}
