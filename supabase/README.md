# Supabase — schema, RLS and seeds

This directory owns the Kade workflow database: the full DOCX section 9 schema,
row level security, and the generated `chains` / `fee_schedule` seed.

## Verified vs unverified

The Supabase CLI is **not installed** in the environment this was authored in.
The suites were run once during development against a plain PostgreSQL using an
ad-hoc `auth` shim, which is how the RLS row below was produced. The shim and
its runner were deliberately **not committed**, so the committed, authoritative
path is `supabase test db` against a real project — and that has not been run.

| Artifact | Status |
|---|---|
| `supabase/seed.sql` generation | **Verified** — `node scripts/db/generate-seed.mjs` runs and the drift guard passes |
| Migrations apply from a clean database | **Verified** — all 9 applied in order with `ON_ERROR_STOP=1` |
| Seed applies | **Verified** |
| `supabase/tests/` pgTAP RLS tests | **Ran once: 29 assertions across 3 suites passed** — against ad-hoc PostgreSQL, not Supabase. Not reproducible from this repository |
| `supabase/config.toml` | **Not verified** — not executed against the Supabase CLI |

Caveats on the RLS result, stated plainly:

- The run used a throwaway shim that reproduced Supabase's `auth.users`,
  `auth.uid()` and API roles. It mirrors Supabase's shape, but it is not
  Supabase, and the shim is not in the repository, so the result cannot be
  re-derived without rebuilding it. Treat it as a development-time check, not as
  D2 evidence, until `supabase test db` has been run against a real project.
- The suites call `finish(true)`. A bare `finish()` does not raise on a failed
  assertion, so `psql` exits 0 and a failing suite would look green; see the
  note under "Running the RLS tests" below.

## Layout

```text
supabase/
  config.toml                     local stack configuration
  migrations/                     schema, then one auditable RLS migration
    20260916000001_profiles.sql
    20260916000002_applications.sql
    20260916000003_wealth.sql
    20260916000004_rails.sql
    20260916000005_documents.sql
    20260916000006_identity_attestations.sql
    20260916000007_review_events.sql
    20260916000008_config.sql
    20260916000009_rls.sql         enable RLS, grants, policies, guard
  tests/                          pgTAP tests (live database required)
  seed.sql                        GENERATED — do not edit
```

## Local setup (requires the Supabase CLI)

Install the CLI first: <https://supabase.com/docs/guides/local-development/cli/getting-started>.

```bash
# 1. Start the local stack (Postgres, Auth, PostgREST, Studio, ...).
supabase start

# 2. Apply migrations and seed from a clean database.
supabase db reset
#    `db reset` also runs supabase/seed.sql by default.

# 3. Run the pgTAP RLS tests.
supabase test db
```

`supabase db reset` is the clean-database path required by D2: it drops the
local database, replays every migration in order, then runs `seed.sql`.

### Running the RLS tests against a plain PostgreSQL

The suites need the `auth` schema with `auth.uid()`, the API roles, and the
`extensions` schema. A Supabase database already has all of them. If you are
using a plain PostgreSQL, provide them yourself before running the suites; they
are the only reason the suites are not portable as-is.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0001_rls_isolation.test.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0002_identity_and_review.test.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0003_rls_completeness.test.sql
```

`DATABASE_URL` is defined in `.env.example`.

If a database is already running, `scripts/verify-full.sh` runs every
`supabase/tests/*.test.sql` whenever `SUPABASE_DB_URL` or `DATABASE_URL` is set,
and prints a loud `SKIP` when neither is.

> **Note:** the suites must call `finish(true)`, not `finish()`. A bare
> `finish()` only prints "Looks like you failed N test(s)" and still exits 0, so
> `psql` reports success and a failing RLS suite would be indistinguishable from
> a passing one. `scripts/verify-full.sh` also greps the TAP output for `not ok`,
> and treats a non-zero `psql` exit as a failure.

## Regenerating the seed

`supabase/seed.sql` is generated from `@kade/shared`; never edit it by hand.

```bash
node scripts/db/generate-seed.mjs            # writes supabase/seed.sql
node scripts/db/generate-seed.mjs --stdout   # prints instead of writing
```

The drift guard in `tests/acceptance/seed-drift.test.ts` regenerates the seed
in memory and fails if the committed file differs byte-for-byte. It runs as part
of the acceptance gate:

```bash
npm run test:acceptance
```

> **Note:** the drift guard runs as part of the acceptance gate, which
> `scripts/verify.sh` invokes. Run it directly with `npm run test:acceptance` or
> `npx vitest run tests/acceptance/seed-drift.test.ts`.

## Security model

Security is enforced in the database, not in the client (ADR 0004). The RLS
migration is the single place it is declared.

### Row ownership

| Table | anon | authenticated (owner) | authenticated (reviewer) | server |
|---|---|---|---|---|
| `profiles` | none | read, insert self, update safe columns | read | all |
| `profile_citizenships` | none | read/write own | none | all |
| `profile_residences` | none | read/write own | none | all |
| `applications` | none | read own, insert own, update `tier` | read | all |
| `household_members` | none | read/write own (via application) | none | all |
| `chains` | none | read | read | all |
| `fee_schedule` | none | read | read | all |
| `wallets`, `wealth_snapshots`, `container_balances`, `allocations`, `gos_transfers`, `card_transactions`, `documents`, `identity_attestations`, `reviewers`, `review_events` | none | **none — deny-by-default** | none | all |

"own" means the row's `profile_id` (or its parent application's `profile_id`)
equals `auth.uid()`. A second resident sees zero rows and can change zero rows.

### Server-written ("the resident proposes, the server decides")

These columns are removed from the `authenticated` column privileges, so even
the owner cannot write them from the browser:

- `profiles.safe_address`
- `applications.status`, `ref`, `preapproval_usdc`, `service_usdc`, `fee_tx`,
  `fee_uid`, `app_uid`, `review_uid`, `service_uid`
- all `identity_attestations` columns (table is deny-by-default)
- `documents.sha256`, `documents.cid` (table is deny-by-default)
- all `review_events` columns (append-only, deny-by-default)

`applications.status` is written by exactly one path: the `SECURITY DEFINER`
trigger on `review_events` inserts. Direct updates of `status` are rejected at
the privilege layer.

The DOCX places the Safe address on `profiles` (STEP 1: "profiles row keyed by
Safe address"), not on `applications`. `profiles.safe_address` is therefore the
protected Safe field; no `applications.safe_address` column exists because the
governing schema does not define one.

### Invariants

- **Every public table has RLS enabled, and this is checked continuously.** Two
  things enforce it, because they cover different moments:
  - the loop at the end of `20260916000009_rls.sql` raises when that migration is
    applied, so a table added *before* it cannot slip through; and
  - `tests/0003_rls_completeness.test.sql` re-asserts it every time the suite
    runs, so a table added by a *later* migration is caught too. The apply-time
    loop alone cannot do that, since it only ever executes once.

  Both are wired into `scripts/verify-full.sh`, which runs the pgTAP suite when a
  `SUPABASE_DB_URL` or `DATABASE_URL` is available and reports a loud SKIP when
  it is not.
- **`identity_attestations.self_nullifier` is unique and indexed** — the
  duplicate-application / Sybil guard. Duplicate detection uses the nullifier,
  not name + date of birth (DOCX section 14).
- **No raw proof payload is stored.** `identity_attestations` holds only the
  attestation UID and the disclosed fields (DOCX section 8, ADR 0004).
- **`review_events` is append-only**, enforced by `BEFORE UPDATE/DELETE`
  triggers for every role.

## Seeds

`seed.sql` contains six `chains` rows (Ethereum / Arbitrum / Base, testnet and
mainnet in `@kade/shared`) and four `fee_schedule` rows (both keys in both
`demo` and `production` modes). Both inserts are upserts, so re-running the seed
is safe. Values are generated from `@kade/shared` and the `[arbitrary]` rows are
listed as comments in the file.
