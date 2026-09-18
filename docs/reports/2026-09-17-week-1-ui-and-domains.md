# Week 1 — UI and domain iteration report

Second iteration report for the Kade Week 1 build. Covers everything between
`95a7896` (the previous `known-good`) and `7fc28fa` (promoted at the end of it).

| | |
|---|---|
| Previous `known-good` | `95a7896` |
| Promoted `known-good` | `7fc28fa` |
| Window (local time) | 17 September 2026 |
| Commits | 16 |
| Change size | 90 files, +9,817 / −219 |
| Mechanical gate | `./scripts/verify.sh` — passed |
| Adversarial review | passed |

## 1. What was requested

Three things, in sequence:

1. Advance the unblocked plan: the Steps 1–2 field contract, a database-side fee
   recomputation, the Safe address machinery, the EAS review pack, credential
   persistence and CI — everything that needs no project credentials.
2. Build the Week 1 UI from the design handoff the project supplied.
3. Parallelise with separate git worktrees where the work is independent.

The owner also relaxed the maturity bar explicitly: this is a hackathon MVP, and
incomplete or mocked work is acceptable **provided it is declared**. That
produced `docs/known-gaps.md` and the posture recorded there.

## 2. Contract amendment — v1.1

The owner directed that the RLS test requirement be removed from D2.
`docs/week-1-frozen-delivery-contract.md` was amended to **v1.1** with a new
section 8.1 recording the change and a before/after table for every affected
clause:

| Clause | Before | After |
|---|---|---|
| Section 4, D2 evidence | migration ids, seed output, automated RLS tests | migration ids and seed output |
| Section 7, Foundation/Data workstream | migrations, seeds, RLS tests, shared types | migrations, seeds, shared types |
| Appendix A, D2 row | Migrations and RLS test report | Migrations and seed output |
| Appendix C, A1 must-return | migrations, seeds, RLS tests, … | migrations, seeds, … |

RLS itself is unchanged: policies, deny-by-default for unused tables, withheld
write privileges on security-critical columns, and the apply-time guard that
fails the migration on an unprotected table. Only the committed test harness is
no longer required.

The rationale is recorded in the contract rather than left implicit: a committed
RLS harness produced four review findings across three corrective rounds, every
one of them a failing or erroring suite reported as success, while adding no
protection beyond the policies themselves.

## 3. Design handoff

The project supplied the official Kade MVP design handoff. It is vendored at
`reference/design-handoff/` with `PROVENANCE.md`:

- the spec README (every screen, layout, colours, type, business rules, state
  model, schema, architecture notes);
- the prototype source, the offline bundle, the design-tool runtime;
- 34 screenshots in flow order, plus their index;
- the wordmark and the build guide.

Two facts worth recording:

- `index.html` in the handoff has the **same SHA-256** as the bundle served at
  `mvp.onchainisland.co`, which had been extracted separately before the handoff
  arrived. Both describe one design; the handoff is authoritative because it also
  carries the spec and the prototype source.
- The handoff instructs explicitly: *"Don't port the HTML."* Nothing in the
  monorepo imports from `reference/`.

`PROVENANCE.md` also records the four places where the handoff and the frozen
contract disagree, all resolved in favour of the contract: the signer (no
managed provider), login (Google only), chain (all-testnet iteration 1), and the
framework version.

## 4. How the work was parallelised

Five agents ran in five separate git worktrees, in two waves. Each worktree ran
its own `npm ci` (about 8 seconds with a warm cache) and, where needed,
`forge install --no-git`, so nothing touched the main tree until merge.

| Wave | Worktree | Owned exclusively | Merged |
|---|---|---|---|
| 1 | `shared` | `packages/shared` | fast, no overlap |
| 1 | `supabase` | `supabase`, `scripts/db/seed-sql.ts`, data model doc | fast, no overlap |
| 1 | `contracts` | `packages/contracts` | fast, no overlap |
| 2 | `ui` | `apps/web` | fast, no overlap |
| 2 | `ci` | `.github`, `docs/known-gaps.md`, `README.md` | fast, no overlap |

Every worktree was branched from the same commit and merged with `--no-ff`, with
`./scripts/verify.sh` run after each wave. **No merge produced a conflict**,
because file ownership was assigned before any agent started.

## 5. What each workstream delivered

### 5.1 `packages/shared` — the Steps 1–2 field contract

`onboarding.ts` plus 23 tests. It freezes the shape and validation for
pre-registration Steps 1–2: the 14-country list, the three tiers, applicant
profile, citizenship and residence lists, household members, and step-completion
checks that return blocking reasons rather than a bare boolean.

The meaningful rule is residence validation: the union of the listed periods must
cover the last five years, reported as a structured result (covered / missing
years / gaps) so the UI can say what is missing rather than just refusing.

`householdSize` includes the applicant, per contract section 2.1, and the fee
delegates to `preapprovalFeeUsdc` rather than being re-implemented.

### 5.2 `supabase` — the fee becomes recomputable in the database

The handoff and the build guide both call for a database function that
recomputes the pre-approval fee. That was impossible with the original schema:
`fee_schedule` carried only the household-size-1 amount, while the formula has a
per-member increment.

- `base_amount`, `per_member_amount` and `rounding_scale` added to
  `fee_schedule`, emitted from the seed generator, which self-checks that the
  seeded parameters reproduce `preapprovalFeeUsdc` for household sizes 1–1000
  before writing a single row.
- `preapproval_fee_usdc()` plus `household_members` triggers maintain
  `applications.preapproval_usdc`, running as definer because that column is
  deliberately withheld from the `authenticated` role.
- Verified against a real PostgreSQL 16: both contract worked examples
  (1.75 demo, 447 production), recompute on insert and delete, and the definer
  path under `authenticated`.
- 19 pgTAP assertions in `supabase/tests/`, ending in `finish(true)`; a
  deliberately mutated assertion was shown to make `psql` exit non-zero.
- `docs/architecture/data-model.md` gained a handoff-vs-DOCX section. DOCX wins
  where a table is already implemented; handoff-only Reflect tables are listed
  as deferred to week 3 rather than added.

### 5.3 `packages/contracts` — EAS review pack and Safe machinery

- `eas/REVIEW.md`: the five exact encodings generated from `@kade/shared`,
  per-field provenance, revocability, resolver, attester and recipient, the exact
  irreversible action the Onchain gate would authorise, and what approval does
  **not** authorise.
- `SafeAddress.sol`: pure CREATE2 Safe proxy derivation with 12 tests, including
  a pinned known-address vector cross-checked three independent ways (viem,
  `cast create2`, `vm.computeCreate2Address`) and sensitivity tests proving any
  input change moves the address.
- A JSON Schema for the D4 deployment manifest, whose example carries
  `provenance: unapproved`.

Nothing was deployed or registered. Every concrete value is `[arbitrary]` and
listed against the gate that must confirm it.

### 5.4 `apps/web` — the Steps 1–2 screen

Replaces the placeholder with the real profile and household step, reproduced
from the spec: the stepper rail, applicant fields, citizenship chips with the
14-country select, residence chips with year ranges, the three tier cards, and
the household editor. The fee recalculates live and is never a client constant.

Validation delegates entirely to the `@kade/shared` contract; the screen renders
the blocking reasons it returns. Persistence sits behind an explicit seam with a
real Supabase implementation, and without a reachable database the app renders a
not-configured state rather than pretending to save.

22 tests added; no existing test changed.

### 5.5 CI and status

`.github/workflows/ci.yml` runs the canonical gate on push and pull request:
Node from `.nvmrc`, cached `npm ci`, the Foundry toolchain, then
`scripts/setup.sh` for the pinned git-ignored Foundry dependencies, then
`verify.sh`. No secrets. The pinned versions are not re-expressed in YAML —
`setup.sh` remains the single source of truth.

`docs/known-gaps.md` was added and then refreshed as work landed.

## 6. Verification

`./scripts/verify.sh` is the only mechanical gate.

| Gate | Result |
|---|---|
| Typecheck | PASS |
| Lint | PASS |
| Unit tests | PASS — 142 (81 `apps/web` + 61 `packages/shared`) |
| Acceptance tests | PASS — 12 |
| Regression tests | PASS — 4 |
| Build | PASS |
| `forge build` | PASS |
| `forge test` | PASS — 45 (12 SafeAddress + 30 KadeLock + 3 integration) |

203 tests in total, up from 142 at the previous `known-good`.

The database suite is deliberately **not** part of the gate: it needs a live
database, so it is run manually against a disposable PostgreSQL as documented in
`supabase/tests/README.md`.

## 7. The review

The review was run with the owner's explicit calibration: report only real,
feasible defects; declared gaps are not findings; do not manufacture findings.
It returned **REVIEW PASSED**.

Four non-blocking warnings were raised, and **every one was a statement that was
simply not true** — the failure mode this repository keeps hitting. All four were
fixed in `7fc28fa`:

| Claim | Reality |
|---|---|
| The pgTAP suite runs 18 assertions | It runs 19 |
| The amended contract is v1.1 throughout | The closing line still said v1.0 |
| The seed self-check covers "every household size" | The loop stops at 1000; the two formulations first diverge near size 13,200 |
| Onboarding failures mean "Nothing was written" | The persistence path is several independent calls with no transaction, so earlier writes can be committed |

One residual label was assessed by the review and declared **non-blocking and
defensible**: the freeze-checklist heading still reads "Freeze status at v1.0",
which is a legitimate record of the decisions frozen at v1.0 that the v1.1
amendment does not touch. It is recorded here rather than silently left.

## 8. Decisions taken during the iteration

- **The UI was not split across worktrees.** The shell and the screens share a
  design system; splitting them would have cost more in coordination than it
  saved in wall-clock time. Everything genuinely disjoint was parallelised.
- **The database fee tests were kept, RLS tests were not.** The removed harness
  tested Supabase's enforcement; the new one tests our own fee arithmetic, which
  is ours to get wrong. It runs manually and is wired into no gate.
- **Handoff-only Reflect tables were not added.** They belong to later weeks; the
  contract freezes the DOCX schema for Week 1.
- **No Week 1 deliverable was marked complete that is not.** See section 10.

## 9. Promotion record

The review passed for the candidate, the mechanical gate passed and represented
that same commit, the tree was clean, and `known-good` was advanced from
`95a7896` to `7fc28fa` and pushed, together with the tag.

## 10. Known limitations

Every item below is declared in `docs/known-gaps.md`, which is the authoritative
register.

- **No live Supabase project.** No onboarding write has ever been executed, no
  session has been restored, and the persistence path is unverified end to end.
- **No live Google sign-in.** No credentials were supplied.
- **The real Safe address does not exist.** Only the derivation machinery and an
  arbitrary vector. The signer address and deployment inputs are Account-gate
  blocked.
- **EAS schemas are not registered.** The review pack is ready; the action is
  irreversible and gate-blocked.
- **RLS has no row-visibility harness.** The policies are reviewed as SQL.
- **The Steps 1–2 screen has not been compared against the screenshots in a
  browser.** Fidelity is by construction from the spec, not visually verified.
- **CI has never run.** It is validated as YAML only.

## 11. What is blocked, and on whom

| Blocker | Owner | Unblocks |
|---|---|---|
| Supabase project + Google OAuth credentials | project | Live sign-in, real persistence, D2 evidence |
| Account gate: Safe version/config + WebAuthn signer address | project + human | Real deterministic address, D4 deployment |
| Onchain gate: approve `eas/REVIEW.md` and the KadeLock threat model | human | EAS registration, D6 |
| §6.2 model A confirmation, contracts licence, preview approval | human | Contract close-out |

## 12. Suggested next steps

1. **Clear the gates.** They are now the critical path: the code is ready to
   consume the answers, and three deliverables are waiting on them.
2. **Visual fidelity pass** on the Steps 1–2 screen against the handoff
   screenshots, once a browser run is possible.
3. **Close the §6.1 escalation** formally: recovering the reference UI source
   removed the risk that justified re-scoping D3/D5.
4. **Then Week 2**: wallet connect + SIWE, multichain balance reads, the
   pre-approval fee UserOp with batched attestations.
