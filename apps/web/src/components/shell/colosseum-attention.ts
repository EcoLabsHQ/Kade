/**
 * The Colosseum nav highlight — a derived, transient, cross-page nav hint.
 *
 * The nav is rendered by the shell, which is a server component; the Residency
 * screen is a client component. This module is the one bridge between them: the
 * Residency screen sets the hint when the demo's compliance window has elapsed
 * and "Become a Citizen" is available (State D), and the client `NavItem` reads
 * it to paint the Residency nav item.
 *
 * The underlying state (the compliance window) is now server-side and
 * account-bound; this hint is *derived* from it — the Residency screen
 * recomputes `citizenEligible` from the server-read state and sets the hint on
 * every render. The hint itself is a browser-local, transient UI affordance: it
 * is module state plus a `localStorage` mirror so a full page reload on another
 * route keeps the nav consistent until the Residency screen recomputes it. It
 * is not account state and it grants nothing; it is the one Colosseum value that
 * deliberately remains browser-local, because moving it server-side would
 * require the shell to derive the residency checks. Nothing outside the
 * Colosseum layer reads or writes it.
 */

const STORAGE_KEY = 'kade.colosseum.attention';
const EVENT_NAME = 'kade:colosseum-attention';

let attention = false;
let hydrated = false;

function readStorage(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // Storage can be unavailable (private mode, SSR). The in-memory value is
    // still authoritative for this document.
    return false;
  }
}

function writeStorage(value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (value) window.localStorage.setItem(STORAGE_KEY, '1');
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort only: the highlight is cosmetic demo state.
  }
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  attention = readStorage();
}

/** True when the demo's "Become a Citizen" step is available and unclaimed. */
export function isColosseumAttention(): boolean {
  hydrate();
  return attention;
}

/**
 * Set or clear the highlight. The Residency screen sets it on State D and
 * clears it when the resident becomes a citizen.
 */
export function setColosseumAttention(value: boolean): void {
  hydrate();
  attention = value;
  writeStorage(value);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(EVENT_NAME));
  }
}

/**
 * Subscribe to changes so a client `NavItem` re-renders when the Residency
 * screen sets or clears the highlight. Returns an unsubscribe function.
 */
export function subscribeColosseumAttention(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
