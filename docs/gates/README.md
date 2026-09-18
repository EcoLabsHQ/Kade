# Week 1 human approval gates

The Week 1 contract (section 7) requires four human checkpoints. Agents may
prepare proposals and code before a gate; no irreversible on-chain write may
happen before the matching gate is approved.

| Gate | Approves | Blocks | Pack |
|---|---|---|---|
| 1. Foundation | Repository shape, environment contract, schema/RLS matrix, shared types | Feature integration | [foundation.md](foundation.md) |
| 2. Account | Authentication separation, passkey implementation, Safe initializer, deterministic deployment inputs | Sepolia deployment | [account.md](account.md) |
| 3. Onchain | Exact EAS encodings, KadeLock interface and threat model | Irreversible registration, contract implementation | [onchain.md](onchain.md) |
| 4. Acceptance | The D8 journey, executed by a human | Declaring Week 1 complete | [acceptance.md](acceptance.md) |

## How to read a pack

Each pack has the same shape:

- **Decision requested** — the smallest thing you have to say yes to.
- **What is already proven** — with the command or artifact that proves it.
- **What is not proven** — stated plainly, with why.
- **What approval authorises** — the irreversible action, if any.
- **What approval does not authorise** — the boundary.

## Rules that hold at every gate

- An agent may prepare anything before a gate; it may not perform the
  irreversible action.
- Approval is recorded with who approved it and when, in the pack itself.
- A gate that is not approved does not stop other work; it stops the specific
  irreversible step.

## Recording an approval

Add a line under the pack's **Approval record**, for example:

```text
Approved: Luuk Weber, 2026-09-19
```
