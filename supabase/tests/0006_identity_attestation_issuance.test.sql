-- =============================================================================
-- Mirror an actually-emitted kade.kyc.v1 attestation.
--
-- Asserts the parts of the storage boundary the TypeScript tests cannot see
-- (they mock the database):
--
--   * `record_identity_attestation` mirrors the emitted UID, the EAS chain id
--     and the five disclosed facts into `identity_attestations`;
--   * it is idempotent on the UNIQUE attestation UID (a replay writes no second
--     row), while the self_nullifier UNIQUE index stays the Sybil guard (a
--     second attestation for the same nullifier raises);
--   * the input guards refuse a bad UID, an alpha-3 nationality, a false
--     predicate, a non-positive chain and a missing expiry;
--   * the writer is `service_role`-only and a resident cannot insert the table;
--   * a resident still reads only their own mirrored row.
--
-- finish(true) raises on a failed assertion so psql exits non-zero. Keep the
-- plan count exact: pgTAP checks curr_test <> plan before it checks failures.
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(20);

-- ---------------------------------------------------------------------------
-- Fixtures. This runs as the migration owner, so RLS does not apply here.
-- ---------------------------------------------------------------------------
insert into auth.users (id, aud, role, email, encrypted_password)
values
  ('44444444-4444-4444-4444-444444444444', 'authenticated', 'authenticated',
   'kade-att-a@example.test', ''),
  ('55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated',
   'kade-att-b@example.test', '');

insert into public.profiles (id, email, first_name, last_name)
values
  ('44444444-4444-4444-4444-444444444444', 'kade-att-a@example.test', 'Ada', 'A'),
  ('55555555-5555-5555-5555-555555555555', 'kade-att-b@example.test', 'Bob', 'B');

-- The emitted attestation, as the emitter would mirror it after a confirmed send.
select public.record_identity_attestation(
  '44444444-4444-4444-4444-444444444444',
  '0x1111111111111111111111111111111111111111111111111111111111111111',
  11155111,
  'NL',
  true,
  true,
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  timestamptz '2030-01-01 00:00:00+00'
);

-- ---------------------------------------------------------------------------
-- The mirror records the emitted UID, chain and facts.
-- ---------------------------------------------------------------------------
select is(
  (select nationality from public.identity_attestations
    where attestation_uid = '0x1111111111111111111111111111111111111111111111111111111111111111'),
  'NL',
  'the disclosed nationality is mirrored'
);
select is(
  (select over18 from public.identity_attestations
    where attestation_uid = '0x1111111111111111111111111111111111111111111111111111111111111111'),
  true,
  'the age predicate is mirrored'
);
select is(
  (select not_sanctioned from public.identity_attestations
    where attestation_uid = '0x1111111111111111111111111111111111111111111111111111111111111111'),
  true,
  'the sanctions predicate is mirrored'
);
select is(
  (select chain from public.identity_attestations
    where attestation_uid = '0x1111111111111111111111111111111111111111111111111111111111111111'),
  11155111,
  'the EAS chain id is mirrored'
);
select is(
  (select self_nullifier from public.identity_attestations
    where attestation_uid = '0x1111111111111111111111111111111111111111111111111111111111111111'),
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'the self nullifier is mirrored'
);
select is(
  (select expires_at from public.identity_attestations
    where attestation_uid = '0x1111111111111111111111111111111111111111111111111111111111111111'),
  timestamptz '2030-01-01 00:00:00+00',
  'the passport expiry is mirrored'
);

-- ---------------------------------------------------------------------------
-- Idempotent on the attestation UID.
-- ---------------------------------------------------------------------------
select public.record_identity_attestation(
  '44444444-4444-4444-4444-444444444444',
  '0x1111111111111111111111111111111111111111111111111111111111111111',
  11155111,
  'NL',
  true,
  true,
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  timestamptz '2030-01-01 00:00:00+00'
);
select is(
  (select count(*)::integer from public.identity_attestations
    where attestation_uid = '0x1111111111111111111111111111111111111111111111111111111111111111'),
  1,
  'a replayed mirror writes no second row'
);

-- ---------------------------------------------------------------------------
-- The writer is service_role-only; a resident cannot insert the table.
-- ---------------------------------------------------------------------------
select ok(
  has_function_privilege(
    'service_role',
    'public.record_identity_attestation(uuid,text,integer,text,boolean,boolean,text,timestamptz)',
    'EXECUTE'
  ),
  'service_role may execute the writer'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.record_identity_attestation(uuid,text,integer,text,boolean,boolean,text,timestamptz)',
    'EXECUTE'
  ),
  'authenticated may not execute the writer'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.record_identity_attestation(uuid,text,integer,text,boolean,boolean,text,timestamptz)',
    'EXECUTE'
  ),
  'anon may not execute the writer'
);
select ok(
  not has_table_privilege('authenticated', 'public.identity_attestations', 'INSERT'),
  'a resident cannot insert identity_attestations'
);
select ok(
  has_table_privilege('authenticated', 'public.identity_attestations', 'SELECT'),
  'a resident can read identity_attestations'
);

-- ---------------------------------------------------------------------------
-- Input guards.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select public.record_identity_attestation(
      '44444444-4444-4444-4444-444444444444',
      '0x1234', 11155111, 'NL', true, true, '0xaa', now())$$,
  '22023',
  null,
  'a malformed attestation UID is refused'
);
select throws_ok(
  $$select public.record_identity_attestation(
      '44444444-4444-4444-4444-444444444444',
      '0x2222222222222222222222222222222222222222222222222222222222222222',
      11155111, 'NLD', true, true, '0xbb', now())$$,
  '22023',
  null,
  'an alpha-3 nationality is refused'
);
select throws_ok(
  $$select public.record_identity_attestation(
      '44444444-4444-4444-4444-444444444444',
      '0x3333333333333333333333333333333333333333333333333333333333333333',
      11155111, 'NL', false, true, '0xcc', now())$$,
  '22023',
  null,
  'a false predicate is refused for a valid attestation'
);
select throws_ok(
  $$select public.record_identity_attestation(
      '44444444-4444-4444-4444-444444444444',
      '0x4444444444444444444444444444444444444444444444444444444444444444',
      11155111, 'NL', true, true, '0xdd', null)$$,
  '22023',
  null,
  'a missing expiry is refused'
);
select throws_ok(
  $$select public.record_identity_attestation(
      '44444444-4444-4444-4444-444444444444',
      '0x5555555555555555555555555555555555555555555555555555555555555555',
      0, 'NL', true, true, '0xee', now())$$,
  '22023',
  null,
  'a non-positive chain id is refused'
);

-- ---------------------------------------------------------------------------
-- The self nullifier stays the Sybil guard: a different UID with the same
-- nullifier raises rather than mirroring a second attestation.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select public.record_identity_attestation(
      '44444444-4444-4444-4444-444444444444',
      '0x6666666666666666666666666666666666666666666666666666666666666666',
      11155111, 'NL', true, true,
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      timestamptz '2031-01-01 00:00:00+00')$$,
  '23505',
  null,
  'a second attestation for the same self nullifier is refused'
);

-- ---------------------------------------------------------------------------
-- A resident reads only their own mirrored row.
-- ---------------------------------------------------------------------------
select set_config(
  'request.jwt.claim.sub',
  '44444444-4444-4444-4444-444444444444',
  true
);
set local role authenticated;

select is(
  (select count(*)::integer from public.identity_attestations),
  1,
  'resident A reads their own mirrored row'
);

reset role;
select set_config(
  'request.jwt.claim.sub',
  '55555555-5555-5555-5555-555555555555',
  true
);
set local role authenticated;

select is(
  (select count(*)::integer from public.identity_attestations),
  0,
  'resident B reads none of resident A''s mirrored rows'
);

reset role;

select * from finish(true);

rollback;
