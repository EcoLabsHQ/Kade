'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { tokens } from '@/components/ui/tokens';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';
import { playCitizenshipCue } from './reveal-sound';

/**
 * The page-behind scroll lock.
 *
 * `overflow: hidden` on the body is not enough: iOS Safari still scrolls the
 * page behind a fixed overlay, and the page can shift when the lock engages.
 * The robust form pins the body at its current scroll offset so the page
 * genuinely cannot move, then puts it back exactly. The lock is
 * reference-counted so nested reveals (and React's development double-invoke)
 * cannot overwrite the saved styles with already-locked ones.
 */
interface SavedBodyStyles {
  readonly position: string;
  readonly top: string;
  readonly left: string;
  readonly right: string;
  readonly overflow: string;
  readonly paddingRight: string;
}

let bodyLockCount = 0;
let savedBodyStyles: SavedBodyStyles | null = null;
let savedScrollY = 0;

function lockBody(): void {
  bodyLockCount += 1;
  if (bodyLockCount > 1) return;

  const body = document.body;
  savedScrollY = window.scrollY;
  savedBodyStyles = {
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    overflow: body.style.overflow,
    paddingRight: body.style.paddingRight,
  };

  body.style.position = 'fixed';
  body.style.top = `-${savedScrollY}px`;
  body.style.left = '0';
  body.style.right = '0';
  body.style.overflow = 'hidden';

  // `scrollbar-gutter: stable` on the root already reserves the gutter, so only
  // compensate with padding when the browser does not support it. Never both.
  const supportsScrollbarGutter =
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('scrollbar-gutter: stable');
  if (!supportsScrollbarGutter) {
    const scrollbarWidth =
      window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;
  }

  document.documentElement.setAttribute('data-overlay-open', 'true');
}

function unlockBody(): void {
  if (bodyLockCount === 0) return;
  bodyLockCount -= 1;
  if (bodyLockCount > 0) return;

  const body = document.body;
  if (savedBodyStyles) {
    body.style.position = savedBodyStyles.position;
    body.style.top = savedBodyStyles.top;
    body.style.left = savedBodyStyles.left;
    body.style.right = savedBodyStyles.right;
    body.style.overflow = savedBodyStyles.overflow;
    body.style.paddingRight = savedBodyStyles.paddingRight;
  }
  savedBodyStyles = null;

  document.documentElement.removeAttribute('data-overlay-open');
  window.scrollTo({ top: savedScrollY, left: 0, behavior: 'instant' });
}

/** The pointer tilt is armed only after the automatic foil pass has finished. */
const FOIL_POINTER_ARM_MS = 1080;
/** The celebratory tier runs longer; interaction is enabled at ~1.6s. */
const CELEBRATION_POINTER_ARM_MS = 1600;
/** How quickly the tilt chases the pointer (Reveal 3: 0.14). */
const FOIL_LERP = 0.14;
/** Reveal 3 caps the tilt at ±2deg. */
const FOIL_MAX_TILT_DEG = 2;
/** The celebratory burst: 8–12 accent rays, 36° apart. */
const CELEBRATION_RAYS = 10;

interface FoilState {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  tiltX: number;
  tiltY: number;
  targetTiltX: number;
  targetTiltY: number;
  raf: number;
  active: boolean;
}

function freshFoilState(): FoilState {
  return {
    x: 0,
    y: 0,
    targetX: 0,
    targetY: 0,
    tiltX: 0,
    tiltY: 0,
    targetTiltX: 0,
    targetTiltY: 0,
    raf: 0,
    active: false,
  };
}

/**
 * The shared full-screen shell for the Colosseum demo artifacts (the virtual
 * residency pass and the citizenship certificate).
 *
 * It is deliberately a *celebration*, not a gate: everything it shows is
 * declared demo state, and it never writes anywhere real. The shell owns the
 * dialog contract so both artifacts inherit it:
 *
 *   - `role="dialog"` + `aria-modal="true"`, named by a heading;
 *   - focus moves into the card on open and returns to the opener on close;
 *   - Escape and a click outside dismiss it; a visible close control too;
 *   - the page behind is scroll-locked only while open, and restored on close,
 *     so dismissing never leaves the page blocked;
 *   - a polite live region announces the reveal;
 *   - the backdrop and card carry the shared Reveal 3 motion (a fast settle),
 *     a pointer tilt and one full-card light sweep, unless
 *     `prefers-reduced-motion: reduce` is set, in which case only a short fade
 *     is used (and no sweep element is rendered).
 *
 * The reveal is intentionally non-blocking in spirit: there is no focus trap
 * and nothing to complete. The user can always get out, at any moment of the
 * animation; the whole subtree unmounts on close, so nothing is left stuck.
 */
export interface FullScreenRevealProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The dialog's accessible name, rendered as a visually hidden heading. */
  readonly title: string;
  /** A polite announcement made to assistive tech when the reveal opens. */
  readonly announcement: string;
  /**
   * The artifact-specific reveal class (Reveal 1 for the residency pass,
   * Reveal 2 for the certificate) applied to the document wrapper.
   */
  readonly revealClassName?: string;
  /** The artifact wrapper's class hook (kept for the reduced-motion tests). */
  readonly flipClassName?: string;
  /**
   * The one-time celebratory tier (the first, live citizenship reveal): a
   * deeper, slower rise with a controlled overshoot, bloom, rays and a wider
   * single light sweep. Every subsequent open uses the standard tier.
   */
  readonly celebration?: boolean;
  readonly children: ReactNode;
}

export function FullScreenReveal({
  open,
  onClose,
  title,
  announcement,
  revealClassName,
  flipClassName,
  celebration = false,
  children,
}: FullScreenRevealProps) {
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const tiltRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const foil = useRef<FoilState>(freshFoilState());
  const reducedMotion = usePrefersReducedMotion();
  // Portals need a document. Client components are still server-rendered, so
  // wait until after mount before creating one.
  const [mounted, setMounted] = useState(false);
  // Pointer control begins only once the automatic foil pass has completed.
  const [foilReady, setFoilReady] = useState(false);
  // The overlay cannot scroll; if the artifact genuinely cannot fit on a short
  // viewport we scale it down instead. 1 means "no scaling".
  const [fitScale, setFitScale] = useState(1);
  // The reveal sound plays automatically; there is no mute control. A missing
  // or blocked AudioContext degrades silently to no sound.
  // Guards against a re-render (or a React StrictMode double-invoke) replaying
  // the cue. Reset when the reveal closes.
  const soundPlayedRef = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Remember what had focus, and return focus there on close. The opener can be
  // gone by then (e.g. the "Become a Citizen" button unmounts into State E), so
  // only restore when it is still in the document.
  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    return () => {
      const opener = openerRef.current;
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  // Move focus into the card once it is on screen.
  useEffect(() => {
    if (open) cardRef.current?.focus();
  }, [open]);

  // Escape dismisses.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  // Scroll-lock the page only while open; always restore the previous state.
  useEffect(() => {
    if (!open) return;
    lockBody();
    return unlockBody;
  }, [open]);

  // Make the artifact always fit the overlay's visible area. The overlay is NOT
  // a scroll port: it cannot scroll (see `backdrop`), so a short viewport must
  // scale the artifact down instead. The card's natural height is measured and
  // the card is scaled by the true ratio with no floor, so it can never be left
  // overflowing. The effect depends on `mounted` as well as `open`: the card
  // only exists after mount, and a reveal that ever mounts already-open must
  // still compute a scale. jsdom reports zero heights, so the guard leaves the
  // scale at 1 there.
  useEffect(() => {
    if (!open || !mounted) {
      setFitScale(1);
      return;
    }
    const card = cardRef.current;
    if (!card || typeof window === 'undefined') return;
    const compute = () => {
      const natural = card.scrollHeight;
      const backdropEl = card.parentElement;
      const viewport =
        backdropEl?.clientHeight && backdropEl.clientHeight > 0
          ? backdropEl.clientHeight
          : window.innerHeight;
      // The overlay's vertical padding is up to 40px each side; keep a little
      // headroom so the card never touches the edge.
      const available = viewport - 96;
      if (natural <= 0 || available <= 0 || natural <= available) {
        setFitScale(1);
        return;
      }
      // No floor: a floor above the true ratio would leave the artifact taller
      // than the viewport and reintroduce an overflow. The true ratio always
      // fits.
      setFitScale(Number((available / natural).toFixed(4)));
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [open, mounted]);

  // Play the one-time citizenship cue only on the live celebration open. The
  // standard reveal, a re-open and the residency pass are all silent. A
  // restored citizen load never opens the reveal, so it never replays.
  // Deliberately independent of `prefers-reduced-motion`: sound is not motion.
  useEffect(() => {
    if (!open) {
      soundPlayedRef.current = false;
      return;
    }
    if (!celebration || soundPlayedRef.current) return;
    soundPlayedRef.current = true;
    playCitizenshipCue();
  }, [open, celebration]);

  // Arm the pointer tilt after the one-shot foil pass (640ms + 440ms). Under
  // reduced motion the pointer never drives it.
  useEffect(() => {
    setFoilReady(false);
    if (!open || reducedMotion) return;
    const armDelay = celebration ? CELEBRATION_POINTER_ARM_MS : FOIL_POINTER_ARM_MS;
    const timer = window.setTimeout(() => setFoilReady(true), armDelay);
    return () => window.clearTimeout(timer);
  }, [open, reducedMotion, celebration]);

  // Stop the smoothing loop and reset the pointer when the reveal closes.
  useEffect(() => {
    if (open) return;
    const state = foil.current;
    state.active = false;
    state.targetX = 0;
    state.targetY = 0;
    state.targetTiltX = 0;
    state.targetTiltY = 0;
    if (state.raf && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(state.raf);
    }
    state.raf = 0;
  }, [open]);

  useEffect(() => {
    const state = foil.current;
    return () => {
      if (state.raf && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(state.raf);
      }
      state.raf = 0;
    };
  }, []);

  const applyFoil = useCallback(() => {
    const state = foil.current;
    const tilt = tiltRef.current;
    if (!tilt) return;
    tilt.style.setProperty('--kade-tilt-x', `${state.tiltX}deg`);
    tilt.style.setProperty('--kade-tilt-y', `${state.tiltY}deg`);
  }, []);

  const startFoilLoop = useCallback(() => {
    const step = () => {
      const state = foil.current;
      state.x += (state.targetX - state.x) * FOIL_LERP;
      state.y += (state.targetY - state.y) * FOIL_LERP;
      state.tiltX += (state.targetTiltX - state.tiltX) * FOIL_LERP;
      state.tiltY += (state.targetTiltY - state.tiltY) * FOIL_LERP;
      applyFoil();
      const settled =
        Math.abs(state.x - state.targetX) < 0.3 &&
        Math.abs(state.y - state.targetY) < 0.3 &&
        Math.abs(state.tiltX - state.targetTiltX) < 0.02 &&
        Math.abs(state.tiltY - state.targetTiltY) < 0.02;
      if (state.active || !settled) {
        state.raf =
          typeof requestAnimationFrame === 'function'
            ? requestAnimationFrame(step)
            : 0;
      } else {
        state.raf = 0;
      }
    };
    const state = foil.current;
    if (state.raf) return;
    if (typeof requestAnimationFrame === 'function') {
      state.raf = requestAnimationFrame(step);
    } else {
      step();
    }
  }, [applyFoil]);

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (reducedMotion || !foilReady) return;
      const el = event.currentTarget;
      const rect = el.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      const state = foil.current;
      state.targetX = event.clientX - rect.left;
      state.targetY = event.clientY - rect.top;
      const nx = state.targetX / width - 0.5;
      const ny = state.targetY / height - 0.5;
      state.targetTiltX = Math.max(
        -FOIL_MAX_TILT_DEG,
        Math.min(FOIL_MAX_TILT_DEG, -ny * 4),
      );
      state.targetTiltY = Math.max(
        -FOIL_MAX_TILT_DEG,
        Math.min(FOIL_MAX_TILT_DEG, nx * 4),
      );
      state.active = true;
      startFoilLoop();
    },
    [foilReady, reducedMotion, startFoilLoop],
  );

  const handlePointerLeave = useCallback(() => {
    if (reducedMotion) return;
    const state = foil.current;
    state.active = false;
    state.targetTiltX = 0;
    state.targetTiltY = 0;
    startFoilLoop();
  }, [reducedMotion, startFoilLoop]);

  if (!open || !mounted) return null;

  const showCelebration = celebration && !reducedMotion;

  const backdropClassName = reducedMotion
    ? 'kade-reveal-backdrop-static'
    : celebration
      ? 'kade-reveal-backdrop-celebration'
      : 'kade-reveal-backdrop';

  const cardClassName = reducedMotion
    ? celebration
      ? 'kade-reveal-card-celebration-static'
      : 'kade-reveal-card-static'
    : celebration
      ? 'kade-reveal-card-celebration kade-celebration'
      : 'kade-reveal-card';

  const tiltClassName = reducedMotion ? undefined : 'kade-foil-tilt';

  const documentClassName = reducedMotion
    ? undefined
    : [
        revealClassName,
        flipClassName,
        showCelebration ? 'kade-reveal-flip-celebration' : null,
      ]
        .filter(Boolean)
        .join(' ');

  return createPortal(
    <div className={backdropClassName} onClick={onClose} style={backdrop}>
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className={cardClassName}
        style={
          fitScale === 1
            ? card
            : { ...card, transform: `scale(${fitScale})` }
        }
      >
        <h2 id={titleId} style={srOnly}>
          {title}
        </h2>
        <p role="status" aria-live="polite" style={srOnly}>
          {announcement}
        </p>

        <div style={closeRow}>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={closeButton}
          >
            <span aria-hidden="true">×</span>
            <span style={closeLabel}>Close</span>
          </button>
        </div>

        <div style={scene}>
          <div
            ref={tiltRef}
            className={tiltClassName}
            style={tilt}
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
          >
            {showCelebration ? (
              <div aria-hidden="true" className="kade-celebration-stage">
                <div className="kade-celebration-bloom" />
                {Array.from({ length: CELEBRATION_RAYS }, (_, index) => (
                  <span
                    key={index}
                    className="kade-celebration-ray"
                    style={{ '--kade-ray': index } as CSSProperties}
                  />
                ))}
              </div>
            ) : null}
            <div className={documentClassName} style={documentWrap}>
              {children}
            </div>
            {/* Exactly ONE light sweep per reveal, and only when motion is
                allowed. It traverses the whole card; the celebration tier
                styles this same single element richer, so its flourish reads as
                one continuous gesture rather than a second pass. Under
                `prefers-reduced-motion` no sweep element is rendered at all. */}
            {reducedMotion ? null : (
              <div aria-hidden="true" className="kade-foil-pass" />
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const backdrop: CSSProperties = {
  position: 'fixed',
  // `inset: 0` rather than `width: 100vw`: a `100vw` width includes the classic
  // scrollbar and can itself cause a horizontal overflow.
  inset: 0,
  // `dvh` tracks the visible viewport as mobile browser chrome moves; `vh`
  // would overhang. The overlay is NOT a scroll port: `overflow: hidden` on
  // both axes guarantees the reveal cannot scroll, and the card is scaled to
  // fit instead (see the fit effect above). It is the single clipped region.
  blockSize: '100dvh',
  background:
    'radial-gradient(120% 120% at 50% 0%, rgba(7,29,48,.82) 0%, rgba(4,14,24,.92) 100%)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflowX: 'hidden',
  overflowY: 'hidden',
  overscrollBehavior: 'contain',
  boxSizing: 'border-box',
  // Gives the card's Reveal 3 `rotateX` a perspective to read against.
  perspective: '1400px',
  paddingTop: 'calc(clamp(12px, 4vw, 40px) + env(safe-area-inset-top))',
  paddingRight: 'calc(clamp(12px, 4vw, 40px) + env(safe-area-inset-right))',
  paddingBottom: 'calc(clamp(12px, 4vw, 40px) + env(safe-area-inset-bottom))',
  paddingLeft: 'calc(clamp(12px, 4vw, 40px) + env(safe-area-inset-left))',
  zIndex: 80,
};

const card: CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  // `margin: auto` centers the card in the overlay.
  margin: 'auto',
  // Bound the artifact horizontally on a laptop or a phone. There is no
  // block-size cap: the card's natural height is measured and it is scaled to
  // fit the viewport (see the fit effect), so it can never overflow the
  // non-scrolling overlay.
  width: 'min(92vw, 560px)',
  maxInlineSize: '100%',
  outline: 'none',
};

const closeRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  alignItems: 'center',
  gap: '8px',
  padding: '0 2px 10px',
};

const closeButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  height: '34px',
  padding: '0 14px',
  border: '1px solid rgba(255,255,255,.35)',
  borderRadius: '999px',
  background: 'rgba(255,255,255,.08)',
  color: '#f4f8ff',
  fontFamily: 'inherit',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
};

const closeLabel: CSSProperties = {
  lineHeight: 1,
};

const scene: CSSProperties = {
  perspective: '1200px',
  display: 'flex',
  justifyContent: 'center',
  // Let the scene shrink inside the flex column; the overlay is not a scroll
  // port, so no nested scrollbar can appear here either.
  minHeight: 0,
};

const tilt: CSSProperties = {
  position: 'relative',
  transformStyle: 'preserve-3d',
  width: '100%',
};

const documentWrap: CSSProperties = {
  width: '100%',
  transformStyle: 'preserve-3d',
};

const srOnly: CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
  color: tokens.ink,
};
