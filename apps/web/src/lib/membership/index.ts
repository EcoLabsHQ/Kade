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
 *   - `./server`     the prepare entry point and its environment wiring.
 *
 * Nothing in this module signs or broadcasts. The manager's owner is the Safe,
 * so the owner-Safe execution is the human step.
 */
export * from './abi';
export * from './plan';
export * from './gate';
export * from './chain';
export * from './store';
export * from './indexer';
export * from './server';
