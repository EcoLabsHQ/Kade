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
  EMPTY_COLOSSEUM_PROGRESS,
  generatePassportSerial,
  generateResidencyPassSerial,
  markCitizen,
  markResidentSince,
  NOOP_COLOSSEUM_PROGRESS_STORE,
  type ColosseumProgress,
  type ColosseumProgressStore,
} from './colosseum-progress';
import { ResidencyPass, ResidencyPassArtifact } from './ResidencyPass';
import {
  CertificateArtifact,
  CitizenshipCertificate,
} from './CitizenshipCertificate';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

/**
 * The Colosseum flow, rendered as a mocked sub-section INSIDE the Residency step.
 *
 * This is a declared demo layer: "Colosseum Resident" / "Colosseum Citizen" and
 * the citizenship certificate confer no real residency, citizenship, legal
 * status or on-chain record. Nothing here writes a table or calls an RPC
 * directly. The 2-minute clock and the certificate are demo state, read
 * server-side for the account and written back through server actions (see
 * `@/lib/residency/colosseum-state-server`), so navigating away, reloading or
 * signing in from another browser does not restart the clock or re-lock "Become
 * a Citizen". The compliance window is the same
 * `applications.colosseum_resident_since` the Citizen mint reads.
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

/**
 * The mint outcome the section renders, structurally compatible with the claim
 * server action's result. Only the fields the UI needs are named; the action
 * outcome (including the additive `explorerUrl`) satisfies it directly, and a
 * local submission failure can be represented without importing the server
 * module.
 */
export interface ClaimOutcomeView {
  readonly status:
    | 'sent'
    | 'failed'
    | 'blocked'
    | 'not-configured'
    | 'unauthenticated';
  readonly sent: boolean;
  readonly reason: string;
  readonly txHash?: string | null;
  readonly account?: string | null;
  readonly operation?: string | null;
  readonly explorerUrl?: string | null;
  /**
   * What the server did to the resident Safe before minting: `deployed` when
   * this claim deployed it on the membership chain, `already-deployed` when it
   * was already live. Absent when the server did not report it, in which case
   * the receipt says nothing rather than guessing.
   */
  readonly safeDeployment?: 'deployed' | 'already-deployed' | null;
}

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
   * The stable key the demo clock and certificate are scoped under (the
   * recorded `applications.id`). Null/absent scopes the demo state under a
   * constant.
   */
  readonly profileKey?: string | null;
  /**
   * The demo state read server-side for this account. It is the initial value
   * the section renders; the section keeps a local mirror and reconciles it with
   * the canonical state the store returns. Absent means the demo-only surface
   * (nothing persisted), which is the declared demo default.
   */
  readonly initialProgress?: ColosseumProgress;
  /**
   * The server write paths. Each transition updates the local mirror
   * synchronously (so the reveal timing and one-shot guards are unchanged) and
   * persists through this store. Absent means a no-op store: the demo-only
   * surface keeps its state for the session but persists nothing.
   */
  readonly store?: ColosseumProgressStore;
  /**
   * The claim trigger. Called once, on the first claim of each milestone, with
   * the target the server should mint (`resident` / `citizen`). It returns the
   * mint outcome so the section can report honestly whether the credential was
   * issued on chain (feedback 1); the reveal is opened before it is awaited, so
   * the mint never changes the reveal timing or the one-shot guards. A caller
   * that only renders the demo may omit it or return nothing.
   */
  readonly onClaimMembership?: (
    target: MembershipClaimTarget,
  ) => Promise<ClaimOutcomeView | null> | void;
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
  initialProgress,
  store,
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

  // The demo clock and certificate, read server-side and passed down (see
  // ./colosseum-progress and @/lib/residency/colosseum-state-server). The local
  // mirror is seeded from the server state so a citizen load shows the
  // certificate immediately and a resident load resumes the window rather than
  // restarting it; every transition updates the mirror synchronously and then
  // reconciles with the canonical state the store returns. The store is held in
  // a ref so a caller that passes a fresh object each render does not re-run the
  // effects.
  const storeRef = useRef<ColosseumProgressStore>(
    store ?? NOOP_COLOSSEUM_PROGRESS_STORE,
  );
  storeRef.current = store ?? NOOP_COLOSSEUM_PROGRESS_STORE;
  const initialProgressRef = useRef<ColosseumProgress>(
    initialProgress ?? EMPTY_COLOSSEUM_PROGRESS,
  );
  initialProgressRef.current = initialProgress ?? EMPTY_COLOSSEUM_PROGRESS;

  const [mounted, setMounted] = useState(false);
  const [progress, setProgress] = useState<ColosseumProgress>(
    initialProgress ?? EMPTY_COLOSSEUM_PROGRESS,
  );
  const [now, setNow] = useState(() => Date.now());
  // The two full-screen demo reveals. They are pure presentation: opening or
  // closing them changes no persisted state and blocks nothing once dismissed.
  const [residencyPassOpen, setResidencyPassOpen] = useState(false);
  const [certificateOpen, setCertificateOpen] = useState(false);
  // The first, live citizenship reveal uses the celebratory tier; every later
  // open uses the standard one.
  const [certificateCelebration, setCertificateCelebration] = useState(false);
  // The first, live residency claim uses its own celebration tier (distinct
  // motion and its own sound); every later open uses the standard one.
  const [residencyCelebration, setResidencyCelebration] = useState(false);
  // Reduced motion suppresses the claim affordance's entrance animation, so the
  // button is simply present and legible rather than arriving with motion.
  const reducedMotion = usePrefersReducedMotion();
  // The mint outcome per claim target, so the section can report honestly
  // whether the on-chain credential was issued (feedback 1). Session state only:
  // it is not persisted, and it is cleared for a target while a fresh claim is
  // in flight so a stale confirmation is never shown.
  const [mintOutcomes, setMintOutcomes] = useState<
    Partial<Record<MembershipClaimTarget, ClaimOutcomeView>>
  >({});
  const [mintPending, setMintPending] = useState<MembershipClaimTarget | null>(
    null,
  );
  // The certificate reveal must fire exactly once, on the *live* transition to
  // citizen — not on a restored citizen load and not again after a dismissal.
  // `restoredCitizenRef` records whether the server state at mount/profile
  // change was already a citizen (so it never celebrates a restored state);
  // `celebratedCitizenRef` latches the one live celebration per mount.
  const restoredCitizenRef = useRef(false);
  const celebratedCitizenRef = useRef(false);

  useEffect(() => {
    setMounted(true);
    const restored = initialProgressRef.current;
    setProgress(restored);
    // Seed from the server state so only a *new* citizenship celebrates.
    restoredCitizenRef.current = restored.citizenAt !== null;
    celebratedCitizenRef.current = false;
    setNow(Date.now());
  }, [profileKey]);

  const citizen = progress.citizenAt !== null;
  const secondsRemaining = secondsRemainingFrom(progress.residentSince, now);
  const windowElapsed =
    progress.residentSince !== null && secondsRemaining <= 0;
  const citizenEligible = allChecksMet && windowElapsed && !citizen;

  // Keep the server-side clock honest and tick it only while the window is live.
  // The window is started by `claimResidency`, not here: the human's flow is
  // claim-first, then the 2-minute compliance window. This effect only clears
  // the window on decay (the checks stopped being green before citizenship) and
  // advances the displayed clock. The start/clear pair writes the same
  // `applications.colosseum_resident_since` the Citizen mint reads, so the
  // displayed countdown and the mint's compliance window are one record. Runs
  // only after mount so the server render never writes demo state.
  useEffect(() => {
    if (!mounted) return;
    if (!allChecksMet || citizen) {
      // The checks stopped being green before citizenship: the clock resets,
      // matching the existing decay. Once a citizen, the record is kept.
      if (!citizen && progress.residentSince !== null) {
        setProgress((current) => clearResidentSince(current));
        void storeRef.current.clearWindow().then((canonical) => {
          if (canonical) setProgress(canonical);
        });
      }
      return;
    }
    // No window yet: nothing to tick. It starts on the claim.
    if (progress.residentSince === null) return;
    if (secondsRemaining <= 0) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [
    mounted,
    allChecksMet,
    citizen,
    progress.residentSince,
    secondsRemaining,
  ]);

  // The nav highlight is on exactly while "Become a Citizen" is available. It
  // is deliberately NOT cleared on unmount, so the highlight persists when the
  // resident navigates away from /residency and can guide them back; returning
  // re-evaluates it against the persisted window, and becoming a citizen clears
  // it explicitly.
  useEffect(() => {
    setColosseumAttention(citizenEligible);
  }, [citizenEligible]);

  /**
   * Submit a claim and record its outcome. The reveal is already opening by the
   * time this is called, so awaiting the mint never affects the reveal timing.
   * While the promise is in flight the target is marked pending and any stale
   * outcome is dropped; when it settles the real outcome (or a caller-provided
   * `failed` outcome) is stored, so the section never shows a confirmation the
   * mint did not produce.
   */
  const runClaim = useCallback(
    (target: MembershipClaimTarget) => {
      const result = onClaimMembership?.(target);
      if (!result || typeof result.then !== 'function') return;
      setMintPending(target);
      setMintOutcomes((current) => {
        const next = { ...current };
        delete next[target];
        return next;
      });
      void result.then(
        (outcome) => {
          if (outcome) {
            setMintOutcomes((current) => ({ ...current, [target]: outcome }));
          }
          setMintPending((pending) => (pending === target ? null : pending));
        },
        () => {
          setMintPending((pending) => (pending === target ? null : pending));
        },
      );
    },
    [onClaimMembership],
  );

  const becomeCitizen = useCallback(() => {
    const iso = new Date().toISOString();
    const serial = generatePassportSerial();
    setProgress((current) => markCitizen(current, iso, serial));
    setColosseumAttention(false);
    // The claim is the trigger: the server re-validates and mints the Citizen
    // credential. The reveal opens from the local transition; the mint outcome
    // is awaited afterwards, and the demo state is persisted to the account.
    runClaim('citizen');
    void storeRef.current.becomeCitizen(iso, serial).then((canonical) => {
      if (canonical) setProgress(canonical);
    });
  }, [runClaim]);

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

  // Claiming the residency pass records a demo serial/instant once, starts the
  // 2-minute compliance window, and reveals the pass full-screen with the
  // residency celebration (distinct motion + sound). Re-opening an already
  // claimed pass shows the same artifact in the standard tier and neither
  // re-starts the window nor re-mints.
  const claimResidency = useCallback(() => {
    // The mint and the window start are triggered only on the *first* claim;
    // re-opening the pass is not a claim and must not call the server again.
    const alreadyClaimed = progress.residencyPassSerial !== null;
    const iso = new Date().toISOString();
    const serial = generateResidencyPassSerial();
    setProgress((current) => claimResidencyPass(current, iso, serial));
    setResidencyCelebration(!alreadyClaimed);
    setResidencyPassOpen(true);
    if (!alreadyClaimed) {
      // The claim starts the compliance window. The server re-derives the four
      // real checks before recording `applications.colosseum_resident_since`
      // (the same gate as before, now invoked at the human's claim-first
      // moment), so the server gate is not weakened. The local mirror updates on
      // the same tick; the server record is the durable one.
      setProgress((current) => markResidentSince(current, iso));
      setNow(Date.now());
      // Start the window, then record the pass, in order. The pass write's
      // canonical state is read after the window is durable, so applying it
      // cannot erase the window the start just recorded.
      void storeRef.current
        .startWindow(iso)
        .then((canonical) => {
          if (canonical) setProgress(canonical);
          return storeRef.current.claimResidencyPass(iso, serial);
        })
        .then((canonical) => {
          if (canonical) setProgress(canonical);
        });
      // The reveal is already opening, so the mint never changes its timing; the
      // outcome is awaited afterwards and reported honestly.
      runClaim('resident');
    }
  }, [progress.residencyPassSerial, runClaim]);

  const residencyPassClaimed = progress.residencyPassSerial !== null;
  const showCertificate = mounted && citizen;
  // Once the resident has claimed their residency pass, the section shows the
  // same inline artifact treatment a citizen gets — the resident card instead of
  // the certificate (feedback 3).
  const showResident = mounted && allChecksMet && !citizen && residencyPassClaimed;
  // The claimable state: all four checks green and the pass not yet claimed. The
  // resident card is shown greyed out (inactive) with the Claim affordance;
  // claiming starts the 2-minute window and reveals the pass. The window cannot
  // be running here in the normal flow — it starts on the claim — but a legacy
  // persisted window (started before this flow) is still counted down at the
  // bottom of the section.
  const showClaimState =
    mounted && allChecksMet && !citizen && !residencyPassClaimed;

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

      {/* State C — all four checks green and the pass not yet claimed: the
          resident card is previewed greyed out (unclaimed) and the Claim
          affordance animates in. Claiming starts the 2-minute window and opens
          the residency reveal. */}
      {showClaimState ? (
        <StateClaim
          reducedMotion={reducedMotion}
          onClaimResidency={claimResidency}
        />
      ) : null}

      {/* State R — the resident has claimed their residency pass: the same
          inline artifact treatment as the citizen state (State E), but the
          residency pass instead of the certificate. The artifact is the control
          that opens the full-screen reveal on demand; the citizenship action
          stays reachable below it, and the testing-only counter sits at the very
          bottom of the section. */}
      {showResident ? (
        <StateResident
          serial={progress.residencyPassSerial}
          issuedAt={progress.residencyPassAt}
          windowElapsed={windowElapsed}
          mintPending={mintPending === 'resident'}
          mintOutcome={mintOutcomes.resident ?? null}
          onOpenFullScreen={() => {
            setResidencyCelebration(false);
            setResidencyPassOpen(true);
          }}
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
          mintPending={mintPending === 'citizen'}
          mintOutcome={mintOutcomes.citizen ?? null}
          onOpenFullScreen={() => {
            setCertificateCelebration(false);
            setCertificateOpen(true);
          }}
        />
      ) : null}

      {/* Full-screen demo reveals. Both are dismissible and block nothing. */}
      <ResidencyPass
        open={residencyPassOpen}
        onClose={() => {
          setResidencyPassOpen(false);
          setResidencyCelebration(false);
        }}
        serial={progress.residencyPassSerial}
        issuedAt={progress.residencyPassAt}
        residencyCelebration={residencyCelebration}
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

      {/* The 2-minute compliance window is a TESTING affordance, not product UI.
          It is a single muted line at the very bottom of the section (feedback
          4): visually it should read as developer chrome, not as part of the
          Colosseum story. The state and the window itself are untouched — the
          countdown is still computed from the same persisted `residentSince`,
          and it stays in the accessibility tree (the progressbar and its
          `aria-valuetext`), so assistive tech can still reach it. */}
      {progress.residentSince !== null && !citizen ? (
        <ComplianceProgress remainingSeconds={secondsRemaining} />
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
 * The compliance window, made almost invisible: a hairline progress track plus a
 * single small, muted line of text at the very bottom of the section. The
 * human's feedback was that the counter was "demasiado protagonico" and is only
 * for testing, so it must read as developer chrome rather than product UI.
 *
 * It stays honest and reachable: the remaining time is real (computed from the
 * same persisted `residentSince`), it is still visible text, and the
 * `progressbar` keeps its `aria-valuetext`, so assistive tech can still reach
 * it. Nothing about the underlying state or the server-side window changes.
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
    <div data-testid="colosseum-compliance" style={complianceWrap}>
      <div
        data-testid="colosseum-compliance-progress"
        role="progressbar"
        aria-label="Compliance window (testing only)"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={elapsed}
        aria-valuetext={`${formatCountdown(remainingSeconds)} remaining`}
        style={progressTrack}
      >
        <div style={{ ...progressFill, transform: `scaleX(${fraction})` }} />
      </div>
      <p style={complianceText}>
        Testing only ·{' '}
        <span data-testid="colosseum-countdown" style={complianceTime}>
          {formatCountdown(remainingSeconds)}
        </span>{' '}
        remaining in the compliance window
      </p>
    </div>
  );
}

/**
 * State C — all four checks green and the residency pass not yet claimed.
 *
 * The resident card is previewed desaturated and inactive (grey) so the reward
 * is visible before it is claimed, and the Claim affordance animates in when
 * the claim becomes possible. Claiming is the human's deliberate first step:
 * it starts the 2-minute compliance window and opens the residency reveal.
 * Under reduced motion the entrance is skipped and the button is simply
 * present and legible.
 */
function StateClaim({
  reducedMotion,
  onClaimResidency,
}: {
  readonly reducedMotion: boolean;
  readonly onClaimResidency: () => void;
}) {
  return (
    <div data-testid="colosseum-state-c" style={stateBox}>
      <h3 style={stateTitle}>You&rsquo;re a Colosseum Resident</h3>
      <p style={body}>
        All four residency checks are green. Claim your virtual residency pass —
        the 2-minute compliance window starts when you do.
      </p>
      <div
        className={
          reducedMotion
            ? 'kade-claim-stage'
            : 'kade-claim-stage kade-claim-animated'
        }
      >
        <div className="kade-claim-card" data-testid="colosseum-claim-card">
          {/* The unclaimed preview: the same pass artifact, greyed out and
              marked "Not claimed yet", so the claimed presentation is a
              deliberate change of state rather than the first time it appears. */}
          <ResidencyPassArtifact
            variant="embedded"
            unclaimed
            serial={null}
            issuedAt={null}
          />
        </div>
        <button
          type="button"
          data-variant="primary"
          data-testid="colosseum-claim-button"
          onClick={onClaimResidency}
          className="kade-claim-button"
          style={{ ...primaryButton, width: '100%' }}
        >
          Claim Colosseum Residency
        </button>
      </div>
    </div>
  );
}

/**
 * The inline artifact stage shared by the resident and citizen states: the
 * embedded credential card plus the transparent overlay button that opens its
 * full-screen reveal. Both states use exactly this structure and differ only in
 * which artifact is rendered (feedback 3), so the two cannot drift apart.
 *
 * The artifact is a non-interactive container; a real <button> overlays it as a
 * sibling, so the button carries the accessible name while the card's text stays
 * in the accessibility tree. A <button> wrapping the block content would be
 * invalid (phrasing-content content model).
 */
function ArtifactStage({
  artifact,
  serial,
  issuedAt,
  onOpenFullScreen,
}: {
  readonly artifact: 'certificate' | 'residency-pass';
  readonly serial: string | null;
  readonly issuedAt: string | null;
  readonly onOpenFullScreen: () => void;
}) {
  const certificate = artifact === 'certificate';
  return (
    <div className="kade-passport-trigger">
      {certificate ? (
        <CertificateArtifact variant="embedded" serial={serial} issuedAt={issuedAt} />
      ) : (
        <ResidencyPassArtifact variant="embedded" serial={serial} issuedAt={issuedAt} />
      )}
      <button
        type="button"
        onClick={onOpenFullScreen}
        aria-label={
          certificate
            ? 'Open the citizenship certificate full-screen'
            : 'Open the residency pass full-screen'
        }
        className="kade-passport-trigger-button"
      />
    </div>
  );
}

/**
 * State E — already a Colosseum Citizen: the inline citizenship certificate.
 *
 * The certificate stays readable in the page (so a stored citizen always sees
 * it), and is itself the control that opens the full-screen reveal on demand.
 * The full-screen celebration is what plays automatically on the moment of
 * citizenship.
 */
function StateE({
  serial,
  issuedAt,
  mintPending,
  mintOutcome,
  onOpenFullScreen,
}: {
  readonly serial: string | null;
  readonly issuedAt: string | null;
  readonly mintPending: boolean;
  readonly mintOutcome: ClaimOutcomeView | null;
  readonly onOpenFullScreen: () => void;
}) {
  return (
    <div data-testid="colosseum-state-e" style={certificateStage}>
      <ArtifactStage
        artifact="certificate"
        serial={serial}
        issuedAt={issuedAt}
        onOpenFullScreen={onOpenFullScreen}
      />
      <MintReceipt
        target="citizen"
        pending={mintPending}
        outcome={mintOutcome}
        serial={serial}
      />
    </div>
  );
}

/**
 * State R — a Colosseum Resident who has claimed their residency pass: the same
 * layout as the citizen state (State E), rendering the residency pass artifact
 * instead of the certificate (feedback 3). The artifact is the control that
 * opens the full-screen reveal on demand. Once the compliance window has
 * elapsed, becoming a citizen is the single primary action; before that the
 * resident is told to remain compliant. The testing-only counter sits at the
 * very bottom of the section, outside this state.
 */
function StateResident({
  serial,
  issuedAt,
  windowElapsed,
  mintPending,
  mintOutcome,
  onOpenFullScreen,
  onBecomeCitizen,
}: {
  readonly serial: string | null;
  readonly issuedAt: string | null;
  readonly windowElapsed: boolean;
  readonly mintPending: boolean;
  readonly mintOutcome: ClaimOutcomeView | null;
  readonly onOpenFullScreen: () => void;
  readonly onBecomeCitizen: () => void;
}) {
  return (
    <div data-testid="colosseum-state-resident" style={certificateStage}>
      <ArtifactStage
        artifact="residency-pass"
        serial={serial}
        issuedAt={issuedAt}
        onOpenFullScreen={onOpenFullScreen}
      />
      <MintReceipt
        target="resident"
        pending={mintPending}
        outcome={mintOutcome}
        serial={serial}
      />
      {windowElapsed ? (
        <button
          type="button"
          data-variant="primary"
          onClick={onBecomeCitizen}
          style={{ ...primaryButton, width: '100%' }}
        >
          Become a Citizen
        </button>
      ) : (
        <p style={{ ...body, fontWeight: 600 }}>
          Remain a compliant resident for 2 minutes to be eligible to become a
          Colosseum Citizen.
        </p>
      )}
    </div>
  );
}

/**
 * The honest mint receipt (feedback 1).
 *
 * When a claim confirms, the server returns the real on-chain outcome: the
 * transaction hash, the member account and the operation. This component
 * surfaces exactly that — it never fabricates a "success". It links to the
 * credential on the membership chain's explorer (the issuance transaction and
 * the holder account) and repeats the serial/state the app already knows.
 *
 * While the mint is in flight it says so; a failed/blocked/unconfigured claim
 * says the credential was NOT issued and shows the reason. It is session state:
 * a reload falls back to the artifact's own serial/state.
 */
function MintReceipt({
  target,
  pending,
  outcome,
  serial,
}: {
  readonly target: MembershipClaimTarget;
  readonly pending: boolean;
  readonly outcome: ClaimOutcomeView | null;
  readonly serial: string | null;
}) {
  const noun =
    target === 'resident'
      ? 'Colosseum Resident credential'
      : 'Colosseum Citizen credential';
  const state = target === 'resident' ? 'Resident' : 'Citizen';

  if (pending) {
    return (
      <p
        data-testid={`colosseum-mint-${target}`}
        data-state="pending"
        style={mintReceiptBox}
      >
        Issuing your {noun} on chain — waiting for confirmation…
      </p>
    );
  }
  if (!outcome) return null;

  const explorerUrl = outcome.explorerUrl ?? null;
  const txHash = outcome.txHash ?? null;
  const account = outcome.account ?? null;
  const txLink = explorerUrl && txHash ? `${explorerUrl}/tx/${txHash}` : null;
  const accountLink =
    explorerUrl && account ? `${explorerUrl}/address/${account}` : null;

  return (
    <div
      data-testid={`colosseum-mint-${target}`}
      data-state={outcome.status}
      style={mintReceiptBox}
    >
      {outcome.status === 'sent' ? (
        <>
          <p style={mintLine}>
            <strong>Issued on chain.</strong> Your {noun} was confirmed.
          </p>
          <p style={mintMeta}>
            Status: {state}
            {serial ? ` · Serial ${serial}` : ''}
          </p>
          {outcome.safeDeployment === 'deployed' ? (
            <p style={mintMeta}>
              Your Safe was deployed on chain before the credential was issued.
            </p>
          ) : outcome.safeDeployment === 'already-deployed' ? (
            <p style={mintMeta}>
              Your Safe was already deployed on chain; the credential was issued
              to it.
            </p>
          ) : null}
          {txLink || accountLink ? (
            <ul style={mintLinks}>
              {txLink ? (
                <li>
                  <a href={txLink} target="_blank" rel="noreferrer" style={mintLink}>
                    View the issuance transaction on Arbiscan
                  </a>
                </li>
              ) : null}
              {accountLink ? (
                <li>
                  <a
                    href={accountLink}
                    target="_blank"
                    rel="noreferrer"
                    style={mintLink}
                  >
                    View the credential holder on Arbiscan
                  </a>
                </li>
              ) : null}
            </ul>
          ) : txHash ? (
            <p style={mintMeta}>
              Transaction: <code>{txHash}</code>
            </p>
          ) : null}
        </>
      ) : (
        <>
          <p style={mintLine}>
            <strong>The credential was not issued.</strong> {outcome.reason}
          </p>
          {txLink ? (
            <p style={mintMeta}>
              <a href={txLink} target="_blank" rel="noreferrer" style={mintLink}>
                View the transaction on Arbiscan
              </a>
            </p>
          ) : null}
        </>
      )}
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

/* The testing-only compliance window: a hairline track plus one small, muted
   line at the very bottom of the section, deliberately low-contrast so it does
   not read as product UI. */
const complianceWrap = {
  marginTop: '22px',
  opacity: 0.5,
};

const progressTrack = {
  height: '2px',
  borderRadius: '999px',
  background: tokens.border,
  overflow: 'hidden',
};

const progressFill = {
  height: '100%',
  borderRadius: '999px',
  background: tokens.locked,
  transformOrigin: 'left center',
};

const complianceText = {
  margin: '4px 0 0',
  fontSize: '10px',
  letterSpacing: '.01em',
  color: tokens.muted,
};

const complianceTime = {
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
  color: tokens.muted,
};

/* The honest mint receipt shown under the resident/citizen artifact. */
const mintReceiptBox = {
  marginTop: '12px',
  padding: '12px 14px',
  borderRadius: '10px',
  background: '#fff',
  border: `1px solid ${tokens.border}`,
  fontSize: '12.5px',
  lineHeight: 1.6,
  color: tokens.chipFg,
};

const mintLine = {
  margin: 0,
};

const mintMeta = {
  margin: '4px 0 0',
  color: tokens.muted,
};

const mintLinks = {
  margin: '6px 0 0',
  paddingLeft: '18px',
};

const mintLink = {
  color: tokens.brandPrimary,
  fontWeight: 600,
};

const certificateStage = {
  marginTop: '14px',
};
