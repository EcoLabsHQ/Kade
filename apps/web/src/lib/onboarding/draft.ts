import {
  COUNTRIES,
  RESIDENCE_COVERAGE_YEARS,
  stepOneComplete,
  stepTwoComplete,
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
}

export interface OnboardingDraft {
  readonly firstName: string;
  readonly lastName: string;
  readonly dob: string;
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
    citizenships: [],
    residences: [],
    tier: null,
    members: [],
  };
}

/**
 * Demo defaults for the setup screens.
 *
 * This is a demo build and the reference pre-fills its forms, so Step 2 starts
 * populated instead of empty. The values reproduce the contract's worked
 * example: a household of three, which is the documented 1.75 USDC demo
 * pre-approval fee (section 2.1). Clearly demo data, not a real filing.
 */
export function demoDraft(
  currentYear: number = new Date().getFullYear(),
): OnboardingDraft {
  return {
    firstName: 'Marcus',
    lastName: 'Feldt',
    dob: '1982-03-14',
    citizenships: ['DE'],
    residences: [
      {
        countryCode: 'DE',
        fromYear: currentYear - RESIDENCE_COVERAGE_YEARS,
        toYear: 'present',
      },
    ],
    tier: 0,
    members: [
      {
        name: 'Lena Feldt',
        relation: 'Spouse',
        dob: '1985-07-22',
        citizenship: 'NL',
      },
      {
        name: 'Emil Feldt',
        relation: 'Son',
        dob: '2015-05-03',
        citizenship: 'DE',
      },
    ],
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
      { name: '', relation: '', dob: '', citizenship: '' },
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
  }));
  return {
    profile: {
      firstName: draft.firstName.trim(),
      lastName: draft.lastName.trim(),
      dob: draft.dob,
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
    citizenships: [...snapshot.citizenships],
    residences: [...snapshot.residences],
    tier: snapshot.tier,
    members: snapshot.members.map((member) => ({
      name: member.name,
      relation: member.relation,
      dob: member.dob,
      citizenship: member.citizenship,
    })),
  };
}
