'use client';

import { useEffect, useState } from 'react';

/**
 * Whether the user asked for reduced motion.
 *
 * The Colosseum artifact reveals are pure progressive enhancement: the CSS in
 * `globals.css` already disables their keyframes under
 * `prefers-reduced-motion: reduce`. This hook is the component-level companion,
 * so a reveal never even *applies* the animation class — which also makes the
 * reduced-motion path directly testable, rather than relying on jsdom to
 * evaluate a media query it does not implement.
 *
 * It starts `false` (the server render and the first client render agree) and
 * settles after mount, so there is no hydration mismatch.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    // `addEventListener` is absent on very old Safari; the initial read above is
    // enough there, so subscribing is best-effort.
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  return reduced;
}
