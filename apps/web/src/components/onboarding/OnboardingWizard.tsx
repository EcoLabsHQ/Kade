'use client';

import { useRouter } from 'next/navigation';

import { useMemo, useState } from 'react';
import { COUNTRIES, type CountryCode, type FeeMode, type TierIndex } from '@kade/shared';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DatePicker } from '@/components/ui/DatePicker';
import { Field } from '@/components/ui/Field';
import { LockedAction } from '@/components/ui/LockedAction';
import { Notice } from '@/components/ui/Notice';
import { tokens } from '@/components/ui/tokens';
import {
  addCitizenship,
  addMember,
  addResidence,
  canRemoveCitizenship,
  countryName,
  draftFieldErrors,
  draftFromSnapshot,
  draftToSnapshot,
  emptyDraft,
  evaluateDraft,
  removeCitizenship,
  removeMember,
  removeResidence,
  updateMember,
  updateResidence,
  type DraftFieldErrors,
  type OnboardingDraft,
} from '@/lib/onboarding/draft';
import { saveOnboardingStep2 } from '@/app/onboarding/actions';
import {
  createNotConfiguredOnboardingStore,
  NOT_CONFIGURED_PERSISTENCE_REASON,
  type OnboardingSnapshot,
  type OnboardingStore,
  type PersistenceMode,
} from '@/lib/onboarding/persistence';
import { CitizenshipEditor } from './CitizenshipEditor';
import { HouseholdEditor } from './HouseholdEditor';
import { ResidenceEditor } from './ResidenceEditor';
import { TierSelector } from './TierSelector';

export interface OnboardingWizardProps {
  /** Active fee schedule, read server-side. The client cannot choose it. */
  readonly mode: FeeMode;
  readonly userId: string;
  readonly persistence: PersistenceMode;
  readonly initial?: OnboardingSnapshot | null;
  /** Test seam: supply a store instead of building one from `persistence`. */
  readonly store?: OnboardingStore;
  /**
   * Where a successful save leads. Receives the snapshot that was saved, so
   * later steps show what is actually stored. Defaults to the dashboard.
   */
  readonly onContinue?: (snapshot: OnboardingSnapshot) => void;
  readonly currentYear?: number;
}

type SaveStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved'; readonly serverFee: number | null }
  | { readonly kind: 'error'; readonly message: string };

const eyebrowStyle = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: tokens.muted,
} as const;

/**
 * Step 2 — Profile & household.
 *
 * The draft is evaluated with the frozen rules in `@kade/shared`. The fee is not
 * computed here: the server resolves it from `fee_schedule`, and the component
 * accepts no fee prop, so the browser cannot set it.
 */
export function OnboardingWizard({
  mode,
  userId,
  persistence,
  initial = null,
  store: storeProp,
  currentYear: currentYearProp,
  onContinue,
}: OnboardingWizardProps) {
  const router = useRouter();
  const currentYear = currentYearProp ?? new Date().getFullYear();
  const [draft, setDraft] = useState<OnboardingDraft>(() =>
    initial ? draftFromSnapshot(initial) : emptyDraft(),
  );
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' });
  const [showErrors, setShowErrors] = useState(false);

  const defaultStore = useMemo<OnboardingStore>(
    () =>
      persistence === 'supabase'
        ? {
            mode: 'supabase',
            // Restore happens server-side before render; nothing to read here.
            load: async () => null,
            // Writes go through a server action; the browser shapes none of them.
            save: (_userId, snapshot) => saveOnboardingStep2(snapshot),
          }
        : createNotConfiguredOnboardingStore(),
    [persistence],
  );
  const store = storeProp ?? defaultStore;

  const evaluation = useMemo(() => evaluateDraft(draft, mode), [draft, mode]);
  const fieldErrors = useMemo<DraftFieldErrors>(
    () => (showErrors ? draftFieldErrors(draft, mode) : {}),
    [showErrors, draft, mode],
  );

  const citizenshipOptions = useMemo(
    () =>
      COUNTRIES.filter(
        (country) => !draft.citizenships.includes(country.code),
      ),
    [draft.citizenships],
  );
  const residenceOptions = useMemo(
    () =>
      COUNTRIES.filter(
        (country) =>
          !draft.residences.some(
            (residence) => residence.countryCode === country.code,
          ),
      ),
    [draft.residences],
  );

  async function handleContinue() {
    if (!evaluation.canContinue) {
      setShowErrors(true);
      return;
    }
    if (store.mode !== 'supabase') {
      setShowErrors(true);
      setStatus({ kind: 'error', message: NOT_CONFIGURED_PERSISTENCE_REASON });
      return;
    }
    setStatus({ kind: 'saving' });
    try {
      const snapshot = draftToSnapshot(draft, mode);
      const persisted = await store.save(userId, snapshot);
      setStatus({ kind: 'saved', serverFee: persisted.preapprovalUsdc });
      // Saving is the step's whole purpose, so move the resident forward rather
      // than leaving them on a screen that looks like nothing happened.
      if (onContinue) {
        onContinue(snapshot);
      } else {
        router.push('/');
        router.refresh();
      }
    } catch (cause) {
      setStatus({
        kind: 'error',
        message:
          cause instanceof Error
            ? cause.message
            : 'Saving failed for an unknown reason. Some of your details may already have been saved.',
      });
    }
  }

  return (
    <div style={{ animation: 'fadeUp .2s ease-out' }}>
      <div style={eyebrowStyle}>Step 2 of 4</div>
      <h1
        style={{
          margin: '8px 0 6px',
          fontSize: '30px',
          fontWeight: 700,
          letterSpacing: '-.02em',
        }}
      >
        Tell us who is applying
      </h1>
      <p
        style={{
          margin: '0 0 24px',
          color: tokens.muted,
          maxWidth: '62ch',
          textWrap: 'pretty',
        }}
      >
        Basic profile and household. Full identity verification happens after
        pre-approval — here we only need enough to open your file.
      </p>

      {showErrors && !evaluation.canContinue ? (
        <Notice
          tone="error"
          title="Check the form"
          style={{ maxWidth: '920px', marginBottom: '16px' }}
        >
          Please complete all required fields to continue.
        </Notice>
      ) : null}

      {persistence === 'not-configured' ? (
        <Notice
          tone="warning"
          title="Saving not configured"
          style={{ maxWidth: '920px', marginBottom: '16px' }}
        >
          {NOT_CONFIGURED_PERSISTENCE_REASON}
        </Notice>
      ) : null}

      {status.kind === 'error' ? (
        <Notice
          tone="error"
          title="Save failed"
          style={{ maxWidth: '920px', marginBottom: '16px' }}
        >
          {status.message}
        </Notice>
      ) : null}

      <div
        className="kade-grid-profile"
        style={{
          gap: '16px',
          maxWidth: '920px',
          alignItems: 'start',
        }}
      >
        <Card>
          <div
            style={{
              ...eyebrowStyle,
              marginBottom: '14px',
            }}
          >
            Principal applicant
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '12px',
            }}
          >
            <Field
              id="first-name"
              label="First name"
              placeholder="First name"
              value={draft.firstName}
              invalid={Boolean(fieldErrors.firstName)}
              error={fieldErrors.firstName}
              onChange={(value) => setDraft((d) => ({ ...d, firstName: value }))}
            />
            <Field
              id="last-name"
              label="Last name"
              placeholder="Last name"
              value={draft.lastName}
              invalid={Boolean(fieldErrors.lastName)}
              error={fieldErrors.lastName}
              onChange={(value) => setDraft((d) => ({ ...d, lastName: value }))}
            />
            <DatePicker
              id="date-of-birth"
              label="Date of birth"
              value={draft.dob}
              invalid={Boolean(fieldErrors.dob)}
              error={fieldErrors.dob}
              onChange={(value) => setDraft((d) => ({ ...d, dob: value }))}
            />
            <CitizenshipEditor
              id="citizenships"
              citizenships={draft.citizenships}
              options={citizenshipOptions}
              removable={canRemoveCitizenship(draft)}
              getCountryName={countryName}
              invalid={Boolean(fieldErrors.citizenships)}
              onAdd={(code: CountryCode) =>
                setDraft((d) => addCitizenship(d, code))
              }
              onRemove={(index) =>
                setDraft((d) => removeCitizenship(d, index))
              }
            />
            <ResidenceEditor
              id="residences"
              residences={draft.residences}
              options={residenceOptions}
              currentYear={currentYear}
              getCountryName={countryName}
              invalid={Boolean(fieldErrors.residences)}
              onAdd={(code: CountryCode) =>
                setDraft((d) => addResidence(d, code, currentYear))
              }
              onRemove={(index) => setDraft((d) => removeResidence(d, index))}
              onUpdate={(index, patch) =>
                setDraft((d) => updateResidence(d, index, patch))
              }
            />
          </div>

          <div
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: tokens.muted,
              margin: '14px 0 6px',
            }}
          >
            Permit tier you are aiming for
          </div>
          <TierSelector
            value={draft.tier}
            invalid={Boolean(fieldErrors.tier)}
            onSelect={(index: TierIndex) =>
              setDraft((d) => ({ ...d, tier: index }))
            }
          />
        </Card>

        <HouseholdEditor
          members={draft.members}
          options={COUNTRIES}
          invalid={Boolean(fieldErrors.members)}
          onAdd={() => setDraft((d) => addMember(d))}
          onRemove={(index) => setDraft((d) => removeMember(d, index))}
          onUpdate={(index, patch) =>
            setDraft((d) => updateMember(d, index, patch))
          }
        />
      </div>


      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          marginTop: '22px',
          width: '100%',
          maxWidth: '920px',
        }}
      >
        <LockedAction
          reason="You are already signed in — account creation is Step 1 (contract section 2, item 2)."
          style={{ padding: '0 22px', fontSize: '15px', cursor: 'not-allowed' }}
        >
          Back
        </LockedAction>
        <Button
          variant={evaluation.canContinue ? 'primary' : 'locked'}
          title="Continue"
          onClick={handleContinue}
          style={evaluation.canContinue ? undefined : { cursor: 'pointer' }}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
