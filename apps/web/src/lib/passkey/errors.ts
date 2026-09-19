/**
 * Passkey persistence errors.
 *
 * Modelled on `PersistenceNotConfiguredError` in the onboarding seam: a missing
 * backend raises a typed error rather than silently reporting a successful
 * write.
 */

export const PASSKEY_PERSISTENCE_NOT_CONFIGURED_REASON =
  'Supabase is not configured in this environment, so the passkey credential ' +
  'metadata cannot be stored. The panel will not pretend a save succeeded.';

/** Raised when a credential write is attempted with no configured backend. */
export class PasskeyPersistenceNotConfiguredError extends Error {
  constructor(
    message = PASSKEY_PERSISTENCE_NOT_CONFIGURED_REASON,
  ) {
    super(message);
    this.name = 'PasskeyPersistenceNotConfiguredError';
  }
}
