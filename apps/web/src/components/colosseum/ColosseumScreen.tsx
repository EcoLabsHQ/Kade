'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { COLOSSEUM_TIER } from '@kade/shared';
import { tokens } from '@/components/ui/tokens';
import { Modal } from '@/components/ui/Modal';
import type { ResidencyCheckId } from '@/lib/residency/checks';
import type { ResidencySnapshot } from '@/lib/residency/server';
import type { ColosseumMembership } from '@/lib/colosseum/server';
import {
  becomeColosseumCitizenAction,
  registerColosseumResidencyAction,
  syncColosseumResidencyAction,
} from '@/app/colosseum/actions';

/**
 * The Colosseum residency surface (COLOSSEUM-1).
 *
 * This is a declared demo layer (Week 3 contract section 8.3): the "Colosseum
 * Resident"/"Colosseum Citizen" labels and the virtual passport confer no real
 * residency, citizenship, legal status or on-chain record. The surface carries
 * no on-screen demo banner by owner decision, and it never claims otherwise.
 *
 * Everything it shows about the resident comes from the real snapshot the
 * server assembled (`loadResidencySnapshot`): the four checks, the qualified
 * position and the tier. The 2-minute clock and the passport are server-written
 * and read back; the client countdown is cosmetic and the RPC remains the
 * authority, so an early "Become a Citizen" is refused.
 */

/** The four real residency checks the Colosseum tier reuses. */
const REQUIRED_CHECKS: readonly ResidencyCheckId[] = [
  'identity',
  'funds',
  'review',
  'service-fee',
];

/** The persisted compliance window: 2 minutes. */
const COMPLIANCE_WINDOW_SECONDS = 120;

/**
 * The shortest time the loading transition is shown before the congrats state.
 * It is a transition, not a gate: eligibility is still server-enforced.
 */
const CONGRATS_TRANSITION_MS = 300;

export interface ColosseumScreenProps {
  readonly snapshot: ResidencySnapshot;
  /** The persisted membership, or null when the resident has none yet. */
  readonly membership: ColosseumMembership | null;
}

function checkById(
  checks: ResidencySnapshot['view']['checks'],
  id: ResidencyCheckId,
) {
  return checks.find((check) => check.id === id);
}

function allChecksMet(checks: ResidencySnapshot['view']['checks']): boolean {
  return REQUIRED_CHECKS.every(
    (id) => checkById(checks, id)?.state === 'met',
  );
}

/** The whole seconds left in the 2-minute window for a `resident_since`. */
function remainingSeconds(residentSince: string, now: number): number {
  const start = Date.parse(residentSince);
  if (Number.isNaN(start)) return 0;
  const elapsed = Math.floor((now - start) / 1000);
  return Math.max(0, COMPLIANCE_WINDOW_SECONDS - elapsed);
}

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function ColosseumScreen({
  snapshot,
  membership: initialMembership,
}: ColosseumScreenProps) {
  const router = useRouter();
  const checks = snapshot.view.checks;

  const registered = snapshot.tier === COLOSSEUM_TIER.name;
  const funds = checkById(checks, 'funds');
  const fundsMet = funds?.state === 'met';
  const met = allChecksMet(checks);

  const [membership, setMembership] = useState<ColosseumMembership | null>(
    initialMembership,
  );
  const [registering, setRegistering] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [popupOpen, setPopupOpen] = useState(true);
  const [syncPhase, setSyncPhase] = useState<'loading' | 'ready' | 'failed'>(
    'loading',
  );
  const [syncNonce, setSyncNonce] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [becoming, setBecoming] = useState(false);
  const [passportAnimate, setPassportAnimate] = useState(false);

  const isCitizen = Boolean(membership?.citizenAt);

  // On first arrival with all four checks met (and not yet a citizen), start
  // the persisted clock server-side. The loading transition is shown while the
  // sync is in flight, with a short minimum so the transition reads.
  useEffect(() => {
    if (!registered || !met || isCitizen) return;
    let cancelled = false;
    setSyncPhase('loading');
    const startedAt = Date.now();
    void (async () => {
      const result = await syncColosseumResidencyAction();
      const elapsed = Date.now() - startedAt;
      const wait = Math.max(0, CONGRATS_TRANSITION_MS - elapsed);
      window.setTimeout(() => {
        if (cancelled) return;
        if (result.status === 'ok') {
          setMembership(result.membership);
          setSyncPhase('ready');
        } else {
          setNotice(result.reason);
          setSyncPhase('failed');
        }
      }, wait);
    })();
    return () => {
      cancelled = true;
    };
  }, [registered, met, isCitizen, syncNonce]);

  // The live countdown is cosmetic; the server's `resident_since` is the
  // authority. It ticks once a second while the congrats state is shown.
  useEffect(() => {
    if (!registered || !met || isCitizen) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [registered, met, isCitizen]);

  async function handleRegister() {
    setRegistering(true);
    setNotice(null);
    const result = await registerColosseumResidencyAction();
    setRegistering(false);
    if (result.status === 'ok') {
      router.refresh();
    } else {
      setNotice(result.reason);
    }
  }

  async function handleBecomeCitizen() {
    setBecoming(true);
    setNotice(null);
    const result = await becomeColosseumCitizenAction();
    setBecoming(false);
    if (result.status === 'ok') {
      setMembership(result.membership);
      setPassportAnimate(true);
      router.refresh();
    } else {
      setNotice(result.reason);
    }
  }

  const residentSince = membership?.residentSince ?? null;
  const remaining =
    residentSince !== null ? remainingSeconds(residentSince, now) : null;
  const eligible = remaining !== null && remaining <= 0;

  return (
    <div style={{ animation: 'fadeUp .2s ease-out' }}>
      <Header />

      {notice ? (
        <p data-testid="colosseum-notice" style={noticeStyle} role="status">
          {notice}
        </p>
      ) : null}

      {!registered ? (
        <RegisterState
          registering={registering}
          onRegister={() => void handleRegister()}
        />
      ) : null}

      {registered && !fundsMet ? (
        <ThresholdState detail={funds?.detail ?? 'No qualifying tier is set.'} />
      ) : null}

      {registered && fundsMet && !met ? (
        <StepsState
          open={popupOpen}
          onOpen={() => setPopupOpen(true)}
          onClose={() => setPopupOpen(false)}
        />
      ) : null}

      {registered && met && isCitizen ? (
        <PassportState membership={membership} animate={passportAnimate} />
      ) : null}

      {registered && met && !isCitizen && syncPhase === 'loading' ? (
        <LoadingState />
      ) : null}

      {registered && met && !isCitizen && syncPhase === 'failed' ? (
        <SyncFailedState
          onRetry={() => {
            setNotice(null);
            setSyncNonce((value) => value + 1);
          }}
        />
      ) : null}

      {registered && met && !isCitizen && syncPhase === 'ready' ? (
        <CongratsState
          remaining={remaining}
          eligible={eligible}
          becoming={becoming}
          onBecomeCitizen={() => void handleBecomeCitizen()}
        />
      ) : null}
    </div>
  );
}

function Header() {
  return (
    <div style={{ marginBottom: '24px' }}>
      <div style={eyebrow}>Colosseum Residency</div>
      <h1 style={heading}>Colosseum</h1>
      <p style={lead}>
        A Colosseum residency track that reuses your real residency checks and
        the real qualified position. A Colosseum resident qualifies at a
        demo-scale 10 USDC.
      </p>
    </div>
  );
}

function RegisterState({
  registering,
  onRegister,
}: {
  readonly registering: boolean;
  readonly onRegister: () => void;
}) {
  return (
    <section data-testid="colosseum-register" style={card}>
      <h2 style={cardTitle}>Register for Colosseum Residency</h2>
      <p style={body}>
        The Colosseum track requires a qualified position of at least{' '}
        <strong>{COLOSSEUM_TIER.minUsdc} USDC</strong> and the same four real
        residency checks as the production programme — identity, qualified
        holdings, intake review and the residency service fee. Registering sets
        your tier to <code>colosseum</code>; it does not change the production
        tiers.
      </p>
      <button
        type="button"
        onClick={onRegister}
        disabled={registering}
        style={{ ...primaryButton, opacity: registering ? 0.7 : 1 }}
      >
        {registering ? 'Registering…' : 'Register for Colosseum Residency'}
      </button>
    </section>
  );
}

function ThresholdState({ detail }: { readonly detail: string }) {
  return (
    <section data-testid="colosseum-threshold" style={card}>
      <h2 style={cardTitle}>Meet the {COLOSSEUM_TIER.minUsdc} USDC threshold</h2>
      <p style={body}>
        Your qualified position must reach {COLOSSEUM_TIER.minUsdc} USDC before
        you can complete the Colosseum residency steps.
      </p>
      <div style={metricRow}>
        <span style={metricLabel}>Qualified position</span>
        <span data-testid="colosseum-qualified" style={metricValue}>
          {detail}
        </span>
      </div>
    </section>
  );
}

function StepsState({
  open,
  onOpen,
  onClose,
}: {
  readonly open: boolean;
  readonly onOpen: () => void;
  readonly onClose: () => void;
}) {
  return (
    <section data-testid="colosseum-steps" style={card}>
      <h2 style={cardTitle}>You meet the {COLOSSEUM_TIER.minUsdc} USDC threshold</h2>
      <p style={body}>
        Your qualified position is above the Colosseum minimum. The remaining
        steps are the real residency checks.
      </p>
      <button type="button" onClick={onOpen} style={secondaryButton}>
        Complete your residency steps
      </button>

      <Modal
        open={open}
        onClose={onClose}
        eyebrow="Colosseum Residency"
        title="Complete your residency steps"
      >
        <div style={{ padding: '18px 22px 22px' }}>
          <p style={body}>
            Finish the same four checks the Residency step uses — identity,
            qualified holdings, intake review and the residency service fee.
            When all four are met, you become a Colosseum Resident.
          </p>
          <Link href="/residency" style={linkStyle}>
            Go to Residency →
          </Link>
        </div>
      </Modal>
    </section>
  );
}

function LoadingState() {
  return (
    <section
      data-testid="colosseum-loading"
      style={{ ...card, display: 'flex', alignItems: 'center', gap: '14px' }}
    >
      <span
        className="kade-spinner"
        aria-hidden="true"
        style={{
          width: '22px',
          height: '22px',
          borderRadius: '50%',
          border: `2px solid ${tokens.border}`,
          borderTopColor: tokens.brandPrimary,
        }}
      />
      <span style={body}>Preparing your Colosseum residency…</span>
    </section>
  );
}

function SyncFailedState({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <section data-testid="colosseum-sync-failed" style={card}>
      <h2 style={cardTitle}>We could not start your residency clock</h2>
      <p style={body}>
        Your checks are met, but the residency clock could not be recorded. Try
        again; nothing has been claimed on your behalf.
      </p>
      <button type="button" onClick={onRetry} style={secondaryButton}>
        Try again
      </button>
    </section>
  );
}

function CongratsState({
  remaining,
  eligible,
  becoming,
  onBecomeCitizen,
}: {
  readonly remaining: number | null;
  readonly eligible: boolean;
  readonly becoming: boolean;
  readonly onBecomeCitizen: () => void;
}) {
  return (
    <section
      data-testid="colosseum-congrats"
      className="kade-colosseum-congrats"
      style={card}
    >
      <h2 style={cardTitle}>You&rsquo;re a Colosseum Resident</h2>
      <ul style={perks}>
        <li>A Colosseum Resident status on this demo surface.</li>
        <li>The Colosseum residency demo walkthrough.</li>
        <li>A virtual passport after 2 compliant minutes.</li>
      </ul>
      <p style={{ ...body, fontWeight: 600 }}>
        Remain a compliant resident for 2 minutes to be eligible to become a
        Colosseum Citizen.
      </p>
      <div style={metricRow}>
        <span style={metricLabel}>Compliance window</span>
        <span data-testid="colosseum-countdown" style={metricValue}>
          {remaining === null ? '—' : formatCountdown(remaining)}
        </span>
      </div>
      <button
        type="button"
        onClick={onBecomeCitizen}
        disabled={!eligible || becoming}
        style={{
          ...primaryButton,
          opacity: !eligible || becoming ? 0.55 : 1,
          cursor: !eligible || becoming ? 'not-allowed' : 'pointer',
        }}
      >
        {becoming ? 'Issuing your passport…' : 'Become a Citizen'}
      </button>
      {!eligible && remaining !== null ? (
        <p style={hint}>
          Unlocks in {formatCountdown(remaining)} once the 2-minute window
          elapses.
        </p>
      ) : null}
    </section>
  );
}

function PassportState({
  membership,
  animate,
}: {
  readonly membership: ColosseumMembership | null;
  readonly animate: boolean;
}) {
  return (
    <section
      data-testid="colosseum-passport"
      data-animate={animate ? 'true' : 'false'}
      className={animate ? 'kade-passport-reveal' : undefined}
      style={passport}
    >
      <div style={passportEyebrow}>Colosseum Citizen</div>
      <h2 style={passportTitle}>Virtual passport</h2>
      <dl style={passportFields}>
        <div style={passportField}>
          <dt style={passportLabel}>Passport serial</dt>
          <dd data-testid="colosseum-passport-serial" style={passportValue}>
            {membership?.passportSerial ?? '—'}
          </dd>
        </div>
        <div style={passportField}>
          <dt style={passportLabel}>Citizen since</dt>
          <dd data-testid="colosseum-passport-citizen-at" style={passportValue}>
            {membership?.citizenAt
              ? new Date(membership.citizenAt).toLocaleString('en-US')
              : '—'}
          </dd>
        </div>
      </dl>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Styles (inline, matching the shell's design tokens)                        */
/* -------------------------------------------------------------------------- */

const eyebrow = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '.08em',
  textTransform: 'uppercase' as const,
  color: tokens.muted,
  marginBottom: '6px',
};

const heading = {
  margin: 0,
  fontSize: '26px',
  fontWeight: 700,
  letterSpacing: '-.02em',
  color: tokens.ink,
};

const lead = {
  margin: '8px 0 0',
  fontSize: '14px',
  lineHeight: 1.6,
  color: tokens.muted,
  maxWidth: '720px',
};

const card = {
  background: '#fff',
  border: `1px solid ${tokens.border}`,
  borderRadius: '16px',
  padding: '24px',
  maxWidth: '640px',
};

const cardTitle = {
  margin: 0,
  fontSize: '18px',
  fontWeight: 700,
  color: tokens.ink,
};

const body = {
  margin: '10px 0',
  fontSize: '14px',
  lineHeight: 1.6,
  color: tokens.chipFg,
};

const hint = {
  margin: '10px 0 0',
  fontSize: '12.5px',
  color: tokens.muted,
};

const primaryButton = {
  marginTop: '8px',
  border: 0,
  borderRadius: '10px',
  background: tokens.brandPrimary,
  color: '#fff',
  fontFamily: 'inherit',
  fontSize: '14px',
  fontWeight: 600,
  padding: '11px 18px',
  cursor: 'pointer',
};

const secondaryButton = {
  marginTop: '8px',
  border: `1px solid ${tokens.border}`,
  borderRadius: '10px',
  background: '#fff',
  color: tokens.brandPrimary,
  fontFamily: 'inherit',
  fontSize: '14px',
  fontWeight: 600,
  padding: '10px 16px',
  cursor: 'pointer',
};

const linkStyle = {
  display: 'inline-block',
  marginTop: '14px',
  color: tokens.brandPrimary,
  fontWeight: 600,
  fontSize: '14px',
  textDecoration: 'none',
};

const noticeStyle = {
  margin: '0 0 16px',
  padding: '10px 14px',
  borderRadius: '10px',
  background: '#FDF6E7',
  color: '#B7791F',
  fontSize: '13px',
};

const metricRow = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: '12px',
  padding: '12px 14px',
  marginTop: '14px',
  borderRadius: '10px',
  background: tokens.surface,
  border: `1px solid ${tokens.border}`,
};

const metricLabel = {
  fontSize: '12.5px',
  color: tokens.muted,
};

const metricValue = {
  fontSize: '14px',
  fontWeight: 700,
  color: tokens.ink,
};

const perks = {
  margin: '12px 0',
  paddingLeft: '18px',
  fontSize: '14px',
  lineHeight: 1.7,
  color: tokens.chipFg,
};

const passport = {
  background: 'linear-gradient(135deg, #0A2A43 0%, #0A7CFF 100%)',
  borderRadius: '18px',
  padding: '28px',
  maxWidth: '460px',
  color: '#fff',
  boxShadow: '0 24px 60px -24px rgba(10,42,67,.6)',
};

const passportEyebrow = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '.12em',
  textTransform: 'uppercase' as const,
  opacity: 0.8,
};

const passportTitle = {
  margin: '6px 0 20px',
  fontSize: '22px',
  fontWeight: 700,
};

const passportFields = {
  margin: 0,
  display: 'grid',
  gap: '14px',
};

const passportField = {
  borderTop: '1px solid rgba(255,255,255,.25)',
  paddingTop: '12px',
};

const passportLabel = {
  fontSize: '11px',
  letterSpacing: '.06em',
  textTransform: 'uppercase' as const,
  opacity: 0.75,
};

const passportValue = {
  margin: '4px 0 0',
  fontSize: '16px',
  fontWeight: 700,
};
