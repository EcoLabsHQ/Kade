/**
 * The Colosseum demo clock and passport — a tiny localStorage-backed store.
 *
 * The Colosseum layer is a declared demo: the 2-minute compliance window and the
 * virtual passport are client-side only and persist nothing anywhere real (no
 * table, no RPC, no on-chain record). They used to be component state, so
 * navigating away from /residency or reloading the page reset the countdown to
 * 2:00 and re-locked "Become a Citizen". This module keeps the demo state across
 * view changes and reloads, mirroring the existing `colosseum-attention` store:
 * module state plus a `localStorage` mirror, keyed per profile.
 *
 * What is stored, and when:
 *   - `residentSince` — the ISO instant the four real checks first all became
 *     `met`. The countdown is computed from it, not restarted, so the window
 *     survives a navigation or reload. It is cleared when the checks stop being
 *     `met` before citizenship (the clock resets), matching the existing decay.
 *   - `citizenAt` — the ISO instant the resident became a Colosseum Citizen.
 *   - `passportSerial` — the demo serial, generated client-side (`KADE-CL-…`).
 *
 * A profile id is passed in rather than read here, so the store is a pure,
 * testable mapping and the caller owns the identity (the same id the rest of the
 * app uses: `applications.id`).
 */

export interface ColosseumProgress {
  /** ISO timestamp when the four checks first all became `met`, or null. */
  readonly residentSince: string | null;
  /** ISO timestamp when the resident became a citizen, or null. */
  readonly citizenAt: string | null;
  /** Client-generated demo passport serial, or null before citizenship. */
  readonly passportSerial: string | null;
}

const STORAGE_PREFIX = 'kade.colosseum.progress.';

export const EMPTY_COLOSSEUM_PROGRESS: ColosseumProgress = {
  residentSince: null,
  citizenAt: null,
  passportSerial: null,
};

function storageKey(profileKey: string): string {
  return `${STORAGE_PREFIX}${profileKey}`;
}

/**
 * A stable, non-empty profile key. An absent application id (a demo resident with
 * no recorded application) falls back to a constant so the demo still tracks one
 * consistent clock per document rather than throwing.
 */
function normalizeProfileKey(profileKey: string | null | undefined): string {
  const trimmed = (profileKey ?? '').trim();
  return trimmed.length > 0 ? trimmed : 'unrecorded';
}

/**
 * The demo passport serial. Client-generated, non-sensitive, and clearly a demo
 * value: Kade never issues a real passport, so it is not read from anywhere.
 */
export function generatePassportSerial(random: () => number = Math.random): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let tail = '';
  for (let i = 0; i < 8; i += 1) {
    const index = Math.min(
      alphabet.length - 1,
      Math.max(0, Math.floor(random() * alphabet.length)),
    );
    tail += alphabet[index];
  }
  return `KADE-CL-${tail}`;
}

function parse(raw: string | null): ColosseumProgress {
  if (!raw) return EMPTY_COLOSSEUM_PROGRESS;
  try {
    const value = JSON.parse(raw) as Partial<ColosseumProgress>;
    return {
      residentSince: typeof value.residentSince === 'string' ? value.residentSince : null,
      citizenAt: typeof value.citizenAt === 'string' ? value.citizenAt : null,
      passportSerial:
        typeof value.passportSerial === 'string' ? value.passportSerial : null,
    };
  } catch {
    // A corrupt value is treated as no progress rather than throwing.
    return EMPTY_COLOSSEUM_PROGRESS;
  }
}

/** Read the demo progress for a profile. Safe when storage is unavailable. */
export function readColosseumProgress(profileKey: string | null | undefined): ColosseumProgress {
  if (typeof window === 'undefined') return EMPTY_COLOSSEUM_PROGRESS;
  try {
    return parse(window.localStorage.getItem(storageKey(normalizeProfileKey(profileKey))));
  } catch {
    // Storage can be unavailable (private mode, SSR): the in-memory caller's
    // state remains authoritative for this document.
    return EMPTY_COLOSSEUM_PROGRESS;
  }
}

function write(profileKey: string | null | undefined, progress: ColosseumProgress): void {
  if (typeof window === 'undefined') return;
  try {
    const empty =
      progress.residentSince === null &&
      progress.citizenAt === null &&
      progress.passportSerial === null;
    if (empty) window.localStorage.removeItem(storageKey(normalizeProfileKey(profileKey)));
    else
      window.localStorage.setItem(
        storageKey(normalizeProfileKey(profileKey)),
        JSON.stringify(progress),
      );
  } catch {
    // Best-effort only: the demo clock is cosmetic state.
  }
}

/**
 * Start (or restart) the demo clock: record `residentSince` only when there is
 * not already a live one. Returns the progress after the write, so a caller can
 * drive the countdown from the same value without a second read.
 */
export function markResidentSince(
  profileKey: string | null | undefined,
  iso: string,
): ColosseumProgress {
  const current = readColosseumProgress(profileKey);
  if (current.residentSince !== null) return current;
  const next: ColosseumProgress = { ...current, residentSince: iso };
  write(profileKey, next);
  return next;
}

/**
 * Clear the clock before citizenship (the checks stopped being `met`), matching
 * the existing decay behaviour. Citizenship, once recorded, is not cleared.
 */
export function clearResidentSince(profileKey: string | null | undefined): ColosseumProgress {
  const current = readColosseumProgress(profileKey);
  if (current.citizenAt !== null || current.residentSince === null) return current;
  const next: ColosseumProgress = { ...current, residentSince: null };
  write(profileKey, next);
  return next;
}

/**
 * Record citizenship with a demo serial. Idempotent: an existing citizenship
 * keeps its original instant and serial rather than minting a second passport.
 */
export function markCitizen(
  profileKey: string | null | undefined,
  iso: string,
  serial: string,
): ColosseumProgress {
  const current = readColosseumProgress(profileKey);
  if (current.citizenAt !== null) return current;
  const next: ColosseumProgress = {
    residentSince: current.residentSince,
    citizenAt: iso,
    passportSerial: current.passportSerial ?? serial,
  };
  write(profileKey, next);
  return next;
}

/** Test/utility hook: remove the demo progress for a profile. */
export function resetColosseumProgress(profileKey: string | null | undefined): void {
  write(profileKey, EMPTY_COLOSSEUM_PROGRESS);
}

/* -------------------------------------------------------------------------- */
/* Persisted documents flag (demo)                                            */
/* -------------------------------------------------------------------------- */

/**
 * The Residency step's "Documents complete" row is demo state: Upload marks it
 * complete in local state, nothing is uploaded. The *presence* of that flag is
 * persisted here so the Overview tracker can read the same fact, without the
 * Overview needing the count or the Residency step's session state.
 */
const DOCUMENTS_PREFIX = 'kade.documents.complete.';

export function documentsFlagKey(profileKey: string | null | undefined): string {
  return `${DOCUMENTS_PREFIX}${normalizeProfileKey(profileKey)}`;
}

export function readDocumentsComplete(key: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function writeDocumentsComplete(key: string, value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (value) window.localStorage.setItem(key, '1');
    else window.localStorage.removeItem(key);
  } catch {
    // Best-effort only: the flag is cosmetic demo state.
  }
}
