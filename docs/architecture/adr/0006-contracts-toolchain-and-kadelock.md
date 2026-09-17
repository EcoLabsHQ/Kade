# ADR 0006 — Contracts toolchain and the KadeLock baseline

**Status:** accepted · 17 September 2026
**Refs:** week-1 contract sections 6.2, 4 (D7), 7 (Onchain gate), 9; DOCX sections 6 and 8

## Context

Contract section 6.2 freezes KadeLock as the **minimum Safe Guard/Module**
(model A) and records that it is **not deployed on-chain in Week 1** — compiled
and Foundry-tested only.

D7 requires that at minimum the tests cover:

- unauthorised configuration changes;
- lock enforcement before `unlockAt`;
- permitted destinations;
- rejected destinations;
- post-unlock behaviour.

Compliance co-signing, cure-event behaviour and bypass tests are explicitly
**outside** the Week 1 minimum model.

The Onchain gate must approve the exact EAS encodings and the KadeLock
interface and threat model **before** any irreversible registration or contract
implementation.

## Decision

- **Foundry** for contract source and tests. It is the standard for this class of
  contract, it is already available in the build environment, and `forge test`
  integrates directly into `scripts/verify.sh`.
- **KadeLock is a Safe Guard/Module**, not a vault, matching the frozen model A
  and resolving DOCX Appendix B.4.
- **The interface and threat model are written before the implementation**, and
  both are reviewed at the Onchain gate.
- **Deployment is out of scope** for Week 1. `kadeLockAddress` is `null` in the
  chain registry and carries an `arbitrary` provenance marker, so nothing can
  mistake a placeholder for a deployment.
- **EAS registration is guarded in code.** `assertRegistrationApproved()` throws
  unless an approval record naming the approver and timestamp exists, so a test
  run or an accidental script invocation cannot trigger an irreversible write.
- **Dependencies are fetched, not vendored.** `safe-smart-account` is LGPL-3.0
  and `forge-std` is MIT/Apache-2.0. Neither is committed: `scripts/setup.sh`
  installs pinned versions into `packages/contracts/lib/`, which is git-ignored.
  Vendoring LGPL-3.0 source into an MIT-licensed repository would mix licences
  and import a large third-party tree into our history for no build benefit.

## Consequences

- `forge build` and `forge test` are part of the mechanical gate, so a KadeLock
  regression fails verification in the same way a TypeScript regression does.
- The contract cannot drift into an on-chain deployment without an explicit,
  recorded human decision.
- Because model A is frozen "pending explicit confirmation" (section 6.2), the
  threat model is written to be reviewable as a proposal rather than presented
  as already-approved design.

## Alternatives considered

- **Hardhat** — heavier, and its JS test story duplicates the toolchain the web
  app already has.
- **Deploy KadeLock in Week 1** — rejected; explicitly out of scope and
  irreversible.
- **Register EAS schemas as part of the build** — rejected; registration is
  irreversible and is gate-blocked.
