# Week 2 — Front 04 holdings: working notes

**Status:** Working notes for the `week-2-04-holdings` front. Not a governing
document. Scope is `docs/week-2-frozen-delivery-contract.md` (Frozen v1.0),
deliverable **D17 / EXE-013**, frozen decisions §2.1 item 2 and §2.2 items 2–3.

## Blocked

- `BLOCKED: consumes 03 ownership module (not merged yet)`. Front 03
  (`week-2-03-ownership-proof`) owns `apps/web/src/lib/wallet/**`, including the
  frozen `@/lib/wallet/ownership` interface (`issueOwnershipChallenge`,
  `verifyWalletOwnership`). That module is being built in parallel and does not
  exist on any branch at the time of writing (checked
  `git show week-2-03-ownership-proof:apps/web/src/lib/wallet/ownership.ts` —
  no such path). The Holdings link/verify wiring
  (`apps/web/src/app/holdings/link-actions.ts`) imports it and therefore does
  **not typecheck** on this branch. No stub or duplicate of 03's logic is
  created here; the aggregation is isolated so its tests never require 03.

## Interface assumption consumed from 03

The only documented surface is the two function names in the front brief
(`docs/planning/week-2-front-briefs.md`, front 03). `link-actions.ts` codes to
this assumed shape and isolates it so reconciliation is one file:

```ts
issueOwnershipChallenge(address: string): Promise<{ message: string }>;
verifyWalletOwnership(input: {
  address: string;
  message: string;
  signature: string;
}): Promise<{ verifiedAt: string }>;
```

When 03 merges, align `link-actions.ts` with the frozen signature. Everything
else in this front is independent of 03.

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
