# Kade MVP — Week 2 Delivery Contract

> **MOCK / DRAFT — not frozen, not approved, no governance force.**
>
> This file is a **mock-up of the Week 2 delivery contract**, reconstructed from
> the repository's own sources and amended with the owner's recorded priorities,
> so the owner can review it before it freezes. It is **not** a governing
> document: it does not authorise work, it does not define acceptance, and it
> must not be cited as the Week 2 contract. The governing documents remain
> `docs/DEVELOPMENT_CONTRACT.md` (how work is verified and promoted),
> `docs/week-1-frozen-delivery-contract.md` (Week 1, frozen v1.10) and
> `docs/planning/kade-mvp-build-document-v7.docx` (what is in scope).
>
> Where this draft states an outcome as already delivered, it cites the file or
> evidence in the repository. Where it proposes hours, backlog ids, priorities or
> scope boundaries that are **not** in a governing source, the value is marked
> `[proposed]` / `[arbitrary]` / `[owner]` and must be confirmed at the matching
> human gate. Intended final path: `docs/week-2-frozen-delivery-contract.md`.

**Status:** Mock v0.2 — reconstructed 21 September 2026; owner priorities
recorded 22 September 2026; never approved  
**Delivery window:** 21–27 September 2026 (build guide §10, Week 2)  
**Execution allocation:** 20 human development/orchestration hours `[proposed —
mirrors the Week 1 envelope; not sourced from the backlog workbook]`  
**Parent plan:** 80-hour MVP execution plan (`docs/planning/kade-mvp-backlog.xlsx`)  
**Week goal:** Steps 3–4 end to end, then Residency, Holdings, Invest and Admin
(build guide §10 Week 2 "Wealth, fee, vaults", **re-prioritised by the owner**)

## 1. Contract interpretation

This mock covers development work only and covers **Week 2 only**. It parallels
the frozen Week 1 contract in structure so the two can be diffed and a real
Week 2 contract can be cut from it.

Three facts shape it, and all are stated up front because they are unusual:

1. **Week 2 work has already begun under Week 1 change control.** Amendments
   v1.7–v1.10 are explicitly labelled "Week 2 change control onto the frozen
   Week 1 contract" (week-1 contract §8.7–§8.10). The Step 3–4 path is therefore
   partly *delivered* and verified only to the extent `docs/known-gaps.md`
   records.
2. **The owner has re-prioritised the build guide's Week 2–3 scope.** Recorded
   22 September 2026 (§2.2): Residency first, then Holdings, then Invest
   (Morpho on Ethereum mainnet, one pool, fully functional), with a simple Admin
   dashboard as a first-class deliverable. Vote and the Finance rails (Bank ↔
   Crypto, Card) move to the end. Where this draft and the build guide disagree
   on ordering, this draft follows the owner and says so.
3. **Iteration 2 activates Ethereum mainnet, at least for Invest and Holdings.**
   Iteration 1 was all-testnet. The owner's "Morpho deposit on ETH Mainnet" and
   "holdings through wallet signature" cannot be satisfied on testnet, so the
   mainnet activation moves from "open decision" to a Week 2 dependency (§5).
   Arbitrum and Base remain later.

No deliverable is accepted solely because code was generated, a mock is
displayed, or an agent reports completion. Acceptance requires the evidence
listed for each deliverable.

## 2. Frozen and proposed product decisions

### 2.1 Already frozen by week-1 amendments

v1.7–v1.10 are recorded in full in `docs/week-1-frozen-delivery-contract.md`
§8.7–§8.10 and are not restated here: read-only Bitcoin proof-of-wealth (v1.7);
read-only pasted EVM proof-of-wealth (v1.8); pre-approval fee paid from an
external wallet on Sepolia with server-side receipt verification (v1.9); and the
same wallet connection reused read-only by the proof-of-wealth rows (v1.10).

### 2.2 Owner priority order `[owner, 22 September 2026]`

1. **Residency** — the resident completes the residency step.
2. **Holdings** — show all linked holdings, **and only through a wallet
   connection signature** (ownership proof, comparable to an EOA signature).
   Pasting an address is **not** enough here; pasting was only for registration
   (Step 3 proof of wealth).
3. **Invest** — make the **Morpho deposit on Ethereum mainnet into one pool
   fully functional first**, before any other instrument or chain.
4. **Admin dashboard** — a **simple** review-and-approve applications screen.
   The owner calls this important, not optional.
5. **Vote** — later, at the end.
6. **Finance** (Bank ↔ Crypto, Card) — later, at the end.

### 2.3 Decisions this draft proposes

To be confirmed at the Week 2 gates before they are treated as frozen:

1. **Ethereum mainnet is activated for iteration 2.** `[proposed]` It is required
   by Holdings (signed wallets) and Invest (Morpho). Arbitrum and Base stay
   deferred; their registry entries are unchanged.
2. **Ownership proof (a signed message) is in scope for Holdings only.**
   `[proposed]` A linked wallet is proven by a signature over a server-issued
   challenge (EIP-191 / EIP-4361-style), comparable to an EOA signature. It is
   required to display that wallet's holdings.
3. **Pasted addresses stay registration-only.** `[proposed]` Pasted Bitcoin and
   EVM addresses remain read-only, unverified proof-of-wealth for Step 3 and
   **never** feed Holdings.
4. **The connected EOA still has no authority over the Safe.** `[proposed]` It is
   never a Safe owner/signer, is never a login, and cannot authorise a
   transaction (v1.9/v1.10 boundary, unchanged).
5. **No managed embedded signer.** `[proposed]` Unchanged from week-1 §2 item 5.
6. **The five EAS schemas and their Week 1 UIDs are immutable.** `[proposed]`
   Week 2 attestations reuse the registered schemas; no encoding change without
   the Onchain gate.
7. **Fees follow the frozen Week 1 fee model.** `[proposed]` The `fee_schedule`
   table and `KADE_FEE_MODE` remain the single source; no amount is hard-coded
   in the client (week-1 §2.1).

### 2.4 Fee model

Unchanged from week-1 contract §2.1. Reproduced for convenience:

| Function | Production | Demo (iteration 1) |
|---|---|---|
| Pre-approval fee | `XCG 500 + XCG 100 per household member` (household of 3 → `447 USDC`) | `1.00 USDC flat + 0.25 USDC per household member` (household of 3 → `1.75 USDC`) |
| Residency service fee | `2,000 USDC` | `10 USDC` |

Demo formula: `preapproval_usdc = 1.00 + 0.25 × household_size`. The service fee
is seeded but not charged in iteration 1 (week-1 §2.1); charging it is part of
the Residency deliverable (D16).

## 3. Week 2 execution packages

Hours, backlog ids and priorities below are **`[proposed]`** until the backlog
workbook and the owner's Week 2 envelope confirm them. Status reflects the
repository at the commit this mock was written from.

### 3.1 Priority deliverables

| ID | Priority | Hours | Package | Status |
|---|---|---:|---|---|
| EXE-010 | P1 | 5 | Residency step end to end (Self KYC, four checks, service fee, permit) | Not started |
| EXE-011 | P2 | 4 | Holdings from **signed** linked wallets (ownership proof + aggregation) | Not started |
| EXE-012 | P3 | 3 | Invest: Morpho deposit on **Ethereum mainnet**, one pool, fully functional | Not started |
| EXE-013 | P4 | 4 | Admin dashboard: review and approve/reject applications | Not started |
|  |  | **16** |  |  |

### 3.2 Enablers these deliverables depend on

| ID | Hours | Package | Status |
|---|---:|---|---|
| EXE-014 | 2 | Ethereum mainnet activation: payer, RPC, treasury, per-chain config | Not started |
| EXE-015 | 3 | Batched attested fee payment (`kade.fee.v1` + `kade.application.v1`) | Not started |
| EXE-016 | 3 | KadeLock qualified vault deployed; qualified-balance accounting | Not started |
| EXE-017 | 2 | Multi-chain balance coverage beyond Bitcoin + Ethereum/Base USDC | Not started |
|  | **10** |  |  |

### 3.3 Deliverables already completed under Week 1 change control

| ID | Hours (spent) | Package | Status |
|---|---:|---|---|
| EXE-007 | — | Step 3 proof-of-wealth read path (Bitcoin, pasted EVM, wallet) | **Delivered on testnet** (v1.7–v1.10) |
| EXE-008 | — | Step 4 pre-approval fee collection on Sepolia | **Delivered on Sepolia** (v1.9) |
| EXE-009 | — | Wallet-connection authority boundary | **Delivered** (v1.9/v1.10) |

### 3.4 Later `[owner]`

| ID | Priority | Package | Status |
|---|---|---|---|
| EXE-018 | P5 | Vote (Snapshot) | Later |
| EXE-019 | P6 | Finance: Bank ↔ Crypto (GOS), Card | Later |

> **Note:** the proposed total exceeds a 20-hour envelope. The draft does **not**
> hide that: either the envelope grows, or enablers and later items are cut or
> deferred through change control. That is an owner decision, not an agent's.

## 4. High-level deliverables and acceptance evidence

Status is the honest repository state. **Built** means code and tests exist and
`./scripts/verify.sh` covers them; it does not claim an independent review or a
mainnet deployment.

### D9 — Proof-of-wealth read path (Step 3) — registration only

Accepted when:

- a signed-in resident can add up to 5 Bitcoin addresses, up to 5 pasted EVM
  (`0x…`) addresses, or connect a browser-extension/WalletConnect wallet;
- the server validates addresses and reads balances from a public source
  (`mempool.space`; a Blockscout-compatible explorer for Ethereum and Base);
- the screen states the balance was read from a public source and is **not**
  evidence of control;
- pasted rows persist to `public.wallets` with `siwe_sig`/`verified_at` NULL, an
  owner-only policy, and the 5-address cap;
- a connected wallet writes **no** row.

Status: **Built on testnet read paths.** This path is for **registration only**
and is not the source of Holdings (D17). Evidence: migrations
`20260921000001_bitcoin_wallet_addresses.sql`, `20260921000002_evm_wallet_addresses.sql`;
provider clients and unit tests.

### D10 — Pre-approval fee collection (Step 4)

Accepted when:

- a signed-in resident connects an external wallet and sends the configured fee
  as a direct USDC transfer to the Kade treasury on the active chain;
- the server re-reads the receipt and confirms success plus a USDC `Transfer` to
  the treasury of at least the server-resolved amount before the step advances;
- `applications.fee_tx` is written only through the `SECURITY DEFINER` function
  scoped to `profile_id = auth.uid()`, and is treated as a **claim, not a
  proof** — the paid state is derived by re-reading the chain;
- `applications.status` remains trigger-only.

Status: **Built on Sepolia.** Evidence: migration
`20260921000003_record_preapproval_fee_tx.sql`; receipt verifier and unit tests;
component test for the connect-and-pay step; recorded `fee_tx`. No Treasury-Safe
batch and no attestation is issued (that is D13/EXE-015).

### D11 — Wallet-connection authority boundary

Accepted when:

- the connected EOA is never a Safe owner/signer, is never written to
  `safe_deployments` or `passkey_credentials`, and cannot authorise a Safe
  transaction;
- wallet connection is not a login and creates no session;
- no row is marked verified for a connected wallet **except** the D17 ownership
  proof, which is recorded for holdings and nothing else.

Status: **Built.** Evidence: connection component and unit tests; the reused
shared balance provider; screen copy stating the connection gives Kade no
authority over the Safe.

### D12 — Multi-chain balance coverage

Accepted when balance reads cover the token and chain set the owner approves,
beyond Bitcoin plus Ethereum/Base native-and-USDC.

Status: **Not started** (EXE-017, enabler for D17).

### D13 — Attested fee payment

Accepted when the fee is settled through a Safe-originated batched
`MultiSend`/UserOp carrying `kade.fee.v1` and `kade.application.v1` in one
signature, UIDs recorded and independently verifiable.

Status: **Not started** (EXE-015). Explicitly excluded in Week 1 (week-1 §8.9).

### D14 — KadeLock qualified vault

Accepted when the frozen KadeLock Guard is deployed on the approved chains, the
qualified-balance view sums deposits across chains to the tier check, and the
deployment is verified on the explorer.

Status: **Not started** (EXE-016). KadeLock compiles and its Foundry policy tests
pass but it is not deployed (week-1 D7).

### D15 — Cross-chain wealth indexer

Accepted when a background aggregator writes per-chain `wealth_snapshots` and the
Holdings total is derived from them rather than on-demand reads.

Status: **Not started.** Excluded in Week 1 (week-1 §9); revisitable after D17.

### D16 — Residency step end to end `[owner P1]`

Accepted when a signed-in, pre-approved resident can:

- reach the Residency step from the shell (the `/vote`-style gate flips once the
  pre-approval fee is verified);
- complete identity verification (Self → `kade.kyc.v1`), and the four checks
  (identity, funds, review, service fee) are shown with their real state;
- pay the configured **residency service fee** on the approved chain, verified
  server-side from the receipt as in D10;
- receive the permit attestation (`kade.permit.v1`) once the checks are green;
- see a residency tracker whose state is derived from on-chain records, not
  fixtures.

Status: **Not started.** The service fee is seeded but not charged in iteration 1
(week-1 §2.1); Self integration and `kade.permit.v1` issuance are excluded in
Week 1 (week-1 §9). Evidence required: migration(s), the Self verifier path,
receipt verifier, issued UIDs, and an end-to-end test.

### D17 — Holdings from signed linked wallets `[owner P2]`

Accepted when:

- a resident links a wallet and proves control with a **signature over a
  server-issued challenge** (EIP-191 / EIP-4361-style, comparable to an EOA
  signature);
- the Holdings screen shows **all** linked wallets' holdings, read from the
  approved provider(s);
- **pasting an address cannot add a holding** — pasted rows (D9) are excluded
  from Holdings by construction, not by policy wording;
- the ownership proof is stored and `wallets.verified_at` is set only for
  signature-verified rows;
- the signature confers no Safe authority and is not a login (D11).

Status: **Not started.** Ownership proof was deliberately excluded through
v1.10; the owner has now required it for Holdings. Evidence required: migration
or column use for the challenge/verification, the verification path and its unit
tests, the Holdings screen test, and the on-screen distinction between a
signature-verified wallet and a pasted address.

### D18 — Invest: Morpho deposit on Ethereum mainnet, one pool `[owner P3]`

Accepted when:

- a resident with a funded Safe/vault can deposit USDC into **one** Morpho pool
  on **Ethereum mainnet**;
- the deposit is fully functional end to end: build the call, sign with the
  passkey (Safe WebAuthn signer), submit, and confirm on the explorer;
- the resulting position is reflected in Holdings/qualified balances;
- no other instrument, no other pool and no other chain is required for this to
  count as delivered.

Status: **Not started.** The build guide placed Morpho on Base and Aave on
Arbitrum; the owner overrides this to **Ethereum mainnet first** `[owner]`.
Blocked by the signer-contract deployment (`docs/known-gaps.md`) — no passkey
signature can validate until `createSigner` runs. Evidence required: the pool
address and chain id in configuration, the transaction, the resulting position,
and a test.

### D19 — Simple Admin dashboard `[owner P4, important]`

Accepted when:

- a reviewer role (not a resident) can sign in to an admin surface;
- the dashboard lists applications with the fields needed to decide (applicant,
  fee state, proof of wealth, residency checks);
- the reviewer can **approve** or **reject**, and the action writes a
  `review_events` row and issues `kade.review.v1`;
- the resident's gates flip from the reviewer's action (Realtime or equivalent),
  not from a manual database edit;
- RLS restricts the surface to `reviewers` rows; a resident cannot reach it.

Status: **Not started.** Admin review UI and `kade.review.v1` are excluded in
Week 1 (week-1 §9). The owner calls this important, so it is a P4 deliverable,
not a locked item. Evidence required: the admin route, the `reviewers` RLS
policy, the review action, the issued UID, and a two-screen live test.

### D20 — Vote (Snapshot) `[owner P5, later]`

Accepted when eligibility is derived from `kade.kyc.v1`/permit state and a vote
can be cast through Snapshot.

Status: **Not started; explicitly last.** Rendered locked today (`nav.ts`).

### D21 — Finance: Bank ↔ Crypto (GOS) and Card `[owner P6, later]`

Accepted when a resident can fund/cash out via GOS with a chain selector and a
card top-up draws from source chains.

Status: **Not started; explicitly last.** Rendered locked today (`nav.ts`).

## 5. Development dependencies supplied by the project

Day-1 dependencies for Week 2 that are **not** in the repository:

- an **Ethereum mainnet** deployment payer, RPC and funded treasury (required by
  D17 and D18);
- a Morpho pool address and its chain id for D18 `[owner: ETH mainnet, one pool]`;
- a Self project configuration for D16;
- a reviewer account/role for D19;
- a paymaster policy for any chain where gas is sponsored;
- confirmation the Reown/WalletConnect project id used by v1.9 is still valid;
- the owner's Week 2 envelope and the updated backlog rows (ids are `[proposed]`).

Missing dependencies trigger change control; they do not convert testnet
acceptance into mock acceptance automatically.

## 6. Already executed under Week 2 change control (v1.7–v1.10)

| Amendment | Subject | Deliverable touched | Status |
|---|---|---|---|
| v1.7 | Read-only Bitcoin proof-of-wealth; empty-first Step 2 | D9 | Built |
| v1.8 | Pasted EVM proof-of-wealth; row layout | D9 | Built |
| v1.9 | Pre-approval fee paid from an external wallet on Sepolia | D10, D11 | Built |
| v1.10 | Proof-of-wealth wallet rows use the real connection, read-only | D9, D11 | Built |

## 7. Deferred items and open decisions

| Item | State | Why | Revisit |
|---|---|---|---|
| Ethereum mainnet activation | Required for D17/D18 | Iteration 1 was testnet-only; payer/treasury not supplied yet | Week 2 gate |
| Arbitrum / Base activation | Deferred | Safe v1.5.0 has no Arbitrum Sepolia deployment; product chains stay in the registry | Later |
| Ownership proof (SIWE-style) | Now in scope for Holdings | Was excluded through v1.10; owner requires it for D17 | D17 gate |
| Signer contract not deployed | Declared gap | Nothing calls `createSigner`; no passkey signature can validate — blocks D18 | D18 gate |
| Hardware wallets / Bitcoin xpub | Not implemented | Only single-address reads in scope | If re-introduced |
| KadeLock deployment | Not started | Frozen model A, compiled and tested only | Week 2 gate |
| Indexer / wealth snapshots | Not started | Excluded in Week 1 | After D17 |
| Attested fee payment | Not started | Excluded in Week 1 (v1.9) | Week 2 gate |

## 8. Change control

Any change affecting authentication, Safe ownership, deterministic deployment
inputs, EAS schema encoding, KadeLock enforcement, wallet-connection authority,
database security, or the hour allocation requires explicit human approval, as
in week-1 §8.

If a timebox is exhausted:

1. the agent records completed evidence and the unmet acceptance criterion;
2. the integration owner identifies the smallest reallocation inside the
   80-hour plan;
3. no deliverable is silently downgraded, mocked, or marked complete;
4. the human approves the reallocation, scope change, or schedule change.

### 8.1 Amendment log

- **v0.1 — 21 September 2026.** Mock reconstructed from the repository.
- **v0.2 — 22 September 2026.** Owner priority order recorded (§2.2):
  Residency → Holdings (signed wallets) → Invest (Morpho ETH mainnet, one pool)
  → Admin dashboard; Vote and Finance last. Mainnet activation moved from open
  decision to dependency; ownership proof moved from excluded to in scope for
  Holdings. `[owner]`

Amendments v1.7–v1.10 live in the frozen Week 1 contract and are referenced, not
duplicated, here.

## 9. Explicit Week 2 exclusions (proposed)

Unless introduced through change control, Week 2 excludes:

- Arbitrum and Base deployment;
- managed/embedded signers;
- hardware wallets and Bitcoin xpub;
- pasted addresses feeding Holdings (pasting stays registration-only);
- ERC-20 balances other than the approved token set;
- recovery (Safe RecoveryHub), Reflect/Aave vaults, CCTP;
- Vote and the Finance rails until P5/P6;
- any attestation issuance that changes a frozen EAS schema encoding.

## 10. Freeze checklist

- [ ] Week 2 delivery window and hour envelope confirmed by the owner.
- [ ] Priority order (Residency → Holdings → Invest → Admin → later) confirmed.
- [ ] Ethereum mainnet activation approved and funded.
- [ ] Morpho pool address + chain id (ETH mainnet, one pool) supplied.
- [ ] Ownership-proof scope (Holdings only) and challenge format confirmed.
- [ ] Admin reviewer role and Self project configuration supplied.
- [ ] Backlog ids for EXE-010–EXE-019 confirmed against the workbook.
- [ ] Week 2 gates defined (mirroring the Week 1 four checkpoints).

This draft is **not frozen**. It is a proposal for review.

## Appendix A — Traceability

| Source | Deliverable | Status |
|---|---|---|
| Build guide §10 Week 2: Steps 3–4 | D9, D10 | Built on testnet/Sepolia |
| Build guide §10 Week 2: KadeLock deployed | D14 | Not started |
| Build guide §10 Week 2: indexer | D15 | Not started |
| Build guide §10 Week 3: Residency + service fee | D16 | P1, not started |
| Build guide §10 Week 3: Admin lanes, `kade.review.v1` | D19 | P4, not started |
| Build guide §10 Week 3: Invest (Morpho/Aave) | D18 | P3, ETH mainnet per owner |
| Owner 22 Sep 2026: Holdings via signed wallets | D17 | P2, not started |
| Owner 22 Sep 2026: Vote / Finance last | D20, D21 | Later |

## Appendix B — Assumptions and unresolved sources

1. **Hour allocation, priorities and backlog ids are `[proposed]`.** The backlog
   workbook (`docs/planning/kade-mvp-backlog.xlsx`) was not parsed for this
   draft; ids and hours must be taken from it or assigned by the owner.
2. **Chain maturity is now decided for Invest/Holdings (mainnet) but not for the
   rest.** Arbitrum/Base stay deferred; the guide's three-chain assumption is not
   adopted wholesale.
3. **"Vault" terminology.** The guide calls KadeLock both a Guard and a qualified
   vault; Week 1 froze the minimum Guard/Module. D14 must be reconciled at the
   Onchain gate.
4. **Ownership proof is a new authority surface.** It must be reviewed so the
   signature can never be mistaken for Safe authority or a login (D11).
5. **Evidence for delivered items is only as strong as `known-gaps.md` says.**
   Notably, the signer contract is not deployed (blocks D18), email magic link
   has not completed a round trip, and there is no RLS harness.

## Appendix C — Agent task contracts (proposed)

These briefs become executable only after their corresponding Week 2 gate is
approved.

### B1 — Foundation and data

**Work:** migrations, seeds, shared types for Residency, Holdings verification
and Admin review; the `fee_tx`/service-fee writers.
**Must not decide:** fee semantics, chain set, or attestation encoding.

### B2 — Identity and account

**Work:** the ownership-proof challenge and verification; receipt verification;
Safe signer deployment so D18 can sign.
**Must not decide:** Safe version, owners, threshold, or login methods.

### B3 — Onboarding and residency

**Work:** the Residency step (Self, four checks, service fee, tracker) and the
Holdings and Invest screens.
**Must not redesign:** the fee formula, the onboarding sequence, or the
handoff's visual language.

### B4 — Onchain and admin

**Work:** the Morpho ETH-mainnet deposit call path; KadeLock deployment;
`kade.review.v1` issuance and the simple Admin dashboard.
**Must not perform:** irreversible deployment before the Onchain gate, or schema
encoding changes.

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
