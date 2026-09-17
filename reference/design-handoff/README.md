# Handoff: Kade MVP — Onchain Island Resident Platform

## Overview

Kade is infrastructure for residency-by-investment programmes. This MVP is the first deployment: the **Onchain Island Resident Platform** for Curaçao's investor permit. It covers a four-step pre-registration flow, an eight-screen resident platform, and a two-screen admin console for the programme operator.

The commercial model has two fees:

1. **Pre-approval fee**, paid at signup — pre-approves the account instantly so the resident can use the platform on day one.
2. **Residency service fee** (2,000 USDC in production), payable only once four readiness checks are green — then the full permit package is compiled and submitted.

Review happens in the background. The programme only intervenes on exception.

## About the design files

The files in this bundle are **design references written in HTML** — a high-fidelity, fully clickable prototype of the intended look and behaviour. They are **not production code to copy**. `Kade MVP.dc.html` runs on a design-tool runtime (a template dialect plus a small React-backed logic class), not on Next.js or any app framework.

Your task is to **recreate these designs in a real codebase**. The recommended stack, which the build guide assumes throughout:

- **Next.js 14** (App Router) + TypeScript
- **wagmi / viem** for chain reads and writes
- **Safe{Core} + ERC-4337** for smart accounts, with a Pimlico paymaster
- **EAS** (Ethereum Attestation Service) for attestations
- **Supabase** (Postgres + Auth + Realtime + RLS) for workflow state
- Ethereum mainnet as the settlement network, with Base and Arbitrum as deposit/yield venues

If you prefer a different framework, the designs translate cleanly — but keep the separation the prototype already enforces: **money and attestations onchain, workflow state in Postgres**.

## Fidelity

**High-fidelity.** Colours, type, spacing, copy, empty states, gating logic and modal content are all final. Recreate them faithfully. Every number shown in the prototype is either derived from a formula documented below or a deliberate seed value.

---

## Global layout

A two-pane shell, no top nav:

- **Sidebar** — fixed 240px, white, 1px right border `#EAEDF1`. Contains: logo block, a network chip, the nav (grouped with 11px uppercase section labels), a Resident/Admin mode toggle at the bottom.
- **Main** — flex-1, scrolls independently. Every screen wraps its content in `max-width: 1160px; margin: 0 auto; padding: 36px 40px 64px`.
- Screens mount with `animation: fadeUp .2s ease-out` (translateY 6px → 0, opacity 0 → 1).
- Page header pattern: `<h1>` at 36px/700/-.02em, optional one-line `<p>` subhead at 15px `#667085` with `max-width: 62ch`, optional right-aligned status chip or action button on the same baseline.

### Nav structure

```
Overview
RESIDENCY    → Residency · Vote
ASSETS       → Holdings · Invest
FINANCE      → Bank ↔ Crypto · Card & Banking
[mode toggle] Resident | Admin
ADMIN        → Applications · Treasury & Attestations
```

---

## Screens

### 1. Pre-registration (4 steps)

A stepper rail on the left of the content area (each step clickable once reached), the active step's form on the right. Steps are gated: you cannot advance past step 3 without at least one signed wallet.

**Step 1 · Create account** — email + passkey, or connect an existing wallet. Behind the scenes a Safe smart account is deployed on Ethereum mainnet with the passkey as owner; gas is sponsored. Copy explicitly says "no seed phrase to manage".

**Step 2 · Profile & household**
- Text fields: first name, last name, date of birth.
- **Citizenships** — chip list with a "+ Add country" `<select>` over a 14-country list (NL, DE, US, GB, CH, CA, AE, SG, BR, VE, CO, SR, ZA, PT). Each chip shows a country-code badge (22×16, `rgba(16,24,40,.08)` background, 10px/700 text) and an × to remove. At least one must remain.
- **Countries of residence (last 5 years)** — same pattern, chips also show a year range. Caption: "Each residence country needs a police clearance later — listing them now means nothing is missed."
- **Tier selector** — three cards: 3-year $280,000 · 5-year $425,000 · Indefinite $850,000.
- **Household members** — add/remove rows (name, relation, DOB, citizenship). The pre-approval fee recalculates live.

**Step 3 · Proof of wealth**
- Starts completely empty: the summary reads **$0** in `#98A2B3` with "Connect a wallet to begin", and the asset table shows a dashed empty-state box.
- Four connect options, **self-custodied EOAs only** (the copy states that exchange and custodial accounts come later):
  | key | label | sublabel | badge | colour |
  |---|---|---|---|---|
  | `mm` | Browser extension | MetaMask, Rabby · EVM | EXT | `#E8831D` |
  | `cb` | WalletConnect | Scan with a mobile wallet | WC | `#3B99FC` |
  | `lg` | Hardware wallet | Ledger, Trezor · EVM | HW | `#101828` |
  | `btc` | Bitcoin | Watch-only xpub · Sparrow, Ledger | BTC | `#F7931A` |
- **Connect opens a modal with three variants** (440px max-width, 18px radius, `rgba(16,24,40,.45)` backdrop, click-outside to close):
  - *Extension / hardware* → a SIWE (EIP-4361) signature sheet: domain, address, purpose, nonce, issued-at, plus "This request will not trigger a transaction or cost any fees" and a green "Read-only · we never request spending approval" line. CTA: **Sign message**.
  - *WalletConnect* → an 11×11 QR preview with a WC badge centred over it, the `wc:…@2?relay-protocol=irn&symKey=…` URI in mono, "Open your mobile wallet and scan this code". CTA: **I scanned it — continue**.
  - *Bitcoin* → watch-only xpub import: instructions to export from Sparrow / Ledger Live, a long `zpub…` string, and `Derivation m/84'/0'/0' · 14 addresses found · gap limit 20`. CTA: **Add watch-only key**.
  - Every variant shows a blue "Will be read: {assets} · {value}" strip and a footer note that the real app opens the actual wallet.
- **Multichain balances.** EVM wallets report per-chain balances across **Ethereum, Base, Arbitrum, Optimism and Celo**, shown as a breakdown under each wallet and aggregated into a per-chain summary strip. Seed values:
  - `mm` — 25 ETH / $49,575 total: Ethereum 14.20 ($28,150), Base 6.10 ($12,093), Arbitrum 3.40 ($6,740), Optimism 1.05 ($2,082), Celo 0.25 ($510).
  - `cb` — 150,000 USDC / $150,000: Ethereum 84,200, Base 41,500, Arbitrum 18,800, plus Optimism and Celo remainders.
  - `lg` — 48,900 USDY / $50,000 (Arbitrum).
  - `btc` — 3.2 BTC / $203,216 (wrapped via GOS on Ethereum).
- Continue button label and colour are state-driven: disabled `#98A2B3` "Connect a wallet to continue" → enabled `#0A7CFF` "Continue".

**Step 4 · Pay pre-approval fee**
- Two-column grid `minmax(0,2fr) minmax(0,1fr)`, max-width 960px.
- Left, "Your file": fixed three-column rows (96px label / flexible value / 88px right-aligned status chip with a 6px dot). Rows: applicant (name · citizenship codes · DOB), residence history, household, tier, proof of wealth, qualified holdings, fee.
- Right, "Your pre-approval" (dark card): one bold line — "Paying pre-approves your account on the spot." — then three arrow rows: **Now** (use the platform: identity, containers, GOS, voting) · **3 days** (we review; we only step in if something is wrong) · **After** (card, bank payouts, borrowing, Start Residency).
- Fee breakdown lines above the CTA. **Button: "Pay now to start pre-approval".** After payment it becomes "Enter the platform →".

### 2. Overview
KPI row (qualifying balance, account status, fees paid, attestations), the permit stage list, a qualified-holdings summary card, and next-step cards that deep-link into the relevant screen.

### 3. Residency ("Start Residency")
Subhead: *"Clear all four checks, pay the service fee, and we submit your full package."*

Two equal-height cards, `minmax(0,1.5fr) minmax(0,1fr)`, `align-items: stretch`:

**Left — readiness checks.** Four rows, each with a state dot, title, detail line and an inline action that navigates to where the work happens:
| Check | Satisfied when | Action |
|---|---|---|
| Identity verified | `kade.kyc.v1` issued | **Verify with Self** → opens the Self modal |
| Qualified holdings meet {tier} tier | vault value ≥ tier minimum | Move funds → Holdings |
| Documents complete | 6 of 6 uploaded | Upload |
| Intake review cleared | reviewer signs `kade.review.v1` | none (admin side) |

**Identity is powered by Self (self.xyz).** The Verify action opens a modal explaining zero-knowledge passport proof: scan the passport's NFC chip with the Self app, generate a proof locally, and disclose only what the programme needs (nationality, age over 18, not on a sanctions list) — the passport image and number never leave the device. The proof is verified onchain and recorded as `kade.kyc.v1`.

**Right — service fee card.** 2,000 USDC, with a flex spacer pushing the CTA to the bottom so both cards end level. The button stays grey `#98A2B3` / `cursor: not-allowed` until all four checks pass.

**After payment** the whole screen becomes a tracker: four KPIs (submitted, decision due, fees paid, documents), six residency stages (package compiled → Immigration review → decision → biometrics → Kranshi registration → `kade.permit.v1`), the document list, and onchain receipts.

### 4. Vote
A live Snapshot proposal: title, body, choices, running tally bars, and a gasless ballot. Eligibility is the `kade.kyc.v1` attestation.

### 5. Holdings (merged view)
Four KPIs: **total holdings · qualified · not qualified · vault lock**.

**Qualified vault** section — header "Qualified vault · Safe 0x5Af1…c09D", a progress bar toward the selected tier with a target marker, then a 5-column table (asset / source / amount / value / status). It lists:
- vault assets (a zero-value row is hidden),
- the **Reflect USDT+** position when converted,
- **Invest allocations**, badged `INV`.

All rows show a green "Qualified" chip.

**Reflect USDT+ card** (white, 1.5px `#0A7CFF` border) — the default USD vault. Idle USDC/USDT converts to USDT+, a yield-bearing dollar; yield accrues inside the token; redeems 1:1 daily. Shows APY (4.15%), backing (T-bills), redemption terms, a USDC/USDT → USDT+ chip flow, and a right panel that switches between *available to convert* (with what it would earn) and *in USDT+* (balance, earned, source). CTA toggles **Convert to USDT+** / **Redeem to USDC**. Copy stresses the qualifying balance is unchanged and there is no Reflect-side lock.

**In linked wallets** section — assets not yet moved, each with a **Move to vault** button and a per-asset chain badge. Empty state: "All linked assets are in the qualified vault."

**Footer note** — qualified vaults run on Ethereum, Base and Arbitrum at the same address and the tier is the total across all three; fiat ramps settle on Ethereum; KadeLock blocks outbound transfers until the unlock date except to fee addresses and approved instruments; Immigration can verify and attest but never move funds; dropping below tier starts a 90-day cure period.

### 6. Invest
A table of qualifying instruments, each with venue, type, terms, minimum and a **chain badge**:

| key | name | venue | type | terms | min | chain |
|---|---|---|---|---|---|---|
| `aqua` | Aqualectra 2025–2032 · AQUA-A1 | DCSX · feeder | Bond | 5.00% semi-annual | $2,800 | Ethereum |
| `soms` | Staatsolie 2025–2033 · SOMS-25-A1 | DCSX | Bond | USD · 7.75% | $100 | Ethereum |
| `usdy` | Ondo USDY | Ondo · Arbitrum vault | Tokenized treasury | 3.37% APY | $500 | Arbitrum |
| `morpho` | Morpho USDC vault · Base | Morpho Blue · Base vault | Lending vault | 4.62% APY · variable | $100 | Base |
| `latam` | LATAM EM Fund · Portfolio B | DCSX | Fund | Growth & fintech | $10,000 | Ethereum |

**Allocate opens a modal**: editable USDC amount, presets ($10k / $25k / $50k), minimum, estimated income, "vault USDC after", and "Qualifying balance: unchanged". Confirming is **capped at available vault USDC**.

### 7. Bank ↔ Crypto
Two action cards side by side:

**Fund your vault** (white, blue border, primary). Opens a deposit-details sheet: USD / EUR / XCG tabs that swap account number, routing/BIC and bank (JPMorgan New York `021000021`; GOS Payments Amsterdam `NL42 GOSP 0417 8821 30` / GOSPNL2A; Vidanova Willemstad `CW17 VIDA 0044 2281 90` / VIDACW22), a highlighted reference `OI-0409-MF`, a **"Credit to" chain picker** (Ethereum / Base / Arbitrum), what it's credited as, the 0.5% fee, ETA, a bridge note, and a **Recent top-ups** list.

**Cash out** (grey, "After review" chip until intake clears). Amount from vault USDC, beneficiary name, IBAN, a **"Debit from" chain picker**, **1% fee**, net received, SEPA-instant timing, and **Recent payouts**.

Below: three KPIs (funded in $62,500 · cashed out $4,200 · in progress $15,000) and a six-column transfer-history table (date, direction, detail + GOS ref, sent, received, status).

Settlement model, stated in the copy: fiat legs settle on Ethereum; non-Ethereum legs bridge automatically in ~2 min at no extra cost inbound, included in the 1% outbound.

### 8. Card & Banking
**Onchain Island Card, powered by GOS.** Two states:

*Before order* — card art, "How it works" in three numbered lines (merchants charged in XCG; USDC debited from the vault at the 1.79 CBCS peg with no card fee; spend limit set onchain), and an order button gated on review.

*After order* — four KPIs (available to spend XCG 8,946 / $4,997 · spent this month XCG 3,187 · monthly limit XCG 9,000 with a 35% progress bar · FX 1.79, 0% card fee). Card panel with status, funding source, delivered date, Apple/Google Pay, plus **Top up**, Set limit, Freeze. An 8-row transaction table showing **XCG charged next to USDC debited**, with vault top-ups in green. A spend-by-category bar (groceries 1,084 · dining 861 · utilities 701 · other 541).

**Top up opens a modal**: amount (with live XCG equivalent), then a source choice — *vault balance* (instant, one Safe transaction, with a vault-chain picker) or *deposit from another source* (chain picker + the card's deposit address `0x5Af1c4E9a7B2dD0341fE88b6C0937aA5d2e1c09D`, same on all three networks, with per-chain confirmation times).

**Altitude banking** — a single compact dashed strip below: USD and entity accounts tied to the Onchain Island identity, treasury yield on idle cash, vault sync, "Coming later" chip, and an early-access button.

### 9. Admin · Applications
- **Lane switcher**: Pre-approval (paid, awaiting intake review) / Residency applications (service fee paid, with Immigration) / All. A row moves lanes when its service fee is paid.
- **Filters**: free-text search over ref, name and Safe address; status (in review / approved / blocked); tier; funding (meets tier / below tier); sort (oldest first / largest wealth / name A–Z); Clear; an "n of m shown" count; and an empty state.
- **Rows**: ref with **days in stage** underneath (red `#B42318` past the 3-day SLA), applicant with citizenship codes and household size, tier, proof of wealth, qualified balance (green when ≥ tier), both fees, status chip.
- **Expanded row**: checks (sanctions/PEP, provenance, identity, documents), onchain references (Safe, fee UID, application UID, review UID, residency stage) and a reviewer note.
- **Actions**: **Approve** signs `kade.review.v1` and flips that applicant's gates live (card, payouts, borrowing, service-fee eligibility); **Block** freezes and notifies; **Reopen** reverts.
- **KPIs**: pre-approval queue, residency applications, blocked, fees collected (pre-approval + service).

### 10. Admin · Treasury & Attestations
The fee ledger (both fee types), treasury totals, and per-schema attestation counts.

---

## Interactions & behaviour

- **Everything starts empty.** Proof of wealth $0, nothing in the vault, no card, no allocations. Gate the Continue buttons rather than pre-filling data.
- **Gating pattern.** Locked actions render `#98A2B3` with `cursor: not-allowed` and an amber "After review" / "Unlocks after review" chip. Never hide a locked action — show it and say why.
- **Modals.** `position: fixed; inset: 0`, backdrop `rgba(16,24,40,.45)`, `z-index: 60`, card max-width 400–460px, radius 18px, `animation: fadeUp .16s ease-out`, click-outside and × to close, `stopPropagation` on the card.
- **Admin ↔ resident realtime.** Approving `CW-2026-0409` in Admin must immediately satisfy the resident's "intake review cleared" check. In production this is a Supabase Realtime channel on `review_events`.
- **Fee recalculation** is live as household members are added or removed.
- **Allocation accounting.** An allocation debits vault USDC and credits an instrument row, so the **qualified total is unchanged** and `Total = Qualified + Not qualified` always holds. Put this in a test.

## State

The prototype's state object maps closely to what the app needs:

```
step, done                       pre-registration progress
cits[], ress[]                   citizenships, residence history
tier (0|1|2), members            tier index and household size
linked{mm,cb,lg,btc}             which wallets are signed
connecting                       which provider's modal is open
vault{usdc,eth,usdy,btc}         which assets are in the qualified vault
alloc{instrumentKey: amount}     instrument allocations
reflect                          USDT+ converted or not
paid, svcPaid                    pre-approval fee, residency service fee
kyc, reviewed, docsUp            identity proof, intake review, documents uploaded
card, vote, voted                card ordered, ballot state
depChain                         selected chain for deposits/debits
screen, mode, ascreen            navigation
lane, search, fStatus, fTier, fQual, fSort   admin filters
decisions{ref: 'approved'|'blocked'}         admin decisions
```

In production, all of this is either a Supabase row or a chain read — none of it belongs in client state permanently.

## Business rules

```
Pre-approval fee (USDC) = round((500 + 100 × householdMembers) / 1.79)
  → household of 3 = 447 USDC   (XCG 500 base + XCG 100 per member, at the 1.79 CBCS peg)

Residency service fee = 2,000 USDC, payable only when all four readiness checks pass

Tiers = [{ name: '3-year', min: 280000 },
         { name: '5-year', min: 425000 },
         { name: 'Indefinite', min: 850000 }]

Qualified total  = vault assets (USDT+ at its current redemption ratio) + instrument allocations
Total holdings   = qualified + not qualified
Card FX          = 1.79 XCG per USD (CBCS peg), 0% card fee
GOS fees         = fund vault 0.5% · cash out 1%
Documents        = 6 items, including one police clearance per residence country
Review SLA       = 3 days
```

### Demo-scale amounts
For a live mainnet demo, drive every amount from a `fee_schedule` table with a `mode` column (`production` | `demo`) — one env var picks the mode, nothing hard-coded client-side. Demo values: 1 USDC pre-approval (+0.25/member), 10 USDC service fee, $100/$250/$500 tiers, 50 USDC minimum investment, 5 USDC card top-up, XCG 90 card limit, $20 fund / $10 cash-out. A full run costs about $61 plus gas. Pre-fund the demo Safe with ~200 USDC and 0.05 ETH. Show a "Demo pricing" chip beside the network chip.

## Design tokens

```
Typography   Plus Jakarta Sans (400/500/600/700/800), Google Fonts
             h1 36px/700/-.02em · h2 17px/600 · body 15px/1.55
             eyebrow 11px/700, letter-spacing .08em, uppercase, #667085
             table header 11px/700, letter-spacing .06em, uppercase
             all figures: font-variant-numeric: tabular-nums

Ink          #101828 primary · #344054 body · #667085 muted · #98A2B3 disabled
Brand        #0063B5 deep blue · #0A7CFF action blue · #EAF2FC blue tint
Semantic     #1B7F5A green · #B7791F amber (#FDF6E7 tint, #8A5A12 text) · #B42318 red
Surfaces     #FFFFFF page · #FAFAFA cards · #F2F4F7 chips · #EAEDF1 borders
Chains       Ethereum #627EEA · Base #0052FF · Arbitrum #2D374B · Optimism #FF0420 · Celo #FCFF52

Radii        8–10px inner boxes · 14px cards · 16–18px modals · 999px pills
Controls     inputs 42–48px · buttons 36/40/44/46px · nav rows 2px gap
Layout       sidebar 240px · content max-width 1160px · page padding 36px 40px 64px
             card padding 18–24px · grid gaps 10/14/16px
Motion       fadeUp .2s ease-out (screens) · .16s (modals)
```

## Architecture notes

- **Accounts** — Safe{Core} + 4337 module on mainnet; passkey via Privy or the Safe WebAuthn signer. Paymaster restricted to Kade contracts, EAS, the Reflect adapter and USDC → treasury, with a per-account daily cap. This is mainnet: cap it and alert on anomalies.
- **Attestations** — EAS schemas `kade.kyc.v1`, `kade.fee.v1`, `kade.application.v1`, `kade.review.v1`, `kade.permit.v1`. Demo and production amounts share identical schemas, so nothing needs re-registering.
- **Qualified vault** — a Safe Guard/Module (`KadeLock`) blocking outbound value before `unlockAt` except to allowlisted addresses (treasury fee address, approved instruments, Reflect adapter, GOS off-ramp after review); compliance co-signer 2-of-2 on withdrawals; cure event when value drops below tier.
- **Fees** — each fee is a USDC transfer to the Treasury Safe batched with its attestations via MultiSend, so it's one signature. If the balance sits in USDT+, batch the redemption into the same UserOp.
- **Reflect** — treat USDT+ as an ERC-20 the vault holds. Never assume a 1.0000 ratio: read it from Reflect's `convertToAssets`/oracle and store it with each balance snapshot so historical qualified balances are reproducible. Accrual is price-per-share, not a payout — show the delta, don't write a transaction row per accrual.
- **Identity** — Self (self.xyz) for zero-knowledge passport proof; verify onchain, then attest `kade.kyc.v1`. Store the proof reference, never passport data.
- **Documents** — hash and pin; attest the root; show the CID. Never put a document onchain.
- **Multichain** — Ethereum is the settlement hub. Read balances on Ethereum, Base, Arbitrum, Optimism and Celo for proof of wealth; allow qualified vaults on Ethereum, Base and Arbitrum at the same address, summed for the tier check.

## Supabase schema

| Table | Key columns | Notes |
|---|---|---|
| `profiles` | id, safe_address, email, first_name, last_name, dob, reflect_default | RLS: owner read/write, reviewer read |
| `profile_citizenships` | profile_id, country_code | Multiple citizenships |
| `profile_residences` | profile_id, country_code, from_year, to_year | Drives the police-clearance checklist |
| `applications` | id, ref, profile_id, tier, status, preapproval_usdc, service_usdc, fee_tx, fee_uid, app_uid, review_uid, service_uid | Status changes via a `review_events` trigger only |
| `household_members` | application_id, name, relation, dob, citizenship | A DB function recomputes the pre-approval fee |
| `wallets` | profile_id, address, chain, provider, siwe_sig, verified_at | EOA and xpub rows |
| `wealth_snapshots` | wallet_id, taken_at, assets jsonb, usd_value, provenance | Balance indexer output, per chain |
| `container_balances` | application_id, safe_address, chain, taken_at, assets jsonb, usd_value, usdtplus_ratio | Qualified balance and tier checks |
| `reflect_positions` | application_id, shares, principal_usdc, ratio_at_entry, converted_at, redeemed_at | USDT+ position and accrued yield |
| `allocations` | application_id, instrument, amount_usdc, chain, tx, created_at | Instrument rows shown in Holdings |
| `gos_transfers` | application_id, direction, currency, amount, fee_bps, chain, gos_ref, status, settled_at | Fund and cash-out history |
| `documents` | application_id, kind, owner, sha256, cid, status | Hash + pin only |
| `review_events` | application_id, reviewer_id, action, note, attestation_uid, created_at | Append-only; Realtime feeds both UIs |
| `fee_schedule` | mode, key, amount, currency | Demo vs production amounts live here |
| `reviewers` | id, role, signer_address | RLS gate for the Admin screens |

## Suggested four-week plan

1. **Foundations** — repo, sidebar shell, Supabase schema + RLS + seeded `fee_schedule`, passkey Safe deploy on mainnet, pre-registration steps 1–2 writing real rows, EAS schemas registered.
2. **Wealth & fee** — the four connect flows + SIWE + multichain balance reads; the pre-approval fee UserOp with batched attestations; Overview on real data.
3. **Holdings, Reflect, residency, admin** — `KadeLock` with the Reflect adapter allowlisted; merged Holdings with move-to-vault, USDT+ convert/redeem and allocation accounting; the Invest modal; the Start Residency gate + service fee; Self verification; Admin lanes, filters and Approve/Block signing `kade.review.v1` with gates flipping over Realtime.
4. **Rails, card, polish** — GOS fund/cash-out with history; card order → active state with the XCG/USDC ledger and top-up; Altitude early-access capture; Vote; empty and error states; seeded demo rows; deploy; a 3-minute demo script.

## Assets

- `assets/onchain-island-logo.png` — wordmark. Inverted to white over blue via `filter: brightness(0) invert(1)`.
- Fonts: Plus Jakarta Sans from Google Fonts.
- Country badges are rendered as text (ISO code in a tinted pill) — no flag image dependency.
- No icon library: every glyph in the prototype is a text character, a coloured dot or a CSS shape. Substitute your codebase's icon set freely.

## Files in this bundle

| File | What it is |
|---|---|
| `Kade MVP.dc.html` | The full prototype — **design reference**. Open in a browser to click through every flow. Template markup first, then a `class Component` logic block holding all seed data and derived values. |
| `index.html` | The same prototype bundled as one self-contained offline file. Easiest thing to open and click through. |
| `MVP Build Document.docx` | The build guide: model, flows, demo-scale amounts, architecture, schema, week-by-week plan, dev tips, demo script, open decisions. |
| `assets/` | Logo. |
| `screenshots/` | 34 PNGs in flow order, with a `README.md` index mapping each file to its screen. |

### Reading the prototype source

The template dialect is small and readable: `{{ name }}` is a value hole, `<sc-for list="{{ rows }}" as="row">` is a loop, `<sc-if value="{{ flag }}">` is a conditional, and `style="…"` is a plain inline style. All logic lives in `renderVals()` at the bottom — that method is effectively the spec for every derived number on screen. Read it alongside the business rules above.

## Open decisions for the dev

- Passkey provider: Privy (faster) vs the Safe WebAuthn signer (fully self-custodial).
- Reflect auto-convert: default on with the first conversion explicit, or always ask?
- Whether USDT+ yield compounds in the vault or sweeps to a spendable balance.
- Reviewer signing: a server-side key in an Edge Function vs a reviewer wallet signature. Start server-side and log every signature.
- GOS sandbox availability for card issuing and off-ramp; Altitude timeline for phase 2.
