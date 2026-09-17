# Supabase — schema, RLS and seeds

This directory owns the Kade workflow database: the full DOCX section 9 schema,
row level security, and the generated `chains` / `fee_schedule` seed.

## Verified vs unverified

The Supabase CLI is **not installed** in the environment this was authored in.
The schema was applied to a plain PostgreSQL during development to confirm the
migrations and seed are valid SQL; the Supabase-specific paths below remain
unrun.

| Artifact | Status |
|---|---|
| `supabase/seed.sql` generation | **Verified** — `node scripts/db/generate-seed.mjs` runs and the drift guard passes |
| Migrations apply from a clean database | **Verified** — all 9 applied in order with `ON_ERROR_STOP=1` |
| Seed applies | **Verified** |
| `supabase/config.toml` | **Not verified** — not executed against the Supabase CLI |

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
```

`supabase db reset` is the clean-database path required by D2: it drops the
local database, replays every migration in order, then runs `seed.sql`.

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

- **Every public table has RLS enabled.** The loop at the end of
  `20260916000009_rls.sql` raises if any public table in `public` has RLS off, so
  the migration fails rather than shipping an unprotected table. It runs once, at
  apply time; a table added by a **later** migration is not covered by it, and
  that review is manual.
- **`identity_attestations.self_nullifier` is unique and indexed** — the
  duplicate-application / Sybil guard. Duplicate detection uses the nullifier,
  not name + date of birth (DOCX section 14).
- **No raw proof payload is stored.** `identity_attestations` holds only the
  attestation UID and the disclosed fields (DOCX section 8, ADR 0004).
- **`review_events` is append-only**, enforced by `BEFORE UPDATE/DELETE`
  triggers for every role.

> **Note:** the policies are enforced by Postgres and configured through
> Supabase. This repository no longer ships an RLS test suite: the enforcement
> mechanism is Supabase's, and the policy set is reviewed as SQL rather than
> exercised by a committed harness.

## Seeds

`seed.sql` contains six `chains` rows (Ethereum / Arbitrum / Base, testnet and
mainnet in `@kade/shared`) and four `fee_schedule` rows (both keys in both
`demo` and `production` modes). Both inserts are upserts, so re-running the seed
is safe. Values are generated from `@kade/shared` and the `[arbitrary]` rows are
listed as comments in the file.
