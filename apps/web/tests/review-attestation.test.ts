import { describe, expect, it } from 'vitest';
import { decodeAbiParameters } from 'viem';
import { EAS_SCHEMAS } from '@kade/shared';
import {
  AttestationIssuanceGatedError,
  encodeReviewAttestation,
  isReviewAction,
  issueReviewAttestation,
  reviewAttestationData,
  REVIEW_ACTIONS,
} from '@/lib/review/attestation';

/**
 * The `kade.review.v1` issuance path.
 *
 * The schema is frozen in `@kade/shared`; this test pins that the encoder reads
 * its field order rather than hard-coding one, and that `cleared` is true only
 * for an approval. The on-chain write is gated, so issuance must refuse instead
 * of returning a fabricated UID.
 */

describe('kade.review.v1 encoding', () => {
  it('encodes against the frozen schema field order', () => {
    const fields = EAS_SCHEMAS['kade.review.v1'].fields.map((field) => field.name);
    expect(fields).toEqual(['applicationRef', 'cleared', 'note']);

    const encoded = encodeReviewAttestation(
      reviewAttestationData('CW-2026-0409', 'approve', 'ok'),
    );
    const decoded = decodeAbiParameters(
      [
        { name: 'applicationRef', type: 'string' },
        { name: 'cleared', type: 'bool' },
        { name: 'note', type: 'string' },
      ],
      encoded,
    );
    expect(decoded).toEqual(['CW-2026-0409', true, 'ok']);
  });

  it('marks only an approval as cleared', () => {
    expect(reviewAttestationData('ref', 'approve', null).cleared).toBe(true);
    expect(reviewAttestationData('ref', 'block', null).cleared).toBe(false);
    expect(reviewAttestationData('ref', 'reopen', null).cleared).toBe(false);
    expect(reviewAttestationData('ref', 'block', null).note).toBe('');
  });

  it('accepts exactly the three frozen actions', () => {
    expect([...REVIEW_ACTIONS]).toEqual(['approve', 'block', 'reopen']);
    for (const action of REVIEW_ACTIONS) expect(isReviewAction(action)).toBe(true);
    expect(isReviewAction('delete')).toBe(false);
  });
});

describe('issuance gate', () => {
  it('refuses to issue before the Onchain gate, without a UID', () => {
    expect(() =>
      issueReviewAttestation('CW-2026-0409', 'approve', 'ok'),
    ).toThrow(AttestationIssuanceGatedError);
  });
});
