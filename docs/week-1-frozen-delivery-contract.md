# Kade MVP — Week 1 Delivery Contract

**Status:** Frozen v1.0 — human decisions recorded 16 September 2026  
**Delivery window:** 14–20 September 2026  
**Execution allocation:** 20 human development/orchestration hours (parallel agent execution, not combined effort)  
**Parent plan:** 80-hour MVP execution plan  
**Week goal:** Account and pre-registration foundations on testnet (Ethereum Sepolia; Arbitrum Sepolia and Base Sepolia reserved)

## 1. Contract interpretation

This contract covers development work only and covers **Week 1 only**. The 20-hour allocation measures hands-on human development, review, integration, and orchestration time with parallel agents; agent execution is expected and does not count against the 20 hours. It does not weaken the acceptance criteria.

No deliverable is accepted solely because code was generated, a mock is displayed, or an agent reports completion. Acceptance requires the evidence listed in this contract.

## 2. Frozen product decisions

All Week 1 decisions are frozen. This contract covers an **all-testnet iteration 1**; the target product chains remain Ethereum, Arbitrum, and Base.

1. The deployed MVP at `https://mvp.onchainisland.co/` is the visual and interaction baseline. Its source code is **not available** (see section 6.1).
2. Google OAuth through Supabase is the only application login. No email OTP fallback in Week 1.
3. The passkey is separate from the login session and is used only to authorize Safe transactions.
4. Google credentials cannot authorize financial transactions.
5. The signer implementation is the **direct Safe WebAuthn signer**. No managed embedded signer (Privy, Turnkey) in Week 1.
6. The resident Safe has one operational signer, the passkey, and threshold 1. No user EOA is an owner.
7. Iteration 1 runs entirely on testnet: the resident Safe is deployed on **Ethereum Sepolia**; the **Arbitrum Sepolia** and **Base Sepolia** addresses are counterfactually predicted and persisted. No mainnet deployment in Week 1.
8. The five EAS schemas are `kade.kyc.v1`, `kade.fee.v1`, `kade.application.v1`, `kade.review.v1`, and `kade.permit.v1`.
9. The five schemas are registered on **Sepolia** with an authorized Sepolia EAS registration account.
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
| EXE-001 | Project setup and Supabase environment | 3 | KAD-001 | Public repository, README, license/prior-work disclosure, provider configuration, environment-variable contract, Supabase environments, and repeatable local setup are ready. The deployed MVP is the visual baseline; its source is not available (section 6.1). |
| EXE-002 | Seed chains and fee schedule | 1 | KAD-002 | Ethereum `1`/Sepolia `11155111`, Arbitrum `42161`/Arbitrum Sepolia `421614`, and Base `8453`/Base Sepolia `84532`, token metadata, contract/config placeholders, and demo/production fee schedules are migration-seeded and readable by the application. Testnet is active for iteration 1. |
| EXE-003 | Connect shell, login, and passkey signer | 4 | KAD-003 | Sidebar/routes use a real Supabase session; Google login/logout and protected routes work; the independent transaction passkey can be created and restored after reload. |
| EXE-004 | Create Safe and predict L2 addresses | 3 | KAD-004 | One resident Safe is deployed on Ethereum Sepolia, stored against the resident, and displayed in the UI; deterministic Arbitrum Sepolia and Base Sepolia addresses and all reproducibility inputs are persisted. |
| EXE-005 | Connect profile, household, and fee calculation | 5 | KAD-005, KAD-006 | Steps 1–2 persist and restore applicant, citizenship, five-year residence, tier, and household data; the server-controlled configured fee (section 2.1) is recalculated and displayed. |
| EXE-006 | Register EAS schemas and establish KadeLock baseline | 4 | KAD-007, KAD-008 | Five reviewed schemas are registered on Sepolia and their UIDs are versioned; the frozen minimum KadeLock implementation compiles and its critical rules pass Foundry tests. |
|  | **Total** | **20** | **KAD-001–KAD-008** |  |

Hours are timeboxes, not permission to omit acceptance criteria silently. A package that cannot satisfy its criteria within its timebox must trigger the change-control clause.

## 4. High-level deliverables and acceptance evidence

### D1 — Public development foundation

Accepted when:

- the repository is public;
- a clean checkout installs, builds, and starts using documented commands;
- README includes setup, architecture summary, third-party attribution, prior-work disclosure, and Week 1 limitations;
- secrets are excluded from source control;
- a shared HTTPS preview is available if approved by the human reviewer.

Evidence: repository URL, clean-build output, preview URL, and secret-scan result.

### D2 — Supabase schema, RLS, and seeds

Accepted when:

- migrations create the approved schema scope;
- residents cannot read or modify another resident's records;
- Safe, passkey, fee, and attestation security fields cannot be arbitrarily overwritten by the browser;
- `chains` and `fee_schedule` contain approved demo and production records;
- seeds and migrations run from a clean database.

Evidence: migration identifiers, seed output, and automated RLS tests.

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
- Sepolia, Arbitrum Sepolia, and Base Sepolia calculations produce the same Safe address using frozen deployment inputs;
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
4. verify matching Ethereum Sepolia, Arbitrum Sepolia, and Base Sepolia addresses;
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
- Sepolia, Arbitrum Sepolia, and Base Sepolia RPC access;
- a funded Sepolia deployment account;
- final Safe deployment version/configuration and the direct Safe WebAuthn signer;
- an authorized Sepolia EAS registration account;
- DOCX fee parameters and the five EAS schema field definitions;
- the deployed MVP UI at `https://mvp.onchainisland.co/` as the visual baseline.

Not supplied: the MVP UI source repository (section 6.1). Recovery configuration is not required (section 6.3).

Missing dependencies trigger change control; they do not convert testnet acceptance into mock acceptance automatically.

## 6. Resolved items and change-control escalations

### 6.1 UI source repository — escalation

The MVP UI source code is not available; only the deployment at `https://mvp.onchainisland.co/` exists. This invalidates the original EXE-003 and EXE-005 assumption of “connecting existing screens”. Week 1 therefore must recreate the shell and Steps 1–2 to match the deployed baseline, which materially increases frontend effort inside the fixed 20-hour allocation.

Required human action: either
1. supply the MVP UI source before Week 1 starts; or
2. approve a reallocation that funds recreation of the shell and Steps 1–2 within the 80-hour plan; or
3. re-scope D3/D5 to a reduced, specified subset of the baseline.

Until one option is approved, D3 and D5 are at risk under change control.

### 6.2 KadeLock enforcement model — confirm

The recommendation for the 20-hour budget was **A) minimum Safe Guard/Module**, and no contrary answer was recorded for KadeLock; the answer provided addressed the Aave vault (a Week 3 item). This contract freezes A pending explicit confirmation. KadeLock is not deployed on-chain in Week 1 (compiled and Foundry-tested only, per section 9).

### 6.3 Recovery — resolved

Recovery is **excluded from Week 1**. The accepted product trust model is the Safe RecoveryHub, scheduled for a later week. No recovery hours are included in EXE-001–EXE-006, and no recovery deliverable is accepted or rejected under this contract.

### 6.4 Aave vault — out of scope, note for later weeks

The product will use a simple wrapper around Aave vaults, and the human holds source code to supply to the agents at implementation time. This is Week 3 scope and is not part of this Week 1 contract.

## 7. Agent orchestration and human approval gates

### Agent workstreams

- **Foundation/Data agent:** EXE-001, EXE-002, migrations, seeds, RLS tests, shared types.
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

## 9. Explicit Week 1 development exclusions

Unless introduced through change control, Week 1 excludes:

- external wallet connection and proof-of-wallet ownership;
- pre-approval payment execution and Treasury transfer;
- paymaster policy beyond what is strictly required to deploy the Week 1 Safe;
- balance aggregation and indexer;
- L2 Safe deployment;
- Aave vault deployment/integration;
- full KYC/Self verification flow;
- admin review UI and `kade.review.v1` issuance;
- GOS, CCTP, card, investment, voting, and production release work.

These exclusions do not remove schema registration or interfaces explicitly required by D1–D8.

## 10. Freeze checklist

Freeze status at v1.0:

- [x] meaning of the 20-hour allocation — human development/orchestration hours with parallel agents.
- [ ] authoritative UI source repository — **not available; escalation in section 6.1**.
- [x] Google-only versus email fallback — Google only.
- [x] direct Safe WebAuthn versus managed embedded signer — direct Safe WebAuthn signer.
- [x] full versus partial Supabase schema scope — full DOCX schema, RLS/deny-by-default.
- [x] Safe deployment network — all-testnet iteration 1: deploy on Ethereum Sepolia; predict Arbitrum Sepolia and Base Sepolia.
- [x] Safe deployment parameters — frozen per section 4, D4.
- [x] exact Step 1–2 fields and fee formula — section 2.1.
- [x] five EAS schema encodings and registration authority — DOCX fields, registered on Sepolia.
- [ ] KadeLock enforcement model — frozen as A (minimum Guard/Module), **confirm per section 6.2**.
- [x] Recovery option — excluded from Week 1 (section 6.3).
- [ ] shared HTTPS preview requirement — pending explicit approval.
- [ ] all Day 1 dependencies — pending availability confirmation.
- [x] 20-hour package allocation and Week 1 integrated journey — EXE-001–EXE-006, 20 hours.

This contract is **Frozen v1.0** with the open items above tracked under change control.

## Appendix A — Requirement traceability

| DOCX Week 1 requirement | Backlog | 80h package | Contract deliverable | Required proof | Status |
|---|---|---|---|---|---|
| Public repo with README and disclosure | KAD-001 | EXE-001 | D1 | Public URL, clean build, README/disclosure | Covered |
| Sidebar shell | KAD-003 | EXE-003 | D3, D8 | Protected navigation operating on real session state | Covered; source unavailable (6.1) |
| Supabase schema and RLS | KAD-001, KAD-005, KAD-006 | EXE-001, EXE-005 | D2 | Migrations and RLS test report | Frozen: full DOCX schema |
| `fee_schedule` and `chains` seeded | KAD-002 | EXE-002 | D2 | Reproducible seed output and API/config read | Covered; testnet active |
| Passkey Safe on Ethereum Sepolia | KAD-003, KAD-004 | EXE-003, EXE-004 | D3, D4 | Transaction, owner/threshold inspection, signature test | Frozen: direct Safe WebAuthn |
| Reserved L2 addresses | KAD-004 | EXE-004 | D4 | Deterministic-address test and deployment manifest | Covered as predicted, not deployed |
| Steps 1–2 live | KAD-005, KAD-006 | EXE-005 | D5, D8 | Clean-browser persistence and fee test | Frozen: section 2.1 |
| EAS schemas registered on Sepolia | KAD-007 | EXE-006 | D6 | Five UIDs, transactions, registry verification | Frozen: DOCX fields |
| KadeLock compiled and Foundry-tested | KAD-008 | EXE-006 | D7 | Interface, threat model, passing tests | Frozen as A; confirm 6.2 |

The DOCX submission-work column—team registration, kickoff attendance, Discord communication, and the Monday update video—is not development scope and is intentionally absent from the 20-hour contract.

## Appendix B — Source inconsistencies and resolutions

1. DOCX Step 1 says “Email + passkey, or an existing wallet”; the product decision is Google/Supabase login with a transaction-only passkey and no EOA login. **Resolved:** Google-only login, passkey is transaction-only, no EOA login.
2. DOCX fee table says `1 USDC flat + 0.25 USDC per household member`, while the demo script jumps to `1.75 USDC`. **Resolved:** formula `1.00 + 0.25 × household_size`; the `1.75` example corresponds to a household of 3 (section 2.1).
3. DOCX account architecture permits Privy or Safe WebAuthn. **Resolved:** direct Safe WebAuthn signer.
4. DOCX calls KadeLock a Safe Guard/Module and also a qualified vault. **Resolved:** Week 1 model is the minimum Safe Guard/Module (confirm section 6.2).
5. DOCX requires “Supabase schema + RLS” without scoping the tables. **Resolved:** full DOCX schema, RLS/deny-by-default.
6. DOCX requires a sponsored mainnet Safe in Week 1 while the paymaster package is Week 2. **Resolved:** iteration 1 is testnet-only on Ethereum Sepolia; the deployment payer is the project’s Sepolia account. Mainnet sponsorship is deferred with the paymaster work.

## Appendix C — Agent task contracts

These briefs become executable only after their corresponding human approval gate is approved.

### A1 — Foundation and data

**Inputs:** approved repository, environment contract, schema scope, RLS matrix, chain metadata, fee formula.  
**Work:** EXE-001 and EXE-002 plus the database portion of EXE-005.  
**Must return:** migrations, seeds, RLS tests, generated/shared types, setup documentation, and an evidence manifest.  
**Must not decide:** authentication provider, Safe fields, fee semantics, or reviewer permissions not present in the approved matrix.

### A2 — Identity and account

**Inputs:** approved login method (Google-only), direct Safe WebAuthn signer, Safe deployment manifest template, and Sepolia deployment payer.  
**Work:** EXE-003 and EXE-004.  
**Must return:** login/session implementation, passkey enrollment and verification, Sepolia Safe deployment record, deterministic L2 test, and evidence manifest.  
**Must not decide:** Safe version, owners, threshold, salt, fallback handler, or credential-storage policy.

### A3 — Onboarding

**Inputs:** approved Step 1–2 field contract, validation rules, fee formula (section 2.1), database types, and the deployed MVP as the visual baseline. The UI source is not available (section 6.1).  
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
