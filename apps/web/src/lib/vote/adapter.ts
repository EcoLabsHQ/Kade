import {
  CITIZEN_SPACE_ID,
  RESIDENT_SPACE_ID,
  spaceById,
} from './spaces';
import type { VoteProposal, VoteSpace, VotingPowerRead } from './types';

/**
 * The Snapshot adapter boundary.
 *
 * The Vote screen depends on this interface, never on the mock directly, so the
 * real Snapshot client can replace {@link mockSnapshotAdapter} without touching
 * the screen or its eligibility logic.
 *
 * `mocked` is part of the interface on purpose: a caller can tell a mocked
 * source from a real one, and the mock is honest about which it is. A mock must
 * never present invented data as a real chain read.
 */
export interface SnapshotAdapter {
  /** True when this adapter invents its data instead of reading Snapshot. */
  readonly mocked: boolean;
  getSpace(spaceId: string): Promise<VoteSpace | null>;
  listProposals(spaceId: string): Promise<readonly VoteProposal[]>;
  readVotingPower(input: {
    readonly spaceId: string;
    readonly proposalId: string;
    readonly wallet: string;
    readonly blockNumber: number;
  }): Promise<VotingPowerRead>;
}

/**
 * The reference's resident consultation, kept as the mock's proposal so the
 * existing screen content is unchanged. `provenance: 'mock'` and
 * `snapshotBlock: 0` record that it is not a real Snapshot proposal.
 */
const MOCK_RESIDENT_PROPOSAL: VoteProposal = {
  spaceId: RESIDENT_SPACE_ID,
  proposalId: 'mock-resident-consultation',
  title: 'Programme consultation',
  category: 'resident',
  state: 'open',
  snapshotBlock: 0,
  choices: [
    { id: 'housing', label: 'Housing supply — co-finance 120 affordable units' },
    { id: 'sme', label: 'SME credit — first-loss capital for local lenders' },
    { id: 'split', label: 'Split 50 / 50' },
  ],
  provenance: 'mock',
};

/** A mock Citizen consultation so the citizen-only rule can be exercised. */
const MOCK_CITIZEN_PROPOSAL: VoteProposal = {
  spaceId: CITIZEN_SPACE_ID,
  proposalId: 'mock-citizen-consultation',
  title: 'Citizen assembly consultation',
  category: 'citizen',
  state: 'open',
  snapshotBlock: 0,
  choices: [
    { id: 'for', label: 'Approve' },
    { id: 'against', label: 'Reject' },
  ],
  provenance: 'mock',
};

const MOCK_PROPOSALS: readonly VoteProposal[] = [
  MOCK_RESIDENT_PROPOSAL,
  MOCK_CITIZEN_PROPOSAL,
];

/**
 * The mocked adapter.
 *
 * It is **honest about being mocked**: every proposal carries
 * `provenance: 'mock'`, the spaces report `created: false`, and a voting-power
 * read is returned with `provenance: 'mock'` rather than as a chain read. It
 * invents no real address, block or tally. The screen's eligibility logic runs
 * as real code over this mocked source, exactly as it will over the real one.
 */
export const mockSnapshotAdapter: SnapshotAdapter = {
  mocked: true,

  async getSpace(spaceId) {
    return spaceById(spaceId);
  },

  async listProposals(spaceId) {
    return MOCK_PROPOSALS.filter((proposal) => proposal.spaceId === spaceId);
  },

  async readVotingPower({ blockNumber }) {
    // The mock cannot read a chain, so it does not pretend to: the value is
    // labelled `mock`. A `known` read is what lets the screen's eligibility code
    // be exercised; the honesty is the provenance, not a fabricated chain block.
    return {
      status: 'known',
      power: 1n,
      blockNumber,
      provenance: 'mock',
    } satisfies VotingPowerRead;
  },
};
