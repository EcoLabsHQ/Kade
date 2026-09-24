import { describe, expect, it } from 'vitest';
import {
  KADE_MINIMUM_AGE,
  isNotSanctioned,
  isOver18,
  mapSelfEvent,
  type SelfWebhookEventLike,
} from '@/lib/residency/self-event';

/**
 * The Self event mapper (D16 / EXE-012, contract v1.7).
 *
 * It records only the outcome, never nationality or expiry, and it fails closed:
 * only a genuine `valid` result may become a `valid` row, and an explicitly
 * failed predicate downgrades it.
 */

const PROFILE = '11111111-1111-4111-8111-111111111111';

function event(overrides: SelfWebhookEventLike = {}): SelfWebhookEventLike {
  return {
    type: 'verification.completed',
    status: 'valid',
    verification_id: 'ver_1',
    external_uuid: PROFILE,
    nullifier: 'nullifier-abc',
    proof_attributes: { minimumAge: true, ofac: true },
    ...overrides,
  };
}

describe('predicate helpers', () => {
  it('accepts a numeric age at or above the minimum', () => {
    expect(isOver18(KADE_MINIMUM_AGE)).toBe(true);
    expect(isOver18(18)).toBe(true);
    expect(isOver18(17)).toBe(false);
    expect(isOver18(undefined)).toBe(false);
    expect(isOver18(true)).toBe(true);
    expect(isOver18(false)).toBe(false);
  });

  it('accepts only an explicit true for OFAC', () => {
    expect(isNotSanctioned(true)).toBe(true);
    expect(isNotSanctioned(false)).toBe(false);
    expect(isNotSanctioned(undefined)).toBe(false);
  });
});

describe('mapSelfEvent', () => {
  it('maps a valid outcome to exactly the stored columns', () => {
    expect(mapSelfEvent(event())).toEqual({
      profileId: PROFILE,
      status: 'valid',
      verificationId: 'ver_1',
      selfNullifier: 'nullifier-abc',
      sessionId: null,
    });
  });

  it('records the session id when the event carries one', () => {
    const mapped = mapSelfEvent(event({ session_id: 'sess_1' }));
    expect(mapped).toMatchObject({ sessionId: 'sess_1' });
  });

  it('records an invalid outcome as invalid', () => {
    expect(mapSelfEvent(event({ status: 'invalid', nullifier: null }))).toMatchObject({
      status: 'invalid',
    });
  });

  it('ignores an event whose status is not a completed outcome', () => {
    expect(mapSelfEvent(event({ status: 'pending' }))).toHaveProperty('ignored');
    expect(mapSelfEvent(event({ status: undefined }))).toHaveProperty('ignored');
  });

  it('ignores an unsupported event type', () => {
    expect(mapSelfEvent(event({ type: 'session.created' }))).toHaveProperty('ignored');
  });

  it('ignores an external_uuid that is not a profile uuid', () => {
    expect(mapSelfEvent(event({ external_uuid: 'not-a-uuid' }))).toHaveProperty(
      'ignored',
    );
    expect(mapSelfEvent(event({ external_uuid: undefined }))).toHaveProperty(
      'ignored',
    );
  });

  it('ignores an event without a verification id to dedupe on', () => {
    expect(
      mapSelfEvent(event({ verification_id: undefined, session_id: undefined })),
    ).toHaveProperty('ignored');
  });

  it('falls back to the session id as the dedupe key', () => {
    expect(
      mapSelfEvent(
        event({ verification_id: undefined, session_id: 'sess_fallback' }),
      ),
    ).toMatchObject({ verificationId: 'sess_fallback' });
  });

  it('never stores nationality or expiry, even when disclosed', () => {
    const mapped = mapSelfEvent(
      event({
        proof_attributes: {
          nationality: 'DEU',
          expiryDate: '300101',
          minimumAge: true,
          ofac: true,
        },
      }),
    );
    expect(mapped).not.toHaveProperty('nationality');
    expect(mapped).not.toHaveProperty('expiresAt');
  });

  it('fails closed: an explicitly failed predicate downgrades a valid event', () => {
    expect(
      mapSelfEvent(event({ proof_attributes: { minimumAge: 17, ofac: true } })),
    ).toMatchObject({ status: 'invalid' });
    expect(
      mapSelfEvent(event({ proof_attributes: { minimumAge: true, ofac: false } })),
    ).toMatchObject({ status: 'invalid' });
  });

  it('accepts a valid event whose predicates are asserted by the flow config', () => {
    // The flow is configured with age ≥18 and OFAC; `valid` is its pass/fail
    // result, so undisclosed attributes do not downgrade it.
    expect(mapSelfEvent(event({ proof_attributes: {} }))).toMatchObject({
      status: 'valid',
    });
    expect(mapSelfEvent(event({ proof_attributes: undefined }))).toMatchObject({
      status: 'valid',
    });
  });

  it('keeps a valid result without a nullifier (Sybil field is optional)', () => {
    expect(mapSelfEvent(event({ nullifier: null }))).toMatchObject({
      status: 'valid',
      selfNullifier: null,
    });
  });
});
