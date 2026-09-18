'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { preapprovalFeeUsdc, type FeeMode } from '@kade/shared';
import { SetupSidebar } from '@/components/shell/SetupSidebar';
import { SiteFooter } from '@/components/shell/SiteFooter';
import type { StepperItem } from '@/components/onboarding/PreRegistrationStepper';
import type { AccountState } from '@/components/auth/AccountSummary';
import type {
  OnboardingSnapshot,
  OnboardingStore,
} from '@/lib/onboarding/persistence';
import { OnboardingWizard } from './OnboardingWizard';
import { FeeStep, type FileRow } from './FeeStep';
import { MOCK_WALLETS, WealthStep } from './WealthStep';

type Step = 2 | 3 | 4;

export interface OnboardingFlowProps {
  readonly userId: string;
  readonly mode: FeeMode;
  readonly persistence: 'supabase' | 'not-configured';
  readonly initial: OnboardingSnapshot | null;
  readonly network: string;
  readonly accountState: AccountState;
  readonly currentYear?: number;
  readonly store?: OnboardingStore;
}

function steps(current: Step, paid: boolean): readonly StepperItem[] {
  const done = (index: Step) => current > index || (index === 4 && paid);
  const state = (index: Step): StepperItem['state'] => {
    if (done(index)) return 'done';
    if (current === index) return 'active';
    return 'locked';
  };
  return [
    { title: 'Create account', state: 'done' },
    { title: 'Profile & household', state: current === 2 ? 'active' : 'done' },
    { title: 'Proof of wealth', state: state(3), lockReason: 'Save your profile first.' },
    { title: 'Pay pre-approval fee', state: state(4), lockReason: 'Connect a wallet first.' },
  ];
}

/**
 * The pre-registration flow: steps 2 to 4 in one shell.
 *
 * The reference runs these as steps of a single page, with the sidebar showing
 * progress; this keeps that shape. Step state lives here rather than in the URL
 * so the walkthrough survives moving between steps.
 *
 * Steps 3 and 4 are demo-only: connecting a wallet attaches the reference's seed
 * balances, and paying flips local state. Neither touches a chain — payment
 * execution and wallet connection are excluded from Week 1 — and both screens say
 * so rather than implying a transaction happened.
 */
export function OnboardingFlow({
  userId,
  mode,
  persistence,
  initial,
  network,
  accountState,
  currentYear,
  store,
}: OnboardingFlowProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(2);
  const [connected, setConnected] = useState<readonly string[]>([]);
  const [paid, setPaid] = useState(false);
  const [snapshot, setSnapshot] = useState<OnboardingSnapshot | null>(initial);

  const householdSize = snapshot ? 1 + snapshot.members.length : 1;
  const feeUsdc = preapprovalFeeUsdc(mode, householdSize);

  const tierName = snapshot
    ? (['3-year', '5-year', 'Indefinite'][snapshot.tier] ?? '3-year')
    : '3-year';
  const tierMinimum = snapshot ? [280000, 425000, 850000][snapshot.tier] ?? 280000 : 280000;

  const linked = MOCK_WALLETS.filter((w) => connected.includes(w.key));
  const wealthTotal = linked.reduce((sum, w) => sum + w.value, 0);

  const fileRows = useMemo<readonly FileRow[]>(() => {
    const cits = snapshot?.citizenships.join(' / ') ?? '—';
    const residences = snapshot?.residences
      .map((r) => `${r.countryCode} ${r.fromYear}–${r.toYear === 'present' ? 'now' : r.toYear}`)
      .join(' · ') ?? '—';
    const names = snapshot?.members.map((m) => m.name.split(' ')[0]).join(', ') ?? '';
    return [
      {
        label: 'Applicant',
        value: `${snapshot?.profile.firstName ?? ''} ${snapshot?.profile.lastName ?? ''} · ${cits} · ${snapshot?.profile.dob ?? ''}`,
        status: 'Profile',
        tone: 'success',
      },
      {
        label: 'Residence',
        value: residences,
        status: `${snapshot?.residences.length ?? 0} clearance`,
        tone: 'success',
      },
      {
        label: 'Household',
        value: names
          ? `${names} · ${householdSize} derived permits`
          : `${householdSize} derived permits`,
        status: 'Listed',
        tone: 'success',
      },
      {
        label: 'Target tier',
        value: `${tierName} · $${tierMinimum.toLocaleString('en-US')} qualifying`,
        status: 'Selected',
        tone: 'success',
      },
      {
        label: 'Proof of wealth',
        value: `${linked.length} wallet${linked.length === 1 ? '' : 's'} · $${wealthTotal.toLocaleString('en-US')} · demo balances`,
        status: wealthTotal >= tierMinimum ? 'Meets tier' : 'Below tier',
        tone: wealthTotal >= tierMinimum ? 'success' : 'warning',
      },
    ];
  }, [snapshot, householdSize, tierName, tierMinimum, linked.length, wealthTotal]);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#fff',
        display: 'flex',
        alignItems: 'stretch',
      }}
    >
      <SetupSidebar steps={steps(step, paid)} network={network} accountState={accountState} />

      <main
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          maxWidth: '1160px',
          width: '100%',
          margin: '0 auto',
          padding: '36px 40px 64px',
        }}
      >
        {step === 2 ? (
          <OnboardingWizard
            mode={mode}
            userId={userId}
            persistence={persistence}
            initial={snapshot}
            store={store}
            currentYear={currentYear}
            onContinue={(saved) => {
              setSnapshot(saved);
              setStep(3);
            }}
          />
        ) : step === 3 ? (
          <WealthStep
            connected={connected}
            onConnect={(key) =>
              setConnected((current) =>
                current.includes(key) ? current : [...current, key],
              )
            }
            onContinue={() => setStep(4)}
            tierName={tierName}
            tierMinimum={tierMinimum}
          />
        ) : (
          <FeeStep
            rows={fileRows}
            feeUsdc={feeUsdc}
            mode={mode}
            paid={paid}
            onPay={() => setPaid(true)}
            onEnter={() => {
              router.push('/');
              router.refresh();
            }}
          />
        )}

        <SiteFooter />
      </main>
    </div>
  );
}
