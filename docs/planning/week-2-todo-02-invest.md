# Week 2 — front 02 (invest-morpho) todo and status

**Branch:** `week-2-02-invest-morpho`
**Deliverable:** D18 / EXE-014 — a resident deposits USDC into one Morpho pool
on Ethereum mainnet, fully functional end to end.
**Governing scope:** `docs/week-2-frozen-delivery-contract.md` §2.2 and §6.3
(Morpho on Ethereum mainnet, one pool).

## BLOCKED: pool address + mainnet + signer deployment

The deposit **cannot execute**, and this front does not claim it can. Three
project-supplied dependencies are missing, so the execution path is
configuration-gated and the UI can only build and report:

1. **Pool address / market parameters not supplied.** The frozen decision is one
   Morpho pool on Ethereum mainnet, but no pool address or market parameters were
   given (contract §5 and the freeze checklist). Nothing here invents one. The
   configuration keys are documented below; until they are set,
   `readMorphoPoolConfig()` returns `null` and the screen says "pool not
   configured".
2. **No mainnet RPC / payer / treasury.** Mainnet funding is not supplied
   (contract §5). `isMainnetRailConfigured()` is false, so the deposit cannot be
   submitted.
3. **Safe WebAuthn signer not deployed** (D-EXE-011, front 01, Account gate). The
   Safe's only owner is an address without code, so a passkey signature cannot
   authorise the Safe transaction. This is the same blocker `docs/known-gaps.md`
   records.

**Consequence:** the calldata is built and unit-tested against the Morpho ABI
(deterministic, no network write), and the call path is ready, but **no deposit
was executed and none is claimed**. The deposit is not "functioning end to end" —
it cannot be until the three dependencies above land. When they do, a
gate-approved caller supplies the `execute` callback to `prepareMorphoDeposit`,
which is the only place a Safe transaction would be submitted.

## What was built (not gated)

| Artifact | Purpose |
|---|---|
| `apps/web/src/lib/invest/morpho-abi.ts` | The canonical Morpho Blue `supply`/`idToMarketParams` ABI and `marketId` (`keccak256(abi.encode(MarketParams))`). |
| `apps/web/src/lib/invest/morpho-config.ts` | Reads the pool and chain id from configuration; returns `null` when absent, never a placeholder. |
| `apps/web/src/lib/invest/morpho-deposit.ts` | Builds `USDC.approve(morpho, amount)` + `Morpho.supply(marketParams, amount, 0, safe, 0x)` for a Safe; pure, unsigned, deterministic. |
| `apps/web/src/lib/invest/morpho-execution.ts` | The config-gated execution boundary: refuses on pool/mainnet/signer, has no send path. |
| `apps/web/src/app/invest/actions.ts` | Server action that builds (never sends) a deposit; the browser holds no calldata inputs. |
| `apps/web/src/app/invest/page.tsx` | The `/invest` route. |
| `apps/web/src/components/invest/InvestScreen.tsx` | The Invest UI for the one pool. |

### Calldata tests (D18 evidence)

`apps/web/tests/morpho-deposit.test.ts`, `apps/web/tests/morpho-execution.test.ts`,
`apps/web/tests/invest-screen.test.tsx`. They decode the built calldata strictly
through the Morpho Blue ABI and pin a real reference vector: `marketId`
reproduces the canonical Ethereum-mainnet USDC/WETH 86% market id
`0x94b823e6bd8ea533b4e33fbc307faea0b307301bc48763acc4d4aa4def7636cd`.

## Configuration keys (pool address and chain id, not hard-coded)

Server-only, read by `apps/web/src/lib/invest/morpho-config.ts`. Values live in
`apps/web/.env.local` (never the repository root, never committed).

| Key | Meaning |
|---|---|
| `KADE_MORPHO_MORPHO_ADDRESS` | The Morpho Blue contract to call. |
| `KADE_MORPHO_LOAN_TOKEN` | The market's loan token (USDC). |
| `KADE_MORPHO_COLLATERAL_TOKEN` | The market's collateral token. |
| `KADE_MORPHO_ORACLE` | The market's oracle. |
| `KADE_MORPHO_IRM` | The market's interest-rate model. |
| `KADE_MORPHO_LLTV` | The market's LLTV, as a decimal uint256 string. |
| `KADE_MORPHO_POOL_ID` | Optional: the expected market id, checked against the derived one. |

The **chain id is not a separate key**: it is `CHAIN_IDS.ethereum` from the
frozen chain registry in `@kade/shared` (mainnet, per §6.3), so the pool can only
ever be the mainnet one. These are `[arbitrary]` names until the project confirms
the pool; no value is invented for them.

## Out of scope for this front

- `apps/web/src/components/shell/nav.ts` — unlocking the Invest route is the
  integration owner's change; this branch leaves it locked.
- `packages/shared/**` (front 00), `apps/web/src/lib/wallet/**` (front 03).
- Reflecting the resulting position in Holdings — that is D17 (front 04). The
  `public.allocations` table already exists (migration `20260916000003`) and is
  the intended home; wiring it is a follow-on once a deposit can execute.

## Corrective history

- The front verifier (DISCOVERY) raised **F1** (blocking): `readMorphoPoolConfig`
  parsed `KADE_MORPHO_MORPHO_ADDRESS` outside the address guard, so a malformed
  value threw out of the reader — and out of `isMorphoConfigured` — crashing
  `/invest` instead of returning `null`.
- Corrected in `956c62d`: every address is parsed inside the guard, and a
  regression test pins malformed-address → `null` / `false` without throwing.
  Recheck verdict: **REVIEW PASSED**, F1 resolved.
- Non-blocking warnings left open for integration: **W1** `signerDeployed` is
  wired to the Safe deployment record rather than the WebAuthn signer contract
  (depends on front 01); **W2** the execution gate flags are client-supplied;
  **W3** gate misclassification; **W4** `ready-to-execute` can be returned after
  `execute`; **W5** the chain label is hard-coded in the component; **W6**
  present-tense deposit copy.

## Verification

See the Appendix D evidence note returned with this front. `./scripts/verify.sh`
is run and its exact result reported there, including the pre-existing flaky
`onboarding-flow.test.tsx` jsdom test if it fires.
