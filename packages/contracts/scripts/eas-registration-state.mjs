// Derives the EAS registration state from the committed record.
//
// The registration state is a fact, not a hand-written claim: the generators
// read registered-uids.json and describe what is actually recorded, so the
// committed artifacts never have to be hand-edited when a schema moves from
// "planned" to "registered".
//
// Pure reads and computation. No network, no signing, no writes.
import { readFileSync } from 'node:fs';

export const REGISTRATIONS_PATH = new URL('../eas/registered-uids.json', import.meta.url);

/**
 * Reads the registration record, returning `null` when it is absent or not
 * valid JSON. Generation must still work before the first registration, so this
 * never throws.
 */
export function readRegistrationRecord(registrationsPath = REGISTRATIONS_PATH) {
  let raw;
  try {
    raw = readFileSync(registrationsPath, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Joins a manifest's schema list with the recorded registrations.
 *
 * `entries` follows the manifest order (the registration order), and only
 * includes schemas that have a recorded UID. A record for a name the manifest
 * does not know is ignored: the manifest is the source of truth for what the
 * package intends.
 */
export function registrationStatus(schemas, record) {
  const list = Array.isArray(record?.registrations) ? record.registrations : [];
  const byName = new Map(list.map((registration) => [registration.name, registration]));
  const entries = schemas
    .map((schema) => byName.get(schema.name))
    .filter((registration) => registration !== undefined);

  const registeredCount = entries.length;
  const totalSchemas = schemas.length;
  const allRegistered = totalSchemas > 0 && registeredCount === totalSchemas;
  const noneRegistered = registeredCount === 0;

  return {
    allRegistered,
    noneRegistered,
    partial: !allRegistered && !noneRegistered,
    registeredCount,
    totalSchemas,
    chainId: record?.chainId ?? null,
    registrar: record?.registrar ?? null,
    byName,
    entries,
  };
}

/** The UID map the generated artifacts embed, keyed by schema name. */
export function registeredUids(status) {
  return Object.fromEntries(status.entries.map((entry) => [entry.name, entry.uid]));
}
