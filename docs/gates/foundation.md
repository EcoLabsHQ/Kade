# Gate 1 — Foundation

**Approves:** repository shape, environment contract, schema and RLS matrix,
shared types.
**Blocks:** feature integration.

## Decision requested

Confirm that the repository shape, the environment contract, the schema/RLS
matrix and the shared type surface are what the rest of the build should be
written against. No irreversible action is involved.

## What is already proven

| Requirement | Evidence |
|---|---|
| Repository shape | `README.md` layout; three npm workspaces plus `supabase/`; `./scripts/setup.sh` reproduces a clean checkout |
| Environment contract | `.env.example`, every variable grouped by concern and marked `documented` / `external` / `arbitrary` |
| Schema scope | 13 migrations creating all 18 tables (the DOCX section 9 set plus `passkey_credentials`, contract v1.5); applied to the live project |
| RLS matrix | `docs/architecture/data-model.md`; `supabase/migrations/20260916000009_rls.sql` is the single place RLS is declared |
| RLS applied live | 18/18 tables with RLS enabled; 10 deny-by-default with zero policies; owner policies on `profiles`, `applications`, `citizenships`, `residences`, `household_members`, `chains`, `fee_schedule` |
| Seeds | `supabase/seed.sql` generated from `@kade/shared`, byte-for-byte drift guard in `tests/acceptance/seed-drift.test.ts` |
| Fee model | live `preapproval_fee_usdc('demo', 3) = 1.75`, `('production', 3) = 447`; recompute triggers verified |
| Shared types | `packages/shared/src/*` with 67 unit tests |
| Decisions | six ADRs in `docs/architecture/adr/` |

Commands: `./scripts/verify.sh` (all gates), `docs/architecture/data-model.md`
(the RLS matrix in full).

## What is not proven

- **Live row visibility.** No committed harness exercises RLS. The policies are
  reviewed as SQL; contract v1.1 removed the test-evidence requirement. Declared
  in `docs/known-gaps.md`.
- **`supabase/config.toml`** has not been executed by the Supabase CLI (not
  installed here).

## What approval authorises

Continued feature work against these interfaces. Nothing irreversible.

## What approval does not authorise

Any on-chain write, any EAS registration, any Safe deployment.

## Open items folded into this gate

- **Contract v1.3** keeps the repository private; the reviewer is given access.
- **§6.1 escalation** (MVP UI source unavailable) is closed — see
  `docs/architecture/adr/0002-web-framework-and-design-system.md` and
  `reference/design-handoff/PROVENANCE.md`. The source was recovered from the
  deployment and then supplied officially by the project.

## Approval record

_Not yet recorded._
