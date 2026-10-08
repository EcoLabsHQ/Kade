import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAddress, type Address, type Hex } from 'viem';
import type { SnapshotAdapter } from '@/lib/vote/adapter';
import { createVoteDuplicateGuard } from '@/lib/vote/duplicate-guard';
import type {
  SnapshotSequencerClient,
  SnapshotSequencerResult,
  SnapshotVoteEnvelope,
} from '@/lib/vote/sequencer';
import {
  abandonSnapshotVote,
  beginSnapshotVote,
  completeSnapshotVote,
  RETAINED_VOTE_TTL_MS,
  type SnapshotVoteDependencies,
} from '@/lib/vote/submit';
import { RESIDENT_SPACE_ID, VOTE_CHAIN_ID } from '@/lib/vote/spaces';
import type { VoteProposal, VotingPowerRead } from '@/lib/vote/types';

/**
 * The resident-authorised vote path.
 *
 * The server validates every precondition and returns the canonical typed data;
 * the **resident's** signature (produced elsewhere, in the browser) is the only
 * thing submitted. These tests prove that:
 *
 *   - the build phase returns the exact canonical `Vote` typed data and signs
 *     nothing;
 *   - every precondition refuses before the typed data is returned, so the
 *     resident is never asked to sign an ineligible vote;
 *   - the submit phase sends the resident's signature over the **retained**
 *     typed data, and a refusal releases the duplicate guard for a retry;
 *   - the backend holds no signer at all: there is no key to leak.
 */

const VOTER = getAddress('0x1111111111111111111111111111111111111111') as Address;
const PROPOSAL_ID = '0xproposal';

/** A signature as the passkey would return it (opaque bytes to the server). */
const SIGNATURE = `0x${'ab'.repeat(65)}` as Hex;

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
    sequencer: sequencerWith(ACCEPTED).sequencer,
    duplicateGuard: createVoteDuplicateGuard(),
    now: () => 1_791_382_034_000,
    ...overrides,
  };
}

// The expiry test drives the clock with fake timers; always restore them.
afterEach(() => {
  vi.useRealTimers();
});

describe('beginSnapshotVote — the resident is handed the canonical typed data', () => {
  it('returns the canonical Vote typed data for the selected choice and signs nothing', async () => {
    const { sequencer, envelopes } = sequencerWith(ACCEPTED);
    const deps = baseDeps({ sequencer });

    const outcome = await beginSnapshotVote(
      { spaceId: RESIDENT_SPACE_ID, proposalId: PROPOSAL_ID, choice: 1 },
      deps,
    );

    expect(outcome.status).toBe('ready');
    if (outcome.status !== 'ready') throw new Error('expected ready');

    expect(outcome.voter).toBe(VOTER);
    expect(outcome.typedData.domain).toEqual({ name: 'snapshot', version: '0.1.4' });
    expect(outcome.typedData.primaryType).toBe('Vote');
    expect(outcome.typedData.message).toEqual({
      from: VOTER,
      space: RESIDENT_SPACE_ID,
      proposal: PROPOSAL_ID,
      // 0-based index 1 → Snapshot's 1-based choice 2.
      choice: 2,
      timestamp: 1_791_382_034,
      reason: '',
      app: 'kade',
      metadata: '{}',
    });

    // Nothing was sent by the build phase.
    expect(envelopes).toHaveLength(0);
  });
});

describe('completeSnapshotVote — the resident’s signature is submitted', () => {
  it('submits the resident’s signature over the retained typed data', async () => {
    const { sequencer, envelopes } = sequencerWith(ACCEPTED);
    const deps = baseDeps({ sequencer });

    const begin = await beginSnapshotVote(
      { spaceId: RESIDENT_SPACE_ID, proposalId: PROPOSAL_ID, choice: 1 },
      deps,
    );
    if (begin.status !== 'ready') throw new Error('expected ready');

    const outcome = await completeSnapshotVote(
      { token: begin.token, signature: SIGNATURE },
      { sequencer, duplicateGuard: deps.duplicateGuard },
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

    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]?.address).toBe(VOTER);
    // The signature is the resident's, used verbatim.
    expect(envelopes[0]?.sig).toBe(SIGNATURE);
    // The typed data submitted is the server-retained one, not anything the
    // client could have supplied.
    expect(envelopes[0]?.data.message).toEqual(begin.typedData.message);
  });

  it('refuses an unknown or already-used token without sending', async () => {
    const { sequencer, envelopes } = sequencerWith(ACCEPTED);
    const deps = baseDeps({ sequencer });
    const begin = await beginSnapshotVote(
      { spaceId: RESIDENT_SPACE_ID, proposalId: PROPOSAL_ID, choice: 0 },
      deps,
    );
    if (begin.status !== 'ready') throw new Error('expected ready');

    // First completion consumes the token.
    await completeSnapshotVote(
      { token: begin.token, signature: SIGNATURE },
      { sequencer, duplicateGuard: deps.duplicateGuard },
    );
    const replay = await completeSnapshotVote(
      { token: begin.token, signature: SIGNATURE },
      { sequencer, duplicateGuard: deps.duplicateGuard },
    );

    expect(replay).toMatchObject({ status: 'failed', submitted: false });
    expect(envelopes).toHaveLength(1);
  });

  it('refuses an empty signature without sending', async () => {
    const { sequencer, envelopes } = sequencerWith(ACCEPTED);
    const deps = baseDeps({ sequencer });
    const begin = await beginSnapshotVote(
      { spaceId: RESIDENT_SPACE_ID, proposalId: PROPOSAL_ID, choice: 0 },
      deps,
    );
    if (begin.status !== 'ready') throw new Error('expected ready');

    const outcome = await completeSnapshotVote(
      { token: begin.token, signature: '0x' },
      { sequencer, duplicateGuard: deps.duplicateGuard },
    );

    expect(outcome).toMatchObject({ status: 'failed', submitted: false });
    expect(envelopes).toHaveLength(0);
  });
});

describe('beginSnapshotVote — preconditions refuse before anything is signed', () => {
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
      const { sequencer, envelopes } = sequencerWith(ACCEPTED);
      const deps = baseDeps({ ...testCase.deps, sequencer });
      const outcome = await beginSnapshotVote(
        testCase.input ?? { spaceId: RESIDENT_SPACE_ID, proposalId: PROPOSAL_ID, choice: 0 },
        deps,
      );
      expect(outcome.status).toBe('blocked');
      expect(outcome.submitted).toBe(false);
      // Nothing was sent, and the resident was handed nothing to sign.
      expect(envelopes).toHaveLength(0);
      expect('typedData' in outcome).toBe(false);
    });
  }

  it('refuses an unconfigured environment before signing', async () => {
    for (const override of [
      { chainId: null },
      { safeAddress: null },
      { sequencer: null },
      { duplicateGuard: null },
    ] satisfies Array<Partial<SnapshotVoteDependencies>>) {
      const outcome = await beginSnapshotVote(
        { spaceId: RESIDENT_SPACE_ID, proposalId: PROPOSAL_ID, choice: 0 },
        baseDeps(override),
      );
      expect(outcome).toMatchObject({ status: 'not-configured', submitted: false });
    }
  });
});

describe('duplicates and failures', () => {
  const input = { spaceId: RESIDENT_SPACE_ID, proposalId: PROPOSAL_ID, choice: 0 };

  it('does not hand out a second vote after a genuine submission, and says a vote exists', async () => {
    const { sequencer, envelopes } = sequencerWith(ACCEPTED);
    const duplicateGuard = createVoteDuplicateGuard();
    const deps = baseDeps({ sequencer, duplicateGuard });

    const first = await beginSnapshotVote(input, deps);
    if (first.status !== 'ready') throw new Error('expected ready');
    const submitted = await completeSnapshotVote(
      { token: first.token, signature: SIGNATURE },
      { sequencer, duplicateGuard },
    );
    expect(submitted.submitted).toBe(true);

    const second = await beginSnapshotVote(input, deps);
    expect(second.status).toBe('blocked');
    expect(second.submitted).toBe(false);
    if (second.status === 'blocked') {
      // The refusal is TRUE: a vote genuinely exists.
      expect(second.reason).toMatch(/already exists/);
    }
    expect(envelopes).toHaveLength(1);
  });

  it('refuses a concurrent attempt as in-progress, never as an existing vote', async () => {
    const { sequencer } = sequencerWith(ACCEPTED);
    const duplicateGuard = createVoteDuplicateGuard();
    const deps = baseDeps({ sequencer, duplicateGuard });

    const first = await beginSnapshotVote(input, deps);
    expect(first.status).toBe('ready');

    const second = await beginSnapshotVote(input, deps);
    expect(second.status).toBe('blocked');
    if (second.status === 'blocked') {
      expect(second.reason).toMatch(/already being signed/);
      // No vote exists yet, so the "a vote already exists" claim must not appear.
      expect(second.reason).not.toMatch(/already exists/);
    }
  });

  it('surfaces a sequencer rejection honestly and allows a retry', async () => {
    const { sequencer, envelopes } = sequencerWith({
      ok: false,
      reason: 'The Snapshot sequencer rejected the vote (400): invalid signature',
    });
    const duplicateGuard = createVoteDuplicateGuard();
    const deps = baseDeps({ sequencer, duplicateGuard });
    const input = { spaceId: RESIDENT_SPACE_ID, proposalId: PROPOSAL_ID, choice: 0 };

    const first = await beginSnapshotVote(input, deps);
    if (first.status !== 'ready') throw new Error('expected ready');
    const outcome = await completeSnapshotVote(
      { token: first.token, signature: SIGNATURE },
      { sequencer, duplicateGuard },
    );
    expect(outcome).toMatchObject({
      status: 'failed',
      submitted: false,
      reason: 'The Snapshot sequencer rejected the vote (400): invalid signature',
    });

    // The failed attempt released the guard, so a retry is handed a fresh vote.
    const retry = await beginSnapshotVote(input, deps);
    expect(retry.status).toBe('ready');
    expect(envelopes).toHaveLength(1);
  });

  it('fails closed when the duplicate lookup cannot be read', async () => {
    const { sequencer, envelopes } = sequencerWith(ACCEPTED);
    const duplicateGuard = createVoteDuplicateGuard({
      lookup: async () => {
        throw new Error('hub down');
      },
    });
    const deps = baseDeps({ sequencer, duplicateGuard });

    const outcome = await beginSnapshotVote(
      { spaceId: RESIDENT_SPACE_ID, proposalId: PROPOSAL_ID, choice: 0 },
      deps,
    );
    expect(outcome.submitted).toBe(false);
    expect(outcome.status).toBe('blocked');
    expect(envelopes).toHaveLength(0);
  });
});

describe('an abandoned attempt releases the reservation so a retry is immediate', () => {
  const input = { spaceId: RESIDENT_SPACE_ID, proposalId: PROPOSAL_ID, choice: 0 };

  it('lets the resident try again after an explicit abandon (dismissed prompt)', async () => {
    const { sequencer, envelopes } = sequencerWith(ACCEPTED);
    const duplicateGuard = createVoteDuplicateGuard();
    const deps = baseDeps({ sequencer, duplicateGuard });

    const first = await beginSnapshotVote(input, deps);
    if (first.status !== 'ready') throw new Error('expected ready');

    // The browser signing failed / was dismissed: the client abandons the token
    // and never calls complete.
    await abandonSnapshotVote(first.token, { duplicateGuard });

    // The resident can immediately try again and actually cast the vote.
    const second = await beginSnapshotVote(input, deps);
    expect(second.status).toBe('ready');
    if (second.status !== 'ready') throw new Error('expected ready');
    const submitted = await completeSnapshotVote(
      { token: second.token, signature: SIGNATURE },
      { sequencer, duplicateGuard },
    );
    expect(submitted.submitted).toBe(true);
    expect(envelopes).toHaveLength(1);
  });

  it('self-releases an abandoned reservation after its bounded lifetime', async () => {
    const { sequencer } = sequencerWith(ACCEPTED);
    let now = 1_000;
    const duplicateGuard = createVoteDuplicateGuard({
      now: () => now,
      ttlMs: 30_000,
    });
    const deps = baseDeps({ sequencer, duplicateGuard });

    const first = await beginSnapshotVote(input, deps);
    expect(first.status).toBe('ready');

    // No complete and no abandon: while the claim is live it is reported honestly
    // as in progress, never as an existing vote.
    const whileLive = await beginSnapshotVote(input, deps);
    expect(whileLive.status).toBe('blocked');
    if (whileLive.status === 'blocked') {
      expect(whileLive.reason).toMatch(/already being signed/);
    }

    // Past the lifetime it self-releases, so the resident can try again.
    now += 30_001;
    const retry = await beginSnapshotVote(input, deps);
    expect(retry.status).toBe('ready');
  });

  it('releases the reservation when the retained vote expires before signing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const { sequencer } = sequencerWith(ACCEPTED);
    // A guard lifetime longer than the retained-vote lifetime, so it is the
    // explicit release on expiry (not the guard's own TTL) that frees the claim.
    const duplicateGuard = createVoteDuplicateGuard({
      ttlMs: RETAINED_VOTE_TTL_MS * 10,
    });
    const deps = baseDeps({ sequencer, duplicateGuard, now: () => Date.now() });

    const first = await beginSnapshotVote(input, deps);
    if (first.status !== 'ready') throw new Error('expected ready');

    vi.setSystemTime(1_000_000 + RETAINED_VOTE_TTL_MS + 1);
    const outcome = await completeSnapshotVote(
      { token: first.token, signature: SIGNATURE },
      { sequencer, duplicateGuard },
    );
    expect(outcome).toMatchObject({ status: 'failed', submitted: false });
    if (outcome.status === 'failed') {
      expect(outcome.reason).toMatch(/expired/);
    }

    // The expired attempt released the claim, so a retry is immediately possible.
    expect(
      await duplicateGuard.reserve({
        spaceId: RESIDENT_SPACE_ID,
        proposalId: PROPOSAL_ID,
        voter: VOTER,
      }),
    ).toEqual({ status: 'reserved' });
  });
});
