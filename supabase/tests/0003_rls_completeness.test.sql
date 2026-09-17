-- =============================================================================
-- RLS completeness.
--
-- ADR 0004: "A migration that forgets `enable row level security` is a defect,
-- not a detail."
--
-- The loop at the end of `20260916000009_rls.sql` raises at apply time, but it
-- only ever runs once, so it cannot catch a table added by a later migration.
-- This test is the durable form of that invariant: it is re-evaluated every time
-- the suite runs.
--
-- Run with: supabase test db   (or psql -f, see supabase/README.md)
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(3);

select is(
  (
    select count(*)::int
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relrowsecurity
  ),
  0,
  'every table in the public schema has row level security enabled'
);

-- Deny-by-default must mean "RLS on AND no permissive policy", not "RLS off".
select is(
  (
    select count(*)::int
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relrowsecurity
      and not exists (
        select 1 from pg_policy p where p.polrelid = c.oid
      )
      and c.relname not in (
        'wallets', 'wealth_snapshots', 'container_balances', 'allocations',
        'gos_transfers', 'card_transactions', 'documents',
        'identity_attestations', 'reviewers', 'review_events'
      )
  ),
  0,
  'every public table either has a policy or is an intentional deny-by-default table'
);

-- The threat surface: no table may be readable by the anonymous role.
select is(
  (
    select count(*)::int
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee = 'anon'
  ),
  0,
  'the anonymous role has no table privileges in the public schema'
);

-- finish(true) raises on a failed assertion, so psql exits non-zero. A bare
-- finish() only prints "Looks like you failed N test(s)" and still exits 0,
-- which would let this suite fail while the verification gate reports PASS.
select * from finish(true);

rollback;
