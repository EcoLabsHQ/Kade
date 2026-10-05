import {
  COUNTRIES,
  RESIDENCE_COVERAGE_YEARS,
  applicantProfile,
  citizenshipList,
  householdMemberList,
  normalizeRelationForRead,
  residenceList,
  stepOneComplete,
  stepTwoComplete,
  tierIndex,
  type CountryCode,
  type FeeMode,
  type HouseholdMember,
  type Residence,
  type StepStatus,
  type StepTwoStatus,
  type TierIndex,
} from '@kade/shared';
import type { OnboardingSnapshot } from './persistence';

/**
 * The editable shape of Step 2 ("Profile & household").
 *
 * This is a client-side draft only. It deliberately holds raw strings so the
 * form can be incomplete while the applicant types; the frozen rules live in
 * `@kade/shared` and are applied by `evaluateDraft`, never re-implemented here.
 *
 * The draft carries no fee field and computes no fee. The server resolves the
 * pre-approval fee from the active `fee_schedule`, and the persisted
 * authoritative value is recomputed by the database (contract section 2.1).
 */

export interface HouseholdMemberDraft {
  readonly name: string;
  readonly relation: string;
  readonly dob: string;
  readonly citizenship: CountryCode | '';
  readonly gender: string;
}

export interface OnboardingDraft {
  readonly firstName: string;
  readonly lastName: string;
  readonly dob: string;
  readonly gender: string;
  readonly citizenships: readonly CountryCode[];
  readonly residences: readonly Residence[];
  readonly tier: TierIndex | null;
  readonly members: readonly HouseholdMemberDraft[];
}

export const RESIDENCE_YEARS_BACK = 30;

export function emptyDraft(): OnboardingDraft {
  return {
    firstName: '',
    lastName: '',
    dob: '',
    gender: '',
    citizenships: [],
    residences: [],
    tier: null,
    members: [],
  };
}

export function countryName(code: CountryCode | ''): string {
  if (code === '') return '';
  return COUNTRIES.find((country) => country.code === code)?.name ?? code;
}

/** Year range each added residence defaults to: the full required window. */
export function defaultResidenceRange(
  currentYear: number = new Date().getFullYear(),
): { readonly fromYear: number; readonly toYear: 'present' } {
  return { fromYear: currentYear - RESIDENCE_COVERAGE_YEARS, toYear: 'present' };
}

/* -------------------------------------------------------------------------- */
/* Citizenships                                                               */
/* -------------------------------------------------------------------------- */

export function canRemoveCitizenship(draft: OnboardingDraft): boolean {
  return draft.citizenships.length > 1;
}

export function addCitizenship(
  draft: OnboardingDraft,
  code: CountryCode,
): OnboardingDraft {
  if (draft.citizenships.includes(code)) return draft;
  return { ...draft, citizenships: [...draft.citizenships, code] };
}

/**
 * Removes a citizenship, but never the last one: the frozen rule is "at least
 * one must remain" (`citizenshipList` in `@kade/shared`).
 */
export function removeCitizenship(
  draft: OnboardingDraft,
  index: number,
): OnboardingDraft {
  if (!canRemoveCitizenship(draft)) return draft;
  return {
    ...draft,
    citizenships: draft.citizenships.filter((_, i) => i !== index),
  };
}

/* -------------------------------------------------------------------------- */
/* Residences                                                                 */
/* -------------------------------------------------------------------------- */

export function addResidence(
  draft: OnboardingDraft,
  code: CountryCode,
  currentYear: number = new Date().getFullYear(),
): OnboardingDraft {
  if (draft.residences.some((residence) => residence.countryCode === code)) {
    return draft;
  }
  const range = defaultResidenceRange(currentYear);
  return {
    ...draft,
    residences: [
      ...draft.residences,
      { countryCode: code, fromYear: range.fromYear, toYear: range.toYear },
    ],
  };
}

export function removeResidence(
  draft: OnboardingDraft,
  index: number,
): OnboardingDraft {
  return {
    ...draft,
    residences: draft.residences.filter((_, i) => i !== index),
  };
}

export function updateResidence(
  draft: OnboardingDraft,
  index: number,
  patch: Partial<Pick<Residence, 'fromYear' | 'toYear'>>,
): OnboardingDraft {
  return {
    ...draft,
    residences: draft.residences.map((residence, i) =>
      i === index ? { ...residence, ...patch } : residence,
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* Household                                                                  */
/* -------------------------------------------------------------------------- */

export function addMember(draft: OnboardingDraft): OnboardingDraft {
  return {
    ...draft,
    members: [
      ...draft.members,
      { name: '', relation: '', dob: '', citizenship: '', gender: '' },
    ],
  };
}

export function removeMember(
  draft: OnboardingDraft,
  index: number,
): OnboardingDraft {
  return { ...draft, members: draft.members.filter((_, i) => i !== index) };
}

export function updateMember(
  draft: OnboardingDraft,
  index: number,
  patch: Partial<HouseholdMemberDraft>,
): OnboardingDraft {
  return {
    ...draft,
    members: draft.members.map((member, i) =>
      i === index ? { ...member, ...patch } : member,
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* Evaluation                                                                 */
/* -------------------------------------------------------------------------- */

export interface DraftEvaluation {
  readonly stepOne: StepStatus;
  readonly stepTwo: StepTwoStatus;
  /** De-duplicated blockers from both halves, in the shared module's wording. */
  readonly blockers: readonly string[];
  readonly householdSize: number;
  readonly canContinue: boolean;
}

/**
 * Runs the frozen rules for both halves of the handoff's Step 2 screen.
 *
 * This deliberately reports no fee: the pre-approval fee is not computed here.
 * The server resolves it from the active `fee_schedule` and the client only
 * displays that value (contract section 2.1). `stepTwoComplete` still returns
 * its own copy for validation, but it is discarded so nothing downstream can
 * mistake the shared formula for the authoritative amount.
 */
export function evaluateDraft(
  draft: OnboardingDraft,
  mode: FeeMode,
): DraftEvaluation {
  const stepOne = stepOneComplete({
    applicant: {
      firstName: draft.firstName,
      lastName: draft.lastName,
      dob: draft.dob,
      gender: draft.gender,
    },
    citizenships: draft.citizenships,
    residences: draft.residences,
  });
  const stepTwo = stepTwoComplete({
    mode,
    tier: draft.tier,
    members: draft.members,
  });
  const blockers = [...new Set([...stepOne.blockers, ...stepTwo.blockers])];
  return {
    stepOne,
    stepTwo,
    blockers,
    householdSize: stepTwo.householdSize,
    canContinue: stepOne.complete && stepTwo.complete,
  };
}

/* -------------------------------------------------------------------------- */
/* Field-level errors                                                         */
/* -------------------------------------------------------------------------- */

/** Inline messages for the groups the form marks after a failed Continue. */
export interface DraftFieldErrors {
  readonly firstName?: string;
  readonly lastName?: string;
  readonly dob?: string;
  readonly gender?: string;
  readonly citizenships?: string;
  readonly residences?: string;
  readonly tier?: string;
  readonly members?: string;
}

/**
 * Field-level messages for the wizard's inline marking.
 *
 * This reads the frozen zod schemas in `@kade/shared` rather than restating
 * their rules: each schema is `safeParse`-d, its issues are grouped onto the
 * form group they belong to, and the first message for each group is kept.
 * `mode` is accepted so the signature is stable for callers; it does not
 * influence the result because no rule here is fee-dependent.
 */
export function draftFieldErrors(
  draft: OnboardingDraft,
  mode: FeeMode,
): DraftFieldErrors {
  void mode;

  const errors: {
    firstName?: string;
    lastName?: string;
    dob?: string;
    gender?: string;
    citizenships?: string;
    residences?: string;
    tier?: string;
    members?: string;
  } = {};

  const profile = applicantProfile.safeParse({
    firstName: draft.firstName,
    lastName: draft.lastName,
    dob: draft.dob,
    gender: draft.gender,
  });
  if (!profile.success) {
    for (const issue of profile.error.issues) {
      const field = issue.path[0];
      if (field === 'firstName' && errors.firstName === undefined) {
        errors.firstName = issue.message;
      } else if (field === 'lastName' && errors.lastName === undefined) {
        errors.lastName = issue.message;
      } else if (field === 'dob' && errors.dob === undefined) {
        errors.dob = issue.message;
      } else if (field === 'gender' && errors.gender === undefined) {
        errors.gender = issue.message;
      }
    }
  }

  const citizenships = citizenshipList.safeParse(draft.citizenships);
  if (!citizenships.success) {
    errors.citizenships = citizenships.error.issues[0]?.message;
  }

  const residences = residenceList.safeParse(draft.residences);
  if (!residences.success) {
    errors.residences = residences.error.issues[0]?.message;
  }

  const tier = tierIndex.safeParse(draft.tier);
  if (!tier.success) {
    errors.tier = tier.error.issues[0]?.message;
  }

  const members = householdMemberList.safeParse(draft.members);
  if (!members.success) {
    errors.members = members.error.issues[0]?.message;
  }

  return errors;
}

/** Only valid for a draft that has passed `evaluateDraft`. */
export function draftToSnapshot(
  draft: OnboardingDraft,
  mode: FeeMode,
): OnboardingSnapshot {
  const evaluation = evaluateDraft(draft, mode);
  if (!evaluation.canContinue || draft.tier === null) {
    throw new Error(
      'Cannot build a snapshot from an incomplete draft; evaluate it first.',
    );
  }
  const members: HouseholdMember[] = draft.members.map((member) => ({
    name: member.name.trim(),
    relation: member.relation.trim(),
    dob: member.dob,
    citizenship: member.citizenship as CountryCode,
    gender: member.gender,
  }));
  return {
    profile: {
      firstName: draft.firstName.trim(),
      lastName: draft.lastName.trim(),
      dob: draft.dob,
      gender: draft.gender,
    },
    citizenships: [...draft.citizenships],
    residences: [...draft.residences],
    tier: draft.tier,
    members,
  };
}

export function draftFromSnapshot(snapshot: OnboardingSnapshot): OnboardingDraft {
  return {
    firstName: snapshot.profile.firstName,
    lastName: snapshot.profile.lastName,
    dob: snapshot.profile.dob,
    gender: snapshot.profile.gender,
    citizenships: [...snapshot.citizenships],
    residences: [...snapshot.residences],
    tier: snapshot.tier,
    members: snapshot.members.map((member) => ({
      name: member.name,
      relation: normalizeRelationForRead(member.relation),
      dob: member.dob,
      citizenship: member.citizenship,
      gender: member.gender,
    })),
  };
}
