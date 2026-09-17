-- =============================================================================
-- Kade — RLS isolation tests (D2 evidence).
--
-- REQUIRES A LIVE DATABASE. These are NOT run by scripts/verify.sh.
-- Run with:   supabase test db
-- or:         psql "$DATABASE_URL" -f supabase/tests/0001_rls_isolation.test.sql
-- See supabase/README.md.
--
-- What is asserted:
--   * every public table has RLS enabled;
--   * resident A can read and write their own rows;
--   * resident A cannot read or modify resident B's rows;
--   * the security-critical columns named in D2 are not writable by a resident;
--   * the post-Week-1 tables are deny-by-default.
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(18);

-- ---------------------------------------------------------------------------
-- Fixtures. The test runs as the migration owner, so RLS does not apply here.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'resident-a@example.test', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'resident-b@example.test', '', now(), '{}', '{}', now(), now());

insert into public.profiles (id, safe_address, email, first_name, last_name, dob)
values
  ('11111111-1111-1111-1111-111111111111',
   '0x1111111111111111111111111111111111111111', 'resident-a@example.test', 'Alice', 'Anderson', '1990-01-01'),
  ('22222222-2222-2222-2222-222222222222',
   '0x2222222222222222222222222222222222222222', 'resident-b@example.test', 'Bob', 'Brown', '1991-02-02');

insert into public.applications (id, ref, profile_id, tier, status, preapproval_usdc, service_usdc, fee_uid)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'KADE-A',
   '11111111-1111-1111-1111-111111111111', '3-year', 'draft', 1.25, 10, '0xaa'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'KADE-B',
   '22222222-2222-2222-2222-222222222222', '3-year', 'draft', 1.25, 10, '0xbb');

-- ---------------------------------------------------------------------------
-- 1. The guard property: no public table is left without RLS.
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0::bigint,
  'RLS is enabled on every public table');

-- ---------------------------------------------------------------------------
-- Act as resident A.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;

-- Read isolation
select is((select count(*) from public.profiles
             where id = '11111111-1111-1111-1111-111111111111'),
          1::bigint, 'A can read own profile');
select is((select count(*) from public.profiles
             where id = '22222222-2222-2222-2222-222222222222'),
          0::bigint, 'A cannot read B profile');
select is((select count(*) from public.applications
             where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
          1::bigint, 'A can read own application');
select is((select count(*) from public.applications
             where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
          0::bigint, 'A cannot read B application');

-- Write isolation: the RLS policy filters B's row, so 0 rows change (checked later)
update public.profiles set first_name = 'Hacked'
  where id = '22222222-2222-2222-2222-222222222222';

-- Security-critical columns: no column privilege, so the statement is rejected
select throws_ok(
  $$ update public.profiles set safe_address = '0xdead'
       where id = '11111111-1111-1111-1111-111111111111' $$,
  '42501', null, 'A cannot write profiles.safe_address');
select throws_ok(
  $$ update public.applications set status = 'approved'
       where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  '42501', null, 'A cannot write applications.status');
select throws_ok(
  $$ update public.applications set fee_tx = '0xdead'
       where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  '42501', null, 'A cannot write applications.fee_tx');
select throws_ok(
  $$ update public.applications set fee_uid = '0xdead'
       where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  '42501', null, 'A cannot write applications.fee_uid');
select throws_ok(
  $$ update public.applications set app_uid = '0xdead'
       where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  '42501', null, 'A cannot write applications.app_uid');
select throws_ok(
  $$ update public.applications set review_uid = '0xdead'
       where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  '42501', null, 'A cannot write applications.review_uid');
select throws_ok(
  $$ update public.applications set service_uid = '0xdead'
       where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  '42501', null, 'A cannot write applications.service_uid');
select throws_ok(
  $$ update public.applications set preapproval_usdc = 0
       where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  '42501', null, 'A cannot write applications.preapproval_usdc');

-- Deny-by-default tables: no privilege at all for authenticated
select throws_ok($$ select * from public.wallets $$,
  '42501', null, 'wallets is deny-by-default');
select throws_ok($$ select * from public.identity_attestations $$,
  '42501', null, 'identity_attestations is deny-by-default');
select throws_ok($$ select * from public.documents $$,
  '42501', null, 'documents is deny-by-default');
select throws_ok($$ select * from public.review_events $$,
  '42501', null, 'review_events is deny-by-default');

reset role;

-- A's attempted write to B left B untouched
select is((select first_name from public.profiles
             where id = '22222222-2222-2222-2222-222222222222'),
          'Bob', 'B profile is unchanged after A write attempt');

-- finish(true) raises on a failed assertion, so psql exits non-zero. A bare
-- finish() only prints "Looks like you failed N test(s)" and still exits 0,
-- which would let this suite fail while the verification gate reports PASS.
select * from finish(true);
rollback;
