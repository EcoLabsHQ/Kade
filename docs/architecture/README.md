# Architecture

Kade is a monorepo. This directory records the decisions behind its shape and
the interfaces that are frozen between workstreams.

## Governing documents

| Document | Role |
|---|---|
| `docs/DEVELOPMENT_CONTRACT.md` | How work is verified and promoted. Normative. |
| `docs/week-1-frozen-delivery-contract.md` | What is in scope this week. |
| `docs/planning/kade-mvp-build-document-v7.docx` | Product and technical build guide. |
| `docs/planning/kade-mvp-backlog.xlsx` | Backlog and 80-hour plan. |

Where these disagree, the development contract governs verification and the
Week 1 contract governs scope.

## System shape

```text
                    ┌──────────────────────────────┐
                    │  apps/web — Next.js 15        │
                    │  shell, onboarding, auth      │
                    └───────────┬──────────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
      ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
      │ Supabase      │ │ Safe (ERC-4337│ │ EAS           │
      │ workflow +    │ │ smart account)│ │ attestations  │
      │ RLS + seeds   │ │ passkey signer│ │ on Sepolia    │
      └───────────────┘ └───────────────┘ └───────────────┘
              ▲                 ▲                 ▲
              └─────────────────┴─────────────────┘
                                │
                    ┌───────────┴──────────────────┐
                    │ packages/contracts — KadeLock │
                    │ compiled + Foundry-tested     │
                    └──────────────────────────────┘
```

The build guide's accounting rule drives the split: **records on Ethereum,
balances anywhere.** Anything a third party must verify is attested once;
anything that is merely value can sit on the cheapest chain.

## Repository layout

```text
apps/web                     Next.js application
packages/shared              frozen cross-package contracts (this iteration)
packages/contracts           KadeLock and EAS schema tooling (Foundry)
supabase/                    migrations, RLS, seed data
tests/acceptance/            executable form of the frozen Week 1 contract
tests/regressions/           tests protecting previously fixed bugs
reference/mvp-onchainisland/ the deployed MVP UI, vendored as visual baseline
scripts/                     verification and regression tooling
docs/                        contracts, architecture, planning
```

## Frozen interfaces

Workstreams may not change these without an explicit interface decision. They
exist so parallel work does not drift.

### Package names

| Package | Owns |
|---|---|
| `@kade/web` | the Next.js application |
| `@kade/shared` | chains, fees, EAS schemas, Safe inputs, auth model |
| `@kade/contracts` | KadeLock source, EAS manifest, Foundry tests |

### Environment variables

The full list, with the documented source of each variable, is in
`.env.example`. The two that select behaviour are:

| Variable | Values | Effect |
|---|---|---|
| `KADE_CHAIN_ENV` | `testnet` \| `mainnet` | which chain set is active |
| `KADE_FEE_MODE` | `demo` \| `production` | which `fee_schedule` rows are authoritative |

Both are configuration switches, never code branches that duplicate amounts.

### Shared types

Anything crossing a package boundary is defined in `@kade/shared`. In
particular:

- `ChainConfig` — the seeded `chains` row shape.
- `FeeAmount` / `FEE_KEYS` — the `fee_schedule` row shape.
- `EasSchemaDefinition` — the schema proposal reviewed at the Onchain gate.
- `SafeDeploymentInputs` / `SafeDeploymentRecord` — the D4 manifest.
- `ApplicationSession` / `TransactionAuthorisation` — the two authority domains.

### Provenance convention

Values that the governing documents do not specify carry an explicit marker:
`documented`, `external` (taken from the issuing party's public documentation)
or `arbitrary`. `arbitrary` values are placeholders awaiting a human gate and
must never be presented as approved configuration. See
`packages/shared/src/provenance.ts`.

## Decision records

| ADR | Decision |
|---|---|
| [0001](adr/0001-monorepo-and-toolchain.md) | npm workspaces monorepo, single verification entry point |
| [0002](adr/0002-web-framework-and-design-system.md) | Next.js App Router with design tokens taken from the reference UI |
| [0003](adr/0003-auth-and-signing-separation.md) | Google or email magic-link session, passkey as a separate transaction authority |
| [0004](adr/0004-data-ownership-and-rls.md) | Supabase owns workflow; chains own money and attestations |
| [0005](adr/0005-config-over-code.md) | Chains and fees are seeded configuration, not code |
| [0006](adr/0006-contracts-toolchain-and-kadelock.md) | Foundry; KadeLock compiled and tested but not deployed |

## Human approval gates

No irreversible on-chain write happens before the matching gate is approved
(week-1 contract section 7): Foundation, Account, Onchain, Acceptance. Code and
proposals may be prepared before a gate; execution may not.
