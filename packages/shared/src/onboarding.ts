/**
 * Pre-registration Steps 1-2: the frozen shape and validation rules.
 *
 * Sources:
 *   - docs/week-1-frozen-delivery-contract.md section 4 (D5) and section 3
 *     (EXE-005): Steps 1-2 persist and restore the applicant profile, date of
 *     birth, citizenships, five-year residence history, tier and household,
 *     and display the server-controlled pre-approval fee.
 *   - docs/week-1-frozen-delivery-contract.md section 2.1: the applicant is
 *     included in the household size that drives the fee multiplier.
 *   - reference/design-handoff/README.md, "Step 2 · Profile & household",
 *     "Business rules", "State" and "Supabase schema": the field list, the
 *     14-country list, "at least one must remain", the three tiers and the
 *     residence year-range shape.
 *   - supabase/migrations/20260916000001_profiles.sql and
 *     20260916000002_applications.sql: the columns these values persist to.
 *
 * The handoff predates the frozen contract. Where the two disagree the
 * contract governs; the only material disagreement in this area is the
 * household size used by the fee (see `householdSize`).
 *
 * The fee formula lives in ./fees.js (`preapprovalFeeUsdc`); this module uses it
 * to validate and preview. The runtime authority is the database function
 * `public.preapproval_fee_usdc`, which reads the seeded `fee_schedule`; the seed
 * generator asserts the two agree (ADR 0005).
 *
 * Step split. Neither source divides this single handoff screen ("Step 2 ·
 * Profile & household") into two numbered steps, while the contract labels the
 * package "Steps 1-2" (section 3, EXE-005) and orders the fields profile →
 * citizenships → residences → tier → household (section 4, D5). This module
 * therefore reads:
 *   Step 1 — who is applying: profile, citizenships, residence history.
 *   Step 2 — what is being applied for and with whom: tier and household.
 * The split is an interpretation of the two documents, not a quoted rule.
 */

import { z } from 'zod';
import { preapprovalFeeUsdc, type FeeMode } from './fees.js';
import { sourced, type Provenance, type Sourced } from './provenance.js';

/* -------------------------------------------------------------------------- */
/* Countries                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The 14-country list, verbatim from the handoff
 * (reference/design-handoff/README.md, "Step 2 · Profile & household").
 * [documented] the codes are fixed by the handoff; nothing generic is added.
 */
export const COUNTRY_CODES = [
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

export type CountryCode = (typeof COUNTRY_CODES)[number];

export interface Country {
  readonly code: CountryCode;
  readonly name: string;
  /**
   * [arbitrary] The governing documents fix the 14 codes but not their
   * display names. These are conventional ISO 3166-1 English short names used
   * only by the UI; the code remains the stored value.
   */
  readonly nameProvenance: Provenance;
}

function country(code: CountryCode, name: string): Country {
  return { code, name, nameProvenance: 'arbitrary' };
}

/** Exactly the handoff list, in the order it is given. */
export const COUNTRIES: readonly Country[] = [
  country('NL', 'Netherlands'),
  country('DE', 'Germany'),
  country('US', 'United States'),
  country('GB', 'United Kingdom'),
  country('CH', 'Switzerland'),
  country('CA', 'Canada'),
  country('AE', 'United Arab Emirates'),
  country('SG', 'Singapore'),
  country('BR', 'Brazil'),
  country('VE', 'Venezuela'),
  country('CO', 'Colombia'),
  country('SR', 'Suriname'),
  country('ZA', 'South Africa'),
  country('PT', 'Portugal'),
];

/* -------------------------------------------------------------------------- */
/* Tiers                                                                      */
/* -------------------------------------------------------------------------- */

/** The prototype stores a tier index, not a name (handoff "State"). */
export type TierIndex = 0 | 1 | 2;

export type TierName = '3-year' | '5-year' | 'Indefinite';

export interface Tier {
  readonly index: TierIndex;
  readonly name: TierName;
  /** Production qualifying minimum in whole USDC (DOCX section 4). */
  readonly minUsdc: number;
}

/**
 * [documented] The three tiers and their production minimums are stated in the
 * handoff "Business rules" and DOCX section 4 / section 7
 * (`3-year $280k · 5-year $425k · Indefinite $850k`). The DOCX demo table also
 * scales these to $100 / $250 / $500; the frozen fee schedule is what controls
 * demo amounts (contract section 2.1), so the production minimums are kept
 * here.
 */
export const TIERS: readonly Tier[] = [
  { index: 0, name: '3-year', minUsdc: 280000 },
  { index: 1, name: '5-year', minUsdc: 425000 },
  { index: 2, name: 'Indefinite', minUsdc: 850000 },
];

/**
 * `applications.tier` stores the string form, not the prototype index
 * (20260916000002_applications.sql: `tier in ('3-year','5-year','indefinite')`).
 * [arbitrary] the migration records the lower-case encoding of "Indefinite"
 * as a chosen value; the other two are [documented].
 */
export const TIER_DATABASE_VALUES: Readonly<Record<TierIndex, Sourced<string>>> = {
  0: sourced('3-year', 'documented'),
  1: sourced('5-year', 'documented'),
  2: sourced('indefinite', 'arbitrary', 'the migration lower-cases "Indefinite"'),
};

/** The `applications.tier` value for a prototype tier index. */
export function tierDatabaseValue(index: TierIndex): string {
  return TIER_DATABASE_VALUES[index].value;
}

/* -------------------------------------------------------------------------- */
/* Schemas                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The applicant profile. Column mapping (profiles): firstName → first_name,
 * lastName → last_name, dob → dob (`date`).
 */
export const applicantProfile = z.object({
  firstName: z.string().trim().min(1, 'First name is required.'),
  lastName: z.string().trim().min(1, 'Last name is required.'),
  /** ISO 8601 calendar date (`YYYY-MM-DD`), the Postgres `date` wire format. */
  dob: z.iso.date(),
});

export type ApplicantProfile = z.infer<typeof applicantProfile>;

/**
 * A single country code from the 14-country list. Used for citizenships,
 * residence countries and household-member citizenship.
 */
export const citizenship = z.enum(COUNTRY_CODES);

export type Citizenship = z.infer<typeof citizenship>;

/**
 * [documented] The handoff says "At least one must remain", so an empty list is
 * invalid. Stored as one `profile_citizenships` row per code.
 */
export const citizenshipList = z
  .array(citizenship)
  .min(1, 'At least one citizenship is required.');

export type CitizenshipList = z.infer<typeof citizenshipList>;

/**
 * One residence period. Column mapping (profile_residences): countryCode →
 * country_code, fromYear → from_year, toYear → to_year.
 *
 * `toYear: 'present'` is the in-app sentinel for the current year; the
 * migration stores it as a NULL `to_year` ("A NULL to_year means current").
 */
export const residence = z
  .object({
    countryCode: citizenship,
    fromYear: z.number().int(),
    toYear: z.union([z.number().int(), z.literal('present')]),
  })
  .superRefine((value, ctx) => {
    if (value.toYear === 'present') return;
    if (value.toYear < value.fromYear) {
      ctx.addIssue({
        code: 'custom',
        message: 'A residence end year cannot be before its start year.',
        path: ['toYear'],
      });
    }
  });

export type Residence = z.infer<typeof residence>;

/** One contiguous run of uncovered years, inclusive. */
export interface ResidenceGap {
  readonly fromYear: number;
  readonly toYear: number;
}

export interface ResidenceCoverage {
  /** True when every year in the window is covered by at least one residence. */
  readonly covered: boolean;
  /** First year that must be covered, inclusive. */
  readonly windowFromYear: number;
  /** Last year that must be covered, inclusive. */
  readonly windowToYear: number;
  readonly coveredYears: readonly number[];
  readonly missingYears: readonly number[];
  readonly gaps: readonly ResidenceGap[];
}

/** [documented] "last 5 years" / "the required five-year period". */
export const RESIDENCE_COVERAGE_YEARS = 5;

/**
 * The union of the residence periods must cover the five years preceding the
 * current year: `currentYear - 5` through `currentYear - 1`, inclusive. A
 * `toYear` of `'present'` is read as the current year.
 *
 * Returns the structured coverage, not a boolean, so the UI can say exactly
 * which years are missing.
 */
export function residenceCoverage(
  residences: readonly Pick<Residence, 'fromYear' | 'toYear'>[],
  currentYear: number = new Date().getFullYear(),
): ResidenceCoverage {
  if (!Number.isInteger(currentYear)) {
    throw new RangeError(`currentYear must be an integer, received ${currentYear}`);
  }

  const windowFromYear = currentYear - RESIDENCE_COVERAGE_YEARS;
  const windowToYear = currentYear - 1;

  const covered = new Set<number>();
  for (const item of residences) {
    if (!Number.isInteger(item.fromYear)) continue;
    const to = item.toYear === 'present' ? currentYear : item.toYear;
    if (!Number.isInteger(to)) continue;
    const start = Math.max(item.fromYear, windowFromYear);
    const end = Math.min(to, windowToYear);
    for (let year = start; year <= end; year += 1) covered.add(year);
  }

  const missingYears: number[] = [];
  for (let year = windowFromYear; year <= windowToYear; year += 1) {
    if (!covered.has(year)) missingYears.push(year);
  }

  const gaps: ResidenceGap[] = [];
  for (const year of missingYears) {
    const last = gaps[gaps.length - 1];
    if (last && year === last.toYear + 1) {
      gaps[gaps.length - 1] = { fromYear: last.fromYear, toYear: year };
    } else {
      gaps.push({ fromYear: year, toYear: year });
    }
  }

  return {
    covered: missingYears.length === 0,
    windowFromYear,
    windowToYear,
    coveredYears: [...covered].sort((a, b) => a - b),
    missingYears,
    gaps,
  };
}

/** Human-readable explanation of a coverage result, for blocking messages. */
export function describeResidenceCoverage(coverage: ResidenceCoverage): string {
  const ranges = coverage.gaps.map((gap) =>
    gap.fromYear === gap.toYear ? `${gap.fromYear}` : `${gap.fromYear}-${gap.toYear}`,
  );
  return (
    `Residence history must cover ${coverage.windowFromYear}-${coverage.windowToYear}; ` +
    `missing ${ranges.join(', ')}.`
  );
}

/**
 * [documented] "Countries of residence (last 5 years) ... At least one".
 * Enforces both the non-empty list and the five-year coverage rule.
 */
export const residenceList = z
  .array(residence)
  .min(1, 'At least one country of residence is required.')
  .superRefine((list, ctx) => {
    const coverage = residenceCoverage(list);
    if (!coverage.covered) {
      ctx.addIssue({ code: 'custom', message: describeResidenceCoverage(coverage) });
    }
  });

export type ResidenceList = z.infer<typeof residenceList>;

/** `0 | 1 | 2`, the tier index the prototype stores. */
export const tierIndex = z.union([z.literal(0), z.literal(1), z.literal(2)]);

/**
 * A household member. Column mapping (household_members): name → name,
 * relation → relation, dob → dob, citizenship → citizenship.
 *
 * [arbitrary] the migration allows NULL for relation, dob and citizenship, but
 * the handoff presents every member row as fully filled, so the form schema is
 * stricter than the table. That is compatible: these columns accept the
 * validated values.
 */
export const householdMember = z.object({
  name: z.string().trim().min(1, 'Household member name is required.'),
  relation: z.string().trim().min(1, 'Household member relation is required.'),
  dob: z.iso.date(),
  citizenship,
});

export type HouseholdMember = z.infer<typeof householdMember>;

/**
 * The household list. Zero members is valid: the applicant alone is a
 * household of one.
 */
export const householdMemberList = z.array(householdMember);

/* -------------------------------------------------------------------------- */
/* Derived values                                                             */
/* -------------------------------------------------------------------------- */

/**
 * [documented] The applicant is included in the household size that drives the
 * fee multiplier (contract section 2.1). This disambiguates the handoff/DOCX
 * wording "1 USDC flat (+ 0.25 USDC per household member)", which could be read
 * as excluding the applicant, and their worked example "household of 3 yields
 * 1.75". Frozen: `1 + members.length`.
 */
export function householdSize(members: readonly unknown[]): number {
  return 1 + members.length;
}

export interface StepStatus {
  readonly complete: boolean;
  /** Human-readable, de-duplicated reasons the step cannot be advanced. */
  readonly blockers: readonly string[];
}

function issuesToMessages(result: {
  readonly error: { readonly issues: readonly { readonly message: string }[] };
}): string[] {
  return result.error.issues.map((issue) => issue.message);
}

/* -------------------------------------------------------------------------- */
/* Step 1 — profile, citizenships, residence history                          */
/* -------------------------------------------------------------------------- */

export interface StepOneInput {
  readonly applicant: unknown;
  readonly citizenships: unknown;
  readonly residences: unknown;
}

export function stepOneComplete(input: StepOneInput): StepStatus {
  const blockers: string[] = [];

  const applicant = applicantProfile.safeParse(input.applicant);
  if (!applicant.success) blockers.push(...issuesToMessages(applicant));

  const citizenships = citizenshipList.safeParse(input.citizenships);
  if (!citizenships.success) blockers.push(...issuesToMessages(citizenships));

  const residences = residenceList.safeParse(input.residences);
  if (!residences.success) blockers.push(...issuesToMessages(residences));

  const unique = [...new Set(blockers)];
  return { complete: unique.length === 0, blockers: unique };
}

/* -------------------------------------------------------------------------- */
/* Step 2 — tier and household, with the live pre-approval fee                */
/* -------------------------------------------------------------------------- */

export interface StepTwoInput {
  /** The active fee mode comes from server configuration, not the client. */
  readonly mode: FeeMode;
  readonly tier: unknown;
  readonly members: unknown;
}

export interface StepTwoStatus extends StepStatus {
  readonly householdSize: number;
  readonly preapprovalUsdc: number;
}

export function stepTwoComplete(input: StepTwoInput): StepTwoStatus {
  const blockers: string[] = [];

  const tier = tierIndex.safeParse(input.tier);
  if (!tier.success) blockers.push('Select a qualifying tier.');

  const rawMembers = input.members ?? [];
  const members = householdMemberList.safeParse(rawMembers);
  if (!members.success) blockers.push(...issuesToMessages(members));

  const size = householdSize(Array.isArray(rawMembers) ? rawMembers : []);

  const unique = [...new Set(blockers)];
  return {
    complete: unique.length === 0,
    blockers: unique,
    householdSize: size,
    // A preview through the shared reference. The stored and charged amount is
    // recomputed by the database from `fee_schedule`, and is never accepted
    // from the caller (contract section 2.1).
    preapprovalUsdc: preapprovalFeeUsdc(input.mode, size),
  };
}
