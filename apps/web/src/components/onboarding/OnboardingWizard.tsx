'use client';

import { useMemo, useState } from 'react';
import { COUNTRIES, type CountryCode, type FeeMode, type TierIndex } from '@kade/shared';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { LockedAction } from '@/components/ui/LockedAction';
import { Notice } from '@/components/ui/Notice';
import { tokens } from '@/components/ui/tokens';
import { FeeSummary } from '@/components/fees/FeeSummary';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import {
  addCitizenship,
  addMember,
  addResidence,
  canRemoveCitizenship,
  countryName,
  draftFromSnapshot,
  draftToSnapshot,
  emptyDraft,
  evaluateDraft,
  removeCitizenship,
  removeMember,
  removeResidence,
  updateMember,
  updateResidence,
  type OnboardingDraft,
} from '@/lib/onboarding/draft';
import {
  createOnboardingStore,
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
 * The draft is evaluated with the frozen rules in `@kade/shared`; the live fee
 * comes from `stepTwoComplete` (the single implementation of the formula) and
 * the component accepts no fee prop, so the browser cannot set it.
 */
export function OnboardingWizard({
  mode,
  userId,
  persistence,
  initial = null,
  store: storeProp,
  currentYear: currentYearProp,
}: OnboardingWizardProps) {
  const currentYear = currentYearProp ?? new Date().getFullYear();
  const [draft, setDraft] = useState<OnboardingDraft>(() =>
    initial ? draftFromSnapshot(initial) : emptyDraft(),
  );
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' });

  const defaultStore = useMemo(
    () =>
      createOnboardingStore(persistence, () => createSupabaseBrowserClient()),
    [persistence],
  );
  const store = storeProp ?? defaultStore;

  const evaluation = useMemo(() => evaluateDraft(draft, mode), [draft, mode]);

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

  const savingDisabled = !evaluation.canContinue || store.mode !== 'supabase';
  const disabledReason = !evaluation.canContinue
    ? evaluation.blockers[0] ?? 'Complete the required fields to continue.'
    : NOT_CONFIGURED_PERSISTENCE_REASON;

  async function handleContinue() {
    if (!evaluation.canContinue) return;
    if (store.mode !== 'supabase') {
      setStatus({ kind: 'error', message: NOT_CONFIGURED_PERSISTENCE_REASON });
      return;
    }
    setStatus({ kind: 'saving' });
    try {
      const snapshot = draftToSnapshot(draft, mode);
      const persisted = await store.save(userId, snapshot);
      setStatus({ kind: 'saved', serverFee: persisted.preapprovalUsdc });
    } catch (cause) {
      setStatus({
        kind: 'error',
        message:
          cause instanceof Error
            ? cause.message
            : 'Saving failed for an unknown reason. Nothing was written.',
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

      {persistence === 'not-configured' ? (
        <Notice
          tone="warning"
          title="Saving not configured"
          style={{ maxWidth: '920px', marginBottom: '16px' }}
        >
          {NOT_CONFIGURED_PERSISTENCE_REASON}
        </Notice>
      ) : null}

      {!evaluation.canContinue ? (
        <Notice
          tone="warning"
          title="Before you can continue"
          style={{ maxWidth: '920px', marginBottom: '16px' }}
        >
          <ul style={{ margin: 0, paddingLeft: '18px' }}>
            {evaluation.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {status.kind === 'saving' ? (
        <Notice tone="info" style={{ maxWidth: '920px', marginBottom: '16px' }}>
          Saving your file…
        </Notice>
      ) : null}
      {status.kind === 'saved' ? (
        <Notice
          tone="success"
          title="Saved"
          style={{ maxWidth: '920px', marginBottom: '16px' }}
        >
          Your profile and household are stored against the active schedule.
          {status.serverFee !== null
            ? ` Server-confirmed pre-approval fee: ${status.serverFee.toFixed(2)} USDC.`
            : ' The server-recomputed fee could not be read back in this environment.'}
        </Notice>
      ) : null}
      {status.kind === 'error' ? (
        <Notice
          tone="error"
          title="Not saved"
          style={{ maxWidth: '920px', marginBottom: '16px' }}
        >
          {status.message}
        </Notice>
      ) : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.4fr 1fr',
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
              value={draft.firstName}
              onChange={(value) => setDraft((d) => ({ ...d, firstName: value }))}
            />
            <Field
              id="last-name"
              label="Last name"
              value={draft.lastName}
              onChange={(value) => setDraft((d) => ({ ...d, lastName: value }))}
            />
            <Field
              id="date-of-birth"
              label="Date of birth"
              type="date"
              value={draft.dob}
              onChange={(value) => setDraft((d) => ({ ...d, dob: value }))}
            />
            <CitizenshipEditor
              id="citizenships"
              citizenships={draft.citizenships}
              options={citizenshipOptions}
              removable={canRemoveCitizenship(draft)}
              getCountryName={countryName}
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
            onSelect={(index: TierIndex) =>
              setDraft((d) => ({ ...d, tier: index }))
            }
          />
        </Card>

        <HouseholdEditor
          members={draft.members}
          options={COUNTRIES}
          onAdd={() => setDraft((d) => addMember(d))}
          onRemove={(index) => setDraft((d) => removeMember(d, index))}
          onUpdate={(index, patch) =>
            setDraft((d) => updateMember(d, index, patch))
          }
        />
      </div>

      <Card
        style={{ maxWidth: '920px', marginTop: '16px' }}
        padding="16px 24px"
      >
        <FeeSummary mode={mode} householdSize={evaluation.householdSize} />
        <p
          style={{
            margin: '8px 0 0',
            fontSize: '11.5px',
            color: tokens.muted,
            lineHeight: 1.6,
          }}
        >
          Recalculated live from the frozen formula as the household changes. The
          authoritative amount is recomputed by the database on save; the browser
          supplies no amount.
        </p>
      </Card>

      <div
        style={{
          display: 'flex',
          gap: '10px',
          marginTop: '22px',
          maxWidth: '920px',
        }}
      >
        <Button
          variant={savingDisabled ? 'locked' : 'primary'}
          disabled={savingDisabled}
          title={savingDisabled ? disabledReason : 'Save and continue'}
          onClick={handleContinue}
        >
          Continue
        </Button>
        <LockedAction
          reason="You are already signed in — account creation is Step 1 (contract section 2, item 2)."
          style={{ padding: '0 22px', fontSize: '15px', cursor: 'not-allowed' }}
        >
          Back
        </LockedAction>
      </div>
    </div>
  );
}
