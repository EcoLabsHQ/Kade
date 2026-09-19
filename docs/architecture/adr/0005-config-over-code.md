# ADR 0005 — Configuration over code

**Status:** accepted · 17 September 2026
**Refs:** week-1 contract sections 2.1, 3 (EXE-002); DOCX sections 7 and 14

## Context

Three statements in the governing documents point the same way:

- Contract section 2.1: both fees live in the single `fee_schedule` table with a
  `mode` column; **no amount is hard-coded in the client**.
- Contract section 3 (EXE-002): chains, token metadata, contract placeholders
  and demo/production fee schedules are **migration-seeded**.
- Build guide section 14: "flipping demo → production, or adding a fourth chain,
  must be a config change with no code edit."

## Decision

- **Two switches, no duplicated amounts.** `KADE_CHAIN_ENV` selects the chain
  set; `KADE_FEE_MODE` selects the fee schedule rows. Nothing else branches on
  environment for these concerns.
- **The fee formula is data at runtime.** The pre-approval fee is computed in
  the database by `public.preapproval_fee_usdc(mode, household_size)`, which
  reads the active `fee_schedule` rows. `preapprovalFeeUsdc()` in `@kade/shared`
  is the reference implementation, used to generate and verify the seeded rows;
  the seed generator asserts the two agree for household sizes 1–1000 before it
  writes a row. The server reads the database, and the client only displays what
  the server resolves.
- **Addresses come from the `chains` table**, not from environment variables read
  at request time. The seed is generated from `@kade/shared`'s registry so there
  is one source for chain constants.
- **Provenance travels with the value.** Anything the governing documents do not
  state is marked `arbitrary` and must not be presented as approved.

## Consequences

- The fee displayed and the fee enforced cannot diverge, because both derive
  from the same seeded row and the same database function, and the seed asserts
  that function reproduces the `@kade/shared` reference for household sizes
  1–1000.
- `tests/acceptance` asserts the contract's two worked examples (1.75 demo,
  447 production for a household of three), so a schedule edit that breaks the
  documented behaviour fails CI.
- Adding a chain is a registry entry plus a migration, not a new code path.

## Alternatives considered

- **Environment variables per amount** — rejected; drifts from the seeded
  schedule that the contracts will enforce.
- **Hard-coded demo prices behind a build flag** — rejected; it is the specific
  failure mode the build guide warns about, and it is untestable without a
  rebuild.
