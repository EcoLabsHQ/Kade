import { describe, expect, it } from 'vitest';
import {
  describeResidenceCoverage,
  preapprovalFeeUsdc,
  residenceCoverage,
  type Residence,
} from '@kade/shared';
import {
  addCitizenship,
  addMember,
  addResidence,
  canRemoveCitizenship,
  draftToSnapshot,
  emptyDraft,
  evaluateDraft,
  removeCitizenship,
  removeMember,
  updateMember,
  type OnboardingDraft,
} from '@/lib/onboarding/draft';

/**
 * Step 2 model tests (D5).
 *
 * The rules themselves are frozen in `@kade/shared`; these tests prove the UI
 * model calls them rather than re-implementing them, and that the live fee is
 * always the shared value.
 */

const YEAR = new Date().getFullYear();

const fullSpan: Residence[] = [
  { countryCode: 'NL', fromYear: YEAR - 5, toYear: 'present' },
];

function validDraft(): OnboardingDraft {
  return {
    firstName: 'Ada',
    lastName: 'Lovelace',
    dob: '1990-01-01',
    citizenships: ['NL'],
    residences: fullSpan,
    tier: 0,
    members: [],
  };
}

describe('live pre-approval fee', () => {
  it('is the shared formula value, never a constant', () => {
    expect(evaluateDraft(validDraft(), 'demo').feeUsdc).toBe(
      preapprovalFeeUsdc('demo', 1),
    );
    expect(evaluateDraft(validDraft(), 'production').feeUsdc).toBe(
      preapprovalFeeUsdc('production', 1),
    );
  });

  it('updates when a household member is added and removed', () => {
    const base = validDraft();
    const before = evaluateDraft(base, 'demo');

    const withMember = updateMember(addMember(base), 0, {
      name: 'Grace',
      relation: 'Daughter',
      dob: '2015-05-05',
      citizenship: 'DE',
    });
    const after = evaluateDraft(withMember, 'demo');

    expect(after.householdSize).toBe(2);
    expect(after.feeUsdc).toBe(preapprovalFeeUsdc('demo', 2));
    expect(after.feeUsdc).toBeGreaterThan(before.feeUsdc);

    const removed = removeMember(withMember, 0);
    expect(evaluateDraft(removed, 'demo').householdSize).toBe(1);
    expect(evaluateDraft(removed, 'demo').feeUsdc).toBe(before.feeUsdc);
  });

  it('previews the applicant-only fee even before the form is valid', () => {
    const evaluation = evaluateDraft(emptyDraft(), 'demo');
    expect(evaluation.canContinue).toBe(false);
    expect(evaluation.householdSize).toBe(1);
    expect(evaluation.feeUsdc).toBe(preapprovalFeeUsdc('demo', 1));
  });
});

describe('residence coverage', () => {
  it('blocks advancing when the five-year window has a gap, and explains it', () => {
    const gapped: Residence[] = [
      { countryCode: 'NL', fromYear: YEAR - 5, toYear: YEAR - 3 },
      { countryCode: 'DE', fromYear: YEAR - 1, toYear: 'present' },
    ];
    const draft: OnboardingDraft = { ...validDraft(), residences: gapped };
    const evaluation = evaluateDraft(draft, 'demo');

    expect(evaluation.canContinue).toBe(false);
    const expected = describeResidenceCoverage(residenceCoverage(gapped));
    expect(evaluation.blockers).toContain(expected);
    expect(evaluation.blockers.some((blocker) => /missing/.test(blocker))).toBe(
      true,
    );
  });

  it('accepts a default-added residence, which covers the whole window', () => {
    const draft = addResidence(
      { ...validDraft(), residences: [] },
      'DE',
      YEAR,
    );
    expect(evaluateDraft(draft, 'demo').canContinue).toBe(true);
  });
});

describe('citizenships', () => {
  it('prevents removing the last remaining citizenship', () => {
    const one = validDraft();
    expect(canRemoveCitizenship(one)).toBe(false);
    expect(removeCitizenship(one, 0).citizenships).toEqual(['NL']);

    const two = addCitizenship(one, 'DE');
    expect(canRemoveCitizenship(two)).toBe(true);
    expect(removeCitizenship(two, 0).citizenships).toEqual(['DE']);
  });

  it('does not add the same country twice', () => {
    const draft = addCitizenship(validDraft(), 'NL');
    expect(draft.citizenships).toEqual(['NL']);
  });
});

describe('advancing', () => {
  it('cannot advance while validation fails', () => {
    const evaluation = evaluateDraft(emptyDraft(), 'demo');
    expect(evaluation.canContinue).toBe(false);
    expect(evaluation.blockers).toContain(
      'At least one citizenship is required.',
    );
    expect(evaluation.blockers).toContain('First name is required.');
  });

  it('advances once every frozen rule passes', () => {
    expect(evaluateDraft(validDraft(), 'demo').canContinue).toBe(true);
  });

  it('refuses to build a persistence snapshot from an invalid draft', () => {
    expect(() => draftToSnapshot(emptyDraft(), 'demo')).toThrow(/incomplete/i);
  });

  it('builds a snapshot with no fee field for the client to smuggle', () => {
    const snapshot = draftToSnapshot(validDraft(), 'demo');
    expect(Object.keys(snapshot).sort()).toEqual([
      'citizenships',
      'members',
      'profile',
      'residences',
      'tier',
    ]);
  });
});
