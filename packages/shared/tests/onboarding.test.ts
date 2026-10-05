import { describe, expect, it } from 'vitest';
import {
  applicantDob,
  citizenshipList,
  COUNTRIES,
  COUNTRY_CODES,
  gender,
  GENDER_VALUES,
  householdMemberDob,
  householdSize,
  isApplicantAdult,
  latestDobForAge,
  normalizeRelationForRead,
  preapprovalFeeUsdc,
  relation,
  RELATION_VALUES,
  residence,
  residenceCoverage,
  residenceList,
  stepOneComplete,
  stepTwoComplete,
  TIERS,
  tierDatabaseValue,
  tierIndex,
  type HouseholdMember,
  type Residence,
} from '../src/index.js';

const ADULT_DOB_MESSAGE = 'You must be at least 18 years old.';
const FUTURE_DOB_MESSAGE = 'Date of birth cannot be in the future.';

/** `iso` plus `days`, as a `YYYY-MM-DD` string, without a date library. */
function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year!, month! - 1, day! + days);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
}

/**
 * The field contract is frozen by docs/week-1-frozen-delivery-contract.md
 * section 4 (D5) and section 2.1, and specified by
 * reference/design-handoff/README.md ("Step 2 · Profile & household",
 * "Business rules"). The persistence targets are the two migrations.
 */

const EXPECTED_CODES = [
  'NL',
  'DE',
  'US',
  'GB',
  'CH',
  'CA',
  'AE',
  'SG',
  'BR',
  'VE',
  'CO',
  'SR',
  'ZA',
  'PT',
] as const;

const YEAR = new Date().getFullYear();

describe('COUNTRIES', () => {
  it('is exactly the 14-country handoff list, in order', () => {
    expect(COUNTRY_CODES).toEqual(EXPECTED_CODES);
    expect(COUNTRIES.map((c) => c.code)).toEqual(EXPECTED_CODES);
    expect(COUNTRIES).toHaveLength(14);
  });

  it('marks every display name as arbitrary, because only the codes are fixed', () => {
    for (const country of COUNTRIES) {
      expect(country.name.length).toBeGreaterThan(0);
      expect(country.nameProvenance).toBe('arbitrary');
    }
  });
});

describe('TIERS', () => {
  it('matches the three handoff tiers, plus the Colosseum demo tier, with the prototype index', () => {
    expect(TIERS).toEqual([
      { index: 0, name: '3-year', minUsdc: 280000 },
      { index: 1, name: '5-year', minUsdc: 425000 },
      { index: 2, name: 'Indefinite', minUsdc: 850000 },
      { index: 3, name: 'Colosseum Resident', minUsdc: 10 },
    ]);
  });

  it('keeps the three production tiers unchanged', () => {
    expect(TIERS.slice(0, 3)).toEqual([
      { index: 0, name: '3-year', minUsdc: 280000 },
      { index: 1, name: '5-year', minUsdc: 425000 },
      { index: 2, name: 'Indefinite', minUsdc: 850000 },
    ]);
  });

  it('the Colosseum Resident tier is a demo-scale 10 USDC', () => {
    const colosseum = TIERS.find((tier) => tier.name === 'Colosseum Resident');
    expect(colosseum?.minUsdc).toBe(10);
  });

  it('maps the index to the applications.tier encoding', () => {
    expect(tierDatabaseValue(0)).toBe('3-year');
    expect(tierDatabaseValue(1)).toBe('5-year');
    expect(tierDatabaseValue(2)).toBe('indefinite');
    expect(tierDatabaseValue(3)).toBe('colosseum');
  });

  it('tierIndex accepts 0, 1, 2, 3 and rejects anything else', () => {
    for (const index of [0, 1, 2, 3]) {
      expect(tierIndex.safeParse(index).success).toBe(true);
    }
    expect(tierIndex.safeParse(4).success).toBe(false);
    expect(tierIndex.safeParse(-1).success).toBe(false);
  });
});

describe('citizenshipList', () => {
  it('rejects zero citizenships', () => {
    expect(citizenshipList.safeParse([]).success).toBe(false);
  });

  it('accepts a single citizenship', () => {
    expect(citizenshipList.safeParse(['NL']).success).toBe(true);
  });

  it('accepts multiple citizenships', () => {
    expect(citizenshipList.safeParse(['NL', 'DE', 'SR']).success).toBe(true);
  });

  it('rejects a country outside the fixed 14-country list', () => {
    expect(citizenshipList.safeParse(['XX']).success).toBe(false);
  });
});

describe('gender', () => {
  it('is exactly Male, Female and Other', () => {
    expect(GENDER_VALUES).toEqual(['Male', 'Female', 'Other']);
  });

  it('accepts each allowed value and rejects anything else', () => {
    for (const value of GENDER_VALUES) {
      expect(gender.safeParse(value).success).toBe(true);
    }
    expect(gender.safeParse('male').success).toBe(false);
    expect(gender.safeParse('Non-binary').success).toBe(false);
    expect(gender.safeParse('').success).toBe(false);
  });
});

describe('relation', () => {
  it('is exactly Spouse, Partner and Child', () => {
    expect(RELATION_VALUES).toEqual(['Spouse', 'Partner', 'Child']);
  });

  it('accepts each allowed value and rejects free text', () => {
    for (const value of RELATION_VALUES) {
      expect(relation.safeParse(value).success).toBe(true);
    }
    expect(relation.safeParse('Son').success).toBe(false);
    expect(relation.safeParse('Dependent parent').success).toBe(false);
    expect(relation.safeParse('sibling').success).toBe(false);
  });

  it('maps legacy Son/Daughter to Child on read, case-insensitively', () => {
    expect(normalizeRelationForRead('Son')).toBe('Child');
    expect(normalizeRelationForRead('son')).toBe('Child');
    expect(normalizeRelationForRead('Daughter')).toBe('Child');
    expect(normalizeRelationForRead('DAUGHTER')).toBe('Child');
    expect(normalizeRelationForRead('  Son  ')).toBe('Child');
  });

  it('leaves the three valid values and unknown legacy text untouched on read', () => {
    for (const value of RELATION_VALUES) {
      expect(normalizeRelationForRead(value)).toBe(value);
    }
    // Not silently rewritten: an unrecognised value surfaces so it can be fixed.
    expect(normalizeRelationForRead('Dependent parent')).toBe('Dependent parent');
    expect(normalizeRelationForRead('sibling')).toBe('sibling');
  });
});

const fullSpan: Residence[] = [
  { countryCode: 'NL', fromYear: YEAR - 5, toYear: 'present' },
];

const gappedSpan: Residence[] = [
  { countryCode: 'NL', fromYear: YEAR - 5, toYear: YEAR - 3 },
  { countryCode: 'DE', fromYear: YEAR - 1, toYear: 'present' },
];

const singleThreeYearsAgo: Residence[] = [
  { countryCode: 'SR', fromYear: YEAR - 3, toYear: YEAR - 3 },
];

describe('residence coverage', () => {
  it('accepts a span that covers the five years preceding the current year', () => {
    const coverage = residenceCoverage(fullSpan);
    expect(coverage.covered).toBe(true);
    expect(coverage.windowFromYear).toBe(YEAR - 5);
    expect(coverage.windowToYear).toBe(YEAR - 1);
    expect(coverage.missingYears).toEqual([]);
    expect(residenceList.safeParse(fullSpan).success).toBe(true);
  });

  it('fails a span with a gap and reports the gap', () => {
    const coverage = residenceCoverage(gappedSpan);
    expect(coverage.covered).toBe(false);
    expect(coverage.missingYears).toEqual([YEAR - 2]);
    expect(coverage.gaps).toEqual([{ fromYear: YEAR - 2, toYear: YEAR - 2 }]);

    const parsed = residenceList.safeParse(gappedSpan);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => /missing/.test(issue.message))).toBe(true);
    }
  });

  it('fails a single residence from three years ago', () => {
    const coverage = residenceCoverage(singleThreeYearsAgo);
    expect(coverage.covered).toBe(false);
    expect(coverage.missingYears).toEqual([YEAR - 5, YEAR - 4, YEAR - 2, YEAR - 1]);
    expect(coverage.gaps).toEqual([
      { fromYear: YEAR - 5, toYear: YEAR - 4 },
      { fromYear: YEAR - 2, toYear: YEAR - 1 },
    ]);
    expect(residenceList.safeParse(singleThreeYearsAgo).success).toBe(false);
  });

  it('rejects a residence whose end year precedes its start year', () => {
    const backwards: Residence = { countryCode: 'NL', fromYear: YEAR - 1, toYear: YEAR - 4 };
    expect(residence.safeParse(backwards).success).toBe(false);
  });
});

describe('householdSize', () => {
  it('includes the applicant: zero members is a household of one (contract 2.1)', () => {
    expect(householdSize([])).toBe(1);
    expect(householdSize([{ name: 'A' }])).toBe(2);
  });
});

describe('applicant age — at least 18', () => {
  const today = new Date(2026, 8, 22); // 22 September 2026, local time

  it('accepts a date of birth exactly 18 years ago', () => {
    expect(latestDobForAge(18, today)).toBe('2008-09-22');
    expect(isApplicantAdult('2008-09-22', today)).toBe(true);
  });

  it('rejects a date of birth one day short of 18', () => {
    expect(isApplicantAdult('2008-09-23', today)).toBe(false);
  });

  it('accepts a clearly adult date of birth', () => {
    expect(isApplicantAdult('1990-01-01', today)).toBe(true);
  });

  it('exposes the message on the dob path for an under-18 applicant', () => {
    const cutoff = latestDobForAge(18);
    const tooYoung = addDays(cutoff, 1);

    const result = applicantDob.safeParse(tooYoung);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(ADULT_DOB_MESSAGE);
    }
  });

  it('accepts exactly-18 through step one and blocks one day short', () => {
    const cutoff = latestDobForAge(18);
    const exactly18 = stepOneComplete({
      applicant: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        dob: cutoff,
        gender: 'Female',
      },
      citizenships: ['NL'],
      residences: fullSpan,
    });
    expect(exactly18).toEqual({ complete: true, blockers: [] });

    const justShort = stepOneComplete({
      applicant: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        dob: addDays(cutoff, 1),
        gender: 'Female',
      },
      citizenships: ['NL'],
      residences: fullSpan,
    });
    expect(justShort.complete).toBe(false);
    expect(justShort.blockers).toContain(ADULT_DOB_MESSAGE);
  });
});

// Household members no longer carry an 18+ floor (human-directed: the rule was
// removed; minimum age is 0). These members mix relations and include a minor,
// and are used to prove the size/fee derivation rather than an age rule.
const threeMembers: HouseholdMember[] = [
  { name: 'Ada', relation: 'Spouse', dob: '1990-01-01', citizenship: 'NL', gender: 'Female' },
  { name: 'Grace', relation: 'Child', dob: '2015-05-05', citizenship: 'DE', gender: 'Female' },
  { name: 'Alan', relation: 'Child', dob: '2012-08-08', citizenship: 'US', gender: 'Male' },
];

describe('step one — profile, citizenships, residence history', () => {
  const valid = {
    applicant: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      dob: '1990-01-01',
      gender: 'Female',
    },
    citizenships: ['NL'],
    residences: fullSpan,
  };

  it('is complete for a full valid input', () => {
    expect(stepOneComplete(valid)).toEqual({ complete: true, blockers: [] });
  });

  it('blocks an empty profile', () => {
    const status = stepOneComplete({
      ...valid,
      applicant: { firstName: '', lastName: '', dob: '', gender: '' },
    });
    expect(status.complete).toBe(false);
    expect(status.blockers.length).toBeGreaterThanOrEqual(3);
  });

  it('blocks a profile with no gender selected', () => {
    const status = stepOneComplete({
      ...valid,
      applicant: { ...valid.applicant, gender: '' },
    });
    expect(status.complete).toBe(false);
    expect(status.blockers).toContain('Select a gender.');
  });

  it('blocks when no citizenship remains', () => {
    const status = stepOneComplete({ ...valid, citizenships: [] });
    expect(status.complete).toBe(false);
    expect(status.blockers).toContain('At least one citizenship is required.');
  });

  it('names the missing residence years', () => {
    const status = stepOneComplete({ ...valid, residences: gappedSpan });
    expect(status.complete).toBe(false);
    expect(status.blockers.some((blocker) => /missing/.test(blocker))).toBe(true);
  });
});

describe('step two — tier and household, with the live fee', () => {
  it('a household of 3 members is size 4 and matches the frozen fee', () => {
    const status = stepTwoComplete({ mode: 'demo', tier: 2, members: threeMembers });
    expect(status.complete).toBe(true);
    expect(status.householdSize).toBe(4);
    expect(status.householdSize).toBe(householdSize(threeMembers));
    expect(status.preapprovalUsdc).toBe(preapprovalFeeUsdc('demo', 4));
  });

  it('derives the production fee from preapprovalFeeUsdc, not a constant', () => {
    const status = stepTwoComplete({ mode: 'production', tier: 0, members: threeMembers });
    expect(status.preapprovalUsdc).toBe(preapprovalFeeUsdc('production', 4));
  });

  it('accepts an applicant-only household', () => {
    const status = stepTwoComplete({ mode: 'demo', tier: 1, members: [] });
    expect(status).toEqual({
      complete: true,
      blockers: [],
      householdSize: 1,
      preapprovalUsdc: preapprovalFeeUsdc('demo', 1),
    });
  });

  it('blocks when no tier is selected but still previews the fee', () => {
    const status = stepTwoComplete({ mode: 'demo', tier: undefined, members: [] });
    expect(status.complete).toBe(false);
    expect(status.blockers).toContain('Select a qualifying tier.');
    expect(status.householdSize).toBe(1);
    expect(status.preapprovalUsdc).toBe(preapprovalFeeUsdc('demo', 1));
  });

  it('blocks an invalid household member', () => {
    const status = stepTwoComplete({
      mode: 'demo',
      tier: 0,
      members: [
        {
          name: '',
          relation: '',
          dob: 'not-a-date',
          citizenship: 'XX',
          gender: '',
        },
      ],
    });
    expect(status.complete).toBe(false);
    expect(status.householdSize).toBe(2);
  });

  it('accepts a minor household member: the 18+ floor was removed', () => {
    // Human-directed change: minimum age is now 0. A child born in 2015 is a
    // valid household member.
    const memberDob = householdMemberDob.safeParse('2015-05-05');
    expect(memberDob.success).toBe(true);

    const status = stepTwoComplete({
      mode: 'demo',
      tier: 0,
      members: [
        {
          name: 'Grace',
          relation: 'Child',
          dob: '2015-05-05',
          citizenship: 'DE',
          gender: 'Female',
        },
      ],
    });
    expect(status.complete).toBe(true);
  });

  it('still rejects a future household date of birth', () => {
    const future = addDays(latestDobForAge(0), 1);
    const memberDob = householdMemberDob.safeParse(future);
    expect(memberDob.success).toBe(false);
    if (!memberDob.success) {
      expect(memberDob.error.issues[0]?.message).toBe(FUTURE_DOB_MESSAGE);
    }

    const status = stepTwoComplete({
      mode: 'demo',
      tier: 0,
      members: [
        {
          name: 'Grace',
          relation: 'Child',
          dob: future,
          citizenship: 'DE',
          gender: 'Female',
        },
      ],
    });
    expect(status.complete).toBe(false);
    expect(status.blockers).toContain(FUTURE_DOB_MESSAGE);
  });
});
