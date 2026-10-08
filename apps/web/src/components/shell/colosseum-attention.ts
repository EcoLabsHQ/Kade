/**
 * The Colosseum nav claim notice — a derived, transient, browser-local hint.
 *
 * The Residency screen is a client component; the nav is rendered by the shell.
 * This module is the one bridge between them: while the Residency screen is
 * mounted it derives `citizenEligible` (all four real checks met, the 2-minute
 * window elapsed, not yet a citizen) from the server-read state, mirrors that
 * boolean here, and the client `NavItem` reads it to paint the Residency dot.
 *
 * What it means, and what it deliberately does NOT promise:
 *   - It means exactly "citizenship is claimable right now" — never "the
 *     resident is a citizen". `citizenEligible` is false for a citizen and for a
 *     resident whose window has not elapsed, and the Residency screen clears the
 *     flag explicitly on becoming a citizen (and re-derives it on every change),
 *     so while that screen is live the nav cannot claim a state that is not
 *     true, and a stale `true` cannot survive becoming a citizen.
 *   - It is written ONLY while the Residency screen is mounted. It is module
 *     state plus a `localStorage` mirror (so a reload on another route keeps the
 *     nav consistent until the screen recomputes it); nothing else reconciles
 *     it. If the account becomes a citizen, or its window changes, from another
 *     tab or device while this browser sits on a different route, the mirrored
 *     `true` can be stale until `/residency` is mounted again. The `storage`
 *     listener below keeps sibling tabs of the same browser consistent, but it
 *     cannot observe server state. It is a UI affordance, not account state, and
 *     it grants nothing; it is the one Colosseum value that deliberately remains
 *     browser-local, because moving it server-side would require the shell to
 *     derive the residency checks.
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
    // Best-effort only: the notice is cosmetic demo state.
  }
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  attention = readStorage();
}

/**
 * True when citizenship is claimable right now: all four real checks met, the
 * compliance window elapsed, and the resident not yet a citizen.
 */
export function isColosseumAttention(): boolean {
  hydrate();
  return attention;
}

/**
 * Set or clear the notice. The Residency screen sets it while `citizenEligible`
 * holds and clears it explicitly on becoming a citizen, so the nav never claims
 * a state the screen knows to be false.
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
 * screen sets or clears the notice. Also adopts another tab's change through the
 * `storage` event, so sibling tabs of the same browser stay consistent (this is
 * best-effort: it cannot observe server state). Returns an unsubscribe function.
 */
export function subscribeColosseumAttention(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    // Another tab changed the mirror: adopt the written value before notifying.
    hydrate();
    attention = event.newValue === '1';
    listener();
  };
  window.addEventListener(EVENT_NAME, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(EVENT_NAME, listener);
    window.removeEventListener('storage', onStorage);
  };
}
