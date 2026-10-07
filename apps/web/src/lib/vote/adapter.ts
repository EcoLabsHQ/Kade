import { RESIDENT_SPACE_ID, CITIZEN_SPACE_ID, spaceById, voteSpaceConfigById } from './spaces';
import type { SnapshotHubClient, HubProposal } from './hub';
import type {
  VoteProposal,
  VoteSpace,
  VoteSpaceConfig,
  VotingPowerRead,
} from './types';

/**
 * The Snapshot adapter boundary.
 *
 * The Vote screen depends on this interface, never on a source directly, so the
 * real Snapshot client and the mock can swap without touching the screen or its
 * eligibility logic.
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
 * The read-only chain surface the real adapter needs: `balanceOf(account)` for
 * a credential collection at a specific block.
 *
 * It is deliberately minimal and injected, so a test can supply a fake chain
 * read and the adapter never dials the network itself.
 */
export interface VoteChainReader {
  readBalanceOf(input: {
    readonly collection: `0x${string}`;
    readonly account: `0x${string}`;
    readonly blockNumber: number;
  }): Promise<bigint>;
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
 * `provenance: 'mock'`, a voting-power read is returned with `provenance:
 * 'mock'` rather than as a chain read, and it invents no real address, block or
 * tally. The screen's eligibility logic runs as real code over this mocked
 * source, exactly as it does over the real one. The two spaces now report
 * `created: true` because they exist; the mock's data is still invented.
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

/** The real adapter's injected dependencies. */
export interface RealSnapshotAdapterDeps {
  readonly hub: SnapshotHubClient;
  readonly chain: VoteChainReader;
}

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Map a hub proposal onto the Vote primitives using the space's committed
 * configuration.
 *
 * The category comes from the **space config**, never from the title: a
 * `cwcitizen.eth` proposal is a Citizen proposal and a `kadeglobal.eth` one is a
 * Resident-space proposal, whatever it is called.
 */
function toVoteProposal(proposal: HubProposal, config: VoteSpaceConfig): VoteProposal {
  return {
    spaceId: config.id,
    proposalId: proposal.id,
    title: proposal.title,
    category: config.category,
    // Only `active` is votable; `pending` and `closed` are both closed here.
    state: proposal.state === 'active' ? 'open' : 'closed',
    snapshotBlock: proposal.snapshot,
    start: proposal.start,
    end: proposal.end,
    choices: proposal.choices.map((label, index) => ({ id: String(index), label })),
    provenance: 'snapshot',
  };
}

/**
 * The real Snapshot adapter.
 *
 * It reads proposals from the hub and voting power from the chain through the
 * injected clients. Power is `balanceOf(wallet)` of each configured credential
 * at the proposal's `snapshotBlock`, summed across them (a space open to both
 * residents and citizens lists both). A read that fails is returned as an
 * `error` — never as zero and never as eligibility — so an unread chain state
 * refuses rather than grants.
 */
export function createRealSnapshotAdapter(
  deps: RealSnapshotAdapterDeps,
): SnapshotAdapter {
  return {
    mocked: false,

    async getSpace(spaceId) {
      const config = voteSpaceConfigById(spaceId);
      if (config === null) return null;
      return {
        id: config.id,
        name: config.name,
        category: config.category,
        created: config.created,
      };
    },

    async listProposals(spaceId) {
      const config = voteSpaceConfigById(spaceId);
      if (config === null) return [];
      const proposals = await deps.hub.fetchProposals([spaceId]);
      return proposals
        .filter((proposal) => proposal.space.id === config.id)
        .map((proposal) => toVoteProposal(proposal, config));
    },

    async readVotingPower({ spaceId, wallet, blockNumber }) {
      const config = voteSpaceConfigById(spaceId);
      if (config === null) {
        return { status: 'error', reason: `The space "${spaceId}" is not configured.` };
      }
      if (!ADDRESS_PATTERN.test(wallet)) {
        return {
          status: 'error',
          reason: `The wallet "${wallet}" is not a 20-byte hex address.`,
        };
      }
      let power = 0n;
      try {
        for (const credential of config.credentials) {
          power += await deps.chain.readBalanceOf({
            collection: credential.address,
            account: wallet as `0x${string}`,
            blockNumber,
          });
        }
      } catch (cause) {
        // A failed read is not "no power": it is an error, and eligibility is
        // never assumed from it.
        return {
          status: 'error',
          reason: `Voting power could not be read: ${describe(cause)}`,
        };
      }
      return { status: 'known', power, blockNumber, provenance: 'snapshot' };
    },
  };
}
