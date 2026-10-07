/**
 * The Colosseum demo clock and certificate — the pure state model.
 *
 * The Colosseum layer is a declared demo: the 2-minute compliance window and the
 * virtual certificate are demo state. This module used to also persist that state
 * in the browser (a `localStorage` store keyed per profile), which meant two
 * browsers signed into the same account showed different demo states and
 * clearing the browser silently reset the demo. The state now lives on the
 * server, per account (see the `colosseum_progress` migration and
 * `@/lib/residency/colosseum-state-server`); this module holds only the
 * serialisable model and the pure transitions, so it is importable from both the
 * server and the client and remains a pure, testable mapping.
 *
 * What the model carries:
 *   - `residentSince` — the ISO instant the four real checks first all became
 *     `met`. The countdown is computed from it, not restarted, so the window
 *     survives a navigation or reload. It is the SAME instant the server stores
 *     in `applications.colosseum_resident_since`, so the demo clock and the
 *     Citizen mint's compliance window are one record. It is cleared when the
 *     checks stop being `met` before citizenship (the clock resets).
 *   - `citizenAt` — the ISO instant the resident became a Colosseum Citizen.
 *   - `passportSerial` — the demo citizenship-certificate serial (`KADE-CL-…`).
 *   - `residencyPassAt` / `residencyPassSerial` — the ISO instant the resident
 *     claimed their virtual residency pass and its demo serial (`KADE-RES-…`).
 *
 * The demo serials are generated client-side (so the reveal can show the
 * artifact on the same tick) and stored server-side idempotently: the server
 * keeps the first serial written, so a second browser cannot mint a different
 * one for the same account.
 */

export interface ColosseumProgress {
  /** ISO timestamp when the four checks first all became `met`, or null. */
  readonly residentSince: string | null;
  /** ISO timestamp when the resident became a citizen, or null. */
  readonly citizenAt: string | null;
  /** Demo citizenship-certificate serial, or null before citizenship. */
  readonly passportSerial: string | null;
  /** ISO timestamp when the virtual residency pass was claimed, or null. */
  readonly residencyPassAt: string | null;
  /** Demo residency-pass serial, or null before a claim. */
  readonly residencyPassSerial: string | null;
}

export const EMPTY_COLOSSEUM_PROGRESS: ColosseumProgress = {
  residentSince: null,
  citizenAt: null,
  passportSerial: null,
  residencyPassAt: null,
  residencyPassSerial: null,
};

/**
 * The write paths the section drives. Each method is the server round-trip for
 * one transition; it returns the canonical server state (or null when the
 * server could not be reached, in which case the caller keeps its optimistic
 * state). A no-op implementation is used by the demo-only surface and by tests.
 */
export interface ColosseumProgressStore {
  /** Start the compliance window. Idempotent server-side. */
  startWindow(iso: string): Promise<ColosseumProgress | null>;
  /** Clear the compliance window before citizenship (the decay). */
  clearWindow(): Promise<ColosseumProgress | null>;
  /** Record the residency-pass claim and demo serial. Idempotent. */
  claimResidencyPass(iso: string, serial: string): Promise<ColosseumProgress | null>;
  /** Record citizenship and the demo serial. Idempotent. */
  becomeCitizen(iso: string, serial: string): Promise<ColosseumProgress | null>;
}

/**
 * A store that persists nothing. Used when no server wiring is supplied (the
 * declared demo-only surface and unit tests of the presentational states); the
 * caller's optimistic state remains authoritative.
 */
export const NOOP_COLOSSEUM_PROGRESS_STORE: ColosseumProgressStore = {
  async startWindow() {
    return null;
  },
  async clearWindow() {
    return null;
  },
  async claimResidencyPass() {
    return null;
  },
  async becomeCitizen() {
    return null;
  },
};

/**
 * The demo citizenship-certificate serial. Client-generated, non-sensitive, and
 * clearly a demo value: Kade never issues a real document, so it is not read
 * from anywhere.
 */
export function generatePassportSerial(random: () => number = Math.random): string {
  return `KADE-CL-${serialTail(random)}`;
}

/**
 * The demo residency-pass serial. Same shape and rationale as the certificate
 * serial: client-generated, non-sensitive, and clearly a demo value.
 */
export function generateResidencyPassSerial(
  random: () => number = Math.random,
): string {
  return `KADE-RES-${serialTail(random)}`;
}

function serialTail(random: () => number): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let tail = '';
  for (let i = 0; i < 8; i += 1) {
    const index = Math.min(
      alphabet.length - 1,
      Math.max(0, Math.floor(random() * alphabet.length)),
    );
    tail += alphabet[index];
  }
  return tail;
}

/**
 * Start (or restart) the demo clock: record `residentSince` only when there is
 * not already a live one. Pure: the caller persists the returned value.
 */
export function markResidentSince(
  current: ColosseumProgress,
  iso: string,
): ColosseumProgress {
  if (current.residentSince !== null) return current;
  return { ...current, residentSince: iso };
}

/**
 * Clear the clock before citizenship (the checks stopped being `met`), matching
 * the existing decay behaviour. Citizenship, once recorded, is not cleared.
 */
export function clearResidentSince(current: ColosseumProgress): ColosseumProgress {
  if (current.citizenAt !== null || current.residentSince === null) return current;
  return { ...current, residentSince: null };
}

/**
 * Record citizenship with a demo serial. Idempotent: an existing citizenship
 * keeps its original instant and serial rather than minting a second certificate.
 */
export function markCitizen(
  current: ColosseumProgress,
  iso: string,
  serial: string,
): ColosseumProgress {
  if (current.citizenAt !== null) return current;
  // Spread `current` so the residency-pass fields are preserved rather than
  // dropped when citizenship is recorded.
  return {
    ...current,
    citizenAt: iso,
    passportSerial: current.passportSerial ?? serial,
  };
}

/**
 * Claim the virtual residency pass with a demo serial and issue instant.
 * Idempotent: a pass that already exists keeps its original instant and serial,
 * so re-opening it never mints a second one.
 */
export function claimResidencyPass(
  current: ColosseumProgress,
  iso: string,
  serial: string,
): ColosseumProgress {
  if (current.residencyPassAt !== null) return current;
  return {
    ...current,
    residencyPassAt: iso,
    residencyPassSerial: current.residencyPassSerial ?? serial,
  };
}
