# Database tests

pgTAP suites for the parts of the schema whose correctness is not visible in
the TypeScript acceptance tests. They run in a transaction and roll back, so
they never leave fixtures behind.

| File | Covers |
|---|---|
| `0001_fee_recompute.test.sql` | `fee_schedule` formula parameters, `preapproval_fee_usdc()`, the `household_members` / application recompute triggers, mode switching, the definer path, column privileges |
| `0002_passkey_signer.test.sql` | `save_passkey_signer()` scoping, immutability, definer grants and column privileges |
| `0003_admin_review.test.sql` | `is_reviewer()`, the reviewer RLS policies on `review_events` and the decide fields, the `review_events_apply` status trigger, append-only enforcement, and the non-reviewer denial |
| `0004_connected_wallet_sticky.test.sql` | The sticky `connected-wallet` encoding: paste-then-connect and connect-then-paste both end `connected-wallet`, a repeat pasted write is a no-op, a verified row is never re-encoded, the `provider` UPDATE grant is column-scoped, and the 5-address cap is unaffected |
| `support/supabase-shim.sql` | Not a test. Supplies the `auth` schema, `auth.uid()` and the API roles for a plain PostgreSQL |

## With the Supabase CLI

```bash
supabase db reset      # migrations + seed
supabase test db       # runs supabase/tests/*.test.sql
```

## Against a disposable PostgreSQL (no Supabase CLI)

Docker is enough. `postgres:16` needs `pgTAP`; install it from the image's
package repository.

```bash
docker run -d --name kade-pg --rm -e POSTGRES_PASSWORD=postgres \
  -p 55432:5432 postgres:16
docker exec -u root kade-pg bash -lc \
  'apt-get update -qq && apt-get install -y -qq postgresql-16-pgtap'

psql=(docker exec -i kade-pg psql -U postgres -v ON_ERROR_STOP=1 -X -q)
"${psql[@]}" -d postgres < supabase/tests/support/supabase-shim.sql
for f in supabase/migrations/*.sql; do "${psql[@]}" -d postgres < "$f"; done
"${psql[@]}" -d postgres < supabase/seed.sql
"${psql[@]}" -d postgres -f /dev/stdin < supabase/tests/0001_fee_recompute.test.sql
echo "psql exit code: $?"   # 0 on pass

docker rm -f kade-pg
```

## Why `finish(true)`, and why the plan count matters

pgTAP does not fail `psql` by itself. A suite that ends with a bare `finish()`
prints `# Looks like you failed N test(s)` and still exits `0`, so a CI gate
that trusts the exit status reports success on a failing suite. Every suite here
ends with `finish(true)`, which raises and makes `psql` exit non-zero.

Two things defeat it, so both are guarded:

- **A wrong plan count.** `_finish()` checks `curr_test <> plan` *before* it
  checks failures and returns a diagnostic instead of raising. Keep `plan(n)`
  exact; if you add or remove an assertion, update `n`.
- **Trusting the exit status alone.** A CI wrapper should also treat a `not ok`
  line in the output as a failure, in case a suite regresses to a bare
  `finish()`.

To prove the mechanism still works, mutate an expected value in a throwaway copy
and confirm the exit code:

```bash
sed 's/1\.75::numeric/9.99::numeric/' \
  supabase/tests/0001_fee_recompute.test.sql > /tmp/mutated.test.sql
"${psql[@]}" -d postgres -f /dev/stdin < /tmp/mutated.test.sql
echo "psql exit code: $?"   # 3, not 0
```
