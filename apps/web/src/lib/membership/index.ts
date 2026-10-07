/**
 * The Colosseum membership on-chain flow, app-side.
 *
 * The module is split so each concern is testable without a network or a
 * database:
 *   - `./abi`        the manager surface (functions, event, enum);
 *   - `./plan`       the exact owner-Safe call for a transition (never sent);
 *   - `./gate`       the issuance approval gate;
 *   - `./chain`      the `membershipOf` read (known vs unread);
 *   - `./store`      the Supabase-backed transition record;
 *   - `./indexer`    the `MembershipChanged` reconcile (idempotent);
 *   - `./server`     the prepare entry point and its environment wiring;
 *   - `./mint`       the claim-triggered mint (re-validate, execute, index).
 *
 * `./server` prepares and never sends. `./mint` is the claim path: it
 * re-validates the four real checks server-side, reads `membershipOf`, and
 * executes the owner-Safe call through the injected `@/lib/safe/owner-execute`
 * seam, then indexes the event and confirms the row.
 */
export * from './abi';
export * from './plan';
export * from './gate';
export * from './chain';
export * from './store';
export * from './indexer';
export * from './server';
export * from './mint';
