# Week 1 foundation iteration — report

Iteration report for the Kade Week 1 foundation build. It covers one
development iteration: everything between the previous `known-good` state and
the state promoted at the end of it.

| | |
|---|---|
| Previous `known-good` | `e3ed13d` (documentation and harness only) |
| Promoted `known-good` | `ee6b68d` |
| Window (local time) | 16 September 2026, 22:14 – 23:52 (-0500) |
| Commits | 24 |
| Change size | 144 files, +22,027 / −89 |
| Mechanical gate | `./scripts/verify.sh` — passed |

## 1. What was requested

Recreate the Week 1 foundation across every front the programme needs: scaffold
the repository, install dependencies, define the initial tests and behaviour
required by the Week 1 tasks, record the architecture decisions, port the
deployed MVP's UI for the Week 1 screens (login first), and take the
authentication process as far as the frozen constraints allow.

Scope is `docs/week-1-frozen-delivery-contract.md`: deliverables D1–D8 across
packages EXE-001–EXE-006 on Ethereum Sepolia. Recovery, L2 deployment, payments,
Aave, KYC, admin review, GOS/CCTP, card and voting are out of scope.

## 2. Key discovery — the reference UI source

`docs/week-1-frozen-delivery-contract.md` §6.1 records that the MVP UI source is
not available, and escalated the frontend effort on that basis: the shell and
Steps 1–2 would have to be **recreated** rather than wired up.

The deployment at `https://mvp.onchainisland.co/` is published as a
self-contained bundle document. Its markup and component logic are embedded in
the served HTML rather than fetched from a repository, which is why no source
repository exists to be shared. Extracting the bundle recovered:

- the `x-dc` document (190 KB): page shell, sidebar and every screen;
- the component logic (388 lines): state and derived view values;
- the wordmark and the typeface subsets.

This is vendored under `reference/mvp-onchainisland/` with hashes and a
provenance record in `PROVENANCE.json`. It is documentation of the baseline, is
never built or imported, and is disclosed as prior work in the root `README.md`.
Because the baseline is now readable, the Week 1 screens are a **port** rather
than an interpretation: colours, spacing, radii and weights are lifted verbatim
(ADR 0002).

## 3. What was built

### 3.1 Repository and toolchain

npm-workspaces monorepo with three workspaces (`apps/web`, `packages/shared`,
`packages/contracts`). `scripts/setup.sh` performs a one-command clean-checkout
setup, including pinned Foundry dependencies. `scripts/verify.sh` was extended
so it can no longer pass vacuously (ADR 0001).

### 3.2 `packages/shared` — frozen cross-package contracts

The single home for anything crossing a package boundary:

- the chain registry (ids, USDC, EAS, schema registry, explorer);
- the fee model;
- the EAS schema proposal;
- the Safe deployment inputs and the D4 invariants;
- the authentication model.

Values the governing documents do not state carry an explicit provenance marker
(`documented` | `external` | `arbitrary`), so a placeholder cannot be mistaken
for approved configuration.

### 3.3 `packages/contracts` — KadeLock and EAS tooling

`KadeLock` is the frozen Week 1 minimum Safe Guard (model A). It blocks
non-allowlisted native-value transactions while locked, stops blocking at or
after `unlockAt`, and restricts configuration to an admin. It inherits the
canonical `Guard` interface from `safe-smart-account` v1.4.1.

Foundry tests cover the five areas D7 requires: unauthorised configuration
changes, lock enforcement before `unlockAt`, permitted destinations, rejected
destinations, and post-unlock behaviour. 33 tests, all passing.

The EAS tooling generates the registration manifest from `@kade/shared` and
refuses to run without a recorded Onchain-gate approval, so no test run or
script invocation can trigger an irreversible registration.

Nothing is deployed and nothing is registered.

### 3.4 `supabase` — schema, RLS and seeds

Nine migrations create all 17 tables from build guide §9. Every table has RLS
enabled; tables outside the Week 1 journey are deny-by-default with no
permissive policy, and a guard migration raises if any public table is left
unprotected.

Security-critical columns are removed from the `authenticated` role's column
privileges, so a resident cannot overwrite their own Safe address, fee hashes,
attestation UIDs or status. Status changes flow through `review_events` only.
`self_nullifier` is unique and indexed, and no raw proof payload is stored.

`chains` and `fee_schedule` are generated from `@kade/shared` rather than
hand-written, with a drift guard that regenerates the seed and asserts it
matches byte-for-byte.

### 3.5 `apps/web` — shell, login and authentication

The baseline shell is recreated as reusable primitives rather than one large
component. The login screen is a port of the baseline's account screen, adapted
to the frozen auth model.

The application implements two deliberately separate authorities:

| | Credential | Grants |
|---|---|---|
| Application session | Google OAuth via Supabase | Access to the resident's own rows |
| Transaction signing | Passkey (direct Safe WebAuthn signer) | Authorising Safe transactions |

Google is the only login, there is no email or OTP fallback, the passkey is
never requested during sign-in, and a Google session cannot authorise a
transaction. The separation is enforced by guards in `@kade/shared` and covered
by tests (ADR 0003).

No mock state is presented as success. When Supabase is not configured the app
renders an explicit "not configured" state, and it withholds the Safe address
rather than fabricating one.

## 4. Verification

`./scripts/verify.sh` is the only mechanical gate and runs every check below.

| Gate | Result |
|---|---|
| Typecheck | PASS |
| Lint | PASS |
| Unit tests | PASS — 97 (38 `@kade/shared` + 59 `apps/web`) |
| Acceptance tests | PASS — 12 |
| Regression tests | PASS — 4 |
| Build | PASS |
| `forge build` | PASS |
| `forge test` | PASS — 33 |

The gate was previously vacuous: with no `package.json` or `foundry.toml` it
printed `NO VERIFICATION TARGETS CONFIGURED` and exited 0. Wiring real targets
and reporting the regression test count were prerequisites for trusting any
later result.

Test files: 9 web, 5 shared, 2 Foundry, 2 acceptance, 1 regression.

RLS is deliberately **not** covered by the mechanical gate. Enforcement is
Postgres's, configured through Supabase; the policy set is reviewed as SQL in a
single auditable migration. See section 6.

## 5. The review loop

The development contract requires a mechanical gate and an independent
adversarial review before promotion, with a circuit breaker of three corrective
iterations. This iteration used all three.

| Round | Candidate | Verdict | Finding |
|---|---|---|---|
| 1 | `bc3e7d9` | FAILED | Open redirect in the post-auth return path |
| 2 | `72be92d` | FAILED | `RAN` unbound in `verify-full.sh` |
| 3 | `9b388c6` | FAILED | pgTAP `finish()` does not fail the run |
| 4 | `64e271f` | FAILED | `rls-check.sh` reported success on a suite error |

`known-good` was not moved at any point until the final authorization.

Three of the four findings were in the same area — the RLS evidence path. The
contract forbids continuing to patch in that situation: *"if multiple
consecutive fixes target the same underlying behavior ... stop and reevaluate"*.
The iteration therefore stopped at the circuit breaker and escalated to the
human change-control gate rather than starting a fourth corrective round.

### 5.1 Defects found and their root causes

- **Open redirect.** Both the login page and the OAuth callback validated the
  `next` return path with a string prefix check
  (`startsWith('/') && !startsWith('//')`). URL parsers normalise a backslash to
  a path separator, so `next=/\evil.com` passed the check and resolved to
  `http://evil.com/` after a genuine Google sign-in. Fixed by deciding safety on
  the property actually required — the resolved target is the configured
  origin — with the trusted origin taken from configuration rather than the
  request, so a spoofed `Host` header cannot influence the destination. A
  regression test records the exact input and fails if the fix is reverted.

- **Documented switches that nothing read.** ADR 0005, the README and
  `.env.example` presented `KADE_FEE_MODE` and `KADE_CHAIN_ENV` as the behaviour
  switches, but no code read either: the onboarding page hard-coded the demo
  mode. Fixed by reading both server-side and passing the resolved values down
  as props, so the browser can neither read nor override them.

- **pgTAP failures reported as success.** A bare `finish()` does not raise on a
  failed assertion; it prints a diagnostic and `psql` still exits 0. The gate
  derived its verdict solely from `psql`'s exit status, so a failing RLS suite
  looked green. Fixed by calling `finish(true)` in all three suites and by
  having the gate inspect the TAP output for `not ok` as well. The suites were
  later removed entirely (section 6), so this fix no longer exists in the tree;
  it is recorded because it explains the round.

- **`rls-check.sh` reported success on a suite error.** The tool captured output
  with `|| true`, discarded the exit status, and decided pass/fail only by
  grepping for `not ok`. A suite that errored before reaching `finish()` emitted
  no `not ok` and was reported as passed. Resolved by removing the tool rather
  than patching it a third time (section 6).

- **KadeLock described more than it enforces.** It was described in general
  terms as blocking value or asset movement. The implementation inspects only
  `to` and `value`, so a call with `value == 0` is never blocked and ERC-20
  movements pass through while locked. The claim is now stated exactly —
  *blocks non-allowlisted native-value transactions while locked* — the contract
  is described as a Week 1 demonstration of the mechanism rather than the
  production enforcement layer, and the production gap is recorded as a future
  improvement.

## 6. The de-scope decision

At the circuit breaker the human change-control gate chose to **remove the
surface rather than patch it again**, and then removed the RLS test suite
outright on the grounds that enforcement is Supabase's concern.

Removed, in two steps:

| Step | Removed |
|---|---|
| At the circuit breaker | `scripts/db/rls-check.sh`, `supabase/tests/support/supabase-shim.sql` |
| Follow-up | `supabase/tests/` (all three pgTAP suites), the RLS block in `scripts/verify-full.sh` |

The policy set itself is untouched. Row level security is still enabled on every
table, the security-critical columns are still removed from the `authenticated`
role's privileges, and the apply-time guard that fails the migration on an
unprotected table still runs. What is gone is the committed harness that
exercised those policies.

Consequences, stated plainly:

- The Week 1 contract listed "automated RLS tests" as part of the D2 evidence.
  Rather than leave a knowingly unmet acceptance criterion, the contract was
  amended: **v1.1** removes that requirement and records the change in section
  8.1. RLS itself remains a required deliverable and is unchanged.
- Nothing in `verify.sh` or `verify-full.sh` exercises row visibility, so no
  green run should be read as an RLS claim.
- Before this change the RLS suites had produced four review findings across
  three corrective rounds, all of the same class: a failing or erroring suite
  reported as success. Removing the harness removes that class of defect.

## 7. Decisions recorded

Six decision records were written during the iteration.

| ADR | Decision |
|---|---|
| 0001 | npm-workspaces monorepo with a single verification entry point |
| 0002 | Next.js App Router; design tokens taken from the reference UI |
| 0003 | Google-only login; passkey as a separate transaction authority |
| 0004 | Supabase owns workflow; chains own money and attestations |
| 0005 | Chains and fees are seeded configuration, not code |
| 0006 | Foundry; KadeLock compiled and tested, not deployed |

Two supporting decisions are recorded in those ADRs and in the README:

- **Foundry dependencies are fetched, not vendored.** `safe-smart-account` is
  LGPL-3.0; committing it into this MIT-licensed repository would mix licences
  and import a large third-party tree for no build benefit. `lib/` is ignored
  and `scripts/setup.sh` installs pinned versions.
- **The licence is MIT.** The build guide listed MIT versus Apache-2.0 as an
  open decision; MIT was chosen. Confirmation is still with the project.

## 8. Status against the Week 1 deliverables

| ID | Deliverable | Status |
|---|---|---|
| D1 | Public development foundation | Mostly — README, licence, disclosure and clean build; no shared preview URL |
| D2 | Supabase schema, RLS and seeds | Partial — schema, policies and seeds complete; no live Supabase project |
| D3 | Login and transaction signer | Partial — separation tested; live sign-in unverified |
| D4 | Resident Safe and deterministic L2 address | Blocked — invariant guards only; no signer address |
| D5 | Steps 1–2 live | Not started — shell and fee display only |
| D6 | Sepolia EAS registrations | Blocked — manifest prepared, not registered |
| D7 | Tested KadeLock baseline | Complete — 33 Foundry tests |
| D8 | Integrated Week 1 gate | Not possible — needs credentials and a deployment |

## 9. Promotion record

> **Warning:** the review gate did **not** pass for this final state. It failed
> on `rls-check.sh`; the de-scope in section 6 removes that file instead of
> fixing it, which dissolves the finding. `known-good` was moved on explicit
> human change-control authorization, not on a green adversarial review.

The mechanical gate passed and represents the promoted commit. This record
exists so the promotion is auditable and the deviation from the two-gate rule
is not silent.

## 10. Known limitations

- **No RLS harness.** Row level security is enabled and its policies are reviewed
  as SQL, but nothing exercises row visibility, so no green run is an RLS claim.
  D2's evidence requirement was amended to match (contract v1.1, section 8.1).
- **Nothing is on-chain.** KadeLock is not deployed; the EAS schemas are not
  registered. Both are gated on human approval, and registration is
  irreversible.
- **Live authentication is unverified.** No Supabase project or Google OAuth
  credentials were available.
- **The transaction signer is unverified.** A test signature through the direct
  Safe WebAuthn signer requires the signer address and deployment inputs, which
  the project supplies and the Account gate approves. The signer address is an
  explicit unresolved sentinel, never a fabricated address.
- **Passkey metadata persistence is a seam.** No database is reachable from the
  web app, so persistence is in-memory.
- **Human orchestration hours were not measured** and still need recording.
- **Values marked `[arbitrary]`** await their gates; they are listed in the
  KadeLock threat model and in the shared package.

## 11. Open items for the next iteration

- [ ] Supply Google OAuth and Supabase credentials and validate live sign-in.
- [ ] Clear the Account gate: approve the signer implementation and the Safe
      deployment inputs, then produce the deterministic L2 address test (D4).
- [ ] Clear the Onchain gate: approve the EAS encodings and the KadeLock
      interface and threat model.
- [ ] Provision a Supabase project and run `supabase db reset` against it.
- [ ] Close the §6.1 escalation formally: the reference UI source was recovered
      from the deployment, which removes the risk that justified re-scoping
      D3/D5.
- [ ] Confirm the KadeLock model A freeze (§6.2) and the contracts licence.
- [ ] Decide the shared HTTPS preview requirement.
- [ ] Record human orchestration hours against EXE-001–EXE-006.

## Appendix — evidence manifest (Appendix D template)

| Field | Content |
|---|---|
| Package | EXE-001, EXE-002, EXE-003 (partial), EXE-006 (partial); KAD-001–KAD-008 |
| Commit | `ee6b68d` (promoted `known-good`) |
| Hours | Not measured by the agent; human to record |
| Tests | `./scripts/verify.sh` → PASS · 97 unit · 12 acceptance · 4 regression · 33 Foundry |
| Runtime proof | 9 migration ids (`20260916000001`–`20260916000009`); Foundry output; no explorer links, nothing deployed |
| Acceptance mapping | D1 scaffold and setup; D2 schema and seeds; D3 auth separation; D6 manifest; D7 KadeLock tests |
| Known limitations | Section 10 |
| Security notes | No secrets committed; EAS registration guarded and never broadcast; no on-chain writes performed |
| Reviewer | Adversarial review **FAILED**; promotion by human change-control decision |
