# Kade — resident platform (MVP)

Kade is the resident platform for investment-linked residency programmes. An
applicant pays a pre-approval fee onchain, holds qualifying assets in a locked
Safe vault on Ethereum, Arbitrum or Base, invests in local and tokenized
instruments, moves money through a licensed fiat partner and spends on a card.
Governments get a machine-verified queue, attested records and revenue on every
rail. First deployment: the Curaçao investor permit.

> **Status:** Week 1 foundations, **all-testnet iteration 1**. The mechanical
> gate (`./scripts/verify.sh`) passes. See
> [What is and is not verified](#what-is-and-is-not-verified) before relying on
> any of it.

## Hackathon context

| Item | Value |
|---|---|
| Event | Colosseum Crypto World's Fair (14 Sep – 12 Oct 2026) |
| Work window | Only work from 14 Sep onward is judged |
| Feature freeze | Wed 7 Oct 2026 |
| Internal upload target | Fri 9 Oct 2026 |
| Hard deadline | Mon 12 Oct 2026, 11:59 pm PT |
| Tracks | Ethereum (main), Arbitrum, Base |
| Model | Startup pitch + accelerator application, not a code contest |

## Networks and stack

- **Target chains:** Ethereum, Arbitrum, Base — same Safe address on all three.
- **Iteration 1:** Ethereum Sepolia (deploy) + Base Sepolia (predicted
  address). Arbitrum is deferred (contract v1.6). The five EAS schemas are
  registered on Sepolia (D6).
- **Stack:** Safe{Core} + ERC-4337 · Pimlico paymaster · EAS · Self (ZK passport
  identity) · USDC + Circle CCTP · Snapshot · Supabase · GOS (fiat + card) ·
  Reflect (USD vault) · Safe WebAuthn · Next.js, wagmi/viem.

## Repository layout

```text
apps/web                     Next.js 15 application (shell, login, onboarding)
packages/shared              frozen cross-package contracts
packages/contracts           KadeLock + EAS schema tooling (Foundry)
supabase/                    migrations, RLS policies, seeds
tests/acceptance/            executable form of the frozen Week 1 contract
tests/regressions/           tests protecting previously fixed bugs
reference/mvp-onchainisland/ the deployed MVP UI, vendored as visual baseline
docs/architecture/           decisions (ADRs) and the data model
docs/                        governing contracts and planning sources
scripts/                     setup, verification and regression tooling
```

## Getting started

Requires Node >= 20.18 and, for the contracts package, [Foundry](https://book.getfoundry.sh/).

```bash
./scripts/setup.sh          # npm install + pinned Foundry dependencies
cp .env.example .env.local  # then fill in the project-supplied values
./scripts/verify.sh         # the mechanical gate
npm run dev                 # http://localhost:3000
```

`./scripts/verify.sh` is the only mechanical gate. It runs typecheck, lint, unit
tests, acceptance tests, regression tests, build, `forge build` and
`forge test`. `./scripts/verify-full.sh` adds the expensive,
environment-dependent checks (integration, E2E) when they exist.

## Architecture

Data ownership follows one rule from the build guide: **records on Ethereum,
balances anywhere.** Anything a third party must verify is attested once;
anything that is merely value can sit on the cheapest chain.

| Layer | Responsibility |
|---|---|
| `apps/web` | Presentation, session handling, client-side validation |
| `supabase` | Workflow facts, RLS, seeds. Never the source of truth for money |
| `packages/contracts` | KadeLock policy and the EAS schema manifest |
| `packages/shared` | Chains, fees, schemas, Safe inputs, auth model — frozen contracts |

Key decisions are recorded in [`docs/architecture/`](docs/architecture/):

- [0001 — Monorepo and toolchain](docs/architecture/adr/0001-monorepo-and-toolchain.md)
- [0002 — Web framework and design system](docs/architecture/adr/0002-web-framework-and-design-system.md)
- [0003 — Authentication and signing separation](docs/architecture/adr/0003-auth-and-signing-separation.md)
- [0004 — Data ownership and RLS](docs/architecture/adr/0004-data-ownership-and-rls.md)
- [0005 — Configuration over code](docs/architecture/adr/0005-config-over-code.md)
- [0006 — Contracts toolchain and KadeLock](docs/architecture/adr/0006-contracts-toolchain-and-kadelock.md)

### Authentication model

Two authorities, deliberately separate:

| | Credential | Grants |
|---|---|---|
| Application session | Google OAuth or email magic link, via Supabase | Access to the resident's own rows |
| Transaction signing | Passkey (direct Safe WebAuthn signer) | Authorising Safe transactions |

Google OAuth and email magic link are the permitted logins; there is no
password field and no wallet login. The passkey is created after sign-in and is
never requested during sign-in, and neither session type can authorise a
transaction. See
[ADR 0003](docs/architecture/adr/0003-auth-and-signing-separation.md) and
contract v1.2 section 8.2.

## Week 1 scope (frozen)

Deliverables D1–D8 across packages EXE-001–EXE-006 (20 human
development/orchestration hours; agents run in parallel).

| Package | Outcome |
|---|---|
| EXE-001 | Repo (private), environments, provider config, Supabase setup |
| EXE-002 | `chains` and `fee_schedule` seeded (testnet active) |
| EXE-003 | Google or email magic-link login, protected routes, transaction passkey |
| EXE-004 | Resident Safe on Ethereum Sepolia + predicted L2 addresses |
| EXE-005 | Steps 1–2 live, persisted, with server-calculated fee |
| EXE-006 | Five EAS schemas on Sepolia + tested KadeLock baseline |

**In scope:** onboarding Steps 1–2, Safe, passkey, EAS, KadeLock (tested, not
deployed), fee calculation.

**Out of scope for Week 1:** recovery, external wallet connection, payment
execution, paymaster beyond deployment, indexer, L2 Safe deployment, Aave vault,
full KYC/Self flow, admin review UI, GOS, CCTP, card, investment, voting.

See [`docs/week-1-frozen-delivery-contract.md`](docs/week-1-frozen-delivery-contract.md)
for the full contract, gates and acceptance evidence.

## What is and is not verified

This section exists because the Week 1 contract forbids presenting unverified
work as complete.

**Verified by `./scripts/verify.sh`:**

- Typecheck, lint and build of the web application.
- Unit, acceptance and Foundry tests, including the frozen fee model
  (`1.75 USDC` demo and `447 USDC` production for a household of three), the
  five schema names, Safe threshold and ownership invariants, and the
  login/signing separation.
- `KadeLock` compiles and its policy tests pass: unauthorised configuration,
  lock enforcement before `unlockAt`, permitted and rejected destinations, and
  post-unlock behaviour.
- The committed `supabase/seed.sql` is byte-for-byte reproducible from
  `packages/shared`, so the database and the application cannot disagree.
- The Supabase schema, RLS and seed are applied to the live project and verified
  there: 20 tables, RLS on all 20, 10 deny-by-default, and the fee function and
  its triggers reproduce the contract's worked examples.

**Verified outside the gate — not by the agent:**

- **Google sign-in was completed end to end by the project owner**, who signed in
  and restored the session. That result is theirs; the agent verified the
  redirect boundary only.
- **The five EAS schema registrations on Ethereum Sepolia were executed by the
  project owner** from `0x9907Edd6D403AC420cF1A84b10f0d134b13baa84`, after the
  Onchain gate approved the exact encodings. `npm run eas:verify --workspace
  @kade/contracts` re-reads `getSchema()` from the registry and confirms each
  schema string, resolver and revocable flag against the manifest; the UIDs,
  transactions and block numbers are in
  `packages/contracts/eas/registered-uids.json`.

**Not yet verified:**

- **Email magic link has not been delivered and followed.** The provider is
  enabled and the form is implemented and tested, but no link has completed the
  round trip through a real mailbox.
- **Database RLS enforcement.** The policies are applied to the live project with
  RLS enabled on all 20 tables and 10 deny-by-default, but no committed harness
  exercises row visibility: enforcement is Postgres's, configured through
  Supabase.
- **Credential metadata surviving reload against a live session.** Enrolment
  writes the credential id, public key, transports and user-verification flag to
  `passkey_credentials`, and `/account` reloads them server-side; the path is
  unit-tested. No signed-in end-to-end run has exercised the live write. The
  derived `signer_address` is server-written and needs
  `public.save_passkey_signer`, a SECURITY DEFINER function scoped to the
  caller's own credential, so no service-role key is needed; without it the credential still persists,
  the signer stays NULL, and the panel says so rather than faking it.
- **A test signature through the direct Safe WebAuthn signer.** The signer
  address is now derived from the passkey, but signing requires a deployed Safe
  and a real assertion. A Safe **is** deployed on Sepolia; signing has not been
  exercised end to end.
- **Any on-chain write other than the EAS schema registrations.** No attestation
  has been issued, and KadeLock is not deployed. The resident Safe is deployed
  on Sepolia, but no attestation
  deployed: the deployment engine exists at `apps/web/src/lib/safe/deploy.ts`
  but is not wired into the application and its payer key is not configured. The
  EAS tooling only generates, prints and verifies the plan and never broadcasts;
  the five registrations were sent from outside the repository.

## Human approval gates

No irreversible on-chain write happens before its gate is approved
(week-1 contract section 7):

1. **Foundation** — repository shape, environment contract, schema/RLS matrix, shared types.
2. **Account** — authentication separation, passkey implementation, Safe initializer, deterministic deployment inputs.
3. **Onchain** — exact EAS encodings and the KadeLock interface/threat model.
4. **Acceptance** — a human executes D8 and reviews the evidence bundle.

## Demo pricing

Roughly 1/1000 of production; the flow and attestations are identical. Values
live in the `fee_schedule` table (`mode` = `demo | production`) and are selected
by `KADE_FEE_MODE`. No amount is hard-coded in the client.

| Function | Production | Demo |
|---|---|---|
| Pre-approval fee | `XCG 500 + XCG 100 per member` (3 → 447 USDC) | `1.00 USDC + 0.25 USDC per member` (3 → 1.75 USDC) |
| Residency service fee | `2,000 USDC` | `10 USDC` |

## Development workflow

All development is governed by `docs/DEVELOPMENT_CONTRACT.md`. The loop:

```text
known-good
    │
    ▼  granular commits
implement
    │
    ▼
./scripts/verify.sh          # mechanical gate
    │
    ▼
reviewer (adversarial)       # once per iteration, read-only
    │
    ▼
git tag -f known-good HEAD   # only after BOTH gates pass
```

Key rules:

- **commit ≠ known-good.** Intermediate commits may be granular and unreviewed.
- The reviewer compares `git diff known-good...HEAD`, not individual commits.
- Never move `known-good` while verification fails or a regression is open.
- CI (`.github/workflows/ci.yml`) runs the same `./scripts/verify.sh` on every
  push and pull request against `main`; `./scripts/verify-full.sh` stays manual.
- Regression tests live in `tests/regressions/`; the bisect protocol is in
  `scripts/regression/README.md`.
- Values absent from the governing documents are labelled `[arbitrary]` and
  must be confirmed at the matching human gate.

## Agent harness (opencode)

- Default primary agent: **`orchestrator`** — executes the contract, enforces
  the human gates, and assembles the evidence bundle.
- **`reviewer`** subagent — the independent adversarial gate (read-only).
- Commands: `/gate <foundation|account|onchain|acceptance>` and
  `/evidence <EXE-00n>`.

Guardrails in `opencode.json` ask before `git push` and any `--broadcast` /
`cast send`. **Restart opencode** after changing agent or config files.

## Prior-work disclosure

Kade is developed for the Colosseum Crypto World's Fair. Only work performed
between 14 September and 12 October 2026 is submitted as hackathon work; earlier
prototypes and third-party components are disclosed here and attributed.

- **Design prototype.** The Kade MVP (`mvp.onchainisland.co`) existed before the
  contest as a static design with no backend and no contracts. Its source
  repository is not published, so the deployed bundle was extracted to
  `reference/mvp-onchainisland/` as the frozen visual baseline. That directory
  is documentation: it is never built, imported or executed, and its provenance
  and hashes are recorded in `PROVENANCE.json`. All application code,
  contracts, schema and integrations in this repository were written from
  14 September 2026.
- **Business case and specification.** `docs/planning/` predates the contest.
- **Third-party and open-source code** is listed below.

## Third-party attribution

| Component | Licence | Use |
|---|---|---|
| Next.js, React, React DOM | MIT | Web application |
| Tailwind CSS | MIT | Styling |
| Supabase JS / SSR | MIT / Apache-2.0 | Auth and Postgres client |
| viem | MIT | Chain interaction |
| zod | MIT | Runtime validation |
| SimpleWebAuthn | MIT | Passkey enrolment |
| Plus Jakarta Sans | SIL OFL 1.1 | Typeface (via `next/font`) |
| forge-std | MIT / Apache-2.0 | Foundry test library — installed, not committed |
| safe-smart-account | **LGPL-3.0** | `Guard` interface — installed, **deliberately not vendored** |
| EAS contracts / SDK | MIT | Attestation schemas |
| USDC addresses | — | From Circle's published contract address list |
| EAS registry addresses | — | From the EAS project's published deployments |

Foundry dependencies are installed by `scripts/setup.sh` and are not committed;
`safe-smart-account` is LGPL-3.0 and is kept out of this MIT-licensed repository
rather than vendored into it.

## Links

- Build guide: `docs/planning/kade-mvp-build-document-v7.docx` (plain-text extract: `.txt`)
- Backlog and 80-hour plan: `docs/planning/kade-mvp-backlog.xlsx`
- Week 1 contract: `docs/week-1-frozen-delivery-contract.md`
- Development contract: `docs/DEVELOPMENT_CONTRACT.md`
- Human approval gates (the four Week 1 checkpoints): `docs/gates/README.md`
- Known gaps and deliberate shortcuts: `docs/known-gaps.md`
- Iteration reports: `docs/reports/2026-09-16-week-1-foundation.md`,
  `docs/reports/2026-09-17-week-1-ui-and-domains.md`,
  `docs/reports/2026-09-17-live-supabase-and-login-methods.md`
