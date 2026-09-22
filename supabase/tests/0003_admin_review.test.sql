-- =============================================================================
-- Admin review — reviewer RLS and the status trigger (D19, EXE-015).
--
-- Asserts the security properties the reviewer surface depends on, which the
-- TypeScript tests cannot see (they mock the database):
--
--   * public.is_reviewer() is true only for a row in public.reviewers;
--   * a reviewer may INSERT a review_events row and the existing
--     review_events_apply trigger flips applications.status for approve, block
--     and reopen;
--   * a non-reviewer INSERT is refused by RLS, so bypassing the server action
--     does not grant the write;
--   * a reviewer may read the decide fields (wallets, identity_attestations,
--     profile_residences, profile_citizenships) of the application;
--   * review_events stays append-only for every role;
--   * applications.status keeps no direct UPDATE/INSERT privilege for
--     authenticated, so the trigger is the only writer.
--
-- finish(true) raises on a failed assertion so psql exits non-zero. The plan
-- count is exact: pgTAP checks curr_test <> plan before it checks failures, so a
-- wrong plan(n) would mask failures and still exit 0.
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(22);

-- ---------------------------------------------------------------------------
-- Fixtures. This runs as the migration owner, so RLS does not apply here.
-- ---------------------------------------------------------------------------
insert into auth.users (id, aud, role, email, encrypted_password)
values
  ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated',
   'reviewer@example.test', ''),
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated',
   'resident@example.test', '');

insert into public.profiles (id, email, first_name, last_name)
values
  ('11111111-1111-1111-1111-111111111111', 'reviewer@example.test', 'Rita', 'Reviewer'),
  ('22222222-2222-2222-2222-222222222222', 'resident@example.test', 'Ada', 'Lovelace');

insert into public.reviewers (id, role)
values ('11111111-1111-1111-1111-111111111111', 'reviewer');

insert into public.applications (id, ref, profile_id, tier, status)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'CW-2026-0409',
        '22222222-2222-2222-2222-222222222222', '3-year', 'pre_approved');

insert into public.wallets (profile_id, address, chain, provider)
values ('22222222-2222-2222-2222-222222222222', 'bc1qexampler', 0, 'bitcoin-address');

insert into public.identity_attestations
  (profile_id, chain, nationality, over18, not_sanctioned, self_nullifier)
values ('22222222-2222-2222-2222-222222222222', 11155111, 'NL', true, true,
        'nullifier-review-test');

insert into public.profile_residences (profile_id, country_code, from_year, to_year)
values ('22222222-2222-2222-2222-222222222222', 'NL', 2020, null);

insert into public.profile_citizenships (profile_id, country_code)
values ('22222222-2222-2222-2222-222222222222', 'NL');

-- ---------------------------------------------------------------------------
-- is_reviewer() reads the reviewers table with definer rights.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub',
  '22222222-2222-2222-2222-222222222222', true);
select is(public.is_reviewer(), false, 'a resident is not a reviewer');

select set_config('request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111', true);
select is(public.is_reviewer(), true, 'a reviewers row makes the user a reviewer');

-- ---------------------------------------------------------------------------
-- A reviewer writes review events; the trigger flips the status.
-- ---------------------------------------------------------------------------
set local role authenticated;

select lives_ok(
  $$insert into public.review_events (application_id, reviewer_id, action, note)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '11111111-1111-1111-1111-111111111111', 'approve', 'ok')$$,
  'a reviewer may append an approve event'
);
reset role;
select is(
  (select status from public.applications
    where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'approved',
  'approve flips the status to approved'
);

set local role authenticated;
select lives_ok(
  $$insert into public.review_events (application_id, reviewer_id, action, note)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '11111111-1111-1111-1111-111111111111', 'block', 'no')$$,
  'a reviewer may append a block event'
);
reset role;
select is(
  (select status from public.applications
    where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'blocked',
  'block flips the status to blocked'
);

set local role authenticated;
select lives_ok(
  $$insert into public.review_events (application_id, reviewer_id, action, note)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '11111111-1111-1111-1111-111111111111', 'reopen', 'again')$$,
  'a reviewer may append a reopen event'
);
reset role;
select is(
  (select status from public.applications
    where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'pre_approved',
  'reopen flips the status to pre_approved'
);

set local role authenticated;
select is(
  (select count(*)::integer from public.review_events),
  3,
  'the reviewer can read the three events they wrote'
);
select is(
  (select count(*)::integer from public.reviewers),
  1,
  'a reviewer can read their own reviewers row'
);
select is(
  (select count(*)::integer from public.wallets),
  1,
  'a reviewer can read the applicant proof of wealth'
);
select is(
  (select count(*)::integer from public.identity_attestations),
  1,
  'a reviewer can read the applicant identity attestation'
);
select is(
  (select count(*)::integer from public.profile_residences),
  1,
  'a reviewer can read the applicant residences'
);
select is(
  (select count(*)::integer from public.profile_citizenships),
  1,
  'a reviewer can read the applicant citizenships'
);

-- ---------------------------------------------------------------------------
-- Append-only. For `authenticated` the refusal is the privilege layer (only
-- SELECT and INSERT are granted); for the owner, who holds the privileges, the
-- `review_events_immutable` trigger is what refuses.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update public.review_events set note = 'edited'$$,
  '42501',
  null,
  'authenticated cannot update the review log'
);
select throws_ok(
  $$delete from public.review_events$$,
  '42501',
  null,
  'authenticated cannot delete from the review log'
);
reset role;

select throws_ok(
  $$update public.review_events set note = 'edited'$$,
  null,
  'review_events is append-only (DOCX section 9)',
  'the append-only trigger refuses an update even for the table owner'
);
select throws_ok(
  $$delete from public.review_events$$,
  null,
  'review_events is append-only (DOCX section 9)',
  'the append-only trigger refuses a delete even for the table owner'
);

-- ---------------------------------------------------------------------------
-- A non-reviewer is refused, and sees nothing.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub',
  '22222222-2222-2222-2222-222222222222', true);
set local role authenticated;

select throws_ok(
  $$insert into public.review_events (application_id, reviewer_id, action)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '22222222-2222-2222-2222-222222222222', 'approve')$$,
  '42501',
  null,
  'a resident cannot append a review event, even for their own application'
);

select is(
  (select count(*)::integer from public.review_events),
  0,
  'a resident cannot read the review log'
);

-- The status column stays trigger-only at the privilege layer.
select ok(
  not has_column_privilege(
    'authenticated', 'public.applications', 'status', 'UPDATE'
  ),
  'authenticated may not UPDATE applications.status'
);
select ok(
  not has_column_privilege(
    'authenticated', 'public.applications', 'status', 'INSERT'
  ),
  'authenticated may not INSERT applications.status'
);

reset role;

select * from finish(true);

rollback;
