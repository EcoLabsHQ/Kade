import { describe, expect, it } from 'vitest';
import { getAddress, type Address, type Hex } from 'viem';
import type { SnapshotAdapter } from '@/lib/vote/adapter';
import { createVoteDuplicateGuard } from '@/lib/vote/duplicate-guard';
import type { SafeMessageSigner } from '@/lib/safe/owner-sign-message';
import { ownerSafeMessageSigner } from '@/lib/safe/owner-sign-message';
import type {
  SnapshotSequencerClient,
  SnapshotSequencerResult,
  SnapshotVoteEnvelope,
} from '@/lib/vote/sequencer';
import {
  castSnapshotVote,
  type SnapshotVoteDependencies,
} from '@/lib/vote/submit';
import { RESIDENT_SPACE_ID, VOTE_CHAIN_ID } from '@/lib/vote/spaces';
import type { VoteProposal, VotingPowerRead } from '@/lib/vote/types';

/**
 * The vote cast path.
 *
 * Every precondition is proven to refuse **without signing**: an inactive
 * proposal, an unsupported type, an out-of-range choice, a different network and
 * zero (or unreadable) power each stop before the signer is called. A duplicate
 * is not re-submitted; a sequencer error is surfaced honestly; and the signer
 * key never appears in the outcome.
 */

const VOTER = getAddress('0x1111111111111111111111111111111111111111') as Address;
const PROPOSAL_ID = '0xproposal';

const PROPOSAL: VoteProposal = {
  spaceId: RESIDENT_SPACE_ID,
  proposalId: PROPOSAL_ID,
  title: 'Resident: Add February 2nd to official holiday',
  category: 'resident',
  state: 'open',
  snapshotBlock: 100,
  type: 'basic',
  choices: [
    { id: '0', label: 'For' },
    { id: '1', label: 'Against' },
    { id: '2', label: 'Abstain' },
  ],
  provenance: 'snapshot',
};

const KNOWN_POWER: VotingPowerRead = {
  status: 'known',
  power: 1n,
  blockNumber: 100,
  provenance: 'snapshot',
};

function adapterWith(overrides: {
  proposal?: VoteProposal | null;
  power?: VotingPowerRead;
  listThrows?: boolean;
}): SnapshotAdapter {
  return {
    mocked: true,
    async getSpace() {
      return null;
    },
    async listProposals() {
      if (overrides.listThrows) throw new Error('hub down');
      if (overrides.proposal === null) return [];
      return [overrides.proposal ?? PROPOSAL];
    },
    async readVotingPower() {
      return overrides.power ?? KNOWN_POWER;
    },
  };
}

function signerWith(): {
  signer: SafeMessageSigner;
  calls: Array<{ chainId: number; message: unknown }>;
} {
  const calls: Array<{ chainId: number; message: unknown }> = [];
  const signer: SafeMessageSigner = async (input) => {
    calls.push(input);
    return {
      signature: `0x${'ab'.repeat(65)}` as Hex,
      messageHash: `0x${'cd'.repeat(32)}` as Hex,
      signer: VOTER,
    };
  };
  return { signer, calls };
}

function sequencerWith(result: SnapshotSequencerResult): {
  sequencer: SnapshotSequencerClient;
  envelopes: SnapshotVoteEnvelope[];
} {
  const envelopes: SnapshotVoteEnvelope[] = [];
  return {
    sequencer: {
      async submitVote(envelope) {
        envelopes.push(envelope);
        return result;
      },
    },
    envelopes,
  };
}

const ACCEPTED: SnapshotSequencerResult = { ok: true, id: '0x1', ipfsHash: 'QmHash' };

function baseDeps(overrides: Partial<SnapshotVoteDependencies> = {}): SnapshotVoteDependencies {
  return {
    adapter: adapterWith({}),
    chainId: VOTE_CHAIN_ID,
    safeAddress: VOTER,
    membership: 'resident',
    signer: signerWith().signer,
    sequencer: sequencerWith(ACCEPTED).sequencer,
    duplicateGuard: createVoteDuplicateGuard(),
    now: () => 1_791_382_034_000,
    ...overrides,
  };
}

describe('castSnapshotVote — the real path', () => {  it('signs and submits the canonical Vote typed data for the selected choice', async () => {
    const { signer, calls } = signerWith();
    const { sequencer, envelopes } = sequencerWith(ACCEPTED);
    const deps = baseDeps({ signer, sequencer });

    const outcome = await castSnapshotVote(
      { spaceId: RESIDENT_SPACE_ID, proposalId: PROPOSAL_ID, choice: 1 },
      deps,
    );

    expect(outcome).toEqual({
      status: 'submitted',
      submitted: true,
      reason: 'The Snapshot sequencer accepted the vote.',
      spaceId: RESIDENT_SPACE_ID,
      proposalId: PROPOSAL_ID,
      voter: VOTER,
      choice: 2,
      voteId: '0x1',
      ipfsHash: 'QmHash',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.chainId).toBe(VOTE_CHAIN_ID);
    const message = (
      calls[0]?.message as { message: { from: string; space: string; proposal: string; choice: number; timestamp: number } }
    ).message;
    expect(message.from).toBe(VOTER);
    expect(message.space).toBe(RESIDENT_SPACE_ID);
    expect(message.proposal).toBe(PROPOSAL_ID);
    // 0-based index 1 → Snapshot's 1-based choice 2.
    expect(message.choice).toBe(2);
    expect(message.timestamp).toBe(1_791_382_034);

    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]?.address).toBe(VOTER);
    expect(envelopes[0]?.sig).toBe(`0x${'ab'.repeat(65)}`);
    expect(envelopes[0]?.data.message.from).toBe(VOTER);
  });
});

describe('castSnapshotVote — preconditions refuse without signing', () => {
  const cases: Array<{
    readonly name: string;
    readonly input?: { spaceId: string; proposalId: string; choice: number };
    readonly deps?: Partial<SnapshotVoteDependencies>;
  }> = [
    {
      name: 'an inactive proposal',
      deps: { adapter: adapterWith({ proposal: { ...PROPOSAL, state: 'closed' } }) },
    },
    {
      name: 'an unsupported vote type',
      deps: { adapter: adapterWith({ proposal: { ...PROPOSAL, type: 'weighted' } }) },
    },
    {
      name: 'a proposal with no reported vote type',
      deps: { adapter: adapterWith({ proposal: { ...PROPOSAL, type: undefined } }) },
    },
    { name: 'an out-of-range choice', input: { spaceId: RESIDENT_SPACE_ID, proposalId: PROPOSAL_ID, choice: 3 } },
    { name: 'a non-integer choice', input: { spaceId: RESIDENT_SPACE_ID, proposalId: PROPOSAL_ID, choice: 1.5 } },
    { name: 'a negative choice', input: { spaceId: RESIDENT_SPACE_ID, proposalId: PROPOSAL_ID, choice: -1 } },
    { name: 'a different network', deps: { chainId: 1 } },
    { name: 'zero power', deps: { adapter: adapterWith({ power: { status: 'known', power: 0n, blockNumber: 100, provenance: 'snapshot' } }) } },
    { name: 'an unreadable power read', deps: { adapter: adapterWith({ power: { status: 'error', reason: 'RPC down' } }) } },
    { name: 'an unknown power source', deps: { adapter: adapterWith({ power: { status: 'unknown', reason: 'no source' } }) } },
    { name: 'a citizen-only proposal for a Resident', deps: { adapter: adapterWith({ proposal: { ...PROPOSAL, category: 'citizen' } }), membership: 'resident' } },
    { name: 'a proposal that does not exist', input: { spaceId: RESIDENT_SPACE_ID, proposalId: '0xmissing', choice: 0 } },
    { name: 'a proposal that is not in the named space', input: { spaceId: 'unknown.eth', proposalId: PROPOSAL_ID, choice: 0 } },
  ];

  for (const testCase of cases) {
    it(`refuses ${testCase.name}`, async () => {
      const { signer, calls } = signerWith();
      const { sequencer, envelopes } = sequencerWith(ACCEPTED);
      const deps = baseDeps({ ...testCase.deps, signer, sequencer });
      const outcome = await castSnapshotVote(
        testCase.input ?? { spaceId: RESIDENT_SPACE_ID, proposalId: PROPOSAL_ID, choice: 0 },
        deps,
      );
      expect(outcome.submitted).toBe(false);
      expect(outcome.status).toBe('blocked');
      expect(calls).toHaveLength(0);
      expect(envelopes).toHaveLength(0);
    });
  }

  it('refuses an unconfigured environment before signing', async () => {
    for (const override of [
      { chainId: null },
      { safeAddress: null },
      { signer: null },
      { sequencer: null },
      { duplicateGuard: null },
    ] satisfies Array<Partial<SnapshotVoteDependencies>>) {
      const outcome = await castSnapshotVote(
        { spaceId: RESIDENT_SPACE_ID, proposalId: PROPOSAL_ID, choice: 0 },
        baseDeps(override),
      );
      expect(outcome).toMatchObject({ status: 'not-configured', submitted: false });
    }
  });
});

describe('castSnapshotVote — duplicates and failures', () => {
  it('does not submit a second vote for the same (space, proposal, voter)', async () => {
    const { signer, calls } = signerWith();
    const { sequencer, envelopes } = sequencerWith(ACCEPTED);
    const duplicateGuard = createVoteDuplicateGuard();
    const deps = baseDeps({ signer, sequencer, duplicateGuard });
    const input = { spaceId: RESIDENT_SPACE_ID, proposalId: PROPOSAL_ID, choice: 0 };

    const first = await castSnapshotVote(input, deps);
    const second = await castSnapshotVote(input, deps);

    expect(first.submitted).toBe(true);
    expect(second.submitted).toBe(false);
    expect(second.status).toBe('blocked');
    // The signer and the sequencer were each reached exactly once.
    expect(calls).toHaveLength(1);
    expect(envelopes).toHaveLength(1);
  });

  it('surfaces a sequencer rejection honestly and allows a retry', async () => {
    const { signer, calls } = signerWith();
    const { sequencer, envelopes } = sequencerWith({
      ok: false,
      reason: 'The Snapshot sequencer rejected the vote (400): invalid signature',
    });
    const duplicateGuard = createVoteDuplicateGuard();
    const deps = baseDeps({ signer, sequencer, duplicateGuard });
    const input = { spaceId: RESIDENT_SPACE_ID, proposalId: PROPOSAL_ID, choice: 0 };

    const outcome = await castSnapshotVote(input, deps);
    expect(outcome).toMatchObject({
      status: 'failed',
      submitted: false,
      reason: 'The Snapshot sequencer rejected the vote (400): invalid signature',
    });

    // The failed attempt released the guard, so a retry signs again.
    await castSnapshotVote(input, deps);
    expect(calls).toHaveLength(2);
    expect(envelopes).toHaveLength(2);
  });

  it('surfaces a signing failure and allows a retry', async () => {
    const { sequencer } = sequencerWith(ACCEPTED);
    const duplicateGuard = createVoteDuplicateGuard();
    const signer: SafeMessageSigner = async () => {
      throw new Error('signer unavailable');
    };
    const deps = baseDeps({ signer, sequencer, duplicateGuard });
    const input = { spaceId: RESIDENT_SPACE_ID, proposalId: PROPOSAL_ID, choice: 0 };

    const outcome = await castSnapshotVote(input, deps);
    expect(outcome).toMatchObject({ status: 'failed', submitted: false });
    if (outcome.status === 'failed') {
      expect(outcome.reason).toContain('signer unavailable');
    }
    // The failed attempt released the guard, so a retry is attempted.
    const retry = await castSnapshotVote(input, deps);
    expect(retry.status).toBe('failed');
  });

  it('fails closed when the duplicate lookup cannot be read', async () => {
    const { signer, calls } = signerWith();
    const duplicateGuard = createVoteDuplicateGuard({
      lookup: async () => {
        throw new Error('hub down');
      },
    });
    const deps = baseDeps({ signer, duplicateGuard });

    const outcome = await castSnapshotVote(
      { spaceId: RESIDENT_SPACE_ID, proposalId: PROPOSAL_ID, choice: 0 },
      deps,
    );
    expect(outcome.submitted).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('never leaks the signer key into the outcome', async () => {
    const key = `0x${'11'.repeat(32)}`;
    const signer = ownerSafeMessageSigner({
      rpcUrl: 'https://arb.example',
      safeAddress: VOTER,
      privateKey: key,
      sign: async () => {
        throw new Error(`SDK echoed ${key}`);
      },
    });
    const deps = baseDeps({ signer });

    const outcome = await castSnapshotVote(
      { spaceId: RESIDENT_SPACE_ID, proposalId: PROPOSAL_ID, choice: 0 },
      deps,
    );
    expect(JSON.stringify(outcome)).not.toContain(key);
    expect(outcome.submitted).toBe(false);
  });
});
