'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Hex } from 'viem';
import { useRouter } from 'next/navigation';
import { TIERS, type FeeMode } from '@kade/shared';
import { previewPreapprovalFee } from '@/app/onboarding/actions';
import {
  addBitcoinAddress,
  removeBitcoinAddress,
} from '@/app/onboarding/wealth-actions';
import {
  addWalletAddress,
  removeWalletAddress,
} from '@/app/onboarding/wallet-actions';
import type {
  BitcoinAddressRecord,
  EvmAddressRecord,
} from '@/lib/wealth/types';
import { SetupSidebar } from '@/components/shell/SetupSidebar';
import { ContentContainer } from '@/components/shell/ContentContainer';
import { SiteFooter } from '@/components/shell/SiteFooter';
import type { StepperItem } from '@/components/onboarding/PreRegistrationStepper';
import type { AccountState } from '@/components/auth/AccountSummary';
import type { PreapprovalFeeBreakdown } from '@/lib/onboarding/fee';
import type { FeePaymentState } from '@/lib/payments/preapproval-fee';
import type {
  OnboardingSnapshot,
  OnboardingStore,
} from '@/lib/onboarding/persistence';
import { OnboardingWizard } from './OnboardingWizard';
import { FeeStep, type FileRow } from './FeeStep';
import { WealthStep } from './WealthStep';
import { AccountSetupStep } from './AccountSetupStep';

/** The account phase creates the passkey; 2-4 are the pre-registration steps. */
type Step = 'account' | 2 | 3 | 4;

/** The entry tier, shown before the resident has chosen one. */
const DEFAULT_TIER = TIERS[0];

export interface OnboardingFlowProps {
  readonly userId: string;
  readonly mode: FeeMode;
  readonly persistence: 'supabase' | 'not-configured';
  readonly initial: OnboardingSnapshot | null;
  readonly network: string;
  readonly accountState: AccountState;
  /**
   * The fee for the restored household, resolved on the server from the active
   * `fee_schedule`. Null when it could not be read; the screen then says so
   * instead of showing an amount.
   */
  readonly initialFee: PreapprovalFeeBreakdown | null;
  readonly currentYear?: number;
  /** A credential that already exists, so a returning resident skips step 1. */
  readonly initialCredentialId?: string | null;
  readonly store?: OnboardingStore;
  /**
   * Bitcoin addresses already confirmed for this resident, restored server-side.
   * Read-only every time the flow mounts; the balances are re-read by the action.
   */
  readonly initialBitcoinAddresses?: readonly BitcoinAddressRecord[];
  /**
   * Pasted EVM addresses already confirmed for this resident, restored
   * server-side. Read-only every time the flow mounts; balances are re-read.
   */
  readonly initialEvmAddresses?: readonly EvmAddressRecord[];
  /**
   * The pre-approval fee payment state, resolved server-side from
   * `applications.fee_tx` and re-verified against the Sepolia receipt. Only
   * `paid` opens the platform.
   */
  readonly initialPayment: FeePaymentState;
  /** True when both the wallet modal and the fee rail are configured. */
  readonly paymentConfigured: boolean;
  /** The Kade treasury, resolved on the server; null when unconfigured. */
  readonly treasuryAddress: string | null;
  /** USDC on Ethereum Sepolia, from `@kade/shared` chain configuration. */
  readonly usdcAddress: string;
  readonly explorerUrl: string;
  /** True when the WalletConnect project id is configured for this environment. */
  readonly walletConfigured: boolean;
}

function steps(current: Step, paid: boolean): readonly StepperItem[] {
  const position = current === 'account' ? 1 : current;
  const reached = (index: number) => position > index;
  const state = (index: number): StepperItem['state'] => {
    if (reached(index) || (index === 4 && paid)) return 'done';
    if (position === index) return 'active';
    return 'locked';
  };
  return [
    {
      title: 'Create account',
      state: current === 'account' ? 'active' : 'done',
    },
    { title: 'Profile & household', state: state(2), lockReason: 'Create your passkey first.' },
    { title: 'Proof of wealth', state: state(3), lockReason: 'Save your profile first.' },
    { title: 'Pay pre-approval fee', state: state(4), lockReason: 'Add a wallet or a Bitcoin address, or paste a wallet address, first.' },
  ];
}

/**
 * The pre-registration flow: steps 2 to 4 in one shell.
 *
 * The reference runs these as steps of a single page, with the sidebar showing
 * progress; this keeps that shape. Step state lives here rather than in the URL
 * so the walkthrough survives moving between steps.
 *
 * Step 3 holds three different things. The browser-extension and WalletConnect
 * rows are demo: connecting attaches the reference's seed balances and the rows
 * are labelled demo. Bitcoin and pasted EVM addresses are real but read-only:
 * the resident pastes an address and the server reads its balances from a public
 * source, with no ownership proof, so the screen says so rather than implying
 * control. Step 4's payment is real on Ethereum Sepolia: the resident connects
 * an external wallet and sends USDC to the Kade treasury, and the server
 * verifies the receipt before the step is marked paid (contract v1.9, section
 * 8.9). The wallet connection is payment-only and confers no authority over the
 * Safe.
 */
export function OnboardingFlow({
  userId,
  mode,
  persistence,
  initial,
  network,
  accountState,
  initialFee,
  currentYear,
  initialCredentialId = null,
  store,
  initialBitcoinAddresses = [],
  initialEvmAddresses = [],
  initialPayment,
  paymentConfigured,
  treasuryAddress,
  usdcAddress,
  explorerUrl,
  walletConfigured,
}: OnboardingFlowProps) {
  const router = useRouter();
  // The passkey is created before the pre-registration steps, as the reference's
  // Step 1 does in the background.
  const [credentialId, setCredentialId] = useState<string | null>(
    initialCredentialId,
  );
  const [step, setStep] = useState<Step>(
    initialCredentialId ? 2 : 'account',
  );
  // The connected wallet is reported by the panel, which owns the AppKit
  // hooks; only its address and USD figure matter here, for the tier total.
  const [connectedWallet, setConnectedWallet] = useState<{
    readonly address: string;
    readonly usd: number | null;
  } | null>(null);
  const [bitcoinAddresses, setBitcoinAddresses] = useState<
    readonly BitcoinAddressRecord[]
  >(initialBitcoinAddresses);
  const [evmAddresses, setEvmAddresses] = useState<readonly EvmAddressRecord[]>(
    initialEvmAddresses,
  );
  // Paid is restored from the server, not assumed: the platform opens only
  // when the recorded payment still verifies on chain.
  const [paid, setPaid] = useState(initialPayment.status === 'paid');
  const [snapshot, setSnapshot] = useState<OnboardingSnapshot | null>(initial);
  // The server's fee for a household size, tagged with the size it belongs to
  // so a stale amount is never shown while a new one is being resolved.
  const [fee, setFee] = useState<{
    readonly breakdown: PreapprovalFeeBreakdown | null;
    readonly householdSize: number;
  }>(() => ({
    breakdown: initialFee,
    householdSize: initial ? 1 + initial.members.length : 1,
  }));

  const householdSize = snapshot ? 1 + snapshot.members.length : 1;

  // Stable so the payment component's confirmation effect does not re-run on
  // every render of the flow.
  const handlePaid = useCallback((txHash: Hex) => {
    void txHash;
    setPaid(true);
  }, []);

  // The browser never computes the amount. It asks the server, which reads the
  // active fee_schedule and returns the database's own answer.
  useEffect(() => {
    let active = true;
    previewPreapprovalFee(householdSize)
      .then((resolved) => {
        if (active) setFee({ breakdown: resolved, householdSize });
      })
      .catch(() => {
        if (active) setFee({ breakdown: null, householdSize });
      });
    return () => {
      active = false;
    };
  }, [householdSize]);

  const breakdown =
    fee.householdSize === householdSize ? fee.breakdown : null;

  // The name and qualifying minimum come from the resident's own tier, resolved
  // against the frozen tier table rather than copied here as literals.
  const tier = snapshot ? TIERS[snapshot.tier] : DEFAULT_TIER;
  const tierName = tier?.name ?? '3-year';
  const tierMinimum = tier?.minUsdc ?? 280000;

  const bitcoinTotal = bitcoinAddresses.reduce(
    (sum, record) => sum + (record.usd ?? 0),
    0,
  );
  const evmTotal = evmAddresses.reduce(
    (sum, record) => sum + (record.usd ?? 0),
    0,
  );
  const walletTotal = connectedWallet?.usd ?? 0;
  const wealthTotal = bitcoinTotal + evmTotal + walletTotal;

  // The Bitcoin actions both read and write on the server. The browser only
  // shows the record the server returns, so a read that failed is presented as
  // such rather than as a balance.
  async function handleAddBitcoin(address: string) {
    const record = await addBitcoinAddress(address);
    // Re-adding an address the resident already saved is idempotent on the
    // server and returns the existing row, so replace rather than append: the
    // same address must never render twice.
    setBitcoinAddresses((current) =>
      current.some((existing) => existing.id === record.id)
        ? current.map((existing) => (existing.id === record.id ? record : existing))
        : [...current, record],
    );
  }

  async function handleRemoveBitcoin(id: number) {
    await removeBitcoinAddress(id);
    setBitcoinAddresses((current) =>
      current.filter((record) => record.id !== id),
    );
  }

  // The EVM actions are keyed by address: re-adding an address the resident
  // already saved replaces its record rather than rendering it twice.
  async function handleAddWalletAddress(address: string) {
    const record = await addWalletAddress(address);
    setEvmAddresses((current) =>
      current.some((existing) => existing.address === record.address)
        ? current.map((existing) =>
            existing.address === record.address ? record : existing,
          )
        : [...current, record],
    );
  }

  async function handleRemoveWalletAddress(address: string) {
    await removeWalletAddress(address);
    setEvmAddresses((current) =>
      current.filter((record) => record.address !== address),
    );
  }

  const fileRows = useMemo<readonly FileRow[]>(() => {
    const cits = snapshot?.citizenships.join(' / ') ?? '—';
    const residences = snapshot?.residences
      .map((r) => `${r.countryCode} ${r.fromYear}–${r.toYear === 'present' ? 'now' : r.toYear}`)
      .join(' · ') ?? '—';
    const names = snapshot?.members.map((m) => m.name.split(' ')[0]).join(', ') ?? '';
    const sources: string[] = [];
    if (connectedWallet) {
      sources.push('1 connected wallet');
    }
    if (bitcoinAddresses.length > 0) {
      sources.push(
        `${bitcoinAddresses.length} bitcoin address${
          bitcoinAddresses.length === 1 ? '' : 'es'
        }`,
      );
    }
    if (evmAddresses.length > 0) {
      sources.push(
        `${evmAddresses.length} wallet address${
          evmAddresses.length === 1 ? '' : 'es'
        }`,
      );
    }
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
        value: `${sources.length > 0 ? sources.join(' · ') : 'No sources'} · $${wealthTotal.toLocaleString('en-US')}`,
        status: wealthTotal >= tierMinimum ? 'Meets tier' : 'Below tier',
        tone: wealthTotal >= tierMinimum ? 'success' : 'warning',
        // Every source is a real public read now, so the row never carries a
        // demo chip; it names its sources instead.
        demo: false,
      },
    ];
  }, [
    snapshot,
    householdSize,
    tierName,
    tierMinimum,
    connectedWallet,
    wealthTotal,
    bitcoinAddresses.length,
    evmAddresses.length,
  ]);

  return (
    <div
      className="kade-shell"
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
        }}
      >
        <ContentContainer footer={<SiteFooter />}>
        {step === 'account' ? (
          <AccountSetupStep
            rpId={typeof window === 'undefined' ? 'localhost' : window.location.hostname}
            userId={userId}
            userName={userId}
            credentialId={credentialId}
            onEnrolled={setCredentialId}
            onContinue={() => setStep(2)}
          />
        ) : step === 2 ? (
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
            /* Back from step 2 returns to the account phase. */
          />
        ) : step === 3 ? (
          <WealthStep
            walletConfigured={walletConfigured}
            connectedWallet={connectedWallet}
            onWalletChange={(state) =>
              setConnectedWallet(
                state ? { address: state.address, usd: state.usd } : null,
              )
            }
            onContinue={() => setStep(4)}
            onBack={() => setStep(2)}
            tierName={tierName}
            tierMinimum={tierMinimum}
            bitcoinAddresses={bitcoinAddresses}
            onAddBitcoin={handleAddBitcoin}
            onRemoveBitcoin={handleRemoveBitcoin}
            evmAddresses={evmAddresses}
            onAddWalletAddress={handleAddWalletAddress}
            onRemoveWalletAddress={handleRemoveWalletAddress}
          />
        ) : (
          <FeeStep
            rows={fileRows}
            breakdown={breakdown}
            paid={paid}
            paymentConfigured={paymentConfigured}
            treasuryAddress={treasuryAddress}
            usdcAddress={usdcAddress}
            explorerUrl={explorerUrl}
            onPaid={handlePaid}
            onBack={() => setStep(3)}
            onEnter={() => {
              router.push('/');
              router.refresh();
            }}
          />
        )}
        </ContentContainer>
      </main>
    </div>
  );
}
