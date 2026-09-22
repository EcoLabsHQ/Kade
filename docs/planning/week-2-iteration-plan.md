# Week 2 iteration plan — parallel worktrees and stacked PRs

**Status:** Plan (draft). Not a governing document.
**Iteration branch:** `week-2` (integration, base `main`)
**Deploy safety:** `main` stays deployable; only `week-2` and its stacked
branches receive Week 2 work.
**Source of scope:** `docs/week-2-frozen-delivery-contract.md` (Frozen v1.0,
owner decisions recorded 22 September 2026) and `docs/DEVELOPMENT_CONTRACT.md`
(how work is verified and promoted).

## 1. Objective

Deliver the owner's priority order **without touching the live deployment**:

1. Residency
2. Holdings — through signed linked wallets only
3. Invest — Morpho deposit on Ethereum mainnet, one pool, fully functional
4. Admin dashboard — review and approve applications
5. Vote — later
6. Finance — later

Work runs in parallel across independent Git worktrees, integrated through
stacked pull requests onto `week-2`, and reaches `main` only after both gates
pass.

## 2. Non-negotiables

From `docs/DEVELOPMENT_CONTRACT.md` and `AGENTS.md`:

- The `known-good` tag is **fixed** for the whole iteration.
- `main` is deploy-safe; Week 2 never commits to it directly (only docs).
- Each front passes mechanical verification (`./scripts/verify.sh`) before it is
  proposed for integration.
- The adversarial reviewer evaluates `git diff known-good...HEAD`; the review
  session runs on the cumulative `week-2` diff before promotion.
- No irreversible on-chain write before its matching human gate.
- Every package ships an Appendix D evidence manifest.
- No mock, downgrade, or "done" is claimed without evidence.

## 3. Branch and stack model

`main` → `week-2` (integration) → stacked front branches.

```text
main  (deploy-safe, never touched by Week 2 work except docs)
  |
  +-- week-2                     integration + review target
        |
        +-- 00-mainnet-config    P0  enabler (payer, RPC, treasury, config)
        |     |
        |     +-- 01-signer-deploy     gates Invest: deploy the WebAuthn signer
        |     |     |
        |     |     +-- 02-invest-morpho      P3  Morpho ETH mainnet, one pool
        |     |
        |     +-- 03-ownership-proof   signed-message verification (Holdings)
        |     |     |
        |     |     +-- 04-holdings          P2  Holdings from signed wallets
        |     |
        |     +-- 05-residency              P1  Self, checks, service fee, permit
        |     |
        |     +-- 06-admin-review           P4  review + approve + review.v1
```

Four parallel stacks share `00-mainnet-config` as their base. Upper branches
rebase on `week-2` after the branch below merges.

### 3.1 Branches and worktrees

| Worktree (sibling dir) | Branch | Bases on | PR targets |
|---|---|---|---|
| `../kade-wt-integration` | `week-2` | `main` | — |
| `../kade-wt-config` | `week-2/00-mainnet-config` | `week-2` | `week-2` |
| `../kade-wt-signer` | `week-2/01-signer-deploy` | `week-2/00-mainnet-config` | `week-2/00-mainnet-config` |
| `../kade-wt-invest` | `week-2/02-invest-morpho` | `week-2/01-signer-deploy` | `week-2/01-signer-deploy` |
| `../kade-wt-ownership` | `week-2/03-ownership-proof` | `week-2/00-mainnet-config` | `week-2/00-mainnet-config` |
| `../kade-wt-holdings` | `week-2/04-holdings` | `week-2/03-ownership-proof` | `week-2/03-ownership-proof` |
| `../kade-wt-residency` | `week-2/05-residency` | `week-2/00-mainnet-config` | `week-2/00-mainnet-config` |
| `../kade-wt-admin` | `week-2/06-admin-review` | `week-2/00-mainnet-config` | `week-2/00-mainnet-config` |

Worktrees share one Git object store; each runs its own `npm install` (or a
symlinked `node_modules`) and its own `.env.local`. No worktree runs
`verify-full.sh` or a broadcast.

### 3.2 Merge order into `week-2`

`00 → 01 → 02 → 03 → 04 → 05 → 06`, then a final integration pass. A stacked PR
is retargeted to `week-2` and rebased once the branch below it has merged.

## 4. Conflict control (shared interfaces)

Parallel worktrees collide on shared files. Freeze the interfaces before the
fronts start, and give each shared file one owner:

| Shared surface | Owner | Rule |
|---|---|---|
| `packages/shared/**` | `00-mainnet-config` | New types/constants land here first; fronts consume, never edit in parallel |
| `supabase/migrations/**` | per front, distinct prefixes | Append-only; each front uses its own timestamp range (below) |
| `apps/web/src/components/shell/nav.ts` | integration | Unlocking routes is one small PR on the integration branch, not four parallel edits |
| `apps/web/src/components/wallet/**` | `03-ownership-proof` | The wallet provider is touched once; Holdings consumes it |
| `docs/week-1-frozen-delivery-contract.md` | human only | Frozen v1.10; change control only |
| `docs/week-2-frozen-delivery-contract.md` | human only | Frozen v1.0; amendment via change control only |

Migration timestamp ranges (proposed), to avoid filename collisions:

| Front | Range |
|---|---|
| 00 config | `20260922000010–19` |
| 01 signer | `20260922000020–29` |
| 03 ownership | `20260922000030–39` |
| 05 residency | `20260922000040–59` |
| 06 admin | `20260922000060–79` |

## 5. Front detail

| Front | Deliverables | Key surfaces | Gate |
|---|---|---|---|
| 00 mainnet-config | EXE-010: payer, RPC, treasury, fee rail on mainnet; per-chain config | `env.ts`, `packages/shared`, `chains` seed | Foundation |
| 01 signer-deploy | EXE-011: deploy the Safe WebAuthn signer (`createSigner`); unblock passkey signing | `packages/contracts`, `apps/web/src/lib/safe` | Account |
| 02 invest-morpho | EXE-014 / D18: one Morpho pool, ETH mainnet, deposit end to end, position reflected | new invest module, `allocations` | Onchain |
| 03 ownership-proof | EXE-013 enabler: signed-message challenge + verify; `wallets.verified_at` set only here | `apps/web/src/lib/wallet`, migration 03x | Account |
| 04 holdings | EXE-013 / D17: Holdings shows all signed linked wallets; pasted rows excluded | Holdings screen, `nav.ts`, provider reads | Acceptance |
| 05 residency | EXE-012 / D16: Self, four checks, service fee, `kade.permit.v1`, tracker | onboarding residency, migrations 04x | Onchain |
| 06 admin-review | EXE-015 / D19: reviewer role, approve/reject, `kade.review.v1`, RLS | admin route, `reviewers`, migrations 06x | Acceptance |

## 6. Verification and review per front

For every front, before it is proposed for integration:

1. Focused tests for the front's behaviour.
2. `./scripts/verify.sh` on the front's HEAD.
3. A short evidence note (Appendix D fields) committed with the front.

Once the fronts are integrated on `week-2`:

1. `./scripts/verify.sh` on `week-2`.
2. Adversarial review session (`MODE=DISCOVERY`) on
   `git diff known-good...week-2`, state under `.review/iteration-week2/`.
3. Fix batches with focused tests; recheck; resume.
4. On `REVIEW PASSED`: final `./scripts/verify.sh`, merge `week-2` → `main`,
   move `known-good`, commit the review state.

## 7. Deployment safety

- `main` remains the deploy branch and is never broken by Week 2 work.
- Preview deploys come from `week-2` and front branches only after `verify.sh`
  passes.
- New secrets (mainnet RPC, treasury, Morpho pool, Self, reviewer credentials)
  live in platform config and `.env.local`; `.env.example` documents keys only.
- No broadcast, no mainnet write before the Front 00/01/02 gates are approved.

## 8. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Signer contract not deployed | Blocks Invest (P3) | Front 01 is on the critical path; start it first after 00 |
| Mainnet funding not supplied | Blocks 00/01/02 | Declare as a Day-1 dependency; pause the stack, do not mock |
| Shared-file conflicts across worktrees | Rework, broken builds | Interface freeze (§4); one owner per shared file |
| Stacked PRs vs single `known-good` iteration | Review ambiguity | Treat `week-2` as the iteration; review the cumulative diff; `known-good` moves once |
| Scope exceeds a 20-hour envelope | Silent downgrade | Change control; owner decides what is cut or deferred |

## 9. Immediate next steps

- [ ] Owner confirms the stack order and the migration ranges (§3.1, §4).
- [ ] Create `week-2` from `main`.
- [ ] Create the integration worktree and the four stack base branches.
- [ ] Freeze `packages/shared` interfaces for Front 00 and merge it.
- [ ] Start Fronts 01 and 03 in parallel; 02 and 04 follow.
- [ ] Open the PR stack with the bases in §3.1.
