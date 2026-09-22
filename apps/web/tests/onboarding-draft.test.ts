import { describe, expect, it } from 'vitest';
import {
  describeResidenceCoverage,
  isApplicantAdult,
  latestDobForAge,
  residenceCoverage,
  type Residence,
} from '@kade/shared';
import { preapprovalBreakdownFromSchedule } from '@/lib/onboarding/fee';
import {
  addCitizenship,
  addMember,
  addResidence,
  canRemoveCitizenship,
  draftFieldErrors,
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
 * model calls them rather than re-implementing them. The model deliberately
 * computes no fee: that is the server's, resolved from the active
 * `fee_schedule` (contract section 2.1).
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

describe('household size and the configured fee', () => {
  it('no longer computes a fee from the shared formula', () => {
    // The draft model reports validation and size only. Surfacing a fee here
    // is what let the shared formula pass for the authoritative amount.
    const evaluation = evaluateDraft(validDraft(), 'demo');
    expect(evaluation).not.toHaveProperty('feeUsdc');
    expect(Object.keys(evaluation).sort()).toEqual([
      'blockers',
      'canContinue',
      'householdSize',
      'stepOne',
      'stepTwo',
    ]);
  });

  it('updates the household size when a member is added and removed', () => {
    const base = validDraft();
    expect(evaluateDraft(base, 'demo').householdSize).toBe(1);

    const withMember = updateMember(addMember(base), 0, {
      name: 'Grace',
      relation: 'Daughter',
      dob: '2015-05-05',
      citizenship: 'DE',
    });
    expect(evaluateDraft(withMember, 'demo').householdSize).toBe(2);

    const removed = removeMember(withMember, 0);
    expect(evaluateDraft(removed, 'demo').householdSize).toBe(1);
  });

  it('previews the applicant-only fee from a configured schedule', () => {
    const schedule = {
      mode: 'demo',
      baseUsdc: 1,
      perMemberUsdc: 0.25,
      roundingScale: 2,
    } as const;
    const evaluation = evaluateDraft(emptyDraft(), 'demo');
    expect(evaluation.canContinue).toBe(false);
    expect(evaluation.householdSize).toBe(1);
    // 1.00 base + 0.25 x 1, the seeded demo schedule.
    expect(
      preapprovalBreakdownFromSchedule(schedule, evaluation.householdSize)
        .totalUsdc,
    ).toBe(1.25);
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

describe('field-level errors', () => {
  it('flags every mandatory group on an empty draft', () => {
    const errors = draftFieldErrors(emptyDraft(), 'demo');
    expect(errors.firstName).toBeTruthy();
    expect(errors.lastName).toBeTruthy();
    expect(errors.dob).toBeTruthy();
    expect(errors.citizenships).toBeTruthy();
    expect(errors.residences).toBeTruthy();
    expect(errors.tier).toBeTruthy();
    // A household with no members is valid: the applicant alone is the household.
    expect(errors.members).toBeUndefined();
  });

  it('reports nothing for a draft that satisfies every frozen rule', () => {
    expect(draftFieldErrors(validDraft(), 'demo')).toEqual({});
  });

  it('groups residence coverage and household issues onto their form groups', () => {
    const gapped: OnboardingDraft = {
      ...validDraft(),
      residences: [
        { countryCode: 'NL', fromYear: YEAR - 5, toYear: YEAR - 3 },
        { countryCode: 'DE', fromYear: YEAR - 1, toYear: 'present' },
      ],
    };
    const residencesErrors = draftFieldErrors(gapped, 'demo');
    expect(residencesErrors.residences).toBeTruthy();
    expect(residencesErrors.firstName).toBeUndefined();

    const withIncompleteMember = addMember(validDraft());
    expect(draftFieldErrors(withIncompleteMember, 'demo').members).toBeTruthy();
  });
});

describe('applicant age — at least 18', () => {
  const ADULT_DOB_MESSAGE = 'You must be at least 18 years old.';

  /** `iso` plus `days`, as a `YYYY-MM-DD` string. */
  function addDays(iso: string, days: number): string {
    const [year, month, day] = iso.split('-').map(Number);
    const date = new Date(year!, month! - 1, day! + days);
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${mm}-${dd}`;
  }

  it('accepts a date of birth exactly 18 years ago and rejects one day short', () => {
    const cutoff = latestDobForAge(18);
    expect(isApplicantAdult(cutoff)).toBe(true);
    expect(isApplicantAdult(addDays(cutoff, 1))).toBe(false);
  });

  it('marks the dob field with the shared message for an under-18 applicant', () => {
    const draft: OnboardingDraft = {
      ...validDraft(),
      dob: addDays(latestDobForAge(18), 1),
    };

    expect(draftFieldErrors(draft, 'demo').dob).toBe(ADULT_DOB_MESSAGE);

    const evaluation = evaluateDraft(draft, 'demo');
    expect(evaluation.canContinue).toBe(false);
    expect(evaluation.blockers).toContain(ADULT_DOB_MESSAGE);
    expect(() => draftToSnapshot(draft, 'demo')).toThrow(/incomplete/i);
  });

  it('accepts a clearly adult date of birth on the dob field', () => {
    expect(draftFieldErrors(validDraft(), 'demo').dob).toBeUndefined();
    expect(evaluateDraft(validDraft(), 'demo').canContinue).toBe(true);
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
