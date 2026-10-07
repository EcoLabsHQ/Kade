'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { tokens } from '@/components/ui/tokens';
import { tierMinimumUsdc, type ResidencyCheckId } from '@/lib/residency/checks';
import type { MembershipClaimTarget } from '@/lib/membership/plan';
import {
  setColosseumAttention,
} from '@/components/shell/colosseum-attention';
import {
  claimResidencyPass,
  clearResidentSince,
  generatePassportSerial,
  generateResidencyPassSerial,
  markCitizen,
  markResidentSince,
  readColosseumProgress,
  type ColosseumProgress,
} from './colosseum-progress';
import { ResidencyPass } from './ResidencyPass';
import {
  CertificateArtifact,
  CitizenshipCertificate,
} from './CitizenshipCertificate';

/**
 * The Colosseum flow, rendered as a mocked sub-section INSIDE the Residency step.
 *
 * This is a declared demo layer: "Colosseum Resident" / "Colosseum Citizen" and
 * the citizenship certificate confer no real residency, citizenship, legal
 * status or on-chain record. Nothing here writes a table or calls an RPC. The
 * 2-minute clock and the certificate are demo state, persisted per profile
 * through the
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
 * Display labels for the four real checks, used only as a fallback when the
 * snapshot does not carry the derived check's own `label`. The state, the
 * detail and the figure always come from the snapshot, never from here.
 */
const CHECK_LABELS: Record<ResidencyCheckId, string> = {
  identity: 'Identity (Self)',
  funds: 'Qualified holdings',
  review: 'Intake review',
  'service-fee': 'Residency service fee',
};

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
    /**
     * The derived check's own display label, when the caller passes the full
     * derived check (the Residency step does). It is only a display string; the
     * state and detail below are what this section actually reads.
     */
    readonly label?: string;
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
   * The stable key the demo clock and certificate are stored under (the
   * recorded `applications.id`). Null/absent scopes the demo state under a
   * constant.
   */
  readonly profileKey?: string | null;
  /**
   * The claim trigger. Called once, on the first claim of each milestone, with
   * the target the server should mint (`resident` / `citizen`). It is
   * fire-and-forget: the reveal is opened before it is called, so the mint
   * never changes the reveal timing or the one-shot guards. Omitted in tests
   * and any surface that only renders the demo.
   */
  readonly onClaimMembership?: (target: MembershipClaimTarget) => void;
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

export function ColosseumResidency({
  checks,
  tier,
  profileKey,
  onClaimMembership,
}: ColosseumResidencyProps) {
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

  // The demo clock and certificate, persisted per profile (see
  // ./colosseum-progress). The state is seeded from storage on the client so a
  // citizen load shows the certificate immediately and a resident load resumes
  // the window rather than restarting it. On the server (and the first client
  // render) the returned snapshot is hidden until hydration, so there is no
  // mismatch.
  const [mounted, setMounted] = useState(false);
  const [progress, setProgress] = useState<ColosseumProgress>({
    residentSince: null,
    citizenAt: null,
    passportSerial: null,
    residencyPassAt: null,
    residencyPassSerial: null,
  });
  const [now, setNow] = useState(() => Date.now());
  // The two full-screen demo reveals. They are pure presentation: opening or
  // closing them changes no persisted state and blocks nothing once dismissed.
  const [residencyPassOpen, setResidencyPassOpen] = useState(false);
  const [certificateOpen, setCertificateOpen] = useState(false);
  // The first, live citizenship reveal uses the celebratory tier; every later
  // open uses the standard one.
  const [certificateCelebration, setCertificateCelebration] = useState(false);
  // The certificate reveal must fire exactly once, on the *live* transition to
  // citizen — not on a restored citizen load and not again after a dismissal.
  // `restoredCitizenRef` records whether the progress read at mount/profile
  // change was already a citizen (so it never celebrates a restored state);
  // `celebratedCitizenRef` latches the one live celebration per mount.
  const restoredCitizenRef = useRef(false);
  const celebratedCitizenRef = useRef(false);

  useEffect(() => {
    setMounted(true);
    const restored = readColosseumProgress(profileKey ?? null);
    setProgress(restored);
    // Seed from the restored record so only a *new* citizenship celebrates.
    restoredCitizenRef.current = restored.citizenAt !== null;
    celebratedCitizenRef.current = false;
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
    setColosseumAttention(false);
    // The claim is the trigger: the server re-validates and mints the Citizen
    // credential. Fire-and-forget after the local transition, so the reveal is
    // never delayed by the mint.
    onClaimMembership?.('citizen');
  }, [profileKey, onClaimMembership]);

  // Celebrate the milestone with the full-screen certificate reveal, exactly
  // once, on the live transition to citizen. A restored citizen (already
  // recorded when the progress was read) never auto-opens, and once dismissed
  // the reveal is not re-opened by a later render: `celebratedCitizenRef`
  // latches it for this mount. Opening it again stays available by clicking the
  // inline certificate.
  useEffect(() => {
    if (!mounted || !citizen) return;
    if (restoredCitizenRef.current || celebratedCitizenRef.current) return;
    celebratedCitizenRef.current = true;
    setCertificateCelebration(true);
    setCertificateOpen(true);
  }, [mounted, citizen]);

  // Claiming the residency pass records a demo serial/instant once, then reveals
  // it full-screen. Claiming again (re-opening) shows the same artifact.
  const claimResidency = useCallback(() => {
    // The mint is triggered only on the *first* claim; re-opening the pass is
    // not a claim and must not call the server again.
    const alreadyClaimed = progress.residencyPassAt !== null;
    setProgress(
      claimResidencyPass(
        profileKey ?? null,
        new Date().toISOString(),
        generateResidencyPassSerial(),
      ),
    );
    setResidencyPassOpen(true);
    if (!alreadyClaimed) {
      // Fire-and-forget after the local transition: the reveal is already
      // opening, so the mint never changes its timing.
      onClaimMembership?.('resident');
    }
  }, [profileKey, progress.residencyPassAt, onClaimMembership]);

  const showCertificate = mounted && citizen;
  const showStateD = mounted && allChecksMet && !citizen && windowElapsed;
  const showStateC = mounted && allChecksMet && !citizen && !windowElapsed;
  const residencyPassClaimed = progress.residencyPassSerial !== null;

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

      {/* State B — threshold met, but the four real checks are not all green.
          The four real checks are shown inline, read from the same snapshot the
          section already receives; there is no detour dialog. */}
      {fundsMet && !allChecksMet ? <StateB checks={checks} /> : null}

      {/* State C — all four checks green; the persisted countdown is running.
          "Claim Colosseum Residency" is the single primary action. */}
      {showStateC ? (
        <StateC
          remainingSeconds={secondsRemaining}
          residencyPassClaimed={residencyPassClaimed}
          onClaimResidency={claimResidency}
        />
      ) : null}

      {/* State D — the 2-minute window has elapsed. "Become a Citizen" is the
          single primary action; the residency pass drops to a quiet text
          affordance so the two claims never compete. */}
      {showStateD ? (
        <StateD
          remainingSeconds={secondsRemaining}
          residencyPassClaimed={residencyPassClaimed}
          onClaimResidency={claimResidency}
          onBecomeCitizen={becomeCitizen}
        />
      ) : null}

      {/* State E — already a citizen (persisted): the inline certificate
          artifact, re-rendered on reload. The artifact itself is the control
          that opens the full-screen reveal on demand. */}
      {showCertificate ? (
        <StateE
          serial={progress.passportSerial}
          issuedAt={progress.citizenAt}
          onOpenFullScreen={() => {
            setCertificateCelebration(false);
            setCertificateOpen(true);
          }}
        />
      ) : null}

      {/* Full-screen demo reveals. Both are dismissible and block nothing. */}
      <ResidencyPass
        open={residencyPassOpen}
        onClose={() => setResidencyPassOpen(false)}
        serial={progress.residencyPassSerial}
        issuedAt={progress.residencyPassAt}
      />
      <CitizenshipCertificate
        open={certificateOpen}
        onClose={() => {
          setCertificateOpen(false);
          setCertificateCelebration(false);
        }}
        serial={progress.passportSerial}
        issuedAt={progress.citizenAt}
        celebration={certificateCelebration}
      />
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

/**
 * State B — funds met, but the real residency checks are not all green.
 *
 * The four real checks are listed inline with their real state and detail, read
 * from the same snapshot the section already receives. There is no detour
 * dialog: the checklist is the whole state.
 */
function StateB({
  checks,
}: {
  readonly checks: ColosseumResidencyProps['checks'];
}) {
  return (
    <div data-testid="colosseum-state-b" style={stateBox}>
      <h3 style={stateTitle}>You meet the {COLOSSEUM_THRESHOLD} threshold</h3>
      <p style={body}>
        Your qualified position is above the Colosseum minimum. Clear the same
        four residency checks the Residency step uses to become a Colosseum
        Resident.
      </p>
      <ul data-testid="colosseum-checklist" style={checklist}>
        {REQUIRED_CHECKS.map((id) => {
          const check = checks.find((candidate) => candidate.id === id);
          const state = check?.state ?? 'pending';
          const label = check?.label ?? CHECK_LABELS[id];
          return (
            <li
              key={id}
              data-testid={`colosseum-check-${id}`}
              data-state={state}
              style={checkRow}
            >
              <span
                aria-hidden
                style={{
                  ...checkDot,
                  ...(state === 'met'
                    ? checkDotMet
                    : state === 'blocked'
                      ? checkDotBlocked
                      : checkDotPending),
                }}
              >
                {state === 'met' ? '✓' : state === 'blocked' ? '!' : ''}
              </span>
              <span style={checkBody}>
                <span style={checkLabel}>{label}</span>
                <span style={checkDetail}>
                  {check?.detail ?? 'Awaiting this check.'}
                </span>
              </span>
              <span
                style={{
                  ...checkState,
                  color:
                    state === 'met'
                      ? tokens.success
                      : state === 'blocked'
                        ? tokens.danger
                        : tokens.muted,
                }}
              >
                {state === 'met'
                  ? 'Met'
                  : state === 'blocked'
                    ? 'Blocked'
                    : 'Pending'}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The compliance window, kept discreet: a thin progress line plus small, muted
 * text carrying the real remaining time. The time is in the accessibility tree
 * (the visible text, and the progressbar's `aria-valuetext`), but it is no
 * longer the headline of the card.
 */
function ComplianceProgress({
  remainingSeconds,
}: {
  readonly remainingSeconds: number;
}) {
  const total = COLOSSEUM_COMPLIANCE_WINDOW_SECONDS;
  const elapsed = Math.min(total, Math.max(0, total - remainingSeconds));
  const fraction = total > 0 ? elapsed / total : 1;
  return (
    <div style={complianceWrap}>
      <div
        data-testid="colosseum-compliance-progress"
        role="progressbar"
        aria-label="Compliance window"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={elapsed}
        aria-valuetext={`${formatCountdown(remainingSeconds)} remaining`}
        style={progressTrack}
      >
        <div style={{ ...progressFill, transform: `scaleX(${fraction})` }} />
      </div>
      <p style={complianceText}>
        <span data-testid="colosseum-countdown" style={complianceTime}>
          {formatCountdown(remainingSeconds)}
        </span>{' '}
        remaining in the compliance window
      </p>
    </div>
  );
}

/**
 * The residency-pass affordance. It is a real button in both states (the human
 * confirmed the residency is claimed with a button), but in state D, where
 * "Become a Citizen" is the primary action, it renders as a quiet text
 * affordance so the two claims never compete.
 */
function residencyPassLabel(claimed: boolean): string {
  return claimed ? 'View residency pass' : 'Claim Colosseum Residency';
}

/** State C — all four checks green: congrats, the running window and the pass. */
function StateC({
  remainingSeconds,
  residencyPassClaimed,
  onClaimResidency,
}: {
  readonly remainingSeconds: number;
  readonly residencyPassClaimed: boolean;
  readonly onClaimResidency: () => void;
}) {
  return (
    <div data-testid="colosseum-state-c" style={stateBox}>
      <h3 style={stateTitle}>You&rsquo;re a Colosseum Resident</h3>
      <ul style={perks}>
        <li>A Colosseum Resident status on this demo surface.</li>
        <li>The Colosseum residency demo walkthrough.</li>
        <li>A citizenship certificate after 2 compliant minutes.</li>
      </ul>
      <p style={{ ...body, fontWeight: 600 }}>
        Remain a compliant resident for 2 minutes to be eligible to become a
        Colosseum Citizen.
      </p>
      <ComplianceProgress remainingSeconds={remainingSeconds} />
      <button
        type="button"
        data-variant={residencyPassClaimed ? 'secondary' : 'primary'}
        onClick={onClaimResidency}
        style={residencyPassClaimed ? secondaryButton : primaryButton}
      >
        {residencyPassLabel(residencyPassClaimed)}
      </button>
    </div>
  );
}

/** State D — the 2-minute window elapsed; "Become a Citizen" is the action. */
function StateD({
  remainingSeconds,
  residencyPassClaimed,
  onClaimResidency,
  onBecomeCitizen,
}: {
  readonly remainingSeconds: number;
  readonly residencyPassClaimed: boolean;
  readonly onClaimResidency: () => void;
  readonly onBecomeCitizen: () => void;
}) {
  return (
    <div data-testid="colosseum-state-d" style={stateBox}>
      <h3 style={stateTitle}>You&rsquo;re eligible to become a citizen</h3>
      <p style={body}>
        You have remained a compliant resident for 2 minutes. Become a
        Colosseum Citizen to receive your citizenship certificate.
      </p>
      <ComplianceProgress remainingSeconds={remainingSeconds} />
      <button
        type="button"
        data-variant="primary"
        onClick={onBecomeCitizen}
        style={{ ...primaryButton, width: '100%' }}
      >
        Become a Citizen
      </button>
      <button
        type="button"
        data-variant="quiet"
        onClick={onClaimResidency}
        style={quietAction}
      >
        {residencyPassLabel(residencyPassClaimed)}
      </button>
    </div>
  );
}

/**
 * State E — already a Colosseum Citizen: the inline citizenship certificate.
 *
 * The certificate stays readable in the page (so a stored citizen always sees
 * it), and is itself the control that opens the full-screen reveal on demand.
 * It is a real `<button>` so keyboard and assistive-tech users can reach it; it
 * contains no interactive children. The full-screen celebration is what plays
 * automatically on the moment of citizenship.
 */
function StateE({
  serial,
  issuedAt,
  onOpenFullScreen,
}: {
  readonly serial: string | null;
  readonly issuedAt: string | null;
  readonly onOpenFullScreen: () => void;
}) {
  return (
    <div data-testid="colosseum-state-e" style={certificateStage}>
      {/*
        The artifact is a non-interactive container; a real <button> overlays it
        as a sibling, so the button carries the accessible name while the card's
        text stays in the accessibility tree. A <button> wrapping the block
        content would be invalid (phrasing-content content model).
      */}
      <div className="kade-passport-trigger">
        <CertificateArtifact
          variant="embedded"
          serial={serial}
          issuedAt={issuedAt}
        />
        <button
          type="button"
          onClick={onOpenFullScreen}
          aria-label="Open the citizenship certificate full-screen"
          className="kade-passport-trigger-button"
        />
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

// The pill button hugs its label, so it needs real horizontal padding: without
// it the `border-radius: 999px` end-caps have no room and the glyphs render
// over the curved ends. `minHeight` (not a fixed `height`) lets the label wrap
// on a narrow viewport instead of being clipped.
const primaryButton = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginTop: '12px',
  minHeight: '42px',
  padding: '10px 22px',
  border: 0,
  borderRadius: '999px',
  background: tokens.brandPrimary,
  color: '#fff',
  fontFamily: 'inherit',
  fontSize: '14px',
  fontWeight: 600,
  lineHeight: 1.2,
  textAlign: 'center' as const,
  cursor: 'pointer',
  maxWidth: '100%',
  boxSizing: 'border-box' as const,
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

/* State B's inline checklist of the four real checks. */
const checklist = {
  margin: '4px 0 0',
  padding: 0,
  listStyle: 'none' as const,
};

const checkRow = {
  display: 'grid',
  gridTemplateColumns: '20px 1fr auto',
  gap: '10px',
  alignItems: 'center',
  padding: '10px 0',
  borderTop: `1px solid ${tokens.border}`,
};

const checkDot = {
  width: '18px',
  height: '18px',
  borderRadius: '50%',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '10px',
  fontWeight: 700,
  lineHeight: 1,
};

const checkDotMet = {
  background: tokens.brandPrimary,
  color: '#fff',
};

const checkDotPending = {
  background: tokens.chipBg,
  color: tokens.muted,
};

const checkDotBlocked = {
  background: '#FDECEA',
  color: tokens.danger,
};

const checkBody = {
  display: 'flex',
  flexDirection: 'column' as const,
  minWidth: 0,
};

const checkLabel = {
  fontSize: '13px',
  fontWeight: 600,
  color: tokens.ink,
};

const checkDetail = {
  fontSize: '11.5px',
  color: tokens.muted,
};

const checkState = {
  fontSize: '11.5px',
  fontWeight: 600,
  whiteSpace: 'nowrap' as const,
};

/* The discreet compliance window: a thin line plus small, muted text. */
const complianceWrap = {
  marginTop: '14px',
};

const progressTrack = {
  height: '4px',
  borderRadius: '999px',
  background: tokens.border,
  overflow: 'hidden',
};

const progressFill = {
  height: '100%',
  borderRadius: '999px',
  background: tokens.brandPrimary,
  transformOrigin: 'left center',
};

const complianceText = {
  margin: '6px 0 0',
  fontSize: '11.5px',
  color: tokens.muted,
};

const complianceTime = {
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
  color: tokens.chipFg,
};

/* The quiet, text-only residency-pass affordance used in state D so it never
   competes with "Become a Citizen". It is still a real button. */
const quietAction = {
  display: 'inline-flex',
  alignItems: 'center',
  marginTop: '12px',
  padding: '2px 0',
  border: 0,
  background: 'transparent',
  color: tokens.brandPrimary,
  fontFamily: 'inherit',
  fontSize: '12.5px',
  fontWeight: 600,
  cursor: 'pointer',
  textDecoration: 'underline',
  textUnderlineOffset: '3px',
};

const certificateStage = {
  marginTop: '14px',
};
