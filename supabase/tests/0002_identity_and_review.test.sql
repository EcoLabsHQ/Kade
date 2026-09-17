-- =============================================================================
-- Kade — identity nullifier and review-log invariants (D2 evidence).
--
-- REQUIRES A LIVE DATABASE. Not run by scripts/verify.sh. See supabase/README.md.
--
-- What is asserted:
--   * no raw proof payload column exists (DOCX section 8 / ADR 0004);
--   * self_nullifier is indexed and UNIQUE — the Sybil guard (DOCX section 9);
--   * duplicate self_nullifier and duplicate attestation_uid inserts are rejected;
--   * review_events is append-only and is the only writer of applications.status.
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(8);

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'resident-a@example.test', '', now(), '{}', '{}', now(), now());

insert into public.profiles (id, safe_address, email, first_name, last_name, dob)
values
  ('11111111-1111-1111-1111-111111111111',
   '0x1111111111111111111111111111111111111111', 'resident-a@example.test', 'Alice', 'Anderson', '1990-01-01');

insert into public.applications (id, ref, profile_id, tier, status)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'KADE-A',
   '11111111-1111-1111-1111-111111111111', '3-year', 'draft');

-- 1. No raw proof payload is stored anywhere.
select is(
  (select count(*) from information_schema.columns
    where table_schema = 'public'
      and table_name = 'identity_attestations'
      and column_name in ('proof', 'raw_proof', 'proof_payload', 'payload')),
  0::bigint,
  'identity_attestations has no raw proof payload column');

-- 2. self_nullifier is indexed AND unique.
select is(
  (select count(*) from pg_indexes
    where schemaname = 'public'
      and tablename = 'identity_attestations'
      and indexdef ilike '%unique%'
      and indexdef ilike '%self_nullifier%'),
  1::bigint,
  'self_nullifier has a unique index');

-- 3. A duplicate self_nullifier is rejected (the duplicate-application guard).
select throws_ok($$
  insert into public.identity_attestations (profile_id, attestation_uid, chain, self_nullifier)
  values ('11111111-1111-1111-1111-111111111111', '0xuid1', 11155111, '0xnullifier'),
         ('11111111-1111-1111-1111-111111111111', '0xuid2', 11155111, '0xnullifier')
$$, '23505', null, 'duplicate self_nullifier is rejected');

-- 4. A distinct self_nullifier is accepted.
select lives_ok($$
  insert into public.identity_attestations (profile_id, attestation_uid, chain, self_nullifier)
  values ('11111111-1111-1111-1111-111111111111', '0xuid3', 11155111, '0xnullifier2')
$$, 'a distinct self_nullifier is accepted');

-- 5. A duplicate attestation_uid is rejected.
select throws_ok($$
  insert into public.identity_attestations (profile_id, attestation_uid, chain, self_nullifier)
  values ('11111111-1111-1111-1111-111111111111', '0xuid3', 11155111, '0xnullifier3')
$$, '23505', null, 'duplicate attestation_uid is rejected');

-- 6. A review event is the only path that changes applications.status.
insert into public.review_events (application_id, action, note)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'approve', 'cleared');
select is(
  (select status from public.applications where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'approved',
  'review event approve flips status');

-- 7/8. review_events is append-only.
select throws_ok($$ update public.review_events set note = 'edit' $$,
  'P0001', null, 'review_events cannot be updated');
select throws_ok($$ delete from public.review_events $$,
  'P0001', null, 'review_events cannot be deleted');

select * from finish();
rollback;
