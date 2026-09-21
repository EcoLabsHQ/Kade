# Kade MVP — Week 1 Delivery Contract

**Status:** Frozen v1.8 — human decisions recorded 16 September 2026; eight
amendments recorded in sections 8.1-8.8  
**Delivery window:** 14–20 September 2026  
**Execution allocation:** 20 human development/orchestration hours (parallel agent execution, not combined effort)  
**Parent plan:** 80-hour MVP execution plan  
**Week goal:** Account and pre-registration foundations on testnet (Ethereum Sepolia deploys; Base Sepolia predicted; Arbitrum deferred per section 8.6)

## 1. Contract interpretation

This contract covers development work only and covers **Week 1 only**. The 20-hour allocation measures hands-on human development, review, integration, and orchestration time with parallel agents; agent execution is expected and does not count against the 20 hours. It does not weaken the acceptance criteria.

No deliverable is accepted solely because code was generated, a mock is displayed, or an agent reports completion. Acceptance requires the evidence listed in this contract.

## 2. Frozen product decisions

All Week 1 decisions are frozen. This contract covers an **all-testnet iteration 1**; the target product chains remain Ethereum, Arbitrum, and Base.

1. The deployed MVP at `https://mvp.onchainisland.co/` is the visual and interaction baseline. Its source was unavailable when this contract was frozen; it has since been supplied and is vendored at `reference/design-handoff/` (section 6.1, resolved).
2. Google OAuth and email magic link through Supabase are the permitted application logins. There is no password authentication and no wallet login. (Amended v1.2; originally Google-only.)
3. The passkey is separate from the login session and is used only to authorize Safe transactions.
4. Google credentials cannot authorize financial transactions.
5. The signer implementation is the **direct Safe WebAuthn signer**. No managed embedded signer (Privy, Turnkey) in Week 1.
6. The resident Safe has one operational signer, the passkey, and threshold 1. No user EOA is an owner.
7. Iteration 1 runs entirely on testnet: the resident Safe is deployed on **Ethereum Sepolia**; the **Base Sepolia** address is counterfactually predicted and persisted. Arbitrum is deferred (section 8.6). No mainnet deployment in Week 1.
8. The five EAS schemas are `kade.kyc.v1`, `kade.fee.v1`, `kade.application.v1`, `kade.review.v1`, and `kade.permit.v1`.
9. The five schemas are registered on **Sepolia**, sent from the authorized Sepolia EAS registration account `0x9907Edd6D403AC420cF1A84b10f0d134b13baa84`. The Onchain gate approved the exact encodings on 18 September 2026 and the registrations were executed the same day; the repository's EAS tooling generates and verifies the plan and does not broadcast.
10. Supabase uses the full DOCX schema (every table in the DOCX data model) with RLS enabled or deny-by-default for unused tables.
11. The KadeLock Week 1 enforcement model is the **minimum Safe Guard/Module** (section 6.2).
12. Recovery is **excluded from Week 1**. The accepted product trust model is the Safe RecoveryHub, but it is not implemented in this contract.
13. The programme fees follow the DOCX §7 fee table (section 2.1).

### 2.1 Frozen fee model

Values are taken verbatim from the DOCX §7 fee table. Any parameter absent from the DOCX is an arbitrary demo value and is marked `[arbitrary]`.

| Function | Production | Demo (iteration 1) |
|---|---|---|
| Pre-approval fee | `XCG 500 + XCG 100 per household member` (household of 3 → `447 USDC`) | `1.00 USDC flat + 0.25 USDC per household member` (household of 3 → `1.75 USDC`) |
| Residency service fee | `2,000 USDC` | `10 USDC` |

- Demo formula: `preapproval_usdc = 1.00 + 0.25 × household_size`, where the DOCX "household of 3" yields `1.75`, so the applicant is included in the household size that drives the multiplier.
- Currency/rail: USDC.
- Resident pays on Ethereum; production treasury leg is Ethereum mainnet (testnet in iteration 1).
- Both fees are stored in the single `fee_schedule` table with a `mode` column (`demo | production`); a single environment variable selects the mode. No amount is hard-coded in the client.
- Week 1 computes and displays only the pre-approval fee. The service fee is seeded but not charged in Week 1.
- The demo fixture must reach `household_size = 3` to reproduce the DOCX `1.75 USDC` example (resolves Appendix B.2).

The fee is calculated server-side from the active `fee_schedule`; the client may display it but cannot override it.

## 3. Week 1 execution packages

| ID | Package | Hours | Backlog IDs | Contracted outcome |
|---|---|---:|---|---|
| EXE-001 | Project setup and Supabase environment | 3 | KAD-001 | Repository (private, reviewer access), README, license/prior-work disclosure, provider configuration, environment-variable contract, Supabase environments, and repeatable local setup are ready. The deployed MVP is the visual baseline; its source has since been supplied (section 6.1, resolved). |
| EXE-002 | Seed chains and fee schedule | 1 | KAD-002 | Ethereum `1`/Sepolia `11155111`, Arbitrum `42161`/Arbitrum Sepolia `421614`, and Base `8453`/Base Sepolia `84532`, token metadata, contract/config placeholders, and demo/production fee schedules are migration-seeded and readable by the application. Testnet is active for iteration 1. |
| EXE-003 | Connect shell, login, and passkey signer | 4 | KAD-003 | Sidebar/routes use a real Supabase session; Google login/logout and protected routes work; the independent transaction passkey can be created and restored after reload. |
| EXE-004 | Create Safe and predict L2 addresses | 3 | KAD-004 | One resident Safe is deployed on Ethereum Sepolia, stored against the resident, and displayed in the UI; the deterministic Base Sepolia address and all reproducibility inputs are persisted. Arbitrum is deferred (section 8.6). |
| EXE-005 | Connect profile, household, and fee calculation | 5 | KAD-005, KAD-006 | Steps 1–2 persist and restore applicant, citizenship, five-year residence, tier, and household data; the server-controlled configured fee (section 2.1) is recalculated and displayed. |
| EXE-006 | Register EAS schemas and establish KadeLock baseline | 4 | KAD-007, KAD-008 | Five reviewed schemas are registered on Sepolia and their UIDs are versioned; the frozen minimum KadeLock implementation compiles and its critical rules pass Foundry tests. |
|  | **Total** | **20** | **KAD-001–KAD-008** |  |

Hours are timeboxes, not permission to omit acceptance criteria silently. A package that cannot satisfy its criteria within its timebox must trigger the change-control clause.

## 4. High-level deliverables and acceptance evidence

### D1 — Development foundation

Accepted when:

- the repository exists and the reviewer has access (it is private; see section
  8.3);
- a clean checkout installs, builds, and starts using documented commands;
- README includes setup, architecture summary, third-party attribution, prior-work disclosure, and Week 1 limitations;
- secrets are excluded from source control;
- a shared HTTPS preview is available if approved by the human reviewer.

Evidence: repository URL with reviewer access, clean-build output, preview URL, and secret-scan result.

### D2 — Supabase schema, RLS, and seeds

Accepted when:

- migrations create the approved schema scope;
- residents cannot read or modify another resident's records;
- Safe, passkey, fee, and attestation security fields cannot be arbitrarily overwritten by the browser;
- `chains` and `fee_schedule` contain approved demo and production records;
- seeds and migrations run from a clean database.

Evidence: migration identifiers and seed output.

Frozen: the full DOCX schema is in scope, with RLS enabled or deny-by-default for unused tables.

### D3 — Application login and transaction signer

Accepted when:

- a clean browser can sign in through Google and restore the Supabase session after reload;
- protected routes reject unauthenticated access;
- login does not prompt for a passkey;
- a signed-in resident can create the transaction passkey with user verification;
- credential metadata required for future signing is stored securely and survives reload;
- a test signature validates through the direct Safe WebAuthn signer.

Evidence: integrated test report and recorded acceptance journey.

### D4 — Resident Safe and deterministic multichain address

Accepted when:

- a resident Safe is deployed on **Ethereum Sepolia**;
- the direct Safe WebAuthn signer is the only operational owner and threshold is 1;
- no user EOA is an owner;
- Ethereum Sepolia and Base Sepolia calculations produce the same Safe address using frozen deployment inputs (Arbitrum deferred, section 8.6);
- the Sepolia transaction, Safe address, predicted L2 addresses, Safe version, factory, singleton, initializer, handler, owner, threshold, salt, and creation-code assumptions are stored;
- an automated deterministic-address test passes.

Evidence: Sepolia explorer link, persisted account record, deployment manifest, and test output.

### D5 — Steps 1–2 live on the recreated UI

Accepted when the UI (recreated to match the deployed baseline) persists, validates, reloads, and displays:

- basic profile and date of birth;
- multiple citizenships;
- residences covering the required five-year period;
- selected tier;
- household members;
- server-calculated pre-approval fee from the active fee schedule.

The client may display the fee but cannot override its authoritative value.

Evidence: clean-browser end-to-end test covering initial entry, validation, save, reload, edit, and fee recalculation.

### D6 — Sepolia EAS schema registrations

Accepted when all five exact schema encodings, revocability settings, resolver choices, attester rules, and recipients have been reviewed before registration. Fields come from the DOCX; any field absent from the DOCX is an `[arbitrary]` demo value flagged as such. Their Sepolia UIDs and explorer links must be stored in configuration and documented.

Evidence: reviewed schema manifest, five UIDs, transaction links, and verification script output comparing registry values with the manifest.

### D7 — Tested KadeLock baseline

Accepted when the implementation model is frozen, the contract compiles, and Foundry tests prove the approved Week 1 policy. At minimum, tests must cover unauthorized configuration changes, lock enforcement before `unlockAt`, permitted destinations, rejected destinations, and post-unlock behavior.

Compliance co-signing, cure-event behavior, and bypass tests are outside the Week 1 minimum model (section 6.2) unless later added through change control.

Evidence: contract interface, threat assumptions, Foundry test names, and passing test output.

### D8 — Integrated Week 1 gate

From a clean browser and clean test resident, the reviewer can:

1. sign in with Google;
2. create the transaction passkey;
3. create or retrieve the Ethereum Sepolia Safe;
4. verify matching Ethereum Sepolia and Base Sepolia addresses;
5. complete Steps 1–2;
6. observe the correct fee;
7. reload and recover application state;
8. inspect the EAS UIDs;
9. inspect a passing KadeLock test report.

No manual database edits or fixture-only state are permitted during this journey.

## 5. Development dependencies supplied by the project

The delivery clock assumes Day 1 access to:

- a Supabase project and service configuration;
- Google OAuth credentials and an approved HTTPS callback domain;
- Sepolia and Base Sepolia RPC access (Arbitrum deferred, section 8.6);
- a funded Sepolia deployment account;
- a funded Sepolia deployment account (the Safe version and addresses are recorded in `@kade/shared`; the signer is derived from the passkey, not supplied);
- an authorized Sepolia EAS registration account;
- DOCX fee parameters and the five EAS schema field definitions;
- the deployed MVP UI at `https://mvp.onchainisland.co/` as the visual baseline.

Not supplied: the MVP UI source repository (section 6.1). Recovery configuration is not required (section 6.3).

Missing dependencies trigger change control; they do not convert testnet acceptance into mock acceptance automatically.

## 6. Resolved items and change-control escalations

### 6.1 UI source repository — **resolved**

**Resolved 17 September 2026 by option 1: the source was supplied.**

The MVP UI source code was recorded as unavailable, and only the deployment at
`https://mvp.onchainisland.co/` existed. In the meantime the deployed bundle was
parsed and its markup and component logic recovered, and the project then
supplied the official design handoff — the spec, the prototype source, 34
screenshots and the logo — which is vendored at `reference/design-handoff/`
with its provenance recorded there.

The escalation is therefore closed under option 1 rather than by reallocating
hours or re-scoping D3/D5. D3 and D5 are no longer at risk under this item.

The escalation and the recovery are both recorded rather than deleted, because
the recovery is what makes the recreated screens defensible as a port of the
frozen baseline rather than an interpretation of it.

### 6.2 KadeLock enforcement model — confirm

The recommendation for the 20-hour budget was **A) minimum Safe Guard/Module**, and no contrary answer was recorded for KadeLock; the answer provided addressed the Aave vault (a Week 3 item). This contract freezes A; the Onchain gate confirmed the interface and threat model on 18 September 2026 (`docs/gates/onchain.md`). KadeLock is not deployed on-chain in Week 1 (compiled and Foundry-tested only, per section 9).

### 6.3 Recovery — resolved

Recovery is **excluded from Week 1**. The accepted product trust model is the Safe RecoveryHub, scheduled for a later week. No recovery hours are included in EXE-001–EXE-006, and no recovery deliverable is accepted or rejected under this contract.

### 6.4 Aave vault — out of scope, note for later weeks

The product will use a simple wrapper around Aave vaults, and the human holds source code to supply to the agents at implementation time. This is Week 3 scope and is not part of this Week 1 contract.

## 7. Agent orchestration and human approval gates

### Agent workstreams

- **Foundation/Data agent:** EXE-001, EXE-002, migrations, seeds, shared types.
- **Identity/Account agent:** EXE-003 and EXE-004, signer metadata, Safe initializer, deployment, deterministic-address test.
- **Onboarding agent:** EXE-005, recreated Step 1–2 screens matching the deployed baseline, persistence, validation, fee display.
- **Onchain agent:** EXE-006, EAS manifest/registration tooling, KadeLock and Foundry tests.
- **Integration owner:** interface control, reviews, evidence bundle, and D8 acceptance journey.

### Mandatory human checkpoints

1. **Foundation gate:** repository shape, environment contract, schema/RLS matrix, and shared types approved before feature integration.
2. **Account gate:** authentication separation, passkey implementation, Safe initializer, and deterministic deployment inputs approved before Sepolia deployment.
3. **Onchain gate:** exact EAS encodings and KadeLock interface/threat model approved before irreversible registration or contract implementation.
4. **Acceptance gate:** a human executes D8 and reviews the evidence bundle before Week 1 is declared complete.

Agents may prepare proposals and code before a gate, but may not perform irreversible on-chain writes before the corresponding approval.

## 8. Change control

Any change affecting authentication, Safe ownership, deterministic deployment inputs, recovery authority, EAS schema encoding, KadeLock enforcement, database security, or the 20-hour allocation requires explicit human approval.

If a timebox is exhausted:

1. the agent records completed evidence and the unmet acceptance criterion;
2. the integration owner identifies the smallest hour reallocation inside the 80-hour plan;
3. no deliverable is silently downgraded, mocked, or marked complete;
4. the human approves the reallocation, scope change, or schedule change.

### 8.1 Amendment log

**v1.1 — 16 September 2026. Approved by the project owner.**

Removed the "automated RLS tests" evidence requirement from D2. Row level
security remains a required deliverable and is unchanged: the policies, the
deny-by-default stance for unused tables, the withheld write privileges on
security-critical columns, and the apply-time guard that fails the migration on
an unprotected table. What is no longer required is a committed test harness to
prove them. Enforcement of RLS is Postgres's, configured through Supabase, and
the policy set is reviewed as SQL.

Affected clauses:

| Clause | Before | After |
|---|---|---|
| Section 4, D2 evidence | migration ids, seed output, automated RLS tests | migration ids and seed output |
| Section 7, Foundation/Data workstream | migrations, seeds, RLS tests, shared types | migrations, seeds, shared types |
| Appendix A, D2 row | Migrations and RLS test report | Migrations and seed output |
| Appendix C, A1 must-return | migrations, seeds, RLS tests, … | migrations, seeds, … |

Rationale, for the record: a committed RLS harness produced four review findings
across three corrective rounds — every one of them a failing or erroring suite
being reported as success — while adding no protection beyond what the policies
already provide. It was removed rather than patched a fourth time, and this
contract was amended to match rather than left with a knowingly unmet
acceptance criterion.

### 8.2 Amendment v1.2 — login methods

**v1.2 — 17 September 2026. Approved by the project owner.**

Added **email magic link** as a second permitted login alongside Google OAuth.
Password authentication and wallet login remain excluded.

Affected clauses:

| Clause | Before | After |
|---|---|---|
| Section 2, item 2 | Google OAuth is the only application login; no email OTP fallback | Google OAuth and email magic link are the permitted logins; no password, no wallet |
| Section 10, freeze checklist | Google-only versus email fallback — Google only | Login methods — Google and email magic link |
| Appendix B.1 | Resolved: Google-only login | Resolved: Google and email magic link |
| Appendix C, A2 inputs | approved login method (Google-only) | approved login methods (Google OAuth and email magic link) |

What this does **not** change, and why the amendment is safe:

- The passkey remains the only transaction authority; the sign-in flow still
  must not prompt for one (D3).
- A session — from either provider — confers row access and nothing else, and
  cannot authorise a transaction. That separation, not the identity of the
  provider, is the property this contract protects.
- The resident Safe still has exactly one owner (the passkey signer) and
  threshold 1; no EOA is an owner.

Rationale, for the record: Google OAuth requires a Google Cloud OAuth client,
which is the project's to create, and a single-provider login was a startup
risk for the demo. Mail delivery is handled by the project's own SMTP provider
(Resend), so the magic link does not depend on Supabase's rate-limited built-in
mailer. The design handoff's own Step 1 was email-based, so this restores the
baseline rather than departing from it.

### 8.3 Amendment v1.3 — the repository stays private

**v1.3 — 18 September 2026. Approved by the project owner.**

Removed the requirement that the repository be public. It stays private, and
the reviewer is given access instead.

Affected clauses:

| Clause | Before | After |
|---|---|---|
| Section 3, EXE-001 outcome | Public repository, README, disclosure, ... | Repository (private, reviewer access), README, disclosure, ... |
| Section 4, D1 heading | Public development foundation | Development foundation |
| Section 4, D1 accepted-when | the repository is public | the repository exists and the reviewer has access |
| Section 4, D1 evidence | repository URL | repository URL with reviewer access |
| Appendix A, D1 row | Public repo with README and disclosure | Repo with README and disclosure |

What this does **not** change:

- the licence and the prior-work disclosure remain required, and the contracts
  are still intended to be MIT (an open decision recorded in the build guide,
  section 15);
- EAS schema UIDs are still published so a third party can verify a Kade permit
  attestation independently — that is public *on-chain*, which is unaffected by
  the repository's visibility;
- secrets are still excluded from source control.

Rationale, for the record: the hackathon's own rules permit a private
repository ("Repo may be private"), and the owner has chosen to keep it private.
The submission's open-source and composability signal is carried by the
published schemas and the licence rather than by repository visibility.

### 8.4 Amendment v1.4 — the §6.1 escalation is closed

**v1.4 — 18 September 2026. Approved implicitly by the project supplying the
design handoff; recorded here so the contract does not carry a stale risk.**

Section 6.1 required a human choice among three options for the unavailable MVP
UI source. The project supplied the source (option 1), so section 6.1 is marked
resolved and D3/D5 are no longer flagged at risk.

No acceptance criterion changed. This is a status correction to a record that
would otherwise claim an open risk that no longer exists.

### 8.5 Amendment v1.5 — credential metadata gets a home, and the Safe version

**v1.5 — 18 September 2026. Approved by the project owner.**

Two decisions recorded together, because both were blocking D3 and D4.

**1. `passkey_credentials` is added to the schema.** D3 requires the credential
metadata needed for future signing to be stored securely and to survive a
reload. The DOCX section 9 data model has no table for it — `wallets` covers
self-custodied EOAs and Bitcoin xpubs, which a WebAuthn credential is not — so
the metadata had nowhere to live and did not survive a reload. The table stores
the credential id, the credential's public key (base64url SubjectPublicKeyInfo,
not a COSE key), the authenticator transports, whether enrolment required user
verification, and the derived `signer_address`.
It stores no private key and no raw attestation object. RLS is on: a resident
may read their own credential and propose one, while `signer_address` is
server-written because it is derived from the public key and the frozen Safe
inputs.

**2. The active Safe release is v1.4.1, not the latest v1.5.0.** *(Superseded by
v1.6: the owner then chose v1.5.0 and dropped Arbitrum, which is what made
v1.5.0 usable. Kept as the record of the decision taken at v1.5.)* Safe v1.5.0 is
not deployed on Arbitrum Sepolia (chain 421614): its published deployment file
carries no entry for that chain, while v1.4.1's does. D4 requires one address
across Ethereum Sepolia, Arbitrum Sepolia and Base Sepolia, so v1.5.0 cannot
satisfy D4. v1.4.1 also has its `SafeProxy` creation code pinned by a Foundry
test in this repository, which is what lets the address derivation be checked
against a fixed vector. Moving to v1.5.0 is a configuration change once the
target set drops a chain it does not cover, or once Safe deploys it there.

The addresses for both versions, their code hashes, and the passkey module's
signer factory and P-256 verifier are recorded in
`packages/shared/src/safe-deployments.ts`, sourced from Safe's own published
deployments.

### 8.6 Amendment v1.6 — Safe v1.5.0, and Arbitrum deferred

**v1.6 — 18 September 2026. Approved by the project owner.**

Iteration 1 uses **Safe v1.5.0**, and **Arbitrum is dropped from the active
chain set**. The two decisions are joined: v1.5.0 has no Arbitrum Sepolia
deployment, so it could not be adopted while Arbitrum Sepolia was in scope.

Affected clauses:

| Clause | Before | After |
|---|---|---|
| Section 2, item 7 | Ethereum Sepolia deployed; Arbitrum Sepolia and Base Sepolia predicted | Ethereum Sepolia deployed; Base Sepolia predicted; Arbitrum deferred |
| Section 4, D4 | Same address across three testnets | Same address across the two active testnets |
| Active Safe release | v1.4.1 (the newest deployed on all three testnets) | v1.5.0 (the latest release) |

What does **not** change:

- the Safe still has one owner, the direct WebAuthn signer, at threshold 1, with
  no EOA owner;
- the address is still derived with the chain-agnostic `createProxyWithNonce`,
  so it does not depend on the chain id;
- Arbitrum remains a target product chain. Its definitions stay in the registry
  and `deferredChains()` returns them, so re-enabling it is a configuration
  change and no code has to pretend the chain does not exist.

Evidence for the version choice, from Safe's own published deployments: the
v1.5.0 `safe_l2` deployment file has no entry for chain 421614, while v1.4.1's
does. Both are deployed on 11155111 and 84532. The addresses, their code hashes,
the passkey module's signer factory and P-256 verifier, and the v1.5.0
`SafeProxy` creation code built by this repository are recorded in
`packages/shared/src/safe-deployments.ts`. That recorded build is *not* the code
the deployed factory uses: `SafeAddress.t.sol` pins this repository's build so a
toolchain change is caught, while the application reads `proxyCreationCode()`
from the deployed factory at runtime, and the deployed code is recorded
separately in the same module.

### 8.7 Amendment v1.7 — read-only Bitcoin proof-of-wealth, and empty-first profile entry

**v1.7 — 21 September 2026. Approved by the project owner. Week 2 change
control onto the frozen Week 1 contract.**

Bitcoin address reads are in scope, read-only and unverified. A signed-in
resident may add up to **5** Bitcoin addresses. The server validates the
address, reads its balance and the BTC/USD price from a single public
Esplora-compatible source (`mempool.space`), and returns the USD value. There
is **no signature, no wallet connection, and no ownership proof**; the UI states
the balance was read from a public source and is not evidence of control.

Addresses are persisted. Rows live in the existing `public.wallets` table:
`address`, `chain = 0` (the `[arbitrary]` sentinel — the DOCX documents `chain`
as an EVM chain id, and Bitcoin has none), `provider = 'bitcoin-address'`, and
`siwe_sig`/`verified_at` left NULL, which is the documented "unverified"
meaning. RLS is enabled with an owner-only policy; the resident may
insert/select/delete their own rows, and a unique index on
`(profile_id, address, chain)` makes a repeat idempotent. There is **no new
table and no new column**, so no schema field is invented — the amendment
extends the meaning of two `wallets` columns whose encodings were already
`[arbitrary]`. The migration file is
`supabase/migrations/20260921000001_bitcoin_wallet_addresses.sql`.

Only Bitcoin, and only one provider. EVM wallet connection (browser extension /
WalletConnect), the "Wallet address (0x)" multi-chain block, DeBank, hardware
wallets, and background balance aggregation/indexing remain out of scope. The
browser-extension and WalletConnect rows stay demo and are labelled demo; the
hardware-wallet row is removed.

Section 9 is narrowed in two places, and both are stated there in full:
"external wallet connection and proof-of-wallet ownership" becomes external
wallet *connection* and *ownership proof* excluded while read-only, unverified,
address-based Bitcoin balance reads are in scope; "balance aggregation and
indexer" becomes a background aggregator/indexer excluded while a single
on-demand, server-proxied read per address is in scope.

Step 2 starts empty. The profile form opens empty, matching the design handoff
("Everything starts empty"); the earlier example prefill is removed. The
applicant, citizenship, five-year residence, tier and household groups all
remain mandatory; `Continue` is always actionable and marks the missing groups
instead of being disabled. Date of birth uses a styled date picker.

Acceptance criteria. D5 evidence now also covers entry from empty, validation
marking, and the date picker. D6, D7 and D8 are unaffected; the D8 journey is
unchanged (sign-in → passkey → Sepolia Safe → matching Sepolia/Base Sepolia
addresses → Steps 1–2 → fee → reload → EAS UIDs → KadeLock report).

Affected clauses:

| Clause | Before | After |
|---|---|---|
| Section 9, exclusions | external wallet connection and proof-of-wallet ownership | external wallet connection and ownership proof excluded; read-only, unverified, address-based Bitcoin balance reads in scope |
| Section 9, exclusions | balance aggregation and indexer | a background aggregator/indexer excluded; a single on-demand, server-proxied read per address in scope |
| Section 4, D5 evidence | clean-browser end-to-end test covering initial entry, validation, save, reload, edit, and fee recalculation | adds entry from empty, validation marking, and the styled date picker |
| Schema, `public.wallets` | `chain` used only as an EVM chain id | `chain = 0` and `provider = 'bitcoin-address'` mark up to 5 read-only Bitcoin addresses per resident, unverified |

What this does **not** change:

- D6, D7 and D8, including the D8 journey;
- the passkey remains the only transaction authority, and no session, address
  or balance read can authorise a transaction;
- `public.wallets` keeps its existing shape — no table and no column is added;
- payment execution, the EVM multi-chain block, DeBank, hardware wallets, and
  the indexer remain excluded.

Evidence: the migration file and its owner-only RLS policy; the server-side
provider client (address validation, balance math, provider-error handling);
the server actions; unit tests; the persisted rows; and the on-screen "read
from a public source, not proof of ownership" statement.

### 8.8 Amendment v1.8 — pasted EVM addresses, and the proof-of-wealth row layout

**v1.8 — 21 September 2026. Approved by the project owner. Week 2 change
control onto the frozen Week 1 contract.**

Pasted EVM addresses are in scope, read-only and unverified. A signed-in
resident may paste up to **5** EVM (`0x…`) addresses. The server validates the
address format, reads each address's **native coin balance** on the product
chains' **mainnets** (Ethereum and Base) from a public Blockscout-compatible
explorer API, and returns the balance and its USD value (from the explorer's
native-coin price). There is **no signature, no wallet connection, and no
ownership proof**; the UI states the balance was read from a public source and
is not evidence of control. Rationale, for the record: proof-of-wealth is about
real assets, so the read-only balance query targets mainnet even though
iteration 1 deploys only on testnets — a read moves nothing and is not a
deployment.

Persistence. Rows live in the existing `public.wallets` table, **one row per
(address, chain)** — the table's documented "one row per chain the EOA is read
on" shape — with `provider = 'pasted-address'` and `siwe_sig`/`verified_at`
NULL (unverified). There is **no new table and no new column**. The 5-address
cap in migration 20's trigger is extended to cover both encodings: 5 rows for
Bitcoin (`chain = 0`) and 5 **distinct addresses** for pasted EVM rows
(`chain <> 0`), idempotent on a repeat. A new `delete_wallet_addresses(p_address)`
RPC removes the caller's own rows for one address. The migration file is
`supabase/migrations/20260921000002_evm_wallet_addresses.sql`.

Wallet connection remains excluded. No wallet-connection package is added and
no real wallet connection is implemented (project-owner decision, 21 September
2026): the browser-extension and WalletConnect rows stay demo and are labelled
demo. Only pasted addresses (Bitcoin and EVM) are read.

Multi-token and other chains stay out. ERC-20/token balances (including USDC),
and balances on Arbitrum, Optimism and Celo, are not read in this iteration; the
chain list is data, so they can be added by configuration later.

Row layout parity. The Bitcoin and wallet-address rows present the same
collapsed row shape as the mockup (badge, title, subtitle, right-hand `Connect`
pill) and expand in place to the paste-and-confirm flow; the WalletConnect mark
is corrected to the official geometry.

Section 9 is narrowed again, for the read path only: a single on-demand,
server-proxied, read-only balance read per pasted address is in scope, for
Bitcoin **and** pasted EVM addresses, while external wallet connection,
ownership proof, and a background indexer/aggregator remain excluded.

Acceptance criteria. D5's evidence is unchanged in substance. Nothing in D6, D7
or D8 changes, and the D8 journey is unchanged (sign-in → passkey → Sepolia
Safe → matching Sepolia/Base Sepolia addresses → Steps 1–2 → fee → reload → EAS
UIDs → KadeLock report).

Affected clauses:

| Clause | Before | After |
|---|---|---|
| Section 9, exclusions | read-only, unverified, address-based Bitcoin balance reads in scope (v1.7) | read-only, unverified, address-based Bitcoin **and** pasted EVM balance reads in scope (v1.8) |
| Section 9, exclusions | a single on-demand, server-proxied read per address in scope | the in-scope read covers Bitcoin and pasted EVM addresses; external wallet connection, ownership proof, and the background aggregator/indexer stay excluded |
| Schema, `public.wallets` | up to 5 read-only Bitcoin addresses per resident (`chain = 0`, `provider = 'bitcoin-address'`) | plus up to 5 read-only pasted EVM addresses per resident, one row per `(address, chain)` (`chain <> 0`, `provider = 'pasted-address'`) |
| UI, proof-of-wealth rows | Bitcoin rows use the collapsed mockup row shape | Bitcoin and pasted-EVM rows share the collapsed shape and expand to the paste-and-confirm flow; the WalletConnect mark uses the official geometry |

What this does **not** change:

- D6, D7 and D8, including the D8 journey;
- the passkey remains the only transaction authority, and no session, address
  or balance read can authorise a transaction;
- `public.wallets` keeps its existing shape — no table and no column is added;
- no wallet-connection package is added and no real wallet connection is
  implemented;
- ERC-20/token balances, other chains, payment execution, the EVM multi-chain
  block, DeBank, hardware wallets, and the indexer remain excluded.

Evidence: the migration file and the extended 5-address cap; the server-side
provider client and its unit tests; the server actions; the persisted rows; and
the on-screen "read from a public source, not proof of ownership" statement.

## 9. Explicit Week 1 development exclusions

Unless introduced through change control, Week 1 excludes:

- external wallet connection and proof-of-wallet ownership *(narrowed by
  section 8.7 / v1.7: external wallet connection and ownership proof stay
  excluded; read-only, unverified, address-based Bitcoin balance reads are in
  scope)*;
- pre-approval payment execution and Treasury transfer;
- paymaster policy beyond what is strictly required to deploy the Week 1 Safe;
- balance aggregation and indexer *(narrowed by section 8.7 / v1.7: a
  background aggregator/indexer stays excluded; a single on-demand,
  server-proxied read per address is in scope; narrowed again by section 8.8 /
  v1.8: the in-scope read covers Bitcoin and pasted EVM addresses, while
  external wallet connection, ownership proof and the background
  aggregator/indexer remain excluded)*;
- L2 Safe deployment;
- Aave vault deployment/integration;
- full KYC/Self verification flow;
- admin review UI and `kade.review.v1` issuance;
- GOS, CCTP, card, investment, voting, and production release work.

These exclusions do not remove schema registration or interfaces explicitly required by D1–D8.

## 10. Freeze checklist

Freeze status at v1.0:

- [x] meaning of the 20-hour allocation — human development/orchestration hours with parallel agents.
- [x] authoritative UI source repository — **supplied; section 6.1 resolved** (option 1).
- [x] Login methods — Google OAuth and email magic link. Password and wallet excluded. (Amended v1.2; originally Google-only.)
- [x] direct Safe WebAuthn versus managed embedded signer — direct Safe WebAuthn signer.
- [x] full versus partial Supabase schema scope — full DOCX schema, RLS/deny-by-default.
- [x] Safe deployment network — all-testnet iteration 1: deploy on Ethereum Sepolia; predict Base Sepolia. Arbitrum deferred (section 8.6).
- [x] Safe deployment parameters — frozen per section 4, D4.
- [x] exact Step 1–2 fields and fee formula — section 2.1.
- [x] five EAS schema encodings and registration authority — DOCX fields, approved at the Onchain gate 18 September 2026 and registered on Ethereum Sepolia the same day (UIDs in `packages/contracts/eas/registered-uids.json`).
- [x] KadeLock enforcement model — frozen as A (minimum Guard/Module), confirmed at the Onchain gate 18 September 2026 (section 6.2).
- [x] Recovery option — excluded from Week 1 (section 6.3).
- [ ] shared HTTPS preview requirement — pending explicit approval.
- [ ] all Day 1 dependencies — pending availability confirmation.
- [x] 20-hour package allocation and Week 1 integrated journey — EXE-001–EXE-006, 20 hours.

This contract is **Frozen v1.8** with the open items above tracked under change control.

## Appendix A — Requirement traceability

| DOCX Week 1 requirement | Backlog | 80h package | Contract deliverable | Required proof | Status |
|---|---|---|---|---|---|
| Repo with README and disclosure | KAD-001 | EXE-001 | D1 | Repository URL (private, reviewer access), clean build, README/disclosure | Covered; private per section 8.3 |
| Sidebar shell | KAD-003 | EXE-003 | D3, D8 | Protected navigation operating on real session state | Covered; source unavailable (6.1) |
| Supabase schema and RLS | KAD-001, KAD-005, KAD-006 | EXE-001, EXE-005 | D2 | Migrations and seed output | Frozen: full DOCX schema |
| `fee_schedule` and `chains` seeded | KAD-002 | EXE-002 | D2 | Reproducible seed output and API/config read | Covered; testnet active |
| Passkey Safe on Ethereum Sepolia | KAD-003, KAD-004 | EXE-003, EXE-004 | D3, D4 | Transaction, owner/threshold inspection, signature test | Frozen: direct Safe WebAuthn |
| Reserved L2 addresses | KAD-004 | EXE-004 | D4 | Deterministic-address test and deployment manifest | Covered as predicted, not deployed |
| Steps 1–2 live | KAD-005, KAD-006 | EXE-005 | D5, D8 | Clean-browser persistence and fee test | Frozen: section 2.1 |
| EAS schemas registered on Sepolia | KAD-007 | EXE-006 | D6 | Five UIDs, transactions, registry verification | Frozen: DOCX fields |
| KadeLock compiled and Foundry-tested | KAD-008 | EXE-006 | D7 | Interface, threat model, passing tests | Frozen as A; confirmed 6.2 on 18 Sep 2026 |

The DOCX submission-work column—team registration, kickoff attendance, Discord communication, and the Monday update video—is not development scope and is intentionally absent from the 20-hour contract.

## Appendix B — Source inconsistencies and resolutions

1. DOCX Step 1 says “Email + passkey, or an existing wallet”; the product decision is Supabase login with a transaction-only passkey and no EOA login. **Resolved:** Google OAuth and email magic link are the permitted logins (amended v1.2, matching the design handoff's original email-based Step 1); the passkey is transaction-only and no EOA can log in.
2. DOCX fee table says `1 USDC flat + 0.25 USDC per household member`, while the demo script jumps to `1.75 USDC`. **Resolved:** formula `1.00 + 0.25 × household_size`; the `1.75` example corresponds to a household of 3 (section 2.1).
3. DOCX account architecture permits Privy or Safe WebAuthn. **Resolved:** direct Safe WebAuthn signer.
4. DOCX calls KadeLock a Safe Guard/Module and also a qualified vault. **Resolved:** Week 1 model is the minimum Safe Guard/Module (confirmed at the Onchain gate, 18 September 2026).
5. DOCX requires “Supabase schema + RLS” without scoping the tables. **Resolved:** full DOCX schema, RLS/deny-by-default.
6. DOCX requires a sponsored mainnet Safe in Week 1 while the paymaster package is Week 2. **Resolved:** iteration 1 is testnet-only on Ethereum Sepolia; the deployment payer is the project’s Sepolia account. Mainnet sponsorship is deferred with the paymaster work.

## Appendix C — Agent task contracts

These briefs become executable only after their corresponding human approval gate is approved.

### A1 — Foundation and data

**Inputs:** approved repository, environment contract, schema scope, RLS matrix, chain metadata, fee formula.  
**Work:** EXE-001 and EXE-002 plus the database portion of EXE-005.  
**Must return:** migrations, seeds, generated/shared types, setup documentation, and an evidence manifest.  
**Must not decide:** authentication provider, Safe fields, fee semantics, or reviewer permissions not present in the approved matrix.

### A2 — Identity and account

**Inputs:** approved login methods (Google OAuth and email magic link, per section 2 item 2 as amended v1.2), direct Safe WebAuthn signer, Safe deployment manifest template, and Sepolia deployment payer.  
**Work:** EXE-003 and EXE-004.  
**Must return:** login/session implementation, passkey enrollment and verification, Sepolia Safe deployment record, deterministic L2 test, and evidence manifest.  
**Must not decide:** Safe version, owners, threshold, salt, fallback handler, or credential-storage policy.

### A3 — Onboarding

**Inputs:** approved Step 1–2 field contract, validation rules, fee formula (section 2.1), database types, and the design handoff as the visual baseline (section 6.1, resolved).  
**Work:** UI/application portion of EXE-005.  
**Must return:** shell and Steps 1–2 that match the deployed baseline, persistence, validation, server fee calculation integration, end-to-end tests, and evidence manifest.  
**Must not redesign:** navigation, visual language, onboarding sequence, fee formula, or applicant/household semantics.

### A4 — Onchain core

**Inputs:** approved EAS manifest and attester model; approved KadeLock interface, roles, and threat model.  
**Work:** EXE-006.  
**Must return:** registration script and verification script, five Sepolia UIDs/transactions, contract source, Foundry tests, and evidence manifest.  
**Must not perform:** EAS registration before human approval, invent schema fields, weaken KadeLock rules, or deploy KadeLock in Week 1 unless separately approved.

### Integration owner

**Inputs:** outputs and evidence from A1–A4.  
**Work:** interface review, integration, D8 journey, defect routing, and final traceability update.  
**Must return:** one evidence index mapping every Appendix A row to authoritative proof, together with hours consumed per EXE package.  
**May not mark complete:** any requirement whose proof is missing, mock-only, off-testnet when testnet is required, or dependent on manual database edits.

## Appendix D — Evidence manifest template

Each agent must report:

| Field | Required content |
|---|---|
| Package | EXE identifier and backlog IDs |
| Commit | Immutable commit SHA |
| Hours | Human/orchestration time consumed |
| Tests | Commands and exact results |
| Runtime proof | Preview URL, explorer URL, UID, address, or migration identifier as applicable |
| Acceptance mapping | Contract criterion proved by each artifact |
| Known limitations | Any unmet or partially proven criterion |
| Security notes | Secrets handling, authority assumptions, and irreversible actions |
| Reviewer | Human approval and timestamp |
