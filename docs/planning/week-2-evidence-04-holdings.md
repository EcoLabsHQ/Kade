# Week 2 — Front 04 holdings evidence note (D17 / EXE-013)

**Front:** 04 — holdings, branch `week-2-04-holdings` (base `week-2`,
`main == c49a499` at the time of writing).

**Package:** EXE-013 / D17 (`[arbitrary]` KAD-012). Frozen decisions §2.1 item 2
and §2.2 items 2–3.

## Commits

```text
6ab2c67 test(holdings): pin the loader's verified_at query and pasted-row exclusion
4f7436d feat(holdings): link a wallet by signing a server-issued challenge
3a780d9 feat(holdings): add the Holdings screen and verified-wallet loader
fefa8ac feat(holdings): aggregate over signature-verified wallets only
```

## Files

```text
apps/web/src/lib/wealth/holdings.ts                    aggregation + structural exclusion
apps/web/src/app/holdings/data.ts                      verified_at loader (reuses lib/wealth/evm)
apps/web/src/app/holdings/link-actions.ts              consumes 03's ownership module (BLOCKED)
apps/web/src/app/holdings/page.tsx                     /holdings route
apps/web/src/components/holdings/HoldingsScreen.tsx    aggregate + per-wallet breakdown
apps/web/src/components/holdings/WalletLinkPanel.tsx   link/verify UI (injected 03 callbacks)
apps/web/src/components/holdings/LinkedWalletSection.tsx client wrapper (router refresh)
apps/web/tests/holdings-aggregation.test.ts
apps/web/tests/holdings-loader.test.ts
apps/web/tests/holdings-screen.test.tsx
apps/web/tests/wallet-link-panel.test.tsx
docs/planning/week-2-todo-04-holdings.md
docs/planning/week-2-evidence-04-holdings.md
```

## Tests

```text
$ npx vitest run tests/holdings-aggregation.test.ts tests/holdings-screen.test.tsx tests/wallet-link-panel.test.tsx
 Test Files  3 passed (3)
      Tests  19 passed (19)

$ npx vitest run tests/holdings-loader.test.ts
 Test Files  1 passed (1)
      Tests  5 passed (5)

$ npm run --silent typecheck      # apps/web
 src/app/holdings/link-actions.ts(8,8): error TS2307: Cannot find module
   '@/lib/wallet/ownership' or its corresponding type declarations.

$ npm run --silent lint           # apps/web
 0 errors, 3 warnings (all pre-existing: DatePicker.tsx, wallet-actions.test.ts)
```

The pasted-exclusion property is pinned at the predicate
(`selectVerifiedWallets`), through the loader (a pasted row returned by the query
is still dropped), and in the screen copy.

## verify.sh result

`./scripts/verify.sh` → **exit 1 / VERIFICATION FAILED**, for exactly two
reasons:

| Gate | Result |
|---|---|
| ENVIRONMENT | PASS |
| TYPECHECK | **FAIL** — the expected unresolved `@/lib/wallet/ownership` import |
| LINT | PASS |
| UNIT TESTS | **FAIL** — pre-existing flake (see below) |
| ACCEPTANCE TESTS | PASS (12) |
| REGRESSION TESTS | PASS (14) |
| BUILD | **FAIL** — same unresolved 03 import (`Module not found`) |
| FORGE BUILD / FORGE TEST | PASS (45 tests) |

1. **TYPECHECK + BUILD**: `apps/web/src/app/holdings/link-actions.ts` imports
   `@/lib/wallet/ownership`, which front 03 owns and which is not merged. This is
   the documented BLOCKED dependency; it resolves when 03 merges and this one
   file is reconciled.
2. **UNIT TESTS**: `tests/onboarding-flow.test.tsx > pre-registration flow >
   walks from the saved profile through proof of wealth to the fee` exceeds the
   5000 ms default under full-suite contention. It is **pre-existing and
   unrelated to this front**: it passes in isolation at 0.8–1.0 s
   (`npx vitest run tests/onboarding-flow.test.tsx` → `Tests 36 passed`), and it
   still fails with front 04's four test files excluded
   (`--exclude '**/holdings-*.test.*' --exclude '**/wallet-link-panel.test.tsx'`
   → `Tests 1 failed | 397 passed`). Classified FLAKY/ENVIRONMENTAL; not
   introduced by front 04.

## Runtime proof

None. This front performs a read-only database read and a signature
verification; it makes **no on-chain write** and deploys nothing, so there is no
explorer URL, UID or migration to cite. No migration is added (front 04 has no
migration range; 03 owns the `wallets.verified_at` write).

## BLOCKED

```text
BLOCKED: consumes 03 ownership module (not merged yet)
```

`apps/web/src/lib/wallet/ownership` (`issueOwnershipChallenge`,
`verifyWalletOwnership`) does not exist on any branch yet
(`git show week-2-03-ownership-proof:apps/web/src/lib/wallet/ownership.ts` →
no such path). No stub or duplicate of 03's logic is created. `link-actions.ts`
codes to the assumed shape and is the single reconciliation point; the panel and
all tests inject the callbacks, so they stay green without 03.

**Integration request (not owned here):** unlock the `/holdings` item in
`apps/web/src/components/shell/nav.ts` (remove `locked: true` and `lockReason`).
The route is already protected by `resolveAccess`.

## Security notes

- **Structural exclusion.** `VerifiedWallet` is branded by a module-private
  `unique symbol`; `selectVerifiedWallets` is its only producer and drops every
  row without a usable `verified_at`. `aggregateHoldings` takes
  `VerifiedWallet[]`, so a pasted row cannot be passed in — the exclusion is not
  a display filter. The loader additionally filters `verified_at is not null`.
- **No fabricated balances.** A provider failure becomes a per-wallet
  `readError` with a null value, shown as `—`; it is never summed as zero.
- **No authority, no login.** The ownership signature proves control of an
  address only. It is not a login and confers no Safe authority; the panel states
  this. No connected EOA is written to `safe_deployments` or
  `passkey_credentials`.
- **Server-only reads.** The browser never calls the balance provider and never
  writes the database; the server action requires a signed-in session before it
  delegates to 03.
- **No secrets, no irreversible writes.** No key or address is added; no
  broadcast, no `cast send`, no deployment.

## Summary

Front 04 delivers D17: the Holdings screen aggregates the balances of
signature-verified linked wallets only, and pasted addresses are excluded by
construction rather than by a display filter. The aggregation is a pure,
network-injected module whose tests prove that a pasted row (`verified_at` NULL)
can never become a `VerifiedWallet` or contribute a holding; a thin server
loader reads only rows where 03 has set `verified_at` and reuses the existing
public EVM provider, so Holdings and proof-of-wealth cannot disagree. The
`/holdings` route renders the aggregate and the per-wallet breakdown, and a
link/verify panel proves a new wallet by signing a server-issued challenge
through front 03's frozen interface. All 24 focused tests pass, lint is clean,
and acceptance/regression/forge gates pass; `verify.sh` fails only on the
expected unresolved 03 import (BLOCKED) plus a pre-existing, load-dependent
timeout in untouched onboarding tests.
