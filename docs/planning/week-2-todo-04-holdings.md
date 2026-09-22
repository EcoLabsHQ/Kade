# Week 2 — Front 04 holdings: working notes

**Status:** Working notes for the `week-2-04-holdings` front. Not a governing
document. Scope is `docs/week-2-frozen-delivery-contract.md` (Frozen v1.0),
deliverable **D17 / EXE-013**, frozen decisions §2.1 item 2 and §2.2 items 2–3.

## Resolved: front 03 ownership module

Front 03 (`week-2-03-ownership-proof`) merged into `week-2` (merge `a3beb40`) and
this branch picked it up (`78df7bc`), so `@/lib/wallet/ownership` exists and the
import resolves. There is no remaining BLOCKED dependency for this front.

The interface consumed — front 03's real, frozen signature — is:

```ts
issueOwnershipChallenge(address: string): Promise<{ nonce: string; message: string }>;
verifyWalletOwnership(input: {
  address: string;
  message: string;
  signature: string;
}): Promise<{ ok: boolean; error?: string }>;
```

`link-actions.ts` branches on `verified.ok` and relays `verified.error`; it does
not write `wallets.verified_at` (03 owns that) and no longer references the
earlier assumed `{ verifiedAt }`. A first pass had assumed that shape; the front
verifier raised it as blocking finding **F1** and it was corrected in `c09b2f4`
with `apps/web/tests/link-actions.test.ts` pinning the contract. See the
evidence note's "Corrective history".

## Integration request (not owned here)

`apps/web/src/components/shell/nav.ts` is integration-owned. Unlock the
`/holdings` nav item: remove `locked: true` and the `lockReason`, leaving
`{ href: '/holdings', label: 'Holdings' }`. The route itself is already protected
by `resolveAccess` (all non-login routes are), so no route-policy change is
needed.

## Out of scope / deliberately not done

- No migration: 03 owns the `wallets.verified_at` write path; `public.wallets`
  already carries `verified_at` and `siwe_sig`
  (`supabase/migrations/20260916000003_wealth.sql`). Front 04 has no migration
  range in the front brief.
- No mock balances and no fabricated figures: a failed provider read is shown as
  `—` with the error text, never as zero.
