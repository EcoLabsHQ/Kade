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
| Fee at runtime | **Resolved.** The server reads the active `fee_schedule` row and `public.preapproval_fee_usdc(mode, household_size)`; the client previews only through a server action and can supply no amount. `applications.preapproval_usdc` is still recomputed by the trigger and read back | The runtime path reads the database, not the shared formula (contract section 2.1) | Done |
| Passkey credential metadata | **Persisted.** Enrolment writes the resident-granted columns (credential id, public key, transports, user verification) to `passkey_credentials`; `/account` reloads the stored credential server-side | **`signer_address` is deliberately not granted to `authenticated`**, so it is written only with `SUPABASE_SERVICE_ROLE_KEY`. With the key present, the action derives the signer from the public key and stores it. With the key absent (the current state), the action checks first and does not derive at all: `signer_address` stays NULL, the panel renders "Not stored", and the action reports the missing key rather than deriving an address it cannot save or faking success | Set `SUPABASE_SERVICE_ROLE_KEY` |
| Safe WebAuthn signer address | **Derived** (when the service key is configured; see the row above). The credential's public key is parsed to its P-256 coordinates and `SafeWebAuthnSignerFactory.getSigner` is called for the address, through a server action so the RPC provider key stays server-side | The factory is the authority: its address depends on its immutable singleton and the proxy creation code it was compiled with, which this repository does not reproduce | Done |
| Safe address derivation | `packages/contracts/src/SafeAddress.sol` derives the CREATE2 address; `apps/web/src/lib/safe/` mirrors it, and `deriveAccount` reads the signer address and the proxy creation code from the deploying contracts | The Safe release and its addresses come from Safe's published deployments, and the two inputs that cannot be reproduced locally come from the chain, so no input is a placeholder. The Foundry test's pinned creation code is *our* build and is not used to derive addresses — see the next row | Account gate (D4) — only deployment remains |
| Safe `SafeProxy` creation code | **The deployed factory's code is not this repository's build.** Ours: 649 bytes, `keccak256 = 0xa547798e…adc906cf`. The deployed v1.5.0 factory's `proxyCreationCode()`: 438 bytes, `keccak256 = 0x941b3e88…b87e12` | The creation code is part of the CREATE2 digest, so deriving from our own build produced an address the factory would never deploy. Found in review, after an earlier value had been pinned in tests as correct. The application now reads the code from the factory at runtime; `DEPLOYED_SAFE_PROXY_CREATION_CODE` records the value so the mismatch is reviewable, and a regression test asserts the two hashes do not converge | None — the chain is read at runtime |
| Salt nonce strategy | **Proposed, not approved.** `residentSaltNonce` derives it as `keccak256(userId)`, so each resident's address is stable and distinct with no server-side counter to lose | This was the Account-gate pack's open question ("what makes each resident's address unique"). Chosen here as the obvious answer, but it fixes every resident's address, so it should be confirmed at the gate before anything is deployed | Account gate (D4) |
| Account address is counterfactual | The account step shows the derived Safe address, and nothing is deployed | A Safe address exists before the Safe does; a counterfactual address is the normal state, not a claim that a contract is on chain. The dashboard still distinguishes "no Safe deployed" from a locked balance | Account gate (D4) |
| Safe address on the login screen | Withheld, labelled "not yet deployed" | Nothing is deployed | After D4 |
| Account step (create passkey) | Shows the account address once the passkey exists, and no caveat about it | Creating a passkey is the ordinary path for a new resident, so the screen reads like a product screen rather than a status report. If the chain is unreachable the passkey still succeeds and the address is simply not shown, because the passkey is created and usable regardless | None |
| Steps 3 and 4 (proof of wealth, pre-approval fee) | Built and walkable, but mocked: connecting a wallet attaches the reference's seed balances and paying flips local state. Neither touches a chain | Wallet connection and payment execution are excluded from Week 1 (contract section 9) | Week 2 (wallets, payments) |
| Dashboard figures | The pre-approved state is mocked: the fee receipt, the three attestations and the residency stages are the reference's demo values, labelled demo in the banner and a chip | Payments, attestations, the indexer and the Safe deployment are all out of Week 1, so none of those records exists | As each lands |
| Safe address in the dashboard | Withheld. Qualified holdings says no Safe is deployed rather than showing a locked balance | Nothing is deployed; an address here would be fabricated | Account gate |
| Fee shown in the web app | **Resolved.** Read from `fee_schedule` server-side; a client-supplied amount cannot change it, and an unreadable schedule disables payment rather than inventing a value | Superseded by the row above | Done |
| Vote, Holdings, Invest, Bank↔Crypto, Card | Rendered locked, not implemented | Out of Week 1 scope | Weeks 3–4 |
| Admin toggle | Rendered locked | Admin review UI is out of scope | Week 3 |
| KadeLock | Compiled and tested only; not deployed | Frozen model A; deployment is out of scope | Post-Week 1 |
| EAS schemas | **Registered on Ethereum Sepolia.** All five registered by the owner from `0x9907Edd6D403AC420cF1A84b10f0d134b13baa84`; the UIDs, transactions and blocks are recorded in `packages/contracts/eas/registered-uids.json`, and `npm run eas:verify` re-reads the registry and confirms each schema string, resolver and revocable flag against the manifest | Registration is irreversible; it was executed once the Onchain gate was approved. This repository still contains no broadcast path: the plan is generated and verified here, the transactions were sent by the owner | Done |
| Database tests (fee formula) | pgTAP suite `supabase/tests/0001_fee_recompute.test.sql` covers the formula, the recompute triggers, mode switching and the definer path; no RLS coverage | It proves only our own arithmetic, not row visibility, and is run by hand rather than by any gate. `pgtap` is available on the project, so it can also run there | When RLS enforcement needs a gate |
| RLS | Policies written and reviewed as SQL; no harness exercises row visibility | Enforcement is Postgres's; the removed RLS harness produced four review findings (contract v1.1) | Only if it earns its keep |
| Live Google sign-in | **Completed end to end by the project owner**: the session was established and restored. The redirect boundary was verified directly by the agent | Reported by the project owner, not independently reproduced by the agent | Done |
| Email magic link | Provider enabled and the form is live, and the agent's tests cover the send path, but no link has been delivered and followed | Depends on the project's SMTP and on a mailbox | First delivered link |
| Google OAuth provider | Enabled. The app also detects a disabled provider and says so instead of failing into raw JSON | — | Done |
| Supabase project | **Provisioned.** All 16 migrations and the seed are applied; 20 tables, RLS on every one, 10 deny-by-default, the fee function and its triggers verified live (`preapproval_fee_usdc('demo', 3)` = 1.75, `('production', 3)` = 447) | Project-supplied dependency | Applied 17 Sep |
| Migration 13 applied text vs committed file | **Declared divergence, not a defect.** The applied `passkey_credentials` statement omits the `comment on column public.passkey_credentials.signer_address` and `comment on column public.passkey_credentials.public_key` statements and the table comment's "Holds no private key and no raw attestation" wording that `20260916000013_passkey_credentials.sql` contains; the same apply additionally ran `select public.reset_demo_data();` and a count select the file does not contain. Confirmed live: `col_description('public.passkey_credentials'::regclass, …)` for `signer_address` is NULL. The committed file is the intended text | The divergence predates this iteration's work — every committed version of the file carries the comments — and correcting an already-applied migration means rewriting history or re-applying, neither of which a documentation pass does | Re-apply the committed file the next time the schema is reset |
| Migration 11 applied comment vs committed file | **Declared divergence, not a defect.** The live `comment on function public.save_onboarding_step2(...)` is shorter than the committed `20260916000011_save_onboarding.sql`: it lacks the "Replaces a sequence of browser-side PostgREST calls…" sentence. The committed file is the intended text | Predates this iteration's work, and the same history/re-apply constraint as migration 13 applies | Re-apply the committed file the next time the schema is reset |
| Migrations 02, 08 and 09 comments later contradicted | **Declared, accepted.** `20260916000002_applications.sql` and `20260916000008_config.sql` describe `preapprovalFeeUsdc()` in `@kade/shared` as "the single implementation" of the fee, and `20260916000009_rls.sql` says it is "the single place RLS is enabled"; migrations 10/13 later add `public.preapproval_fee_usdc()` and RLS for `passkey_credentials`, so the comments inside those files are now false | Those files were deliberately restored to their applied text rather than edited: the file must match the statement the database already ran, so the internal contradiction is the accepted cost. The corrections live in the later migrations (10, 15) and in this repository's docs | Reconcile when the migration set is next reset and comment-only corrections can be applied in order |
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

## Declared limitations of the `known-good` promotion

This section exists because `known-good` was moved to a commit that did **not**
pass adversarial review. It is written down so the tag cannot silently acquire a
meaning it does not have.

- **The promotion was an owner decision, not a passed gate.** The development
  contract requires *both* gates before `known-good` moves. Mechanical
  verification passed (`./scripts/verify.sh`, nine gates). The adversarial review
  did not: it failed ten times in this iteration, and at the tenth it still
  reported one blocking finding and three warnings. The owner chose to promote
  with the limitation declared rather than continue correcting. **The tag
  therefore means "mechanically verified, promoted by owner decision, review
  outstanding" — not the usual "both gates passed".** The contract has not been
  amended, so this deviation is recorded here rather than resolved.

- **The documentation sweep is manual, and it is not complete.** All ten failures
  were one semantic class: statements in live files contradicted by facts this
  iteration changed — Safe v1.5.0 decided, the deployment addresses recorded, the
  signer derived from the passkey, the proxy creation code read from the
  deploying factory. The reviews converged but never reached zero. **No
  mechanical check enforces this class.** That is the root cause: enumerating by
  keyword cannot catch a claim that is expressed without any of the keywords, and
  the ninth review found exactly such an instance. A regression guard was
  proposed for this and was not authorised, so the exposure remains.

- **The four instances the tenth review left uncorrected have since been fixed.**
  They were the last surviving statements contradicted by this iteration's
  changes, and a later `stale-claims` pass corrected each one against the code:

  | Location | Correction |
  |---|---|
  | `docs/architecture/kadelock-threat-model.md` §8 | The row label no longer lists `signer` among the deployment inputs; the row states it is derived per resident |
  | `packages/shared/src/safe.ts` | `SafeDeploymentInputs` no longer types `signer` as a `Sourced` input, because it is derived, not configured |
  | `docs/week-1-frozen-delivery-contract.md` §8.6 | The clause now says the Foundry test pins *this repository's* `SafeProxy` build, not the deployed factory's creation code |
  | `packages/shared/src/auth.ts` | The credential-metadata fact is now true: enrolment persists to `passkey_credentials`, so the metadata survives reload |

  The underlying exposure is unchanged: the sweep is still manual and no
  mechanical check enforces this class.
