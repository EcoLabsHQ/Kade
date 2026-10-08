import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The client half of the resident-authorised vote.
 *
 * The passkey lives in the browser, so the client orchestrates: the server
 * validates and returns the typed data, the passkey signs it, and the server
 * submits the signature. These tests mock both server actions and the browser
 * signing seam, so no network and no passkey prompt is reached, and prove:
 *
 *   - a build refusal short-circuits **without touching the passkey**;
 *   - a ready build signs exactly the returned typed data and submits exactly
 *     that signature;
 *   - a failed or dismissed passkey prompt is reported and **nothing is
 *     submitted**.
 */

const hoisted = vi.hoisted(() => ({
  beginVoteAction: vi.fn(),
  completeVoteAction: vi.fn(),
  signSafeMessageWithPasskey: vi.fn(),
}));

vi.mock('@/app/(resident)/vote/actions', () => ({
  beginVoteAction: hoisted.beginVoteAction,
  completeVoteAction: hoisted.completeVoteAction,
}));

vi.mock('@/lib/safe/passkey-sign-message', () => ({
  signSafeMessageWithPasskey: hoisted.signSafeMessageWithPasskey,
}));

import { castVoteWithPasskey } from '@/lib/vote/cast-client';

const INPUT = { spaceId: 'kadeglobal.eth', proposalId: '0xp', choice: 1 };

const READY = {
  status: 'ready' as const,
  token: 'token-1',
  typedData: {
    domain: { name: 'snapshot', version: '0.1.4' },
    types: { Vote: [] },
    primaryType: 'Vote' as const,
    message: {},
  },
  voter: '0x2222222222222222222222222222222222222222',
  credentialId: 'aabbcc',
  coordinates: { x: '1', y: '2' },
  verifierAddress: '0x3333333333333333333333333333333333333333',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('castVoteWithPasskey', () => {
  it('returns a build refusal without touching the passkey', async () => {
    const refusal = {
      status: 'blocked' as const,
      submitted: false as const,
      reason: 'This proposal is not active, so nothing was signed.',
    };
    hoisted.beginVoteAction.mockResolvedValue(refusal);

    const outcome = await castVoteWithPasskey(INPUT);

    expect(outcome).toBe(refusal);
    expect(hoisted.signSafeMessageWithPasskey).not.toHaveBeenCalled();
    expect(hoisted.completeVoteAction).not.toHaveBeenCalled();
  });

  it('signs the returned typed data with the passkey and submits the signature', async () => {
    hoisted.beginVoteAction.mockResolvedValue(READY);
    hoisted.signSafeMessageWithPasskey.mockResolvedValue('0xsig');
    const submitted = {
      status: 'submitted' as const,
      submitted: true as const,
      reason: 'The Snapshot sequencer accepted the vote.',
    };
    hoisted.completeVoteAction.mockResolvedValue(submitted);

    const outcome = await castVoteWithPasskey(INPUT);

    expect(outcome).toBe(submitted);
    expect(hoisted.signSafeMessageWithPasskey).toHaveBeenCalledTimes(1);
    const signingInput = hoisted.signSafeMessageWithPasskey.mock.calls[0]?.[0];
    expect(signingInput.safeAddress).toBe(READY.voter);
    expect(signingInput.message).toBe(READY.typedData);
    expect(signingInput.signer).toEqual({
      rawId: READY.credentialId,
      coordinates: READY.coordinates,
      verifierAddress: READY.verifierAddress,
    });

    expect(hoisted.completeVoteAction).toHaveBeenCalledWith({
      token: 'token-1',
      signature: '0xsig',
    });
  });

  it('reports a dismissed passkey prompt and submits nothing', async () => {
    hoisted.beginVoteAction.mockResolvedValue(READY);
    hoisted.signSafeMessageWithPasskey.mockRejectedValue(
      new Error('The passkey prompt was dismissed.'),
    );

    const outcome = await castVoteWithPasskey(INPUT);

    expect(outcome).toMatchObject({ status: 'failed', submitted: false });
    if (outcome.status === 'failed') {
      expect(outcome.reason).toContain('dismissed');
    }
    expect(hoisted.completeVoteAction).not.toHaveBeenCalled();
  });
});
