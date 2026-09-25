import { describe, expect, it } from 'vitest';
import {
  KADE_MINIMUM_AGE,
  alpha3ToAlpha2,
  isNotSanctioned,
  isOver18,
  mapSelfEvent,
  mrzDateToIso,
  type SelfWebhookEventLike,
} from '@/lib/residency/self-event';

/**
 * The Self event mapper (D16 / EXE-012).
 *
 * In backend/off-chain mode the webhook carries the disclosed facts. The mapper
 * records the outcome, converts the nationality (alpha-3 -> alpha-2) and the
 * passport expiry (MRZ -> ISO date), and fails closed: only a genuine `valid`
 * result may become a `valid` row, and an explicitly failed predicate
 * downgrades it. A fact it cannot read honestly becomes `null`, never a guess.
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

describe('alpha3ToAlpha2', () => {
  it('converts a known ISO 3166-1 alpha-3 code to alpha-2', () => {
    expect(alpha3ToAlpha2('NLD')).toBe('NL');
    expect(alpha3ToAlpha2('DEU')).toBe('DE');
    expect(alpha3ToAlpha2('USA')).toBe('US');
    expect(alpha3ToAlpha2('GBR')).toBe('GB');
    expect(alpha3ToAlpha2('SUR')).toBe('SR');
  });

  it('is not case- or whitespace-sensitive', () => {
    expect(alpha3ToAlpha2('nld')).toBe('NL');
    expect(alpha3ToAlpha2('  deu ')).toBe('DE');
  });

  it('returns null for a code the frozen table does not know', () => {
    expect(alpha3ToAlpha2('ZZZ')).toBeNull();
    expect(alpha3ToAlpha2('XYZ')).toBeNull();
  });

  it('returns null for a malformed or non-string value', () => {
    expect(alpha3ToAlpha2('NL')).toBeNull();
    expect(alpha3ToAlpha2('NLDX')).toBeNull();
    expect(alpha3ToAlpha2(undefined)).toBeNull();
    expect(alpha3ToAlpha2(42)).toBeNull();
  });
});

describe('mrzDateToIso', () => {
  it('reads a YYMMDD MRZ date as 20YY and returns an ISO date', () => {
    expect(mrzDateToIso('300101')).toBe('2030-01-01');
    expect(mrzDateToIso('991231')).toBe('2099-12-31');
  });

  it('accepts a real leap day', () => {
    expect(mrzDateToIso('240229')).toBe('2024-02-29');
  });

  it('rejects an impossible calendar date instead of repairing it', () => {
    expect(mrzDateToIso('260229')).toBeNull(); // 2026 is not a leap year
    expect(mrzDateToIso('300230')).toBeNull(); // 30 February
    expect(mrzDateToIso('301301')).toBeNull(); // month 13
    expect(mrzDateToIso('300132')).toBeNull(); // day 32
  });

  it('rejects a value that is not exactly six digits', () => {
    expect(mrzDateToIso('30010')).toBeNull();
    expect(mrzDateToIso('20300101')).toBeNull();
    expect(mrzDateToIso('30-01-01')).toBeNull();
    expect(mrzDateToIso('abcdef')).toBeNull();
    expect(mrzDateToIso(undefined)).toBeNull();
  });
});

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
      nationality: null,
      over18: true,
      notSanctioned: true,
      expiresAt: null,
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

  it('stores the disclosed facts, converting alpha-3 and MRZ', () => {
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
    expect(mapped).toMatchObject({
      status: 'valid',
      nationality: 'DE',
      expiresAt: '2030-01-01',
      over18: true,
      notSanctioned: true,
    });
  });

  it('keeps the outcome when a disclosed fact cannot be read, storing null', () => {
    const mapped = mapSelfEvent(
      event({
        proof_attributes: {
          nationality: 'ZZZ',
          expiryDate: 'not-a-date',
          minimumAge: true,
          ofac: true,
        },
      }),
    );
    expect(mapped).toMatchObject({
      status: 'valid',
      nationality: null,
      expiresAt: null,
      over18: true,
      notSanctioned: true,
    });
  });

  it('maps a payload with no nationality or expiry without crashing', () => {
    expect(mapSelfEvent(event({ proof_attributes: {} }))).toMatchObject({
      nationality: null,
      expiresAt: null,
      over18: true,
      notSanctioned: true,
    });
  });

  it('does not leak any other reveal (name, date of birth)', () => {
    const mapped = mapSelfEvent(
      event({
        proof_attributes: {
          nationality: 'DEU',
          dateOfBirth: '1990-01-01',
          dob: '1990-01-01',
          expiryDate: '300101',
          name: 'Ada Lovelace',
          minimumAge: true,
          ofac: true,
        },
      }),
    );
    expect(mapped).toMatchObject({ status: 'valid' });
    expect(mapped).not.toHaveProperty('dateOfBirth');
    expect(mapped).not.toHaveProperty('dob');
    expect(mapped).not.toHaveProperty('name');
  });

  it('fails closed: an explicitly failed predicate downgrades a valid event', () => {
    expect(
      mapSelfEvent(event({ proof_attributes: { minimumAge: 17, ofac: true } })),
    ).toMatchObject({
      status: 'invalid',
      over18: false,
      notSanctioned: false,
    });
    expect(
      mapSelfEvent(event({ proof_attributes: { minimumAge: true, ofac: false } })),
    ).toMatchObject({
      status: 'invalid',
      over18: false,
      notSanctioned: false,
    });
  });

  it('accepts a valid event whose predicates are asserted by the flow config', () => {
    // The flow is configured with age >=18 and OFAC; `valid` is its pass/fail
    // result, so undisclosed attributes do not downgrade it.
    expect(mapSelfEvent(event({ proof_attributes: {} }))).toMatchObject({
      status: 'valid',
      over18: true,
      notSanctioned: true,
    });
    expect(mapSelfEvent(event({ proof_attributes: undefined }))).toMatchObject({
      status: 'valid',
      over18: true,
      notSanctioned: true,
    });
  });

  it('derives false predicates from a Self-reported invalid', () => {
    expect(
      mapSelfEvent(
        event({
          status: 'invalid',
          proof_attributes: { minimumAge: true, ofac: true },
        }),
      ),
    ).toMatchObject({
      status: 'invalid',
      over18: false,
      notSanctioned: false,
    });
  });

  it('keeps a valid result without a nullifier (Sybil field is optional)', () => {
    expect(mapSelfEvent(event({ nullifier: null }))).toMatchObject({
      status: 'valid',
      selfNullifier: null,
    });
  });
});
