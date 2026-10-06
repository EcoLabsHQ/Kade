import { describe, expect, it } from 'vitest';
import {
  CITIZEN_ONLY_REFUSAL,
  evaluateVoteEligibility,
} from '@/lib/vote/eligibility';
import type { VoteProposal, VotingPowerRead } from '@/lib/vote/types';
import { RESIDENT_SPACE_ID, CITIZEN_SPACE_ID } from '@/lib/vote/spaces';

/**
 * The vote eligibility rules, as pure logic.
 *
 * The important property is the fail-closed one: a voting power that could not
 * be read is neither "no power" nor "eligible". It refuses, and the reason says
 * so.
 */

const WALLET = '0x1111111111111111111111111111111111111111';

const RESIDENT_PROPOSAL: VoteProposal = {
  spaceId: RESIDENT_SPACE_ID,
  proposalId: 'p1',
  title: 't',
  category: 'resident',
  state: 'open',
  snapshotBlock: 1,
  choices: [],
  provenance: 'mock',
};

const CITIZEN_PROPOSAL: VoteProposal = {
  ...RESIDENT_PROPOSAL,
  spaceId: CITIZEN_SPACE_ID,
  category: 'citizen',
};

const KNOWN_ONE: VotingPowerRead = {
  status: 'known',
  power: 1n,
  blockNumber: 1,
  provenance: 'mock',
};

describe('evaluateVoteEligibility', () => {
  it('is eligible for the right category with power > 0', () => {
    const result = evaluateVoteEligibility({
      wallet: WALLET,
      membership: 'resident',
      proposal: RESIDENT_PROPOSAL,
      power: KNOWN_ONE,
    });
    expect(result.eligible).toBe(true);
    expect(result.reason).toBe('eligible');
    expect(result.message).toBeNull();
  });

  it('refuses a disconnected wallet first', () => {
    const result = evaluateVoteEligibility({
      wallet: null,
      membership: 'resident',
      proposal: RESIDENT_PROPOSAL,
      power: KNOWN_ONE,
    });
    expect(result.reason).toBe('wallet-disconnected');
  });

  it('refuses a closed proposal', () => {
    const result = evaluateVoteEligibility({
      wallet: WALLET,
      membership: 'resident',
      proposal: { ...RESIDENT_PROPOSAL, state: 'closed' },
      power: KNOWN_ONE,
    });
    expect(result.reason).toBe('closed');
  });

  it('refuses a Resident on a Citizen proposal with the exact text', () => {
    const result = evaluateVoteEligibility({
      wallet: WALLET,
      membership: 'resident',
      proposal: CITIZEN_PROPOSAL,
      power: KNOWN_ONE,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('citizen-only');
    expect(result.message).toBe('Colosseum Citizens only');
    expect(result.message).toBe(CITIZEN_ONLY_REFUSAL);
  });

  it('allows a Citizen on a Citizen proposal', () => {
    const result = evaluateVoteEligibility({
      wallet: WALLET,
      membership: 'citizen',
      proposal: CITIZEN_PROPOSAL,
      power: KNOWN_ONE,
    });
    expect(result.eligible).toBe(true);
  });

  it('never assumes eligibility from an error read', () => {
    const result = evaluateVoteEligibility({
      wallet: WALLET,
      membership: 'resident',
      proposal: RESIDENT_PROPOSAL,
      power: { status: 'error', reason: 'RPC down' },
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('power-unread');
  });

  it('never assumes eligibility from an unknown read', () => {
    const result = evaluateVoteEligibility({
      wallet: WALLET,
      membership: 'resident',
      proposal: RESIDENT_PROPOSAL,
      power: { status: 'unknown', reason: 'mocked' },
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('power-unread');
  });

  it('refuses zero power', () => {
    const result = evaluateVoteEligibility({
      wallet: WALLET,
      membership: 'resident',
      proposal: RESIDENT_PROPOSAL,
      power: { status: 'known', power: 0n, blockNumber: 1, provenance: 'mock' },
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('no-power');
  });

  it('reports loading while the proposal or power is not yet read', () => {
    const result = evaluateVoteEligibility({
      wallet: WALLET,
      membership: 'resident',
      proposal: null,
      power: null,
    });
    expect(result.reason).toBe('loading');
  });
});
