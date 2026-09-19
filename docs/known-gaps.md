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
| Safe WebAuthn signer address | **Derived.** The credential's public key is parsed to its P-256 coordinates and `SafeWebAuthnSignerFactory.getSigner` is called for the address, through a server action so the RPC provider key stays server-side | The factory is the authority: its address depends on its immutable singleton and the proxy creation code it was compiled with, which this repository does not reproduce | Done |
| Safe address derivation | `packages/contracts/src/SafeAddress.sol` derives the CREATE2 address and a Foundry test pins the `SafeProxy` creation code; `apps/web/src/lib/safe/` mirrors it and calls the live signer factory | The Safe release and its addresses come from Safe's published deployments, the creation code is pinned, and the signer comes from the chain, so no input is a placeholder | Account gate (D4) — only deployment remains |
| Safe `SafeProxy` creation code | **The deployed factory's code is not this repository's build.** Ours: 649 bytes, `keccak256 = 0xa547798e…adc906cf`. The deployed v1.5.0 factory's `proxyCreationCode()`: 438 bytes, `keccak256 = 0x941b3e88…b87e12` | The creation code is part of the CREATE2 digest, so deriving from our own build produced an address the factory would never deploy. Found in review, after an earlier value had been pinned in tests as correct. The application now reads the code from the factory at runtime; `DEPLOYED_SAFE_PROXY_CREATION_CODE` records the value so the mismatch is reviewable, and a regression test asserts the two hashes do not converge | None — the chain is read at runtime |
| Salt nonce strategy | **Proposed, not approved.** `residentSaltNonce` derives it as `keccak256(userId)`, so each resident's address is stable and distinct with no server-side counter to lose | This was the Account-gate pack's open question ("what makes each resident's address unique"). Chosen here as the obvious answer, but it fixes every resident's address, so it should be confirmed at the gate before anything is deployed | Account gate (D4) |
| Account address is counterfactual | The account step shows the derived Safe address, and nothing is deployed | A Safe address exists before the Safe does; a counterfactual address is the normal state, not a claim that a contract is on chain. The dashboard still distinguishes "no Safe deployed" from a locked balance | Account gate (D4) |
| Safe address on the login screen | Withheld, labelled "not yet deployed" | Nothing is deployed | After D4 |
| Account step (create passkey) | Shows the account address once the passkey exists, and no caveat about it | Creating a passkey is the ordinary path for a new resident, so the screen reads like a product screen rather than a status report. If the chain is unreachable the passkey still succeeds and the address is simply not shown, because the passkey is created and usable regardless | None |
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
| Supabase project | **Provisioned.** All 13 migrations and the seed are applied; 18 tables, RLS on every one, 10 deny-by-default, the fee function and its triggers verified live (`preapproval_fee_usdc('demo', 3)` = 1.75, `('production', 3)` = 447) | Project-supplied dependency | Applied 17 Sep |
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
