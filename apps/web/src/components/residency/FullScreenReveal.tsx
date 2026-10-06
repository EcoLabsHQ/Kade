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
import {
  isRevealSoundMuted,
  playRevealSound,
  setRevealSoundMuted,
} from './reveal-sound';

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

/** The pointer light is armed only after the automatic foil pass has finished. */
const FOIL_POINTER_ARM_MS = 1080;
/** The celebratory tier runs longer; interaction is enabled at ~1.6s. */
const CELEBRATION_POINTER_ARM_MS = 1600;
/** How quickly the light and tilt chase the pointer (Reveal 3: 0.14). */
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
 *     and a pointer-tracked foil light, unless `prefers-reduced-motion: reduce`
 *     is set, in which case only a short fade is used.
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
   * deeper, slower rise with a controlled overshoot, bloom, rays, a wide foil
   * pass and a slow sheen. Every subsequent open uses the standard tier.
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
  const foilLightRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const foil = useRef<FoilState>(freshFoilState());
  const reducedMotion = usePrefersReducedMotion();
  // Portals need a document. Client components are still server-rendered, so
  // wait until after mount before creating one.
  const [mounted, setMounted] = useState(false);
  // Pointer control begins only once the automatic foil pass has completed.
  const [foilReady, setFoilReady] = useState(false);
  // The overlay is the single scroll port, but it must not actually scroll: if
  // the artifact genuinely cannot fit on a short viewport we scale it down
  // rather than let the overlay grow a scrollbar. 1 means "no scaling".
  const [fitScale, setFitScale] = useState(1);
  // The reveal sound is opt-out: on by default, persisted mute preference, and
  // a missing or blocked AudioContext degrades silently to no sound.
  const [soundMuted, setSoundMuted] = useState(false);
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

  // Keep the artifact inside the overlay's visible area. The overlay stays the
  // single scroll port (see `backdrop`), but a short viewport must scale the
  // artifact down rather than grow a scrollbar. The card's own layout height is
  // measured; if it exceeds the visible area we scale it. jsdom reports zero
  // heights, so the guard leaves the scale at 1 there.
  useEffect(() => {
    if (!open) {
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
      setFitScale(Math.max(0.6, Number((available / natural).toFixed(3))));
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [open]);

  // Read the persisted mute preference once the reveal mounts (client only).
  useEffect(() => {
    setSoundMuted(isRevealSoundMuted());
  }, []);

  // Play the cue exactly once per open, on the live open. A restored citizen
  // load never opens the reveal, so it never replays. Deliberately independent
  // of `prefers-reduced-motion`: sound is not motion, the mute control is.
  useEffect(() => {
    if (!open) {
      soundPlayedRef.current = false;
      return;
    }
    if (soundPlayedRef.current) return;
    soundPlayedRef.current = true;
    playRevealSound(celebration ? 'celebration' : 'standard');
  }, [open, celebration]);

  const toggleSound = useCallback(() => {
    setSoundMuted((previous) => {
      const next = !previous;
      setRevealSoundMuted(next);
      return next;
    });
  }, []);

  // Arm the pointer light after the one-shot foil pass (640ms + 440ms). Under
  // reduced motion the light is static and the pointer never drives it.
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
    tilt.style.setProperty('--kade-foil-x', `${state.x}px`);
    tilt.style.setProperty('--kade-foil-y', `${state.y}px`);
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
      foilLightRef.current?.setAttribute('data-active', 'true');
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
    foilLightRef.current?.setAttribute('data-active', 'false');
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
            aria-pressed={soundMuted}
            aria-label={soundMuted ? 'Unmute reveal sound' : 'Mute reveal sound'}
            onClick={toggleSound}
            style={soundButton}
          >
            <span aria-hidden="true">{soundMuted ? '🔇' : '🔊'}</span>
            <span style={closeLabel}>{soundMuted ? 'Muted' : 'Sound'}</span>
          </button>
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
            {reducedMotion ? (
              <div
                aria-hidden="true"
                className="kade-foil-light kade-foil-light-static"
              />
            ) : (
              <>
                <div
                  ref={foilLightRef}
                  aria-hidden="true"
                  className="kade-foil-light"
                />
                {/* Exactly ONE light pass per reveal. The celebration tier
                    styles this same single element richer, so its flourish
                    reads as one continuous gesture rather than a second pass. */}
                <div aria-hidden="true" className="kade-foil-pass" />
              </>
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
  // would overhang. The overlay is the one and only scroll port: when the
  // artifact is taller than the viewport it scrolls here, never in a nested
  // region.
  blockSize: '100dvh',
  background:
    'radial-gradient(120% 120% at 50% 0%, rgba(7,29,48,.82) 0%, rgba(4,14,24,.92) 100%)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflowX: 'hidden',
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  WebkitOverflowScrolling: 'touch',
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
  // `margin: auto` centers the card while keeping it reachable when it is
  // taller than the viewport, unlike `align-items: center` alone which clips
  // the start of an overflowing flex item.
  margin: 'auto',
  // Bound the artifact to the visible area on a laptop or a phone; the overlay
  // scrolls gracefully as a last resort if the content still exceeds it.
  width: 'min(92vw, 560px)',
  maxInlineSize: '100%',
  maxBlockSize: 'min(100%, 78dvh)',
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

// The persisted mute control. It sits beside Close, is a real button, and is
// labelled both visibly ("Sound" / "Muted") and for assistive tech.
const soundButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  height: '34px',
  padding: '0 12px',
  border: '1px solid rgba(255,255,255,.28)',
  borderRadius: '999px',
  background: 'rgba(255,255,255,.06)',
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
  // Let the scene shrink inside the flex column; the overlay, not this region,
  // owns scrolling, so no nested scrollbar can appear.
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
