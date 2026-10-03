# Kade MVP — Week 3 Delivery Contract

**Status:** Frozen v1.0 — human-approved 30 September 2026  
**Delivery window:** 28 September – 4 October 2026  
**Scope:** **this increment** — the Finance and Vote presentational mocks, the
off-by-default operator withdrawal tool, and the Invest auto-refresh.

This is a deliberately short contract. It records the human-directed addition of
the Finance screens and the Vote screen as **purely presentational mocks**, the
unlinked, environment-gated operator Safe → wallet withdrawal, and the Invest
auto-refresh, and states the condition on which this increment may be promoted. It
does not re-open the frozen Week 2 contract
(`docs/week-2-frozen-delivery-contract.md`, Frozen v1.8 with amendments to v1.10)
beyond this increment; everything else it froze remains frozen, and the Week 1
contract (`docs/week-1-frozen-delivery-contract.md`, Frozen v1.10) is unchanged.

Where product scope and the development contract disagree, the development
contract governs how work is verified and promoted; this contract governs what is
in scope for the Week 3 increment.

## 1. What this contract adds

**FIN-1 — Finance presentational mock.** The two Finance destinations are built
as **visual mocks**:

- `/bank` — **Bank ↔ Crypto**: the reference's header with the "powered by GOS"
  chip, the Bank → Crypto and Crypto → Bank cards, the three KPI cards, the
  transfer-history table, and the Fund vault / Cash out dialogs.
- `/card` — **Card & Banking**: the reference's header and status chip, the
  Onchain Island card face, "How it works", the "Altitude banking" banner, the
  pre-order and active layouts, and the Top up card dialog.

**VOTE-1 — Vote presentational mock.** `/vote` is built as a **visual mock** of
the reference's Snapshot consultation: the header, the "Resident voice · Snapshot"
panel, the proposal and its three tallied choices, the "Your ballot" card with
"Sign & cast vote", the turnout line, and the local select → cast interaction. It
is reachable from the nav.

The Finance nav items and the Vote nav item render as plain links (none of them is
locked).

**OPERATOR-1 — Operator withdrawal (Safe → wallet).** A new, deliberately
**unlinked** route `/vault/withdraw` moves USDC or the chain's native coin out of
the resident's Safe to an operator-named destination, so the team can empty a Safe
for clean testing on the deployment. It is **off by default**: only
`KADE_OPERATOR_WITHDRAW=1` enables the route and both server actions, and each
checks the flag server-side. It is **not a backdoor** — the resident's WebAuthn
passkey remains the only signer, no managed/embedded signer is introduced, and the
connected EOA has no authority. It reuses the existing Safe-4337 seam, validates
the destination, amount, chain and balance fail-closed, and reports success only
for a confirmed receipt. Documented in `docs/operator-vault-withdraw.md`.

**INVEST-REFRESH-1 — Invest auto-refresh.** After a confirmed deposit or
un-allocate, `InvestScreen` calls `router.refresh()` once so the route re-reads
the Safe's position without a manual reload. No other Invest behaviour changes.

## 2. Frozen properties (acceptance)

1. **Purely presentational.** The screens create no capability: no server action,
   no Supabase read for the screen, no wallet/chain code, no network call. No
   button claims a real transfer, card order or balance.
2. **Faithful to the reference.** Layout, copy and demo values follow
   `reference/design-handoff/kade-mvp.dc.html` (the two screens and their dialogs)
   and screenshots `reference/design-handoff/screenshots/20-…`–`25-…`.
3. **Reachable and framed.** `/bank`, `/card` and `/vote` are auth-gated and
   render inside the existing resident shell, exactly as `/invest` does.
4. **Existing behaviour preserved.** Existing-file changes are limited to: the
   Finance nav items and the Vote nav item in
   `apps/web/src/components/shell/nav.ts`; an **additive** optional
   `eyebrow?: string` prop on
   `apps/web/src/components/ui/Modal.tsx` (the default single-line header is
   unchanged, so no existing caller's behaviour changes); the `AGENTS.md`
   current-scope pointer; `apps/web/src/components/invest/InvestScreen.tsx` (the
   one `router.refresh()` call); the seven existing `apps/web/tests/invest-*.test.tsx`
   files (each gaining an additive `vi.mock('next/navigation')`); and
   `apps/web/tests/finance-bank.test.tsx` (its former "Vote locked" assertion
   inverted for VOTE-1). No existing test is weakened or removed.

## 3. Declared presentational divergence

As with Week 2 amendment v1.5, the screens display reference copy and **seeded
demo data** that describe a product state the programme has not reached: GOS
bank/crypto rails, an issued card, a resident's balances and transfers, and a
Snapshot consultation with tallies and a turnout that are not real (no vote is
recorded anywhere and `kade.kyc.v1` is not emitted, so the reference's
"KYC-attested" eligibility is not backed by an attestation). This divergence is
**declared here** and is the condition on which this increment is promoted. It
creates no capability.

**The divergence is declared here only.** By explicit owner decision (30
September 2026) the screens reproduce the design reference **verbatim** and carry
no on-screen demo banner, dialog notice or demo-labelled control: the declaration
in this contract — not a UI badge — is what makes the mock honest, exactly as
Week 2 amendment v1.5 handled the Holdings divergence.

Residual risk, recorded rather than hidden: the screens display seeded demo
balances, transfers and a card, and the dialogs display reference addresses (the
credit target "USDC in Safe 0x5Af1…c09D" and the card deposit address
"0x5Af1c4E9a7B2dD0341fE88b6C0937aA5d2e1c09D"). These are **demo values**; no
address shown is the resident's, and none should be used to send funds. This
increment is a demonstration layer and is expected to be replaced by a real,
disclosed capability under change control before any resident-facing use.

## 4. Explicit exclusions (unchanged)

This increment does **not** deliver, and does not move into scope:

- GOS integration, card issuance, or any fiat rail;
- any chain write, deposit, payout or order, **except** the off-by-default,
  unlinked operator withdrawal declared as OPERATOR-1 in §1 — the only
  fund-moving capability this increment adds;
- D12 multi-chain coverage, D13 attested fee payment, D14 KadeLock qualified
  vault, D15 wealth indexer — all remain beyond the envelope;
- a **real** Snapshot vote (space, EIP-712 signature, IPFS storage) and any
  attestation-gated eligibility — the Vote screen is a visual mock only, and
  `kade.kyc.v1` is not emitted;
- any change to authentication, Safe ownership, EAS schema encoding, KadeLock
  enforcement, wallet-connection authority, database security, or the fee model.

## 5. Acceptance evidence

- the `/bank`, `/card` and `/vote` routes render inside the authenticated shell;
- `/vault/withdraw` is a 404 unless `KADE_OPERATOR_WITHDRAW=1`, and both actions
  refuse when the flag is off;
- focused component tests: `apps/web/tests/finance-bank.test.tsx`,
  `apps/web/tests/finance-card.test.tsx`, `apps/web/tests/vote-screen.test.tsx`,
  `apps/web/tests/operator-vault-withdraw.test.tsx` and
  `apps/web/tests/invest-screen.test.tsx`;
- `./scripts/verify.sh` **PASS** on the exact promoted HEAD;
- a complete review session with no open blocking finding.

## 6. Change control

Promoting Finance or Vote from a **mock** to a real capability (GOS integration,
card issuance, any on-chain/fiat action, or a real Snapshot vote), or enabling the
operator withdrawal outside its environment gate, is a new change-control item and
requires explicit human approval. The excluded areas in §4 may not be moved into
scope by this contract.

## 7. Promotion condition

Promotion requires mechanical verification PASS on the exact HEAD and a completed
review session with no open blocking finding, per
`docs/DEVELOPMENT_CONTRACT.md` §15.
