'use client';

import { useEffect, useState } from 'react';
import { tokens } from '@/components/ui/tokens';
import { Modal } from '@/components/ui/Modal';
import type { ResidencyCheckId } from '@/lib/residency/checks';
import {
  setColosseumAttention,
} from '@/components/shell/colosseum-attention';

/**
 * The Colosseum flow, rendered as a mocked sub-section INSIDE the Residency step.
 *
 * This is a declared demo layer: "Colosseum Resident" / "Colosseum Citizen" and
 * the virtual passport confer no real residency, citizenship, legal status or
 * on-chain record. Nothing here writes a table or calls an RPC. The 2-minute
 * clock and the passport are plain component state; a page reload resets them,
 * which is acceptable for a demo.
 *
 * Everything the section says about the resident comes from the real Residency
 * snapshot: the four derived checks (`identity`, `funds`, `review`,
 * `service-fee`) and the real qualified figure in the funds check's detail. It
 * never fabricates a checkmark or a balance. The 10 USDC threshold comes from
 * the shared `TIERS` entry through the same `funds` check as the production
 * tiers (`tierMinimumUsdc`), so this section adds no separate threshold of its
 * own.
 */

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
}

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * The real qualified figure carried by the funds check detail. The funds check
 * formats a below-threshold balance as "$X of $Y." and a met balance as "$X
 * meets the tier."; the leading "$X" is the resident's real qualified amount.
 * When the detail does not carry a figure (e.g. an unread vault), this returns
 * null and the caller says so, so the section never invents a balance.
 */
function qualifiedFigure(detail: string): string | null {
  const match = detail.match(/^\$([\d,]+)/);
  return match ? `$${match[1]}` : null;
}

export function ColosseumResidency({ checks }: ColosseumResidencyProps) {
  const funds = checks.find((check) => check.id === 'funds');
  const fundsMet = funds?.state === 'met';
  const allChecksMet = REQUIRED_CHECKS.every(
    (id) => checks.find((check) => check.id === id)?.state === 'met',
  );

  // The mocked demo clock. It starts when all four checks are green (the real
  // "Start Residency" milestone) and is not persisted; a reload resets it.
  const [secondsRemaining, setSecondsRemaining] = useState<number>(
    COLOSSEUM_COMPLIANCE_WINDOW_SECONDS,
  );
  const [citizen, setCitizen] = useState(false);
  const [passportAnimate, setPassportAnimate] = useState(false);
  const [stepsModalOpen, setStepsModalOpen] = useState(false);

  const windowElapsed = secondsRemaining <= 0;
  const citizenEligible = allChecksMet && windowElapsed && !citizen;

  // Start (or restart) the countdown whenever the real milestone is met and the
  // resident is not yet a citizen. Nothing ticks otherwise.
  useEffect(() => {
    if (!allChecksMet || citizen) {
      setSecondsRemaining(COLOSSEUM_COMPLIANCE_WINDOW_SECONDS);
      return;
    }
    setSecondsRemaining(COLOSSEUM_COMPLIANCE_WINDOW_SECONDS);
    const interval = window.setInterval(() => {
      setSecondsRemaining((value) => (value <= 1 ? 0 : value - 1));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [allChecksMet, citizen]);

  // The nav highlight is on exactly while "Become a Citizen" is available. It
  // is deliberately NOT cleared on unmount, so the highlight persists when the
  // resident navigates away from /residency and can guide them back. Returning
  // to /residency re-runs this effect against the (possibly reset) demo clock,
  // which clears a stale highlight; becoming a citizen clears it explicitly.
  useEffect(() => {
    setColosseumAttention(citizenEligible);
  }, [citizenEligible]);

  function becomeCitizen() {
    setCitizen(true);
    setPassportAnimate(true);
    setColosseumAttention(false);
  }

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
        qualifies at a demo-scale 10 USDC.
      </p>

      {/* State A — not eligible yet: the real funds check is below the 10 USDC
          threshold. The figure is the resident's real qualified amount. */}
      {!fundsMet ? (
        <StateA detail={funds?.detail ?? 'No qualifying tier is set.'} />
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
      {allChecksMet && !citizen && windowElapsed ? (
        <StateD
          countdown="0:00"
          onBecomeCitizen={becomeCitizen}
        />
      ) : null}

      {/* State C — all four checks green; the mocked countdown is running. */}
      {allChecksMet && !citizen && !windowElapsed ? (
        <StateC countdown={formatCountdown(secondsRemaining)} />
      ) : null}

      {/* State E — already a citizen (in-session): passport without re-animating. */}
      {citizen ? <StateE animate={passportAnimate} /> : null}
    </section>
  );
}

/** State A — the resident has not reached the Colosseum threshold yet. */
function StateA({ detail }: { readonly detail: string }) {
  const figure = qualifiedFigure(detail);
  return (
    <div data-testid="colosseum-state-a" style={stateBox}>
      <h3 style={stateTitle}>Reach the 10 USDC threshold</h3>
      <p style={body}>
        Fund your qualified vault to reach the 10 USDC Colosseum threshold. It
        is read through the same qualified-holdings check as the production
        tiers.
      </p>
      <div style={metricRow}>
        <span style={metricLabel}>Your qualified position</span>
        <span data-testid="colosseum-qualified" style={metricValue}>
          {figure ?? 'Not available yet'}
        </span>
      </div>
      <div style={metricRow}>
        <span style={metricLabel}>Colosseum threshold</span>
        <span data-testid="colosseum-threshold" style={metricValue}>
          10 USDC
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
      <h3 style={stateTitle}>You meet the 10 USDC threshold</h3>
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

/** State E — already a Colosseum Citizen in this session: show the passport. */
function StateE({ animate }: { readonly animate: boolean }) {
  return (
    <div
      data-testid="colosseum-state-e"
      className={animate ? 'kade-passport-reveal' : undefined}
      style={passport}
    >
      <div style={passportEyebrow}>Colosseum Citizen</div>
      <h3 style={passportTitle}>Virtual passport</h3>
      <p style={passportNote}>
        A demo artifact only — it is not a real travel or identity document and
        confers no status, onchain or otherwise.
      </p>
      <dl style={passportFields}>
        <div style={passportField}>
          <dt style={passportLabel}>Document</dt>
          <dd style={passportValue}>Colosseum Citizen</dd>
        </div>
        <div style={passportField}>
          <dt style={passportLabel}>Status</dt>
          <dd style={passportValue}>Demo · not a real passport</dd>
        </div>
      </dl>
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

const passport = {
  marginTop: '14px',
  background: 'linear-gradient(135deg, #0A2A43 0%, #0A7CFF 100%)',
  borderRadius: '16px',
  padding: '24px',
  color: '#fff',
  boxShadow: '0 20px 50px -24px rgba(10,42,67,.55)',
};

const passportEyebrow = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '.12em',
  textTransform: 'uppercase' as const,
  opacity: 0.8,
};

const passportTitle = {
  margin: '6px 0 8px',
  fontSize: '20px',
  fontWeight: 700,
};

const passportNote = {
  margin: '0 0 16px',
  fontSize: '12px',
  lineHeight: 1.6,
  opacity: 0.85,
};

const passportFields = {
  margin: 0,
  display: 'grid',
  gap: '12px',
};

const passportField = {
  borderTop: '1px solid rgba(255,255,255,.25)',
  paddingTop: '10px',
};

const passportLabel = {
  fontSize: '11px',
  letterSpacing: '.06em',
  textTransform: 'uppercase' as const,
  opacity: 0.75,
};

const passportValue = {
  margin: '4px 0 0',
  fontSize: '15px',
  fontWeight: 700,
};
