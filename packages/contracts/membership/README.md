# Colosseum membership — deployment plan (never broadcasts)

The membership contracts (`MembershipManager`, `ColosseumResident`,
`ColosseumCitizen`) are compiled and Foundry-tested and **not deployed**. This
directory holds the tooling that produces a **reviewable deployment plan** — the
deploy order, constructor arguments, predicted addresses and exact calldata — in
the same discipline as the EAS registration tooling
(`scripts/generate-eas-registration-calldata.mjs`).

> **No script here signs or broadcasts.** There is no broadcast mode, no private
> key is read, and every result is `sent: false`. The project owner deploys from
> their own funded account and executes the Safe call. This mirrors the EAS
> model: the tooling generates and verifies the plan, the owner sends.

## Deploy order

1. **`MembershipManager`** — constructor `(initialOwner = Safe)`. The Safe is the
   `Ownable2Step` owner; no administrative permission stays with the deployer.
2. **`ColosseumResident`** — constructor `(manager_)`, the manager from step 1.
   The manager is the only minter/burner.
3. **`ColosseumCitizen`** — constructor `(manager_)`, the manager from step 1.
4. **`MembershipManager.setCollections(resident, citizen)`** — executed by the
   Safe. One-time: the manager reverts on a second call.

## Required inputs (read from configuration; never invented)

Copy `deployment-inputs.example.json` to `deployment-inputs.json` (or point
`KADE_MEMBERSHIP_DEPLOYMENT_INPUTS` at another path) and fill in:

| Input | Meaning |
|---|---|
| `chainId` | The target chain id. |
| `chainName` | The target chain name, for the plan. |
| `rpcUrl` | The target RPC. The planner never dials it; only its host is recorded. |
| `deployer` | The EOA that deploys the three contracts. |
| `safe` | The Safe that will own the manager and call `setCollections`. |
| `deployerNonce` | Optional. When present, the CREATE addresses are predicted deterministically; when absent, addresses and dependent calldata are reported as unknown. |

The planner **fails closed** when any required input is absent or malformed. Do
not commit the real `deployment-inputs.json`; it may carry a provider endpoint.

## Running it

```bash
cd packages/contracts
forge build                 # produces out/<Contract>.sol/<Contract>.json
npm run membership:plan     # writes membership/deployment-plan.json
```

## Open human decision: Arbitrum

`packages/shared/src/chains.ts` marks Arbitrum `active: false` and documents that
the project owner dropped it from iteration 1. This plan does **not** flip that
flag: re-enabling Arbitrum is an explicit human decision, recorded as a note in
the generated plan rather than performed by tooling.
