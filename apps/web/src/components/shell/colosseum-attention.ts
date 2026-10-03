/**
 * The Colosseum nav highlight — a tiny shareable client state.
 *
 * The Colosseum demo layer lives inside the Residency screen and its 2-minute
 * clock and "Become a Citizen" step are entirely client-side (no table, no RPC).
 * The nav, however, is rendered by the shell, which is a server component. This
 * module is the one honest bridge between them: the Residency screen sets a flag
 * when the demo's 2-minute window has elapsed (State D), and the client
 * `NavItem` reads it to paint the Residency nav item.
 *
 * It is deliberately module state plus a `localStorage` mirror, not a database
 * or a cookie: the whole Colosseum layer is a declared demo and persists
 * nothing. A page reload resets the demo timer anyway, so restoring the
 * highlight from `localStorage` simply keeps the nav consistent with that demo
 * state. Nothing outside the Colosseum layer reads or writes it.
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
