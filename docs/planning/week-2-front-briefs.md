# Week 2 front briefs (working document)

**Status:** Working document for the parallel Week 2 fronts. Not a governing
document. The governing scope is `docs/week-2-frozen-delivery-contract.md`
(Frozen v1.0); the process is `docs/DEVELOPMENT_CONTRACT.md`.

## Shared rules — every front

1. **Stay in your worktree.** Work only on your branch (`week-2-XX-…`). Never
   commit to `main` or `week-2`. Never touch another worktree.
2. **No irreversible on-chain writes.** No `--broadcast`, no `cast send`, no
   deploying contracts, no mainnet state changes. Reading chain state is fine.
   Deployment fronts stop at the deployment call and mark it gated.
3. **No mocks presented as real.** If a required project dependency is missing
   (mainnet RPC/payer/treasury, Morpho pool, Self config, reviewer account),
   implement up to that boundary and **STOP**, never fabricate. Record a
   `BLOCKED:` line in `docs/planning/week-2-todo-<front>.md`.
4. **Granular commits** on your branch, single purpose each.
5. **Gate:** run `./scripts/verify.sh` before finishing and report the exact
   result. `node_modules` is already installed; Foundry libs are copied.
6. **Do not edit files owned by another front** (ownership table below), and do
   not change the Week 1/Week 2 contracts or `DEVELOPMENT_CONTRACT.md`.
7. Values absent from the DOCX are `[arbitrary]` and labelled as such.
8. **Return an Appendix D evidence note** (branch, commits, files, tests +
   exact results, runtime proof, blocked items, security notes).

## File ownership (to keep parallel worktrees from colliding)

| Surface | Owner |
|---|---|
| `packages/shared/**` | 00-mainnet-config |
| `apps/web/src/lib/env.ts` | 00-mainnet-config |
| `apps/web/src/lib/wallet/**` | 03-ownership-proof |
| `apps/web/src/components/shell/nav.ts` | integration only — request, do not edit |
| `supabase/migrations/**` | per front, by range below |
| everything else | the front that needs it |

### Migration timestamp ranges

| Front | Range |
|---|---|
| 00 | `20260922000010–19` |
| 01 | `20260922000020–29` |
| 03 | `20260922000030–39` |
| 05 | `20260922000040–59` |
| 06 | `20260922000060–79` |

## Front briefs

### 00 — mainnet-config (EXE-010)

**Goal:** Ethereum mainnet configuration as the base for Holdings and Invest.
**Work:** env schema and `.env.example` keys for mainnet (`ETHEREUM_RPC_URL`,
mainnet treasury, chain env); `packages/shared` chain/config types; server-side
treasury read; `chains` seed rows for mainnet.
**Dependency:** no mainnet RPC/payer/treasury is supplied. Do **not** invent
values — document the keys, guard the runtime reads, and mark activation
`BLOCKED: mainnet funding not supplied`.
**Owns:** `packages/shared/**`, `apps/web/src/lib/env.ts`.
**Deliverable:** config plumbing + tests.

### 01 — signer-deploy (EXE-011)

**Goal:** unblock passkey signing by deploying the direct Safe WebAuthn signer.
**Work:** the `createSigner` call path, inputs, and tests. Build the transaction
and verify it by simulation/fork only.
**Dependency:** the deploy is an irreversible on-chain write and requires the
Account gate. **Do not broadcast.** Mark `BLOCKED: Account gate not approved`.
**Deliverable:** call path + dry tests.

### 03 — ownership-proof (EXE-013 enabler)

**Goal:** prove control of a linked wallet with a signature.
**Work:** server-issued challenge (nonce), EIP-191 / EIP-4361-style verification,
persist the verification, and set `wallets.verified_at` **only** for
signature-verified rows. Migration + owner-only RLS in the 03x range.
**Feasible in-repo.**
**Owns:** `apps/web/src/lib/wallet/**`.
**Deliverable:** migration, verification path, unit tests. This freezes the
interface 04-holdings consumes.

### 04 — holdings (EXE-013)

**Goal:** Holdings shows **all** signed linked wallets' holdings.
**Work:** the Holdings screen and aggregation over the 03 verification; pasted
rows are excluded **by construction**.
**Dependency:** consumes 03's frozen interface (challenge/verify module
signature). If 03's interface is not yet present on your branch, code to the
documented signature and mark it.
**Deliverable:** screen + tests. Mainnet reads use the existing explorer config.

### 02 — invest-morpho (EXE-014)

**Goal:** one Morpho pool deposit on Ethereum mainnet, fully functional.
**Work:** the deposit call (USDC approve + deposit into one pool), the UI, and
calldata tests against the Morpho ABI.
**Dependency:** pool address + mainnet + the signer deployment are missing.
**Do not execute a deposit.** Mark `BLOCKED: pool address + mainnet + signer`.
**Deliverable:** call-construction module + tests.

### 05 — residency (EXE-012)

**Goal:** the Residency step end to end.
**Work:** the step UI, the four checks, server-verified service-fee collection,
the `kade.permit.v1` issuance path, and a tracker derived from records.
**Dependency:** Self config is missing and permit issuance is a gated on-chain
write. Implement the step/checks/service-fee wiring; mark
`BLOCKED: Self config + permit issuance gate`.
**Deliverable:** step + tests for what runs.

### 06 — admin-review (EXE-015)

**Goal:** a simple Admin review dashboard.
**Work:** the admin route, the `reviewers` RLS policy, the review action
(`approve | block | reopen`) writing `review_events`, the `kade.review.v1`
issuance path, and the live gate flip.
**Dependency:** the on-chain attestation write is gated; the DB path
(`review_events` → status trigger) is real and testable.
**Deliverable:** route, RLS, action, tests. Mark the chain write if gated.

## Evidence note format

```text
Front: <id and branch>
Commits: <sha list>
Files: <paths>
Tests: <commands and exact results>
verify.sh: <result>
Runtime proof: <explorer/migration/uid, or none>
BLOCKED: <items, or none>
Security notes: <secrets, authority, irreversible actions>
```
