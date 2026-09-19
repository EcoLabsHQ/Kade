# Known gaps and deliberate shortcuts

Kade Week 1 is a **hackathon MVP**, not a production system. Incomplete,
simplified and mocked things are expected and acceptable, provided they are
declared here rather than discovered later.

## How to read this

- Nothing in this file is a defect. It is **declared scope**.
- An item here is not a review finding. A review finding is a false claim, a
  weakened test, a security regression, or behaviour that contradicts the
  documentation.
- What is *not* relaxed by the MVP posture: committed secrets, presenting mock
  state as real, claiming verification that did not happen, and gates that
  report success on failure. Those stay blocking at any maturity level.

See `docs/week-1-frozen-delivery-contract.md` section 9 for what is formally out
of scope for Week 1.

## Register

| Area | State | Why | Revisit |
|---|---|---|---|
| Onboarding Steps 1–2 screen | Built: stepper rail, applicant fields, citizenship and residence chips, tier cards, household editor, live fee | D5 | Faithfulness review against the handoff screenshots |
| `/onboarding` validation and save | Validation delegates to `@kade/shared`; persistence is implemented behind a seam with a real Supabase store, and the web app is now wired to a live Supabase project | The schema, triggers and RLS have been verified directly with SQL, but no onboarding write has yet been executed *through the app* | First end-to-end run with a signed-in session |
| Fee at runtime | Web app computes the fee from the shared formula + `KADE_FEE_MODE`; the database can now recompute it independently via `public.preapproval_fee_usdc()` (`supabase/migrations/20260916000010_fee_function.sql`) | One formula, one source; the seed generator asserts the database parameters reproduce `@kade/shared`. The web path is not yet wired to the database function | Small change; contract says "from the active `fee_schedule`" |
| Passkey credential metadata | In-memory seam; does not survive reload | Persistence is not implemented against the database yet | When passkey enrolment is wired to the schema |
| Safe WebAuthn signer address | Unresolved sentinel, never a fabricated address | Requires the Account-gate deployment inputs | Account gate |
| Safe address derivation | `packages/contracts/src/SafeAddress.sol` derives the CREATE2 proxy address; a test pins one all-`[arbitrary]` vector and proves input sensitivity | Every concrete input (factory, singleton, initializer, salt) is project-supplied and Account-gate blocked, so no real address exists yet | Account gate (D4) |
| Safe address on the login screen | Withheld, labelled "not yet deployed" | Nothing is deployed | After D4 |
| Steps 3 and 4 (proof of wealth, pre-approval fee) | Built and walkable, but mocked: connecting a wallet attaches the reference's seed balances and paying flips local state. Neither touches a chain | Wallet connection and payment execution are excluded from Week 1 (contract section 9) | Week 2 (wallets, payments) |
| Dashboard figures | The pre-approved state is mocked: the fee receipt, the three attestations and the residency stages are the reference's demo values, labelled demo in the banner and a chip | Payments, attestations, the indexer and the Safe deployment are all out of Week 1, so none of those records exists | As each lands |
| Safe address in the dashboard | Withheld. Qualified holdings says no Safe is deployed rather than showing a locked balance | Nothing is deployed; an address here would be fabricated | Account gate |
| Fee shown in the web app | Computed from the shared formula, not read from `fee_schedule` | Declared: the runtime schedule read is not wired | Small change; the DB function already returns the same value |
| Vote, Holdings, Invest, Bank↔Crypto, Card | Rendered locked, not implemented | Out of Week 1 scope | Weeks 3–4 |
| Admin toggle | Rendered locked | Admin review UI is out of scope | Week 3 |
| KadeLock | Compiled and tested only; not deployed | Frozen model A; deployment is out of scope | Post-Week 1 |
| EAS schemas | Manifest, registration planner and Onchain-gate review pack (`packages/contracts/eas/REVIEW.md`) generated; nothing registered | Registration is irreversible and the approval record is still unapproved (Onchain gate, checkpoint 3) | Onchain gate |
| Database tests (fee formula) | pgTAP suite `supabase/tests/0001_fee_recompute.test.sql` covers the formula, the recompute triggers, mode switching and the definer path; no RLS coverage | It proves only our own arithmetic, not row visibility, and is run by hand rather than by any gate. `pgtap` is available on the project, so it can also run there | When RLS enforcement needs a gate |
| RLS | Policies written and reviewed as SQL; no harness exercises row visibility | Enforcement is Postgres's; the removed RLS harness produced four review findings (contract v1.1) | Only if it earns its keep |
| Live Google sign-in | **Completed end to end by the project owner**: the session was established and restored. The redirect boundary was verified directly by the agent | Reported by the project owner, not independently reproduced by the agent | Done |
| Email magic link | Provider enabled and the form is live, and the agent's tests cover the send path, but no link has been delivered and followed | Depends on the project's SMTP and on a mailbox | First delivered link |
| Google OAuth provider | Enabled. The app also detects a disabled provider and says so instead of failing into raw JSON | — | Done |
| Supabase project | **Provisioned.** All 10 migrations and the seed are applied; 17 tables, RLS on every one, 10 deny-by-default, the fee function and its triggers verified live (`preapproval_fee_usdc('demo', 3)` = 1.75, `('production', 3)` = 447) | Project-supplied dependency | Applied 17 Sep |
| CI | Present. GitHub Actions runs `./scripts/verify.sh` on push and pull request against `main` (`.github/workflows/ci.yml`) | The canonical gate now runs without a human remembering; no secrets are configured or required | Add `verify-full.sh` when its extra checks are wired |
| Design system | Design tokens ported as inline styles on primitives | Fast, and faithful to the vendored handoff at `reference/design-handoff/` | When the real UI lands |

## Deliberate simplifications

These are choices, not omissions:

- **`[arbitrary]` values** are labelled as such in code and in the threat model
  rather than invented confidently.
- **KadeLock has a single admin**, no timelock and no second signer. It blocks
  non-allowlisted native-value transactions only; ERC-20 and call data are not
  inspected. The production shape is recorded as a future improvement in the
  threat model.
- **No external wallet connection.** Out of scope; the passkey is the only
  transaction authority.
- **No indexer.** Nothing aggregates balances.

## If you are reviewing this repository

Judgement to apply:

- Declared gaps above → not findings.
- Undeclared gaps, stale claims, or a gate that passes while proving nothing →
  findings.
- Mock data rendered as if real → finding, always.
