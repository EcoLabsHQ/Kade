import { describe, expect, it, vi } from 'vitest';
import {
  createRealSnapshotAdapter,
  type SnapshotAdapter,
  type VoteChainReader,
} from '@/lib/vote/adapter';
import { createSnapshotHubClient } from '@/lib/vote/hub';
import { evaluateVoteEligibility } from '@/lib/vote/eligibility';
import {
  CITIZEN_CREDENTIAL,
  CITIZEN_SPACE_ID,
  RESIDENT_CREDENTIAL,
  RESIDENT_SPACE_ID,
} from '@/lib/vote/spaces';
import type { VoteProposal, VotingPowerRead } from '@/lib/vote/types';

/**
 * The real Snapshot adapter.
 *
 * The hub response and the chain read are both injected, so these tests never
 * dial the network. They prove that a hub payload is parsed into the expected
 * proposals, that voting power is the configured credential's `balanceOf` at the
 * proposal's snapshot block, that the resident/citizen rules hold, and that an
 * unread chain state refuses rather than grants.
 */

const WALLET = '0x1111111111111111111111111111111111111111';

/** A hub response shaped exactly like the real hub's (trimmed to the fields read). */
const HUB_RESPONSE = {
  data: {
    proposals: [
      {
        id: '0xcitizen',
        title: 'Citizen: Add February 2nd to official holiday',
        state: 'active',
        start: 1791383124,
        end: 1791815124,
        snapshot: 512590783,
        choices: ['For', 'Against', 'Abstain'],
        space: { id: CITIZEN_SPACE_ID, name: 'Curaçao Citizens' },
      },
      {
        id: '0xresident',
        title: 'Resident: Add February 2nd to official holiday',
        state: 'active',
        start: 1791382034,
        end: 1791814034,
        snapshot: 512586595,
        choices: ['For', 'Against', 'Abstain'],
        space: { id: RESIDENT_SPACE_ID, name: 'Curaçao Residents' },
      },
      {
        id: '0xclosed',
        title: 'Test',
        state: 'closed',
        start: 1791336033,
        end: 1791336333,
        snapshot: 512415532,
        choices: ['For', 'Against', 'Abstain'],
        space: { id: RESIDENT_SPACE_ID, name: 'Curaçao Residents' },
      },
    ],
  },
};

function fakeFetch(body: unknown, ok = true, status = 200): typeof fetch {
  return vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

function adapterWith(chain: VoteChainReader, fetchImpl = fakeFetch(HUB_RESPONSE)): SnapshotAdapter {
  return createRealSnapshotAdapter({
    hub: createSnapshotHubClient({ fetch: fetchImpl }),
    chain,
  });
}

/** A chain reader that grants `holder` only its own credential. */
function chainFor(holder: 'resident' | 'citizen'): VoteChainReader {
  return {
    async readBalanceOf({ collection }) {
      if (holder === 'resident') {
        return collection === RESIDENT_CREDENTIAL.address ? 1n : 0n;
      }
      return collection === CITIZEN_CREDENTIAL.address ? 1n : 0n;
    },
  };
}

const RESIDENT_PROPOSAL: VoteProposal = {
  spaceId: RESIDENT_SPACE_ID,
  proposalId: '0xresident',
  title: 'Resident: Add February 2nd to official holiday',
  category: 'resident',
  state: 'open',
  snapshotBlock: 512586595,
  start: 1791382034,
  end: 1791814034,
  choices: [],
  provenance: 'snapshot',
};

const CITIZEN_PROPOSAL: VoteProposal = {
  ...RESIDENT_PROPOSAL,
  spaceId: CITIZEN_SPACE_ID,
  proposalId: '0xcitizen',
  category: 'citizen',
  snapshotBlock: 512590783,
  title: 'Citizen: Add February 2nd to official holiday',
};

describe('real Snapshot adapter — hub parsing', () => {
  it('parses a hub payload into the expected proposals', async () => {
    const adapter = adapterWith(chainFor('resident'));

    const resident = await adapter.listProposals(RESIDENT_SPACE_ID);
    expect(resident.map((proposal) => proposal.proposalId)).toEqual([
      '0xresident',
      '0xclosed',
    ]);
    expect(resident[0]).toEqual({
      spaceId: RESIDENT_SPACE_ID,
      proposalId: '0xresident',
      title: 'Resident: Add February 2nd to official holiday',
      category: 'resident',
      state: 'open',
      snapshotBlock: 512586595,
      start: 1791382034,
      end: 1791814034,
      choices: [
        { id: '0', label: 'For' },
        { id: '1', label: 'Against' },
        { id: '2', label: 'Abstain' },
      ],
      provenance: 'snapshot',
    });
    // A non-active proposal is closed here.
    expect(resident[1]?.state).toBe('closed');

    const citizen = await adapter.listProposals(CITIZEN_SPACE_ID);
    expect(citizen).toHaveLength(1);
    expect(citizen[0]).toMatchObject({
      spaceId: CITIZEN_SPACE_ID,
      proposalId: '0xcitizen',
      category: 'citizen',
      state: 'open',
      provenance: 'snapshot',
    });
  });

  it('reports the real spaces as created configuration', async () => {
    const adapter = adapterWith(chainFor('resident'));
    expect(adapter.mocked).toBe(false);
    expect(await adapter.getSpace(RESIDENT_SPACE_ID)).toMatchObject({
      id: RESIDENT_SPACE_ID,
      category: 'resident',
      created: true,
    });
    expect(await adapter.getSpace(CITIZEN_SPACE_ID)).toMatchObject({
      id: CITIZEN_SPACE_ID,
      category: 'citizen',
      created: true,
    });
    expect(await adapter.getSpace('unknown.eth')).toBeNull();
  });

  it('fails closed on a hub error response', async () => {
    const adapter = adapterWith(
      chainFor('resident'),
      fakeFetch({ errors: [{ message: 'rate limited' }] }),
    );
    await expect(adapter.listProposals(RESIDENT_SPACE_ID)).rejects.toThrow(
      /rate limited/,
    );
  });
});

describe('real Snapshot adapter — voting power', () => {
  it('reads the configured credentials at the proposal snapshot block', async () => {
    const calls: Array<{ collection: string; account: string; blockNumber: number }> = [];
    const chain: VoteChainReader = {
      async readBalanceOf(input) {
        calls.push(input);
        return input.collection === RESIDENT_CREDENTIAL.address ? 2n : 0n;
      },
    };
    const adapter = adapterWith(chain);

    const read = await adapter.readVotingPower({
      spaceId: RESIDENT_SPACE_ID,
      proposalId: '0xresident',
      wallet: WALLET,
      blockNumber: 512586595,
    });

    expect(read).toEqual({
      status: 'known',
      power: 2n,
      blockNumber: 512586595,
      provenance: 'snapshot',
    });
    // The Residents space is open to both credentials, both read at the block.
    expect(calls.map((call) => call.collection)).toEqual([
      RESIDENT_CREDENTIAL.address,
      CITIZEN_CREDENTIAL.address,
    ]);
    expect(calls.every((call) => call.blockNumber === 512586595)).toBe(true);
    expect(calls.every((call) => call.account === WALLET)).toBe(true);
  });

  it('returns an error — never zero — when the chain read fails', async () => {
    const chain: VoteChainReader = {
      async readBalanceOf() {
        throw new Error('RPC unavailable');
      },
    };
    const adapter = adapterWith(chain);

    const read = await adapter.readVotingPower({
      spaceId: RESIDENT_SPACE_ID,
      proposalId: '0xresident',
      wallet: WALLET,
      blockNumber: 512586595,
    });

    expect(read.status).toBe('error');
    const eligibility = evaluateVoteEligibility({
      wallet: WALLET,
      membership: 'resident',
      proposal: RESIDENT_PROPOSAL,
      power: read,
    });
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reason).toBe('power-unread');
  });
});

describe('real Snapshot adapter — resident and citizen rules', () => {
  it('lets a Resident vote a Residents proposal', async () => {
    const adapter = adapterWith(chainFor('resident'));
    const power = await adapter.readVotingPower({
      spaceId: RESIDENT_SPACE_ID,
      proposalId: '0xresident',
      wallet: WALLET,
      blockNumber: RESIDENT_PROPOSAL.snapshotBlock,
    });
    const eligibility = evaluateVoteEligibility({
      wallet: WALLET,
      membership: 'resident',
      proposal: RESIDENT_PROPOSAL,
      power,
    });
    expect(eligibility.eligible).toBe(true);
  });

  it('greys a Citizens proposal for a Resident with the exact text', async () => {
    const adapter = adapterWith(chainFor('resident'));
    // Even with a power read available, the category rule refuses first.
    const power = await adapter.readVotingPower({
      spaceId: CITIZEN_SPACE_ID,
      proposalId: '0xcitizen',
      wallet: WALLET,
      blockNumber: CITIZEN_PROPOSAL.snapshotBlock,
    });
    const eligibility = evaluateVoteEligibility({
      wallet: WALLET,
      membership: 'resident',
      proposal: CITIZEN_PROPOSAL,
      power,
    });
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reason).toBe('citizen-only');
    expect(eligibility.message).toBe('Colosseum Citizens only');
  });

  it('lets a Citizen vote both', async () => {
    const adapter = adapterWith(chainFor('citizen'));
    const residentPower: VotingPowerRead = await adapter.readVotingPower({
      spaceId: RESIDENT_SPACE_ID,
      proposalId: '0xresident',
      wallet: WALLET,
      blockNumber: RESIDENT_PROPOSAL.snapshotBlock,
    });
    const citizenPower: VotingPowerRead = await adapter.readVotingPower({
      spaceId: CITIZEN_SPACE_ID,
      proposalId: '0xcitizen',
      wallet: WALLET,
      blockNumber: CITIZEN_PROPOSAL.snapshotBlock,
    });

    expect(
      evaluateVoteEligibility({
        wallet: WALLET,
        membership: 'citizen',
        proposal: RESIDENT_PROPOSAL,
        power: residentPower,
      }).eligible,
    ).toBe(true);
    expect(
      evaluateVoteEligibility({
        wallet: WALLET,
        membership: 'citizen',
        proposal: CITIZEN_PROPOSAL,
        power: citizenPower,
      }).eligible,
    ).toBe(true);
  });
});
