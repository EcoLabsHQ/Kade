# Change control — fee settlement on Ethereum mainnet

- **Status:** owner-directed, in effect for the demo.
- **Date:** 2026-10-11.
- **Approval:** project owner (explicit direction, see *Approval* below).
- **Supersedes:** `docs/week-2-frozen-delivery-contract.md` v1.9 and v1.10,
  clause "the pre-approval fee and the remaining Sepolia tooling stay on
  Sepolia".
- **Frozen contracts:** **not edited by this change.** The Week 2 contract is
  still frozen at v1.10; this file records the delta and asks the owner to
  formally amend it (see *What is required to close this out*).

This document is the change-control record for making **both fee rails settle
on the active settlement chain** rather than fixing the pre-approval fee to
Sepolia. It is written to be read next to the frozen contracts, not to replace
them.

---

## 1. What changed

Both fee rails now resolve their settlement chain from the active environment
(`KADE_CHAIN_ENV`) instead of assuming Ethereum Sepolia:

- **Onboarding pre-approval fee — server.** `apps/web/src/lib/payments/server.ts`
  (`readFeePaymentConfig` / `isFeePaymentConfigured`) no longer hard-codes the
  Sepolia treasury, the Sepolia RPC endpoint and `CHAIN_IDS.sepolia`; it
  resolves the treasury and endpoint for the active chain
  (`readTreasuryAddressFor` / `readRpcUrlFor`) and takes the USDC address from
  the active chain in `@kade/shared`.
- **Onboarding pre-approval fee — client.** `apps/web/src/components/onboarding/FeePayment.tsx`
  and its server action path now expect the active chain's chain id and USDC
  contract rather than a fixed Sepolia pair, so the wallet is asked to send on
  the chain the server will verify against.
- **Onboarding page.** `apps/web/src/app/onboarding/page.tsx` gates the payment
  control on the active chain's configuration and passes the active chain id
  through to the fee component.
- **Residency service fee — client.** `apps/web/src/components/residency/ServiceFeePayment.tsx`
  is chain-aware: it follows the same active settlement chain the service-fee
  server resolves, instead of always presenting Sepolia.
  (`apps/web/src/lib/residency/service-fee-server.ts` already resolved the
  treasury, endpoint and token from `KADE_CHAIN_ENV`; the client is brought into
  line with it.)

Resulting rails:

| `KADE_CHAIN_ENV` | Settlement chain | Treasury | RPC endpoint | USDC |
|---|---|---|---|---|
| `testnet` | Ethereum Sepolia (11155111) | `TREASURY_ADDRESS` | `SEPOLIA_RPC_URL` | Sepolia USDC (from `@kade/shared`) |
| `mainnet` | Ethereum (1) | `MAINNET_TREASURY_ADDRESS` | `ETHEREUM_RPC_URL` | mainnet USDC `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` (from `@kade/shared`) |

The treasury, endpoint and token are still assembled **on the server** and are
still **not** `NEXT_PUBLIC_`; the client never chooses the recipient. When the
active chain's rail is incomplete the fee step still reports "not configured"
and renders no payment control. No path fabricates a `sent: true`.

## 2. Why

Owner demo direction: the demo must show the fee **paid on Ethereum mainnet**.
The pre-approval fee had been fixed to Sepolia (week-1 §8.9, reaffirmed by the
week-2 v1.9/v1.10 freeze), which cannot demonstrate a mainnet settlement.
Rather than special-case the demo, the rail is made chain-aware so the same
code path settles on either chain the environment selects.

## 3. The frozen clause superseded

`docs/week-2-frozen-delivery-contract.md` v1.9 (under "What this does **not**
change", the chain-model bullet) and v1.10 (the same bullet) both state:

> the chain model: vaults on **mainnet**; the pre-approval fee and the remaining
> Sepolia tooling stay on Sepolia.

(v1.10: "the pre-approval fee stays on Sepolia.")

That clause no longer holds for the pre-approval fee: it now follows the active
settlement chain and can settle on Ethereum mainnet. The clause was written to
pin the fee to Sepolia while the vault rail was on mainnet; the owner has
decided the demo needs the fee itself on mainnet.

**The frozen Week 2 contract is not modified by this change.** It remains the
frozen record of what v1.10 said. This file supersedes the single clause for
the demo and is the honest record that the frozen text and current behaviour
disagree. The Week 1 §8.9 clause and the week-2 §5 config assumptions are
affected by reference; the frozen Week 1 and Week 3 contracts are untouched.

## 4. Approval

**Owner-directed, 2026-10-11.** The project owner directed that the demo's fee
payment settle on Ethereum mainnet, that both fee rails follow the active
settlement chain, that the mainnet rail be activated, and that the existing
`TREASURY_ADDRESS` value be reused as `MAINNET_TREASURY_ADDRESS`. This is a
deliberate, owner-approved testing/demo decision recorded here rather than
applied silently, so a reviewer can see it was not a removed control.

## 5. Risks and assumptions

- **Real mainnet USDC is spent.** On `mainnet`, the demo sends **real** USDC on
  Ethereum (chain 1) to a real treasury, and the sender pays real gas. There is
  no testnet buffer for a mistaken amount or address. Use a demo-sized amount.
- **The mainnet treasury is the existing `TREASURY_ADDRESS` value, reused.**
  The owner asserts that this address is controlled on mainnet. That assertion
  is the load-bearing assumption: if the address is Sepolia-only, mainnet funds
  sent to it could be unrecoverable. The code does not verify chain control of
  the address; it verifies only that the value is a well-formed 20-byte hex
  address.
- **`MAINNET_TREASURY_ADDRESS` and `TREASURY_ADDRESS` carry the same value.**
  They are read through separate variables (so the rails stay independently
  configurable and fail-closed), but the demo sets them equal. Changing one
  without the other silently changes which rail a misconfigured environment
  uses; keep them in step while they share a value.
- **The Safe stays on Sepolia.** The resident Safe is deployed on Ethereum
  Sepolia; the Colosseum credential is minted on Arbitrum One. Under
  `KADE_CHAIN_ENV=mainnet` the app's **active settlement chain** (Ethereum) and
  the **Safe's chain** (Sepolia) differ. This mismatch is already handled in the
  shell/app shell (`apps/web/src/lib/safe/shell.ts`,
  `apps/web/src/components/shell/AppShell.tsx`), which label the active chain
  and the Safe's chain separately. This change does not move the Safe and does
  not make the Safe settle fees.
- **The mainnet settlement rail is otherwise intact.** The pre-approval fee's
  receipt verification, the `fee_schedule`-driven amount, the SECURITY DEFINER
  write path, and the fail-closed "not configured" behaviour are unchanged; only
  the chain selection changes.
- **Supersession is provisional.** This record does not itself amend the frozen
  contract. Until the owner amends Week 2, the frozen text and behaviour differ;
  that discrepancy is intentional and documented here.

## 6. Activation steps

To run the demo on Ethereum mainnet:

1. Set `KADE_CHAIN_ENV=mainnet`.
2. Set `MAINNET_TREASURY_ADDRESS=<treasury>` — for the demo, the existing
   `TREASURY_ADDRESS` value.
3. `ETHEREUM_RPC_URL` is already a required variable in the environment
   contract; ensure it is a working Ethereum mainnet endpoint.
4. Leave `TREASURY_ADDRESS` / `SEPOLIA_RPC_URL` in place: they remain the
   `testnet` rail and its fail-closed fallback.

To return to Sepolia, set `KADE_CHAIN_ENV=testnet`; the pre-approval fee and the
residency service fee settle on Sepolia again.

## 7. What is required to close this out

- The owner should formally amend `docs/week-2-frozen-delivery-contract.md`
  (a v1.11 amendment) to move the pre-approval fee off the "stays on Sepolia"
  clause, or explicitly accept this demo-only supersession. This file is the
  change-control record that makes the delta visible until then.
- The change should be covered by the review gate in the normal way
  (`docs/DEVELOPMENT_CONTRACT.md` §12 and §15) before promotion.

## 8. References

- `docs/week-2-frozen-delivery-contract.md` — v1.9, v1.10 (clause superseded).
- `docs/week-1-frozen-delivery-contract.md` §8.9 — the original Sepolia
  pre-approval fee decision.
- `.env.example` — "Fee payment treasuries" section, updated by this change.
- `apps/web/src/lib/env.ts` — `readTreasuryAddressFor`, `readRpcUrlFor`.
- `apps/web/src/lib/config/mainnet.ts` — mainnet server config.
- `packages/shared/src/chains.ts` — the frozen chain registry (USDC addresses).
