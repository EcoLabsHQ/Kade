/** Raised when a Supabase operation is attempted without configuration. */
export class AuthNotConfiguredError extends Error {
  constructor(
    message = 'Authentication is not configured. Set NEXT_PUBLIC_SUPABASE_URL and ' +
      'NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.example). No sign-in can be ' +
      'attempted until those values are supplied.',
  ) {
    super(message);
    this.name = 'AuthNotConfiguredError';
  }
}
