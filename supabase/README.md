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
| Migrations apply from a clean database | **Verified** — all 20 applied and verified in order with `ON_ERROR_STOP=1`; migrations 21 and 22 are committed but not yet applied |
| Seed applies | **Verified** |
| Fee function + recompute triggers (pgTAP) | **Verified** — `supabase/tests/0001_fee_recompute.test.sql` runs 19 assertions green on a `postgres:16` container; a deliberately failing assertion makes `psql` exit 3 |
| `supabase/config.toml` | **Not verified** — not executed against the Supabase CLI |

## Layout

```text
supabase/
  config.toml                     local stack configuration
  migrations/                     schema, then the auditable RLS migrations
    20260916000001_profiles.sql
    20260916000002_applications.sql
    20260916000003_wealth.sql
    20260916000004_rails.sql
    20260916000005_documents.sql
    20260916000006_identity_attestations.sql
    20260916000007_review_events.sql
    20260916000008_config.sql
    20260916000009_rls.sql         enable RLS, grants, policies, guard
    20260916000010_fee_function.sql  fee formula columns, function, triggers
    20260916000011_save_onboarding.sql  atomic Step 2 save RPC
    20260916000012_reset_demo.sql  demo reset function
    20260916000013_passkey_credentials.sql  passkey metadata table + RLS
    20260916000014_passkey_public_key_comment.sql  comment-only correction
    20260916000015_fee_authority_comment.sql  comment-only correction
    20260916000016_safe_deployments.sql       safe_deployments + safe_pre_deposits
    20260916000017_passkey_signer.sql         SECURITY DEFINER signer writer
    20260916000018_safe_deployment_writes.sql SECURITY DEFINER Safe-record writers
    20260916000019_safe_address_comment.sql     comment-only correction
    20260921000001_bitcoin_wallet_addresses.sql  wallets owner policy + Bitcoin address RPCs
    20260921000002_evm_wallet_addresses.sql      pasted EVM addresses: cap + delete-by-address
    20260921000003_record_preapproval_fee_tx.sql SECURITY DEFINER fee_tx writer
  tests/                          pgTAP suites (see tests/README.md)
    0001_fee_recompute.test.sql
    support/supabase-shim.sql     auth schema/roles for a plain PostgreSQL
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

## Resetting the demo to its base state

The demo should start from the same state every time. `reset_demo_data()` deletes
every resident (which cascades from `auth.users` through profiles, applications,
household members, wallets, attestations, documents and the rail and card rows)
and then asserts that the seeded configuration survived.

```sql
select public.reset_demo_data();
```

It is `SECURITY DEFINER` with `EXECUTE` revoked from `public`, `anon` and
`authenticated`, so it cannot be reached with the publishable key. Run it before
a demo, and after anything that writes resident data.

> **Warning:** only ever run it against the demo project. It is a demo reset, not
> a maintenance tool.

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
migration declares the policies for the original table set; tables added later
carry their own RLS and policies in their own migration — `passkey_credentials`
(migration 13), `safe_deployments` / `safe_pre_deposits` (migration 16) and the
owner-scoped `wallets` policy for pasted Bitcoin addresses (migration 20) and the
cap extension plus `delete_wallet_addresses` for pasted EVM addresses (migration
21).

### Row ownership

| Table | anon | authenticated (owner) | authenticated (reviewer) | server |
|---|---|---|---|---|
| `profiles` | none | read, insert self, update safe columns | read | all |
| `profile_citizenships` | none | read/write own | none | all |
| `profile_residences` | none | read/write own | none | all |
| `applications` | none | read own, insert own, update `tier` | read | all |
| `household_members` | none | read/write own (via application) | none | all |
| `passkey_credentials` | none | read own, insert own, update `last_used_at` (`signer_address` excluded) | none | all |
| `safe_deployments` | none | read own. A direct insert cannot produce a row — every manifest column is `NOT NULL` and outside the grant — but the resident **can** call `record_safe_prediction`, a SECURITY DEFINER function scoped to their own row, which is how the prediction is written. See the note below | none | all |
| `safe_pre_deposits` | none | read own, insert own (`verification_status`, `verified_at` excluded) | none | all |
| `chains` | none | read | read | all |
| `fee_schedule` | none | read | read | all |
| `wallets` | none | read own; insert own (`siwe_sig`, `verified_at` excluded); delete own. The 5-address Bitcoin cap is a `BEFORE INSERT` trigger, enforced regardless of write path | none | all |
| `wealth_snapshots`, `container_balances`, `allocations`, `gos_transfers`, `card_transactions`, `documents`, `identity_attestations`, `reviewers`, `review_events` | none | **none — deny-by-default** | none | all |

"own" means the row's `profile_id` (or its parent application's `profile_id`)
equals `auth.uid()`. A second resident sees zero rows and can change zero rows.

### The SECURITY DEFINER writers

Four functions write columns the `authenticated` role has no privilege on, each
scoped to the caller's own row by an explicit `profile_id = auth.uid()` predicate
(RLS is bypassed by the definition, so that predicate is the only thing deciding
which row may be touched):

| Function | Writes | Migration |
|---|---|---|
| `save_passkey_signer` | `passkey_credentials.signer_address` | 17 |
| `record_safe_prediction` | the `safe_deployments` manifest columns | 18 |
| `record_safe_deployment_outcome` | `safe_deployments` status, tx hash, timestamps | 18 |
| `record_preapproval_fee_tx` | `applications.fee_tx` | 22 |

They exist because the alternative was a service-role key in the deployed
environment, which is the most powerful credential in the project. The trade-off
is deliberate and declared: a resident **can** call these for their own row, so
they can set their own signer or record their own prediction. What is closed is
naming another resident's row, moving an existing prediction's inputs, and
changing a signer once set.

### The resident-written Bitcoin address path (migration 20)

`record_wallet_address` and `delete_wallet_address` are **SECURITY INVOKER**, the
opposite trade-off to the writers above: row level security still applies as the
resident, so `wallets_all_own` (`profile_id = auth.uid()`) is the only thing
deciding which row may be touched, and the column grant is what withholds
`siwe_sig` and `verified_at`. A pasted Bitcoin address is therefore never claimed
to be verified; `verified_at` staying NULL is the meaning "pasted, not proven".
The five-address cap from contract v1.7 is a `BEFORE INSERT` trigger so it holds
for a direct PostgREST insert as well as the RPC.

### Server-written columns (a direct write is refused)

These columns are removed from the `authenticated` column privileges, so a
direct write from the browser is refused. Some of them are still reachable
through the SECURITY DEFINER writers above, which is the deliberate trade-off
described there:

- `profiles.safe_address`
- `passkey_credentials.signer_address` (derived from the public key; the
  resident may write the other credential columns)
- every `safe_deployments` column except `profile_id`: the counterfactual
  address, the status, the deployment transaction hash and all the manifest
  inputs. A direct write is refused; `record_safe_prediction` can write them for
  the caller's own row, so a resident can record their own prediction but cannot
  touch another resident's
- `safe_pre_deposits.verification_status`, `verified_at`: the resident may
  propose a deposit, but only a server-side check may mark it verified
- `wallets.siwe_sig`, `wallets.verified_at`: the resident may add and remove
  their own pasted Bitcoin addresses, but withholding these columns is what stops
  a resident declaring an address verified (contract v1.7)
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

## Fee recomputation tests

`supabase/tests/0001_fee_recompute.test.sql` is a pgTAP suite for the D2 fee
recomputation: both worked examples (1.75 demo, 447 production), the
`household_members` and application triggers, mode switching, the definer path
for a resident insert, and the protected-column privileges.

Run it with the Supabase CLI (`supabase test db`), or against any PostgreSQL
that already has the migrations and seed applied:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/tests/0001_fee_recompute.test.sql
```

`supabase/tests/support/supabase-shim.sql` supplies the `auth` schema,
`auth.uid()` and the API roles that a plain PostgreSQL (for example a
disposable `postgres:16` container) does not provide. It is never applied to a
real Supabase project.

The suite ends with `finish(true)`, which raises on a failed assertion so
`psql` exits non-zero. A bare `finish()` prints a summary and exits 0 even when
assertions fail, which is how a failing suite can be reported as success. The
plan count must be exact: pgTAP checks the plan before it checks failures, so a
wrong `plan(n)` masks failing assertions and `psql` still exits 0.

## Seeds

`seed.sql` contains six `chains` rows (Ethereum / Arbitrum / Base, testnet and
mainnet in `@kade/shared`) and four `fee_schedule` rows (both keys in both
`demo` and `production` modes). Each pre-approval row carries the formula
parameters `base_amount`, `per_member_amount` and `rounding_scale`, in USDC.
Both inserts are upserts, so re-running the seed is safe. Values are generated
from `@kade/shared`; `scripts/db/seed-sql.ts` asserts the parameters reproduce
`preapprovalFeeUsdc()` for household sizes 1..1000 before writing the file, so
the seed cannot drift from the shared implementation.
