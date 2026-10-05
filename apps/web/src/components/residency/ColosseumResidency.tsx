'use client';

import { useCallback, useEffect, useState } from 'react';
import { tokens } from '@/components/ui/tokens';
import { Modal } from '@/components/ui/Modal';
import { tierMinimumUsdc, type ResidencyCheckId } from '@/lib/residency/checks';
import {
  setColosseumAttention,
} from '@/components/shell/colosseum-attention';
import {
  clearResidentSince,
  generatePassportSerial,
  markCitizen,
  markResidentSince,
  readColosseumProgress,
  type ColosseumProgress,
} from './colosseum-progress';

/**
 * The Colosseum flow, rendered as a mocked sub-section INSIDE the Residency step.
 *
 * This is a declared demo layer: "Colosseum Resident" / "Colosseum Citizen" and
 * the virtual passport confer no real residency, citizenship, legal status or
 * on-chain record. Nothing here writes a table or calls an RPC. The 2-minute
 * clock and the passport are demo state, persisted per profile through the
 * `localStorage`-backed `./colosseum-progress` store (the same pattern as the
 * nav highlight), so navigating away or reloading does not restart the clock or
 * re-lock "Become a Citizen".
 *
 * Everything the section says about the resident comes from the real Residency
 * snapshot: the four derived checks (`identity`, `funds`, `review`,
 * `service-fee`) and the real qualified figure in the funds check's detail. It
 * never fabricates a checkmark or a balance. The 10 USDC threshold comes from
 * the shared `TIERS` entry through the same `funds` check as the production
 * tiers (`tierMinimumUsdc`), so this section adds no separate threshold of its
 * own.
 */

function resolveColosseumMinimum(): number {
  const minimum = tierMinimumUsdc('colosseum');
  if (minimum === null) {
    // `TIERS` always carries the Colosseum entry; a missing one is a programming
    // error, not a state to render.
    throw new Error('The Colosseum tier is missing from the shared TIERS table.');
  }
  return minimum;
}

/**
 * The Colosseum demo minimum, resolved from the shared tier table through the
 * same `tierMinimumUsdc` the production `funds` check uses, so this section's
 * threshold copy cannot drift from the real config.
 */
const COLOSSEUM_MINIMUM_USDC = resolveColosseumMinimum();

/** The threshold as this section writes it, e.g. `10 USDC`. */
const COLOSSEUM_THRESHOLD = `${COLOSSEUM_MINIMUM_USDC.toLocaleString('en-US')} USDC`;

/** The four real residency checks the Colosseum layer reuses, in display order. */
const REQUIRED_CHECKS: readonly ResidencyCheckId[] = [
  'identity',
  'funds',
  'review',
  'service-fee',
];

/**
 * The mocked compliance window. It is demo state, not a persisted record: a
 * reload restarts it.
 */
export const COLOSSEUM_COMPLIANCE_WINDOW_SECONDS = 120;

export interface ColosseumResidencyProps {
  /**
   * The real, derived residency checks. The funds check carries the real
   * qualified figure and the real tier minimum; the others carry the real state.
   */
  readonly checks: readonly {
    readonly id: ResidencyCheckId;
    readonly state: 'met' | 'pending' | 'blocked';
    readonly detail: string;
  }[];
  /**
   * The resident's recorded `applications.tier`. The Colosseum threshold shown
   * here is only the real funds minimum when the resident is on the Colosseum
   * demo tier; on a production tier the real funds check is gated on that tier's
   * minimum, so the section does not claim 10 USDC reaches it.
   */
  readonly tier: string | null;
  /**
   * The stable key the demo clock and passport are stored under (the recorded
   * `applications.id`). Null/absent scopes the demo state under a constant.
   */
  readonly profileKey?: string | null;
}

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Seconds remaining in the compliance window, computed from the persisted start. */
function secondsRemainingFrom(residentSince: string | null, now: number): number {
  if (!residentSince) return 0;
  const startedAt = Date.parse(residentSince);
  if (!Number.isFinite(startedAt)) return 0;
  const elapsed = Math.floor((now - startedAt) / 1000);
  return Math.max(0, COLOSSEUM_COMPLIANCE_WINDOW_SECONDS - elapsed);
}

/**
 * The real qualified figure carried by the funds check detail. The funds check
 * formats a below-threshold balance as "$X of $Y." and a met balance as "$X
 * meets the tier."; the leading "$X" is the resident's real qualified amount,
 * now with two decimals. The pattern accepts the decimal part so a fractional
 * balance is shown in full rather than truncated at the point. When the detail
 * does not carry a figure (e.g. an unread vault), this returns null and the
 * caller says so, so the section never invents a balance.
 */
function qualifiedFigure(detail: string): string | null {
  const match = detail.match(/^\$([\d,]+(?:\.\d+)?)/);
  return match ? `$${match[1]}` : null;
}

export function ColosseumResidency({ checks, tier, profileKey }: ColosseumResidencyProps) {
  const funds = checks.find((check) => check.id === 'funds');
  const fundsMet = funds?.state === 'met';
  const allChecksMet = REQUIRED_CHECKS.every(
    (id) => checks.find((check) => check.id === id)?.state === 'met',
  );
  // The Colosseum demo threshold is the real funds minimum only when the
  // resident is on the Colosseum tier. On a production tier the real funds check
  // is gated on that tier's own minimum, so the section must not claim 10 USDC
  // satisfies it.
  const onColosseumTier = (tier ?? '').trim().toLowerCase() === 'colosseum';

  // The demo clock and passport, persisted per profile (see ./colosseum-progress).
  // The state is seeded from storage on the client so a citizen load shows the
  // passport immediately and a resident load resumes the window rather than
  // restarting it. On the server (and the first client render) the returned
  // snapshot is hidden until hydration, so there is no mismatch.
  const [mounted, setMounted] = useState(false);
  const [progress, setProgress] = useState<ColosseumProgress>({
    residentSince: null,
    citizenAt: null,
    passportSerial: null,
  });
  const [justBecameCitizen, setJustBecameCitizen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [stepsModalOpen, setStepsModalOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
    setProgress(readColosseumProgress(profileKey ?? null));
    setNow(Date.now());
  }, [profileKey]);

  const citizen = progress.citizenAt !== null;
  const secondsRemaining = secondsRemainingFrom(progress.residentSince, now);
  const windowElapsed =
    progress.residentSince !== null && secondsRemaining <= 0;
  const citizenEligible = allChecksMet && windowElapsed && !citizen;

  // Keep the persisted clock honest against the real milestone, and tick it only
  // while the window is live. Runs only after mount so the server render never
  // writes (or reads) demo state.
  useEffect(() => {
    if (!mounted) return;
    if (!allChecksMet || citizen) {
      // The checks stopped being green before citizenship: the clock resets,
      // matching the existing decay. Once a citizen, the record is kept.
      if (!citizen) setProgress(clearResidentSince(profileKey ?? null));
      return;
    }
    if (progress.residentSince === null) {
      // First time all four checks are green: start the window.
      setProgress(markResidentSince(profileKey ?? null, new Date().toISOString()));
      setNow(Date.now());
      return;
    }
    if (secondsRemaining <= 0) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [
    mounted,
    allChecksMet,
    citizen,
    progress.residentSince,
    secondsRemaining,
    profileKey,
  ]);

  // The nav highlight is on exactly while "Become a Citizen" is available. It
  // is deliberately NOT cleared on unmount, so the highlight persists when the
  // resident navigates away from /residency and can guide them back; returning
  // re-evaluates it against the persisted window, and becoming a citizen clears
  // it explicitly.
  useEffect(() => {
    setColosseumAttention(citizenEligible);
  }, [citizenEligible]);

  const becomeCitizen = useCallback(() => {
    setProgress(markCitizen(profileKey ?? null, new Date().toISOString(), generatePassportSerial()));
    setJustBecameCitizen(true);
    setColosseumAttention(false);
  }, [profileKey]);

  const showPassport = mounted && citizen;
  const showStateD = mounted && allChecksMet && !citizen && windowElapsed;
  const showStateC = mounted && allChecksMet && !citizen && !windowElapsed;

  return (
    <section data-testid="colosseum-section" style={card}>
      <div style={eyebrowRow}>
        <div>
          <div style={eyebrow}>Colosseum Resident</div>
          <h2 style={{ ...cardHeading, marginTop: '2px' }}>
            Colosseum residency
          </h2>
        </div>
        <span style={demoPill}>Demo</span>
      </div>

      <p style={body}>
        The Colosseum track reuses your real residency checks and your real
        qualified position — it adds no check of its own. A Colosseum Resident
        qualifies at a demo-scale {COLOSSEUM_THRESHOLD}.
      </p>

      {/* State A — not eligible yet: the real funds check is below the 10 USDC
          threshold. The figure is the resident's real qualified amount. When the
          resident is on a production tier the real funds check is gated on that
          tier's minimum, so the copy points at the Colosseum tier rather than
          claiming 10 USDC reaches it. */}
      {!fundsMet ? (
        <StateA
          detail={funds?.detail ?? 'No qualifying tier is set.'}
          onColosseumTier={onColosseumTier}
        />
      ) : null}

      {/* State B — threshold met, but the four real checks are not all green. */}
      {fundsMet && !allChecksMet ? (
        <StateB
          open={stepsModalOpen}
          onOpen={() => setStepsModalOpen(true)}
          onClose={() => setStepsModalOpen(false)}
        />
      ) : null}

      {/* State D — the 2-minute window has elapsed: "Become a Citizen" unlocks. */}
      {showStateD ? (
        <StateD countdown="0:00" onBecomeCitizen={becomeCitizen} />
      ) : null}

      {/* State C — all four checks green; the persisted countdown is running. */}
      {showStateC ? <StateC countdown={formatCountdown(secondsRemaining)} /> : null}

      {/* State E — already a citizen (persisted): passport, re-rendered on reload. */}
      {showPassport ? (
        <StateE
          animate={justBecameCitizen}
          serial={progress.passportSerial}
        />
      ) : null}
    </section>
  );
}

/** State A — the resident has not reached the Colosseum threshold yet. */
function StateA({
  detail,
  onColosseumTier,
}: {
  readonly detail: string;
  readonly onColosseumTier: boolean;
}) {
  const figure = qualifiedFigure(detail);
  return (
    <div data-testid="colosseum-state-a" style={stateBox}>
      <h3 style={stateTitle}>Reach the {COLOSSEUM_THRESHOLD} threshold</h3>
      {onColosseumTier ? (
        <p style={body}>
          Fund your qualified vault to reach the {COLOSSEUM_THRESHOLD} Colosseum
          threshold. It is read through the same qualified-holdings check as the
          production tiers.
        </p>
      ) : (
        <p style={body}>
          The Colosseum track qualifies at {COLOSSEUM_THRESHOLD}. Your current
          tier has its own qualified-holdings minimum, so the Colosseum step
          unlocks once that check is met — or choose the Colosseum Resident tier
          in onboarding to qualify at {COLOSSEUM_THRESHOLD}.
        </p>
      )}
      <div style={metricRow}>
        <span style={metricLabel}>Your qualified position</span>
        <span data-testid="colosseum-qualified" style={metricValue}>
          {figure ?? 'Not available yet'}
        </span>
      </div>
      <div style={metricRow}>
        <span style={metricLabel}>Colosseum threshold</span>
        <span data-testid="colosseum-threshold" style={metricValue}>
          {COLOSSEUM_THRESHOLD}
        </span>
      </div>
    </div>
  );
}

/** State B — funds met, but the real residency checks are not all green. */
function StateB({
  open,
  onOpen,
  onClose,
}: {
  readonly open: boolean;
  readonly onOpen: () => void;
  readonly onClose: () => void;
}) {
  return (
    <div data-testid="colosseum-state-b" style={stateBox}>
      <h3 style={stateTitle}>You meet the {COLOSSEUM_THRESHOLD} threshold</h3>
      <p style={body}>
        Your qualified position is above the Colosseum minimum. Complete your
        four residency checks above to become a Colosseum Resident.
      </p>
      <button type="button" onClick={onOpen} style={secondaryButton}>
        Complete your residency steps
      </button>

      <Modal
        open={open}
        onClose={onClose}
        eyebrow="Colosseum Resident"
        title="Complete your residency steps"
      >
        <div style={{ padding: '18px 22px 22px' }}>
          <p style={body}>
            Clear the same four checks the Residency step uses — identity via
            Self, qualified holdings, intake review and the residency service
            fee. When all four are met, the Colosseum Resident step unlocks here.
          </p>
          <button type="button" onClick={onClose} style={secondaryButton}>
            Got it
          </button>
        </div>
      </Modal>
    </div>
  );
}

/** State C — all four checks green: congrats and the running demo countdown. */
function StateC({ countdown }: { readonly countdown: string }) {
  return (
    <div data-testid="colosseum-state-c" style={stateBox}>
      <h3 style={stateTitle}>You&rsquo;re a Colosseum Resident</h3>
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
          {countdown}
        </span>
      </div>
    </div>
  );
}

/** State D — the 2-minute window elapsed; "Become a Citizen" is available. */
function StateD({
  countdown,
  onBecomeCitizen,
}: {
  readonly countdown: string;
  readonly onBecomeCitizen: () => void;
}) {
  return (
    <div data-testid="colosseum-state-d" style={stateBox}>
      <h3 style={stateTitle}>You&rsquo;re eligible to become a citizen</h3>
      <p style={body}>
        You have remained a compliant resident for 2 minutes. Become a
        Colosseum Citizen to receive your virtual passport.
      </p>
      <div style={metricRow}>
        <span style={metricLabel}>Compliance window</span>
        <span data-testid="colosseum-countdown" style={metricValue}>
          {countdown}
        </span>
      </div>
      <button
        type="button"
        onClick={onBecomeCitizen}
        style={{ ...primaryButton, width: '100%' }}
      >
        Become a Citizen
      </button>
    </div>
  );
}

/** State E — already a Colosseum Citizen: the virtual passport artifact. */
function StateE({
  animate,
  serial,
}: {
  readonly animate: boolean;
  readonly serial: string | null;
}) {
  return (
    <div data-testid="colosseum-state-e" style={passportStage}>
      <div
        className={animate ? 'kade-passport-reveal' : undefined}
        style={passportSceneStyle}
      >
        <div
          className={animate ? 'kade-passport-flip' : undefined}
          style={passportCard}
        >
          <div aria-hidden className="kade-passport-guilloche" style={passportTexture} />
          <div aria-hidden style={passportEmblem}>✦</div>

          <div style={passportHeader}>
            <div style={passportOrg}>Colosseum · Demo Passport</div>
            <div style={passportType}>Citizen</div>
          </div>

          <div style={passportTitleRow}>
            <span style={passportTitle}>Virtual passport</span>
            <span style={passportDocChip}>Demo</span>
          </div>

          <p style={passportNote}>Not a real travel or identity document.</p>

          <dl style={passportFields}>
            <div style={passportField}>
              <dt style={passportLabel}>Document</dt>
              <dd style={passportValue}>Colosseum Citizen</dd>
            </div>
            <div style={passportField}>
              <dt style={passportLabel}>Serial</dt>
              <dd data-testid="colosseum-passport-serial" style={passportValueMono}>
                {serial ?? '—'}
              </dd>
            </div>
          </dl>

          <div aria-hidden style={passportMrz}>
            <span>P&lt;KADECOLOSSEUM&lt;CITIZEN</span>
            <span data-testid="colosseum-passport-mrz">{serial ?? '—'}</span>
          </div>

          <p style={passportDisclaimer}>
            Demo artifact only · confers no status, onchain or otherwise.
          </p>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Styles (inline, matching the Residency step's design tokens)               */
/* -------------------------------------------------------------------------- */

const card = {
  background: tokens.surface,
  border: `1px solid ${tokens.border}`,
  borderRadius: '14px',
  padding: '22px 24px',
  marginTop: '16px',
};

const eyebrowRow = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '12px',
};

const eyebrow = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '.08em',
  textTransform: 'uppercase' as const,
  color: tokens.muted,
};

const demoPill = {
  fontSize: '11px',
  fontWeight: 700,
  padding: '3px 9px',
  borderRadius: '999px',
  background: tokens.chipBg,
  color: tokens.muted,
  whiteSpace: 'nowrap' as const,
};

const cardHeading = {
  margin: 0,
  fontSize: '17px',
  fontWeight: 600,
  color: tokens.ink,
};

const body = {
  margin: '10px 0',
  fontSize: '13.5px',
  lineHeight: 1.7,
  color: tokens.chipFg,
};

const stateBox = {
  marginTop: '14px',
  padding: '16px 18px',
  borderRadius: '12px',
  background: '#fff',
  border: `1px solid ${tokens.border}`,
};

const stateTitle = {
  margin: 0,
  fontSize: '15px',
  fontWeight: 700,
  color: tokens.ink,
};

const metricRow = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: '12px',
  padding: '10px 12px',
  marginTop: '12px',
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
  fontVariantNumeric: 'tabular-nums',
};

const perks = {
  margin: '12px 0',
  paddingLeft: '18px',
  fontSize: '13.5px',
  lineHeight: 1.7,
  color: tokens.chipFg,
};

const primaryButton = {
  marginTop: '12px',
  height: '42px',
  border: 0,
  borderRadius: '999px',
  background: tokens.brandPrimary,
  color: '#fff',
  fontFamily: 'inherit',
  fontSize: '14px',
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryButton = {
  marginTop: '10px',
  height: '38px',
  padding: '0 16px',
  border: `1px solid ${tokens.border}`,
  borderRadius: '999px',
  background: '#fff',
  color: tokens.brandPrimary,
  fontFamily: 'inherit',
  fontSize: '13.5px',
  fontWeight: 600,
  cursor: 'pointer',
};

const passportStage = {
  marginTop: '14px',
  perspective: '1000px',
};

const passportSceneStyle: React.CSSProperties = {
  position: 'relative',
  transformStyle: 'preserve-3d',
};

const passportCard: React.CSSProperties = {
  position: 'relative',
  overflow: 'hidden',
  background:
    'radial-gradient(120% 140% at 18% 0%, #12415f 0%, #0a2a43 45%, #071d30 100%)',
  borderRadius: '18px',
  padding: '22px 22px 16px',
  color: '#f4f8ff',
  border: '1px solid rgba(255,255,255,.18)',
  boxShadow:
    '0 1px 0 rgba(255,255,255,.35) inset, 0 -2px 6px rgba(0,0,0,.4) inset, 0 26px 60px -26px rgba(7,29,48,.8)',
  transformStyle: 'preserve-3d',
};

const passportTexture: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  opacity: 0.5,
  background:
    'repeating-radial-gradient(circle at 12% 8%, rgba(255,255,255,.10) 0 1px, transparent 1px 12px), repeating-linear-gradient(115deg, rgba(255,255,255,.05) 0 1px, transparent 1px 9px)',
  pointerEvents: 'none',
};

const passportEmblem: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  right: '-6px',
  transform: 'translateY(-50%)',
  fontSize: '150px',
  lineHeight: 1,
  color: 'rgba(255,255,255,.05)',
  pointerEvents: 'none',
};

const passportHeader: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '10px',
  borderBottom: '1px solid rgba(255,255,255,.2)',
  paddingBottom: '10px',
};

const passportOrg: React.CSSProperties = {
  fontSize: '10.5px',
  fontWeight: 700,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
  opacity: 0.85,
};

const passportType: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '.14em',
  textTransform: 'uppercase',
  padding: '3px 8px',
  borderRadius: '999px',
  background: 'rgba(255,255,255,.12)',
  border: '1px solid rgba(255,255,255,.25)',
};

const passportTitleRow: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: '10px',
  marginTop: '14px',
};

const passportTitle: React.CSSProperties = {
  fontSize: '21px',
  fontWeight: 700,
  letterSpacing: '.01em',
};

const passportDocChip: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '.1em',
  textTransform: 'uppercase',
  color: '#ffd479',
  border: '1px solid rgba(255,212,121,.5)',
  borderRadius: '6px',
  padding: '2px 7px',
};

const passportNote: React.CSSProperties = {
  position: 'relative',
  margin: '4px 0 16px',
  fontSize: '12px',
  lineHeight: 1.6,
  opacity: 0.8,
};

const passportFields: React.CSSProperties = {
  position: 'relative',
  margin: 0,
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '12px',
};

const passportField: React.CSSProperties = {
  borderTop: '1px solid rgba(255,255,255,.22)',
  paddingTop: '9px',
};

const passportLabel: React.CSSProperties = {
  fontSize: '10px',
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  opacity: 0.7,
};

const passportValue: React.CSSProperties = {
  margin: '4px 0 0',
  fontSize: '14.5px',
  fontWeight: 700,
};

const passportValueMono: React.CSSProperties = {
  margin: '4px 0 0',
  fontSize: '13.5px',
  fontWeight: 700,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  letterSpacing: '.04em',
};

const passportMrz: React.CSSProperties = {
  position: 'relative',
  marginTop: '16px',
  display: 'flex',
  justifyContent: 'space-between',
  gap: '10px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '10.5px',
  letterSpacing: '.18em',
  color: 'rgba(244,248,255,.72)',
  borderTop: '1px dashed rgba(255,255,255,.28)',
  paddingTop: '9px',
};

const passportDisclaimer: React.CSSProperties = {
  position: 'relative',
  margin: '10px 0 0',
  fontSize: '10.5px',
  letterSpacing: '.02em',
  opacity: 0.62,
};
