# Kade MVP — Week 2 Delivery Contract

**Status:** Frozen v1.3 — human decisions recorded 22–24 September 2026; three amendments recorded in section 8.1  
**Delivery window:** 21–27 September 2026 (build guide §10, Week 2)  
**Execution allocation:** 20 human development/orchestration hours (parallel
agent execution, not combined effort)  
**Parent plan:** 80-hour MVP execution plan (`docs/planning/kade-mvp-backlog.xlsx`)  
**Week goal:** Residency, signed-wallet Holdings, one fully functional Morpho
deposit on Ethereum mainnet, and a simple Admin review dashboard — on the
foundations delivered by Week 1 and its Week 2 change-control amendments.

## 1. Contract interpretation

This contract covers development work only and covers **Week 2 only**. The
20-hour allocation measures hands-on human development, review, integration and
orchestration time with parallel agents; agent execution is expected and does not
count against the 20 hours. It does not weaken the acceptance criteria.

No deliverable is accepted solely because code was generated, a mock is
displayed, or an agent reports completion. Acceptance requires the evidence
listed in this contract.

Three facts shape this contract and are stated up front because they are
unusual:

1. **Week 2 work has already begun under Week 1 change control.** Amendments
   v1.7–v1.10 to the frozen Week 1 contract are explicitly labelled "Week 2
   change control onto the frozen Week 1 contract" (week-1 contract §8.7–§8.10).
   The Step 3–4 path is therefore partly delivered before this contract froze.
2. **The project owner re-prioritised the build guide's Week 2–3 scope.** The
   order is frozen in §2.1. Where this contract and the build guide disagree on
   ordering, this contract governs.
3. **Iteration 2 activates Ethereum mainnet**, because the frozen Holdings and
   Invest decisions cannot be satisfied on testnet. Iteration 1 was all-testnet;
   this is the first mainnet scope in the programme.

## 2. Frozen product decisions

All Week 2 decisions are frozen.

### 2.1 Priority order

The owner's priority order is frozen. It governs sequencing and any trade-off:

1. **Residency** — the resident completes the residency step.
2. **Holdings** — show all linked holdings, **and only through a wallet
   connection signature** (an ownership proof comparable to an EOA signature).
   Pasting an address is **not** sufficient for Holdings; pasting is
   registration-only (Step 3 proof of wealth).
3. **Invest** — the **Morpho deposit on Ethereum mainnet into one pool** is made
   fully functional first, before any other instrument, pool or chain.
4. **Admin dashboard** — a **simple** review-and-approve applications screen. It
   is a first-class deliverable, not optional.
5. **Vote** — later, at the end of the programme.
6. **Finance** (Bank ↔ Crypto, Card) — later, at the end of the programme.

### 2.2 Frozen decisions

1. **Ethereum mainnet is active in iteration 2.** It is required by Holdings
   (signed wallets) and Invest (Morpho). Arbitrum and Base remain deferred; their
   registry entries are unchanged.
2. **Ownership proof (a signed message) is in scope for Holdings only.** A linked
   wallet is proven by a signature over a server-issued challenge (EIP-191 /
   EIP-4361-style), comparable to an EOA signature, and is required to display
   that wallet's holdings.
3. **Pasted addresses are registration-only — except that a pasted EVM address is
   displayed as unverified.** As amended v1.3, a pasted EVM (`0x…`) address is
   shown in Holdings, explicitly marked unverified and **excluded from the
   Holdings total**, and can be verified there by connecting the wallet that
   controls it and signing the server-issued challenge. Pasted **Bitcoin**
   addresses remain read-only, unverified proof-of-wealth for Step 3 and
   **never** feed Holdings; that exclusion is structural, not a display
   convention. As amended v1.2, a **connected** wallet (browser extension or
   WalletConnect) is likewise displayed unverified and excluded from the total.
4. **The connected EOA has no authority over the resident Safe.** It is never a
   Safe owner or signer, is never added to `safe_deployments` or
   `passkey_credentials`, cannot authorise a Safe transaction, and is not a login
   method. Google OAuth and email magic link remain the only logins (week-1 §2
   item 2 as amended v1.2).
5. **No managed or embedded signer.** The signer remains the direct Safe
   WebAuthn signer (week-1 §2 item 5 unchanged).
6. **The five EAS schemas and their Week 1 UIDs are immutable.** Week 2
   attestations reuse the registered schemas; no encoding changes without the
   Onchain gate.
7. **Fees follow the frozen Week 1 fee model** (week-1 §2.1). The `fee_schedule`
   table and `KADE_FEE_MODE` remain the single source; no amount is hard-coded in
   the client.
8. **Testnet remains for anything mainnet is not required for.** Mainnet is not a
   blanket switch; it is activated where §2.1 items 2 and 3 require it.

### 2.3 Frozen fee model

Values are taken verbatim from the DOCX §7 fee table. Any parameter absent from
the DOCX is an arbitrary demo value and is marked `[arbitrary]`.

| Function | Production | Demo (iteration 1) |
|---|---|---|
| Pre-approval fee | `XCG 500 + XCG 100 per household member` (household of 3 → `447 USDC`) | `1.00 USDC flat + 0.25 USDC per household member` (household of 3 → `1.75 USDC`) |
| Residency service fee | `2,000 USDC` | `10 USDC` |

- Demo formula: `preapproval_usdc = 1.00 + 0.25 × household_size`.
- Currency/rail: USDC.
- Both fees are stored in the single `fee_schedule` table with a `mode` column
  (`demo | production`); a single environment variable selects the mode.
- Week 1 collects the pre-approval fee on Ethereum Sepolia (week-1 §8.9). Week 2
  charges the **residency service fee** as part of the Residency deliverable.

## 3. Week 2 execution packages

| ID | Package | Hours | Backlog | Contracted outcome |
|---|---|---:|---|---|
| EXE-010 | Ethereum mainnet activation and Week 2 configuration | 2 | KAD-009 `[arbitrary]` | A funded mainnet payer, RPC, treasury and per-chain configuration are wired; the fee rail is available on mainnet. Testnet is retained where mainnet is not required. |
| EXE-011 | Safe WebAuthn signer deployment | 2 | KAD-010 `[arbitrary]` | The direct Safe WebAuthn signer contract is deployed so a passkey signature validates, unblocking Invest. |
| EXE-012 | Residency step end to end | 5 | KAD-011 `[arbitrary]` | Self identity verification (`kade.kyc.v1`), the four checks, the server-verified residency service fee, `kade.permit.v1`, and a tracker derived from on-chain records. |
| EXE-013 | Holdings from signed linked wallets | 4 | KAD-012 `[arbitrary]` | A signed-message ownership proof; Holdings shows **all** signed linked wallets' holdings; pasted rows are excluded by construction. |
| EXE-014 | Invest: Morpho deposit on Ethereum mainnet, one pool | 3 | KAD-013 `[arbitrary]` | A resident deposits USDC into one Morpho pool on Ethereum mainnet, fully functional end to end, with the position reflected in Holdings. |
| EXE-015 | Simple Admin review dashboard | 4 | KAD-014 `[arbitrary]` | A reviewer role reviews applications and approves/rejects them; the action writes `review_events` and issues `kade.review.v1`; the resident's gates flip live; RLS restricts the surface. |
|  | **Total** | **20** | **KAD-009–KAD-014** |  |

Delivered under Week 1 change control and **not** re-contracted here: EXE-007
(Step 3 proof-of-wealth read path), EXE-008 (Step 4 pre-approval fee collection
on Sepolia) and EXE-009 (wallet-connection authority boundary), per v1.7–v1.10.

Hours are timeboxes, not permission to omit acceptance criteria silently. A
package that cannot satisfy its criteria within its timebox must trigger the
change-control clause. The items in §6.5 are **beyond** this 20-hour envelope and
are tracked under change control.

## 4. High-level deliverables and acceptance evidence

Status is the honest repository state. **Built** means code and tests exist and
`./scripts/verify.sh` covers them; it does not claim an independent review or a
mainnet deployment.

### 4.1 Already delivered under Week 2 change control

#### D9 — Proof-of-wealth read path (Step 3), registration only

Accepted when a signed-in resident can add up to 5 Bitcoin addresses, up to 5
pasted EVM addresses, or connect a wallet; the server reads balances from a
public source; the screen states the balance is not evidence of control; pasted
rows **and a connected wallet's account** persist to `public.wallets` with
`siwe_sig`/`verified_at` NULL, an owner-only policy and the 5-address cap. A
connected account is saved as a watch-only row with `provider =
'connected-wallet'` (amendment v1.2, superseding v1.1) and is shown in Holdings
unverified and excluded from the total.

Status: **Built on testnet read paths.** This path is for registration only and
is not the source of Holdings (D17). Evidence: migrations
`20260921000001_bitcoin_wallet_addresses.sql`,
`20260921000002_evm_wallet_addresses.sql`; provider clients and unit tests.

#### D10 — Pre-approval fee collection (Step 4)

Accepted when a signed-in resident sends the configured fee as a direct USDC
transfer to the Kade treasury on the active chain; the server re-reads the
receipt and confirms a successful USDC `Transfer` of at least the server-resolved
amount; `applications.fee_tx` is written only through the `SECURITY DEFINER`
function scoped to `profile_id = auth.uid()` and treated as a claim, not a proof;
`applications.status` remains trigger-only.

Status: **Built on Sepolia.** Evidence: migration
`20260921000003_record_preapproval_fee_tx.sql`; receipt verifier and unit tests;
component test; recorded `fee_tx`.

#### D11 — Wallet-connection authority boundary

Accepted when the connected EOA is never a Safe owner/signer, never written to
`safe_deployments` or `passkey_credentials`, cannot authorise a Safe transaction,
is not a login, and no row is marked verified except the D17 ownership proof.

Status: **Built.** Evidence: connection component and unit tests; shared balance
provider; screen copy stating the connection gives Kade no Safe authority.

### 4.2 Frozen priority deliverables

#### D16 — Residency step end to end (priority 1)

Accepted when a signed-in, pre-approved resident can:

- reach the Residency step, with the shell gate flipping once the pre-approval
  fee is verified;
- complete identity verification (Self → `kade.kyc.v1`), with the four checks
  (identity, funds, review, service fee) shown with their real state;
- pay the configured **residency service fee** on the approved chain, verified
  server-side from the receipt as in D10;
- receive the permit attestation (`kade.permit.v1`) once the checks are green;
- see a residency tracker derived from on-chain records, not fixtures.

Evidence: migration(s), the Self verifier path, the receipt verifier, issued
UIDs, and a clean-browser end-to-end test.

#### D17 — Holdings from signed linked wallets (priority 2)

Accepted when:

- a resident links a wallet and proves control with a **signature over a
  server-issued challenge** (EIP-191 / EIP-4361-style);
- the Holdings screen shows **all** linked wallets' holdings from the approved
  provider(s);
- **pasting an address cannot add a holding** — pasted rows are excluded by
  construction;
- `wallets.verified_at` is set only for signature-verified rows;
- the signature confers no Safe authority and is not a login;
- as amended v1.2, a connected wallet that has **not** been signature-verified is
  also shown — in a separate section, labelled unverified, and **excluded from
  the Holdings total**;
- as amended v1.3, a **pasted EVM** address is shown the same way (unverified,
  excluded from the total, and verifiable from Holdings by connecting the wallet
  that controls it); a **pasted Bitcoin** address remains excluded by
  construction.

Evidence: the challenge/verification migration or column use, the verification
path and unit tests, the Holdings screen test, and the on-screen distinction
between a signature-verified wallet and a pasted address.

#### D18 — Invest: Morpho deposit on Ethereum mainnet, one pool (priority 3)

Accepted when:

- a resident with a funded Safe/vault deposits USDC into **one** Morpho pool on
  **Ethereum mainnet**;
- the deposit is fully functional end to end: build the call, sign with the
  passkey (Safe WebAuthn signer), submit, and confirm on the explorer;
- the resulting position is reflected in Holdings/qualified balances;
- no other instrument, pool or chain is required for this to count as delivered.

Evidence: the pool address and chain id in configuration, the transaction, the
resulting position, and a test. Blocked by D-EXE-011 until the signer contract is
deployed.

#### D19 — Simple Admin dashboard (priority 4)

Accepted when:

- a reviewer role, not a resident, can reach an admin surface;
- the dashboard lists applications with the fields needed to decide (applicant,
  fee state, proof of wealth, residency checks);
- the reviewer can **approve** or **reject**, writing a `review_events` row and
  issuing `kade.review.v1`;
- the resident's gates flip from the reviewer's action, not a manual database
  edit;
- RLS restricts the surface to `reviewers` rows; a resident cannot reach it.

Evidence: the admin route, the `reviewers` RLS policy, the review action, the
issued UID, and a two-screen live test.

### 4.3 Beyond the 20-hour envelope (tracked under change control)

These were considered for Week 2 and are **not** contracted in this freeze:

- **D12 — Multi-chain balance coverage** (beyond Bitcoin + Ethereum/Base USDC).
- **D13 — Attested fee payment** (Safe-originated `MultiSend`/UserOp batching
  `kade.fee.v1` + `kade.application.v1`).
- **D14 — KadeLock qualified vault deployed** with qualified-balance accounting.
- **D15 — Cross-chain wealth indexer** writing `wealth_snapshots`.

### 4.4 Later

- **D20 — Vote (Snapshot):** eligibility derived from `kade.kyc.v1`/permit state.
- **D21 — Finance:** Bank ↔ Crypto (GOS fund/cash-out) and Card.

Both are rendered locked today (`apps/web/src/components/shell/nav.ts`).

## 5. Development dependencies supplied by the project

The delivery clock assumes Day 1 access to:

- an **Ethereum mainnet** deployment payer, RPC and a treasury that can receive
  USDC (required by D16–D18);
- a **Morpho pool address and its chain id** for D18 (Ethereum mainnet, one pool);
- a Self project configuration for D16;
- a reviewer account/role for D19;
- a paymaster policy for any chain where gas is sponsored;
- confirmation that the Reown/WalletConnect project id used by v1.9 remains
  valid;
- the updated backlog rows for Week 2 (the backlog ids in §3 are `[arbitrary]`
  until confirmed).

Missing dependencies trigger change control; they do not convert mainnet
acceptance into mock acceptance automatically.

## 6. Resolved items and change-control escalations

### 6.1 Ownership proof — reinstated for Holdings

Ownership proof was deliberately excluded through v1.7–v1.10. The owner has now
frozen it **in scope for Holdings** (D17) and nowhere else. It changes no
authority: it is not a login and confers no Safe authority (§2.2 items 2–4).

### 6.2 Ethereum mainnet — resolved

The build guide assumed mainnet in Week 2 while iteration 1 was testnet-only.
This contract resolves the gap in favour of the owner's decisions: mainnet is
activated for D16–D18. Arbitrum and Base stay deferred.

### 6.3 Invest chain — resolved

The build guide placed Morpho on Base. The owner overrides this: the Morpho
deposit is on **Ethereum mainnet**, into one pool (D18), before any other chain
or instrument.

### 6.4 Signer contract deployment — escalation

The direct Safe WebAuthn signer contract is not deployed; nothing calls
`createSigner`, so the Safe owner exists as an address without code and no
passkey signature can validate (`docs/known-gaps.md`). This **blocks D18** and is
scheduled as EXE-011 on the critical path.

### 6.5 Items beyond the envelope — escalation

D12–D15 (§4.3) exceed the 20-hour envelope. No deliverable is silently
downgraded: the owner either funds a larger envelope, schedules them later, or
drops them, through change control.

## 7. Agent orchestration and human approval gates

### Agent workstreams

- **Foundation/Config agent:** EXE-010, mainnet configuration, shared types.
- **Identity/Account agent:** EXE-011, the ownership-proof challenge and
  verification, the signer deployment.
- **Onboarding/Residency agent:** EXE-012 and the Holdings and Invest screens.
- **Onchain/Admin agent:** EXE-014, EXE-015, `kade.review.v1`, and the simple
  Admin dashboard.
- **Integration owner:** interface control, reviews, evidence bundle, and the
  combined acceptance journey.

### Mandatory human checkpoints

1. **Foundation gate:** mainnet configuration, the environment contract, schema
   changes and shared types approved before feature integration.
2. **Account gate:** the signer deployment, ownership-proof boundary, and
   authentication separation approved before any mainnet deployment.
3. **Onchain gate:** the Morpho call path, `kade.review.v1` issuance, and the
   KadeLock interface/threat model approved before irreversible writes.
4. **Acceptance gate:** a human executes the combined journey and reviews the
   evidence bundle before Week 2 is declared complete.

Agents may prepare proposals and code before a gate, but may not perform
irreversible on-chain writes before the corresponding approval.

## 8. Change control

Any change affecting authentication, Safe ownership, deterministic deployment
inputs, EAS schema encoding, KadeLock enforcement, wallet-connection authority,
database security, or the hour allocation requires explicit human approval.

If a timebox is exhausted:

1. the agent records completed evidence and the unmet acceptance criterion;
2. the integration owner identifies the smallest hour reallocation inside the
   80-hour plan;
3. no deliverable is silently downgraded, mocked, or marked complete;
4. the human approves the reallocation, scope change, or schedule change.

### 8.1 Amendment log

**v1.0 — 22 September 2026. Approved by the project owner.**

Initial freeze of the Week 2 contract. It records the owner's priority order
(§2.1), activates Ethereum mainnet for iteration 2, reinstates ownership proof
for Holdings only, overrides the build guide's Invest chain to Ethereum mainnet,
and moves Vote and the Finance rails to the end. It references the Week 1
amendments v1.7–v1.10 (which delivered D9–D11) rather than duplicating them.

**v1.1 — 22 September 2026. Approved by the project owner.**

A connected wallet is persisted as a watch-only row. Step 3's browser-extension
and WalletConnect rows save the connected account to `public.wallets` through
`record_wallet_address` with `provider = 'pasted-address'` and
`siwe_sig`/`verified_at` NULL, so the proof-of-wealth row survives a reload. This
narrows D9's "a connected wallet writes no row".

What this does **not** change:

- the connected account is not verified (`verified_at` NULL) and is not proof of
  ownership;
- it confers no Safe authority and is not a login;
- the row is excluded from Holdings by construction (D17 requires a signature);
- the 5-address cap and the owner-only policy are unchanged.

Rationale, for the record: a connected wallet that vanished on reload read as a
lost address, so persisting it as a watch-only row keeps the screen stable. The
row is indistinguishable from a pasted address at the schema level because the
schema has no connected-wallet provider encoding; adding one is a change-control
item.

Affected clauses:

| Clause | Before | After |
|---|---|---|
| §4.1, D9 | pasted rows persist; a connected wallet writes no row | pasted rows **and a connected account** persist as watch-only rows (`verified_at` NULL) |

**v1.2 — 23 September 2026. Approved by the project owner.**

A wallet connected in Step 3 through the browser-extension or WalletConnect path
is persisted with a distinct provider value (`connected-wallet`) instead of
`pasted-address`, and is displayed in Holdings **without** a signature. It is
labelled unverified, is not evidence of control, and is **excluded from the
Holdings total**. Signature-verified wallets (`verified_at` non-null, D17) remain
the only verified class, and pasted rows remain excluded by construction.

What this does **not** change:

- pasted Bitcoin and pasted EVM rows never feed Holdings;
- the signature remains the only path that sets `wallets.verified_at`, and a
  connected row is never marked verified;
- the connected wallet is not an ownership proof, is not a login, and confers no
  authority over the resident Safe (D11 / v1.9 unchanged);
- the 5-address cap still applies to connected-wallet rows.

Rationale, for the record: the owner decided that a wallet connected during
onboarding should be visible in Holdings without an additional signing step.
Because a browser connection is not server-verifiable — a watch-only import can
be connected — the row is shown unverified, is excluded from the total, and must
not be read as verified wealth by the review surface.

Affected clauses:

| Clause | Before | After |
|---|---|---|
| §2.2 item 3 | only signature-verified wallets feed Holdings | a connected wallet also feeds Holdings, unverified and excluded from the total |
| §4.1, D9 | a connected account persists as a `pasted-address` watch-only row | a connected account persists with `provider = 'connected-wallet'` and is shown unverified in Holdings |
| §4.2, D17 | Holdings shows signature-verified wallets only | signature-verified wallets **plus** unverified connected wallets, in a separate labelled section |
| §8.1 v1.1 | a connected account persists as a watch-only `pasted-address` row | a connected account persists with `provider = 'connected-wallet'` and is shown unverified in Holdings |

**v1.3 — 24 September 2026. Approved by the project owner.**

A pasted EVM (`0x…`) address is displayed in Holdings as an unverified wallet, in
the same labelled section as a connected wallet, and is **excluded from the
Holdings total**. It can be verified from Holdings by connecting the wallet that
controls it and signing the server-issued challenge.

What this does **not** change:

- pasted **Bitcoin** addresses never feed Holdings; that exclusion stays
  structural (no EVM connection can prove a `bc1…` address);
- the signature remains the only path that sets `wallets.verified_at`, and a
  pasted row is never marked verified without one;
- a connection alone never marks a row verified;
- the signature is not a login and confers no authority over the resident Safe
  (D11 / v1.9 unchanged);
- the 5-address cap still applies to pasted and connected rows.

Rationale, for the record: the owner asked that a pasted address be visible in
Holdings so it can be verified there, rather than staying invisible until
independently proven. No new mechanism is introduced: `record_wallet_ownership`
already marks every stored row for the signed address, so this amendment changes
what is *displayed*, not what can be *written*.

Affected clauses:

| Clause | Before | After |
|---|---|---|
| §2.2 item 3 | no pasted row feeds Holdings | a pasted **EVM** row feeds Holdings, unverified and excluded from the total; pasted Bitcoin stays excluded |
| §4.2, D17 | signature-verified wallets plus unverified connected wallets | plus unverified **pasted EVM** wallets, verifiable from Holdings |

## 9. Explicit Week 2 development exclusions

Unless introduced through change control, Week 2 excludes:

- Arbitrum and Base deployment;
- ownership proof anywhere other than Holdings, and wallet login;
- managed/embedded signers;
- hardware wallets and Bitcoin xpub;
- pasted addresses feeding Holdings;
- ERC-20 balances other than the approved token set;
- recovery (Safe RecoveryHub), Reflect/Aave vaults, CCTP, GOS and Card;
- Vote;
- any attestation issuance that changes a frozen EAS schema encoding.

## 10. Freeze checklist

Freeze status at v1.2:

- [x] meaning of the 20-hour allocation — human development/orchestration hours
  with parallel agents.
- [x] priority order — Residency → Holdings → Invest → Admin → Vote/Finance
  (§2.1).
- [x] Holdings authority — signed linked wallets are verified; a connected wallet
  and a pasted **EVM** address are shown unverified and excluded from the total;
  pasting **Bitcoin** is registration-only and never feeds Holdings (§2.2 items
  2–3, v1.2 and v1.3).
- [x] Invest — Morpho on Ethereum mainnet, one pool (§2.2 item, §6.3).
- [x] Admin dashboard — simple review/approve, first-class (§2.1 item 4).
- [x] mainnet activation for iteration 2 (§2.2 item 1).
- [x] authentication separation and no managed signer (§2.2 items 4–5).
- [x] EAS schemas and Week 1 UIDs immutable (§2.2 item 6).
- [x] fee model — week-1 §2.1 unchanged (§2.3).
- [ ] mainnet funding, treasury and Morpho pool supplied — pending availability.
- [ ] signer contract deployed (EXE-011) — pending the Account gate.
- [ ] backlog ids KAD-009–KAD-014 confirmed against the workbook — currently
  `[arbitrary]`.

This contract is **Frozen v1.2** with the open items above tracked under change
control.

## Appendix A — Requirement traceability

| Source | Deliverable / Package | Required proof | Status |
|---|---|---|---|
| Week 1 v1.7–v1.10 | D9, D10, D11 / EXE-007–009 | Migrations, receipt verifier, tests | Delivered on testnet |
| Owner 22 Sep 2026 — Residency | D16 / EXE-012 | Self path, service-fee receipt, `kade.permit.v1` UID, E2E test | Frozen |
| Owner 22 Sep 2026 — Holdings | D17 / EXE-013 | Signed challenge, verification tests, Holdings screen | Frozen |
| Owner 22 Sep 2026 — Invest | D18 / EXE-014 | Pool config, mainnet transaction, position, test | Frozen |
| Owner 22 Sep 2026 — Admin | D19 / EXE-015 | Admin route, `reviewers` RLS, `kade.review.v1` UID, live test | Frozen |
| Build guide §10 Week 2 | D12–D14 | Explorer deployment, batched attestations | Beyond envelope |
| Build guide §10 Week 2 | D15 | Indexer output | Beyond envelope |
| Build guide §10 Week 3 | D20, D21 | Snapshot vote; GOS/card | Later |

## Appendix B — Source inconsistencies and resolutions

1. **Build guide places Morpho on Base; product is single-pool ETH mainnet.**
   **Resolved:** Ethereum mainnet, one pool first (D18, §6.3).
2. **Build guide lists SIWE for Week 2; v1.7–v1.10 excluded ownership proof.**
   **Resolved:** ownership proof is in scope for Holdings only (§6.1).
3. **The guide's Week 2 assumes mainnet while iteration 1 was testnet-only.**
   **Resolved:** mainnet is activated for D16–D18 only (§6.2).
4. **The guide's Week 2 scope exceeds a 20-hour envelope.** **Resolved:** D12–D15
   are moved beyond the envelope and tracked under change control (§6.5).
5. **Backlog ids for Week 2 are not confirmed.** **Resolved as `[arbitrary]`:**
   KAD-009–KAD-014 are placeholders until the workbook is read.

## Appendix C — Agent task contracts

These briefs become executable only after their corresponding human approval gate
is approved.

### C1 — Foundation and config

**Inputs:** approved mainnet payer, RPC, treasury, per-chain config, schema scope
and shared types.
**Work:** EXE-010 plus the database portion of the Week 2 deliverables.
**Must return:** migrations, seeds, shared types, setup documentation and an
evidence manifest.
**Must not decide:** fee semantics, chain set, or attestation encoding.

### C2 — Identity and account

**Inputs:** approved ownership-proof challenge format, signer deployment inputs,
and the v1.9/v1.10 wallet boundary.
**Work:** EXE-011 and the ownership-proof path.
**Must return:** the signer deployment record, the challenge/verification path,
tests and an evidence manifest.
**Must not decide:** Safe version, owners, threshold, or login methods.

### C3 — Onboarding and residency

**Inputs:** the Self configuration, the Step 3–4 contract, the fee model, and the
design handoff.
**Work:** EXE-012 and the Holdings and Invest screens.
**Must return:** the Residency step, Holdings and Invest, persistence,
validation, end-to-end tests and an evidence manifest.
**Must not redesign:** navigation, visual language, onboarding sequence or fee
formula.

### C4 — Onchain and admin

**Inputs:** the approved Morpho pool, the KadeLock interface and threat model, and
the `kade.review.v1` model.
**Work:** EXE-014, EXE-015 and the simple Admin dashboard.
**Must return:** the deposit call path, the review action and issuance, the
`reviewers` RLS policy, tests and an evidence manifest.
**Must not perform:** irreversible deployment before the Onchain gate, or schema
encoding changes, or weaken KadeLock rules.

## Appendix D — Evidence manifest template

| Field | Required content |
|---|---|
| Package | EXE identifier and backlog ids |
| Commit | Immutable commit SHA |
| Hours | Human/orchestration time consumed |
| Tests | Commands and exact results |
| Runtime proof | Explorer URL, UID, address, or migration identifier as applicable |
| Acceptance mapping | Contract criterion proved by each artifact |
| Known limitations | Any unmet or partially proven criterion |
| Security notes | Secrets handling, authority assumptions, irreversible actions |
| Reviewer | Human approval and timestamp |
