# Week 2 — front 02 (invest-morpho) todo and status

**Branch:** `week-2-02-invest-morpho`
**Deliverable:** D18 / EXE-014 — a resident deposits USDC into one Morpho pool
on Ethereum mainnet, fully functional end to end.
**Governing scope:** `docs/week-2-frozen-delivery-contract.md` §2.2 and §6.3
(Morpho on Ethereum mainnet, one pool).

## Status: built and configuration-gated; the live send is not yet exercised

The deposit path is complete as code: the resident allocates through a
**two-phase passkey flow** and the resident Safe is initialised on the deposit
chain — the existing Safe when it is deployed there, otherwise the predicted one
its first sponsored user operation deploys. It is honest about what has not
happened:

- **The live end-to-end send has not been exercised.** There is no committed run
  or transcript of an on-chain user operation, so the engine-to-Pimlico
  integration is untested in practice.
- **The project-supplied configuration is not set.** No MetaMorpho vault address
  (`KADE_MORPHO_VAULT_ADDRESS` / `KADE_MORPHO_USDC_ADDRESS`) and no mainnet RPC
  (`ETHEREUM_RPC_URL`) is present, so `beginDeposit` returns a gated outcome and
  the screen can only build, never send. Nothing is fabricated to fill the gap.

**Consequence:** the calldata is built and unit-tested against the MetaMorpho
(ERC-4626) ABI — deterministic, no network write — and the passkey/4337 call
path is wired, but **no deposit was executed and none is claimed**. A
`sent: true` appears only for a confirmed receipt; every refusal names the stage
it stopped at.

The blocker that the earlier revision of this note listed — a Safe WebAuthn
signer contract that had to be deployed (D-EXE-011) — **does not exist**: the
passkey is the Safe owner and Safe verifies the WebAuthn assertion itself, so a
Safe that is not yet deployed on the deposit chain is deployed by its first
sponsored user operation. The v1.9 Onchain relaxation (below) permits the
mainnet deposit to be broadcast during testing.

## The two-phase passkey flow

The browser never holds the vault address, the underlying USDC, the Pimlico key
or the calldata inputs, and it never holds the operation: the passkey assertion
is browser-only (`navigator.credentials.get`) while the sponsored bundler is a
server secret, so building and signing cannot happen in one server call.
`apps/web/src/app/invest/actions.ts` splits it in two:

1. **`beginDeposit({ safeAddress, amountUsdc })`** — server, signs nothing.
   Resolves the resident, the stored credential and the recorded Safe; resolves
   the vault and mainnet gates **server-side** (no gate flag is taken from the
   caller); builds the `approve` + `deposit` plan; re-derives the Safe on the
   deposit chain (`deriveAccountFromPasskey`) and **refuses if the derived
   address is not the recorded one**; initialises the pack with the existing
   Safe when it is deployed there, otherwise the predicted branch; retains the
   operation server-side and returns only `{ token, hash, credentialId }`.
2. **`completeDeposit({ token, assertion })`** — server, after the browser
   signs. Re-resolves the signer and the deposit-chain Safe, verifies the
   address again, and submits the retained operation. Only the three raw WebAuthn
   assertion pieces cross from the client.

## What was built

| Artifact | Purpose |
|---|---|
| `apps/web/src/lib/invest/morpho-abi.ts` | The canonical MetaMorpho/ERC-4626 `deposit`/`approve` ABI surface. |
| `apps/web/src/lib/invest/morpho-config.ts` | Reads the vault and USDC addresses and the chain id; returns `null` when absent, never a placeholder. |
| `apps/web/src/lib/invest/morpho-deposit.ts` | Builds `USDC.approve(vault, amount)` + `vault.deposit(amount, safe)` for a Safe; pure, unsigned, deterministic. |
| `apps/web/src/lib/invest/morpho-execution.ts` | The config-gated **build** boundary: refuses on vault/mainnet, has no send path. |
| `apps/web/src/lib/safe/execute-safe-4337.ts` | The two-phase resident-Safe engine (`buildResidentSafeBatch` / `submitResidentSafeOperation`). |
| `apps/web/src/lib/safe/execute-safe-4337-env.ts` | The real Pimlico-backed `Safe4337Pack.init` and the env-wired build/submit seams. |
| `apps/web/src/lib/safe/derive-account.ts` | `deriveAccountFromPasskey(signer, { chainId })` — the deposit-chain Safe address and whether it is deployed there. |
| `apps/web/src/app/invest/actions.ts` | The two-phase server actions `beginDeposit` / `completeDeposit`. |
| `apps/web/src/app/invest/page.tsx` | The `/invest` route and the `isMainnetRailConfigured` predicate. |
| `apps/web/src/components/invest/InvestScreen.tsx` | The Invest UI for the one vault. |

### Tests (D18 evidence)

`apps/web/tests/morpho-deposit.test.ts`, `morpho-execution.test.ts`,
`invest-actions.test.ts`, `invest-screen.test.tsx`, `safe-4337-split.test.ts`,
`safe-4337-split-env.test.ts`, `safe-4337-env.test.ts` and
`safe-execute-4337.test.ts`. They decode the built calldata strictly through the
MetaMorpho/ERC-4626 ABI, and pin the two-phase flow: the predicted branch when
the Safe is not deployed on the deposit chain, the existing branch when it is, a
refusal on an address mismatch, the gates resolved server-side, and the
no-signature refusal before anything reaches the bundler.

## Configuration keys (vault address and mainnet RPC, not hard-coded)

Server-only, read by `morpho-config.ts` and `beginDeposit`. Values live in
`apps/web/.env.local` (never the repository root, never committed).

| Key | Meaning |
|---|---|
| `KADE_MORPHO_VAULT_ADDRESS` | The MetaMorpho vault to deposit into. |
| `KADE_MORPHO_USDC_ADDRESS` | The vault's underlying USDC, the token the Safe approves. |
| `ETHEREUM_RPC_URL` | The Ethereum-mainnet JSON-RPC endpoint used at pack init. |
| `PIMLICO_API_KEY` / `PIMLICO_POLICY_ID` | The sponsored bundler keys (server-only). |

The **chain id is not a separate key**: it is `CHAIN_IDS.ethereum` from the
frozen chain registry in `@kade/shared` (mainnet, per §6.3), so the vault can
only ever be the mainnet one. `ETHEREUM_RPC_URL` is the reserved mainnet
variable; the pre-approval fee and the remaining tooling may stay on
`SEPOLIA_RPC_URL`. No value is invented for any key.

## The v1.9 testing relaxation

Contract v1.9 (28 September 2026) relaxes §7 checkpoint 3 for the Invest
MetaMorpho path during testing: the mainnet deposit **may be broadcast** without
a separate Onchain approval. It is scoped to the resident-Safe ERC-4337 deposit
on Ethereum mainnet and does not change fail-closed behaviour or honest
reporting. It is expected to be withdrawn before the Acceptance gate.

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
- The abandoned Morpho-Blue design (`prepareMorphoDeposit` / `execute` and the
  market-parameter keys) was replaced by the MetaMorpho vault build and the
  two-phase flow; this note now describes what exists, not that design.
- The direct-signer blocker (D-EXE-011) and the "signer not deployed" gate were
  removed with the passkey-signer model: the passkey is the Safe owner and needs
  no deployment.

## Verification

`npx tsc --noEmit` and `npx vitest run` are run from `apps/web`; the full-suite
count is reported with the front's evidence. `./scripts/verify.sh` is the
orchestrator's gate and is not run by this front.
