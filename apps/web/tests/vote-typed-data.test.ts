import { describe, expect, it } from 'vitest';
import {
  buildSnapshotVoteTypedData,
  isSupportedVoteType,
  SNAPSHOT_VOTE_APP,
  SNAPSHOT_VOTE_DOMAIN,
  SNAPSHOT_VOTE_TYPES,
} from '@/lib/vote/snapshot';

/**
 * The canonical Snapshot `Vote` typed data.
 *
 * These assertions are written against the shape Snapshot's own client signs
 * (`snapshot.js` / `sx.js`), not against this module's own constants: the
 * expected domain and type list are hard-coded here, so a change to the module
 * that drifted from the protocol would fail. The sequencer **enforces** the
 * domain name and version.
 */

const SAFE = '0x1111111111111111111111111111111111111111';
const PROPOSAL = '0xproposal';

describe('Snapshot Vote typed data — canonical shape', () => {
  it('uses the enforced domain, with no chainId', () => {
    expect(SNAPSHOT_VOTE_DOMAIN).toEqual({ name: 'snapshot', version: '0.1.4' });
    // A Snapshot vote is not chain-scoped at the EIP-712 layer.
    expect('chainId' in SNAPSHOT_VOTE_DOMAIN).toBe(false);
  });

  it('declares the Vote fields and types in protocol order', () => {
    expect(SNAPSHOT_VOTE_TYPES.Vote).toEqual([
      { name: 'from', type: 'string' },
      { name: 'space', type: 'string' },
      { name: 'timestamp', type: 'uint64' },
      { name: 'proposal', type: 'string' },
      { name: 'choice', type: 'uint32' },
      { name: 'reason', type: 'string' },
      { name: 'app', type: 'string' },
      { name: 'metadata', type: 'string' },
    ]);
  });

  it('builds the exact typed data with `from` = the Safe', () => {
    const data = buildSnapshotVoteTypedData({
      from: SAFE,
      space: 'kadeglobal.eth',
      proposal: PROPOSAL,
      choice: 1,
      timestamp: 1_791_382_034,
      app: 'kade',
    });

    expect(data).toEqual({
      domain: { name: 'snapshot', version: '0.1.4' },
      primaryType: 'Vote',
      types: {
        Vote: [
          { name: 'from', type: 'string' },
          { name: 'space', type: 'string' },
          { name: 'timestamp', type: 'uint64' },
          { name: 'proposal', type: 'string' },
          { name: 'choice', type: 'uint32' },
          { name: 'reason', type: 'string' },
          { name: 'app', type: 'string' },
          { name: 'metadata', type: 'string' },
        ],
      },
      message: {
        from: SAFE,
        space: 'kadeglobal.eth',
        timestamp: 1_791_382_034,
        proposal: PROPOSAL,
        choice: 1,
        reason: '',
        app: 'kade',
        metadata: '{}',
      },
    });
    // `from` is inside the signed payload: that is why a contract wallet needs
    // EIP-1271 rather than EOA recovery.
    expect(data.message.from).toBe(SAFE);
  });

  it('defaults reason, app and metadata as Snapshot does', () => {
    const data = buildSnapshotVoteTypedData({
      from: SAFE,
      space: 'kadeglobal.eth',
      proposal: PROPOSAL,
      choice: 2,
      timestamp: 1,
    });
    expect(data.message.reason).toBe('');
    expect(data.message.app).toBe(SNAPSHOT_VOTE_APP);
    expect(data.message.metadata).toBe('{}');
  });
});

describe('supported vote types', () => {
  it('accepts the two single-choice types and refuses the rest', () => {
    expect(isSupportedVoteType('basic')).toBe(true);
    expect(isSupportedVoteType('single-choice')).toBe(true);
    for (const type of ['weighted', 'approval', 'quadratic', 'ranked-choice', undefined]) {
      expect(isSupportedVoteType(type)).toBe(false);
    }
  });
});
