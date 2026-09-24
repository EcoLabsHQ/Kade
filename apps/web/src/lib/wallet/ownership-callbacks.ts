/**
 * The ownership-proof callbacks that front 03 owns.
 *
 * Verifying a wallet's control is a signature over a server-issued challenge
 * (EIP-191 / EIP-4361-style). The browser half signs the exact message; the
 * server half issues the challenge and decides whether the signature verifies,
 * and it alone sets `wallets.verified_at`. Callers depend only on these three
 * callbacks, injected by the page, so they hold no proof logic — they never
 * re-implement the challenge, the verification or the write.
 *
 * Shared by Holdings (the verify modal) and onboarding Step 3 (the connect flow)
 * so both sites prove ownership through one interface.
 *
 * `onLinked` is the refresh hook: called after a successful verification (or a
 * successful persistence) so the caller can re-read its data.
 */

export interface OwnershipChallengeView {
  /** The exact challenge message the wallet must sign. */
  readonly message: string;
}

export interface OwnershipCallbacks {
  /** Server callback: issue a challenge for this address (front 03). */
  readonly onBegin: (address: string) => Promise<OwnershipChallengeView>;
  /** Server callback: verify and persist the signature (front 03). */
  readonly onComplete: (input: {
    readonly address: string;
    readonly message: string;
    readonly signature: string;
  }) => Promise<{ readonly ok: boolean }>;
  /** Called after a successful verification so the caller can refresh. */
  readonly onLinked: () => void;
}
