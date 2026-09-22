# Week 2 — Front 04 holdings evidence note (D17 / EXE-013)

**Front:** 04 — holdings, branch `week-2-04-holdings` (base `week-2`, now
including front 03; `main == c49a499`).

**Package:** EXE-013 / D17 (`[arbitrary]` KAD-012). Frozen decisions §2.1 item 2
and §2.2 items 2–3.

**Status:** reviewed and passed. Front verifier `REVIEW FAILED` (F1, interface
mismatch) → corrected → `REVIEW PASSED`.

## Commits

```text
c09b2f4 fix(holdings): consume front 03's real ownership result shape
78df7bc merge(week-2): pick up front 03 for the D17 ownership interface
6ab2c67 test(holdings): pin the loader's verified_at query and pasted-row exclusion
4f7436d feat(holdings): link a wallet by signing a server-issued challenge
3a780d9 feat(holdings): add the Holdings screen and verified-wallet loader
fefa8ac feat(holdings): aggregate over signature-verified wallets only
```

## Files

```text
apps/web/src/lib/wealth/holdings.ts                    aggregation + structural exclusion
apps/web/src/app/holdings/data.ts                      verified_at loader (reuses lib/wealth/evm)
apps/web/src/app/holdings/link-actions.ts              consumes 03's ownership module
apps/web/src/app/holdings/page.tsx                     /holdings route
apps/web/src/components/holdings/HoldingsScreen.tsx    aggregate + per-wallet breakdown
apps/web/src/components/holdings/WalletLinkPanel.tsx   link/verify UI (injected 03 callbacks)
apps/web/src/components/holdings/LinkedWalletSection.tsx client wrapper (router refresh)
apps/web/tests/holdings-aggregation.test.ts
apps/web/tests/holdings-loader.test.ts
apps/web/tests/holdings-screen.test.tsx
apps/web/tests/wallet-link-panel.test.tsx
apps/web/tests/link-actions.test.ts                    action ↔ 03 interface contract
docs/planning/week-2-todo-04-holdings.md
docs/planning/week-2-evidence-04-holdings.md
```

## Tests

```text
$ npx vitest run tests/link-actions.test.ts tests/wallet-link-panel.test.tsx \
    tests/holdings-aggregation.test.ts tests/holdings-screen.test.tsx tests/holdings-loader.test.ts
 Test Files  5 passed (5)
      Tests  30 passed (30)

$ npm run --silent typecheck      # apps/web — clean (the TS2307 is gone)

$ npm run --silent lint           # apps/web
 0 errors, 3 warnings (all pre-existing)
```

The pasted-exclusion property is pinned at the predicate
(`selectVerifiedWallets`), through the loader (a pasted row returned by the query
is still dropped), and in the screen copy. `link-actions.test.ts` pins the
`{ ok, error? }` contract, the error relay, and the no-session guard.

## verify.sh result

`./scripts/verify.sh` on `c09b2f4` → **VERIFICATION PASSED** (all nine gates,
including TYPECHECK, BUILD, unit/acceptance/regression, forge build and 45 forge
tests).

## Runtime proof

None. This front performs a read-only database read and a signature
verification; it makes **no on-chain write** and deploys nothing, so there is no
explorer URL, UID or migration to cite. No migration is added (front 04 has no
migration range; 03 owns the `wallets.verified_at` write).

## Corrective history

- **First pass.** The branch was built before front 03 merged and assumed
  03's `verifyWalletOwnership` returned `{ verifiedAt }`. The import was
  unresolved, so typecheck/build failed on the documented BLOCKED dependency.
- **F1 (front verifier, blocking).** `link-actions.ts` read `verified.verifiedAt`,
  but front 03 returns `{ ok, error? }`. Once 03 merged, a *correct* signature
  would have returned `undefined` and been reported as a failure while 03 had
  already set `wallets.verified_at`.
- **Correction (`c09b2f4`).** `completeWalletLink` branches on `verified.ok`,
  relays `verified.error`, returns `{ ok: true }`, and no longer references
  `verifiedAt`; the panel's `onComplete` type follows; a new `link-actions.test.ts`
  pins the contract. Front 03 was integrated into `week-2` first, so the import
  now resolves. Recheck verdict: **REVIEW PASSED**, F1 resolved.

## Integration request (not owned here)

Unlock the `/holdings` item in `apps/web/src/components/shell/nav.ts` (remove
`locked: true` and `lockReason`). The route is already protected by
`resolveAccess`.

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
- **Residual (front 03).** 03's declared trust boundary is unchanged:
  `record_wallet_ownership` cannot recover secp256k1, so a resident can call it
  directly for their own address with a fabricated signature. Holdings does not
  close it; server-side re-verification is 03's named future work.

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
through front 03's frozen interface. After the F1 correction, all 30 focused
tests pass, typecheck and lint are clean, and `./scripts/verify.sh` passes.
