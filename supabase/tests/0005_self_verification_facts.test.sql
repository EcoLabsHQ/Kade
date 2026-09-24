-- =============================================================================
-- Self verification facts — backend/off-chain mode (D16 / EXE-012).
--
-- Asserts the parts of the storage boundary the TypeScript tests cannot see
-- (they mock the database):
--
--   * `record_self_verification` stores the disclosed facts in the repository's
--     encodings (alpha-2 nationality, ISO date expiry) alongside the outcome;
--   * it is idempotent on `verification_id`: a redelivery refreshes the facts and
--     writes no second row;
--   * the fail-closed rule is enforced at the storage boundary: a row cannot
--     persist `over18`/`not_sanctioned` contrary to its status, and the writer
--     requires both to be set;
--   * the input guards still refuse a bad status, an empty dedupe key and a
--     missing profile;
--   * the new columns keep the reviewer/resident access split: a reviewer reads
--     every resident's facts, a resident only their own.
--
-- finish(true) raises on a failed assertion so psql exits non-zero. Keep the
-- plan count exact: pgTAP checks curr_test <> plan before it checks failures.
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(26);

-- ---------------------------------------------------------------------------
-- Fixtures. This runs as the migration owner, so RLS does not apply here.
-- ---------------------------------------------------------------------------
insert into auth.users (id, aud, role, email, encrypted_password)
values
  ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated',
   'facts-reviewer@example.test', ''),
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated',
   'facts-a@example.test', ''),
  ('33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated',
   'facts-b@example.test', '');

insert into public.profiles (id, email, first_name, last_name)
values
  ('11111111-1111-1111-1111-111111111111', 'facts-reviewer@example.test', 'Rita', 'Reviewer'),
  ('22222222-2222-2222-2222-222222222222', 'facts-a@example.test', 'Ada', 'A'),
  ('33333333-3333-3333-3333-333333333333', 'facts-b@example.test', 'Bob', 'B');

insert into public.reviewers (id, role)
values ('11111111-1111-1111-1111-111111111111', 'reviewer');

-- A valid outcome with facts, and an invalid outcome without any.
select public.record_self_verification(
  '22222222-2222-2222-2222-222222222222',
  'valid', '2026-09-24T00:00:00Z', 'nullifier-a', 'sess-a', 'ver_a',
  'NL', true, true, date '2030-01-01'
);
select public.record_self_verification(
  '22222222-2222-2222-2222-222222222222',
  'invalid', null, null, null, 'ver_inv',
  null, false, false, null
);

-- ---------------------------------------------------------------------------
-- The facts are stored in the repository encodings.
-- ---------------------------------------------------------------------------
select is(
  (select status from public.self_verifications where verification_id = 'ver_a'),
  'valid',
  'the valid outcome is stored'
);
select is(
  (select nationality from public.self_verifications where verification_id = 'ver_a'),
  'NL',
  'the nationality is stored as alpha-2'
);
select is(
  (select over18 from public.self_verifications where verification_id = 'ver_a'),
  true,
  'over18 is true for a valid row'
);
select is(
  (select not_sanctioned from public.self_verifications where verification_id = 'ver_a'),
  true,
  'not_sanctioned is true for a valid row'
);
select is(
  (select expires_at from public.self_verifications where verification_id = 'ver_a'),
  date '2030-01-01',
  'the expiry is stored as the ISO date the mapper produced'
);

-- ---------------------------------------------------------------------------
-- Idempotency: the same verification_id refreshes the row and its facts.
-- ---------------------------------------------------------------------------
select public.record_self_verification(
  '22222222-2222-2222-2222-222222222222',
  'valid', '2026-09-25T00:00:00Z', 'nullifier-a', 'sess-a', 'ver_a',
  'DE', true, true, date '2031-02-02'
);

select is(
  (select count(*)::integer from public.self_verifications where verification_id = 'ver_a'),
  1,
  'a redelivered event writes no second row'
);
select is(
  (select nationality from public.self_verifications where verification_id = 'ver_a'),
  'DE',
  'the redelivery refreshes the nationality'
);
select is(
  (select expires_at from public.self_verifications where verification_id = 'ver_a'),
  date '2031-02-02',
  'the redelivery refreshes the expiry'
);

-- ---------------------------------------------------------------------------
-- An invalid outcome carries false predicates and no expiry.
-- ---------------------------------------------------------------------------
select is(
  (select status from public.self_verifications where verification_id = 'ver_inv'),
  'invalid',
  'the invalid outcome is stored'
);
select is(
  (select over18 from public.self_verifications where verification_id = 'ver_inv'),
  false,
  'over18 is false for an invalid row'
);
select is(
  (select not_sanctioned from public.self_verifications where verification_id = 'ver_inv'),
  false,
  'not_sanctioned is false for an invalid row'
);
select ok(
  (select expires_at is null from public.self_verifications where verification_id = 'ver_inv'),
  'an invalid row stores no expiry'
);

-- ---------------------------------------------------------------------------
-- Fail-closed at the storage boundary.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select public.record_self_verification(
      '22222222-2222-2222-2222-222222222222',
      'valid', now(), null, null, 'ver_bad_age', null, false, true, null)$$,
  '23514',
  null,
  'a valid row cannot claim the age predicate failed'
);
select throws_ok(
  $$select public.record_self_verification(
      '22222222-2222-2222-2222-222222222222',
      'valid', now(), null, null, 'ver_bad_ofac', null, true, false, null)$$,
  '23514',
  null,
  'a valid row cannot claim the sanctions predicate failed'
);
select throws_ok(
  $$select public.record_self_verification(
      '22222222-2222-2222-2222-222222222222',
      'invalid', null, null, null, 'ver_bad_inv', null, true, true, null)$$,
  '23514',
  null,
  'an invalid row cannot claim the predicates held'
);
select throws_ok(
  $$select public.record_self_verification(
      '22222222-2222-2222-2222-222222222222',
      'valid', now(), null, null, 'ver_null_preds', null, null, null, null)$$,
  '22023',
  null,
  'the writer requires both predicates to be set'
);

-- ---------------------------------------------------------------------------
-- The input guards are unchanged.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select public.record_self_verification(
      '22222222-2222-2222-2222-222222222222',
      'pending', now(), null, null, 'ver_bad_status', null, true, true, null)$$,
  '22023',
  null,
  'a status that is not valid|invalid is refused'
);
select throws_ok(
  $$select public.record_self_verification(
      '22222222-2222-2222-2222-222222222222',
      'valid', now(), null, null, '', null, true, true, null)$$,
  '22023',
  null,
  'an empty verification_id is refused'
);
select throws_ok(
  $$select public.record_self_verification(
      null, 'valid', now(), null, null, 'ver_no_profile', null, true, true, null)$$,
  '22023',
  null,
  'a missing profile is refused'
);
select throws_ok(
  $$select public.record_self_verification(
      '22222222-2222-2222-2222-222222222222',
      'valid', now(), null, null, 'ver_bad_nat', 'XYZ', true, true, null)$$,
  '23514',
  null,
  'a nationality that is not alpha-2 is refused'
);
select throws_ok(
  $$select public.record_self_verification(
      '22222222-2222-2222-2222-222222222222',
      'valid', now(), null, null, 'ver_old_exp', null, true, true, date '1999-12-31')$$,
  '23514',
  null,
  'an expiry before the century policy is refused'
);

-- ---------------------------------------------------------------------------
-- Access split: a resident reads only their own; a reviewer reads every row.
-- ---------------------------------------------------------------------------
select set_config(
  'request.jwt.claim.sub',
  '22222222-2222-2222-2222-222222222222',
  true
);
set local role authenticated;

select is(
  (select count(*)::integer from public.self_verifications),
  2,
  'resident A reads exactly their own two rows'
);
select is(
  (select nationality from public.self_verifications where verification_id = 'ver_a'),
  'DE',
  'resident A reads their own disclosed facts'
);

reset role;
select set_config(
  'request.jwt.claim.sub',
  '33333333-3333-3333-3333-333333333333',
  true
);
set local role authenticated;

select is(
  (select count(*)::integer from public.self_verifications),
  0,
  'resident B reads none of resident A''s rows'
);

reset role;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111',
  true
);
set local role authenticated;

select is(
  (select count(*)::integer from public.self_verifications),
  2,
  'a reviewer reads every resident''s Self rows'
);
select is(
  (select nationality from public.self_verifications where verification_id = 'ver_a'),
  'DE',
  'a reviewer reads the disclosed facts'
);

reset role;

select * from finish(true);

rollback;
