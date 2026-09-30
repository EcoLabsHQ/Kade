# Kade MVP — Week 3 Delivery Contract

**Status:** Frozen v1.0 — human-approved 30 September 2026  
**Delivery window:** 28 September – 4 October 2026  
**Scope:** **one increment only** — the Finance presentational mock.

This is a deliberately short, single-increment contract. It records the
human-directed addition of the two Finance screens as a **purely presentational
mock** and states the condition on which that increment may be promoted. It does
not re-open the frozen Week 2 contract
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

The Finance nav items render as plain links (they are no longer locked). Vote
(D20) stays deferred and locked.

## 2. Frozen properties (acceptance)

1. **Purely presentational.** The screens create no capability: no server action,
   no Supabase read for the screen, no wallet/chain code, no network call. No
   button claims a real transfer, card order or balance.
2. **Faithful to the reference.** Layout, copy and demo values follow
   `reference/design-handoff/kade-mvp.dc.html` (the two screens and their dialogs)
   and screenshots `reference/design-handoff/screenshots/20-…`–`25-…`.
3. **Reachable and framed.** `/bank` and `/card` are auth-gated and render inside
   the existing resident shell, exactly as `/invest` does.
4. **Existing behaviour preserved.** The only change to an existing file is the
   two Finance nav items in `apps/web/src/components/shell/nav.ts`; no existing
   test is weakened or removed.

## 3. Declared presentational divergence

As with Week 2 amendment v1.5, the screens display reference copy and **seeded
demo data** that describe a product state the programme has not reached: GOS
bank/crypto rails, an issued card, and a resident's balances and transfers. This
divergence is **declared here** and is the condition on which this increment is
promoted. It creates no capability.

To keep the mock honest, the following are also frozen:

- every screen shows an on-screen demo notice, and every dialog a demo line;
- no fabricated address is presentable as usable — the card deposit address is a
  labelled non-real placeholder ("Demo address — do not send funds") and the
  credit target reads "Demo — … (do not send funds)";
- any control that changes the mock state is labelled as a demo preview, and the
  reference's gated "Order card · after intake review" stays genuinely disabled.

## 4. Explicit exclusions (unchanged)

This increment does **not** deliver, and does not move into scope:

- GOS integration, card issuance, or any fiat rail;
- any chain write, deposit, payout or order;
- D12 multi-chain coverage, D13 attested fee payment, D14 KadeLock qualified
  vault, D15 wealth indexer — all remain beyond the envelope;
- Vote (D20), which stays deferred and locked;
- any change to authentication, Safe ownership, EAS schema encoding, KadeLock
  enforcement, wallet-connection authority, database security, or the fee model.

## 5. Acceptance evidence

- the `/bank` and `/card` routes render inside the authenticated shell;
- focused component tests: `apps/web/tests/finance-bank.test.tsx` and
  `apps/web/tests/finance-card.test.tsx`;
- `./scripts/verify.sh` **PASS** on the exact promoted HEAD;
- a complete review session with no open blocking finding.

## 6. Change control

Promoting Finance from a **mock** to a real capability (GOS integration, card
issuance, or any on-chain/fiat action) is a new change-control item and requires
explicit human approval. The excluded areas in §4 may not be moved into scope by
this contract.

## 7. Promotion condition

Promotion requires mechanical verification PASS on the exact HEAD and a completed
review session with no open blocking finding, per
`docs/DEVELOPMENT_CONTRACT.md` §15.
