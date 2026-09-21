-- =============================================================================
-- Passkey signer write (D2, migration 20260916000017).
--
-- Asserts the security properties the migration claims, all of which are
-- invisible to the TypeScript tests (which mock the database):
--
--   * the function writes the signer for the caller's own credential;
--   * it cannot write another resident's credential, even when the credential
--     id is known -- the `profile_id = auth.uid()` predicate is the guard;
--   * it refuses to move an existing non-null signer to a different address,
--     but a re-supplied identical value is a no-op success;
--   * it rejects a call with no authenticated user;
--   * EXECUTE is granted to `authenticated` and revoked from `anon`;
--   * `authenticated` still has no direct column privilege on `signer_address`.
--
-- Scoping is exercised through `auth.uid()` (the JWT claim) rather than by
-- switching role, so the test proves the function's own predicate, not the
-- caller's privileges. One block does run as `authenticated` to prove the
-- granted path works end to end.
--
-- finish(true) raises on a failed assertion so psql exits non-zero. The plan
-- count is exact: pgTAP checks curr_test <> plan before it checks failures, so a
-- wrong plan(n) would mask failures and still exit 0.
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(16);

-- ---------------------------------------------------------------------------
-- Fixtures. This runs as the migration owner, so RLS does not apply here.
-- ---------------------------------------------------------------------------
insert into auth.users (id, aud, role, email, encrypted_password)
values
  ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated',
   'resident-a@example.test', ''),
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated',
   'resident-b@example.test', '');

insert into public.profiles (id, email, first_name, last_name)
values
  ('11111111-1111-1111-1111-111111111111', 'resident-a@example.test', 'A', 'A'),
  ('22222222-2222-2222-2222-222222222222', 'resident-b@example.test', 'B', 'B');

insert into public.passkey_credentials (profile_id, credential_id, public_key)
values
  ('11111111-1111-1111-1111-111111111111', 'cred-a',  'pk-a'),
  ('22222222-2222-2222-2222-222222222222', 'cred-b',  'pk-b'),
  ('11111111-1111-1111-1111-111111111111', 'cred-a2', 'pk-a2');

-- ---------------------------------------------------------------------------
-- No authenticated user: rejected, and nothing is written.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '', true);
select throws_ok(
  $$select public.save_passkey_signer('cred-a', '0xaaaaaaaa')$$,
  '28000',
  null,
  'a call with no authenticated user is rejected'
);

-- ---------------------------------------------------------------------------
-- A resident writes their own signer.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111', true);

select lives_ok(
  $$select public.save_passkey_signer('cred-a', '0xaaaaaaaa')$$,
  'resident A writes the signer on their own credential'
);

select is(
  (select signer_address from public.passkey_credentials
    where credential_id = 'cred-a'),
  '0xaaaaaaaa',
  'the signer is persisted for A'
);

-- ---------------------------------------------------------------------------
-- A resident cannot write another resident's signer, even knowing its id.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select public.save_passkey_signer('cred-b', '0xbbbbbbbb')$$,
  'P0002',
  null,
  'resident A cannot write resident B''s signer'
);

select is(
  (select signer_address from public.passkey_credentials
    where credential_id = 'cred-b'),
  null::text,
  'B''s signer is untouched'
);

-- ---------------------------------------------------------------------------
-- The signer is immutable once set.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select public.save_passkey_signer('cred-a', '0xcccccccc')$$,
  '23514',
  null,
  'an existing signer cannot be moved to a different address'
);

select is(
  (select signer_address from public.passkey_credentials
    where credential_id = 'cred-a'),
  '0xaaaaaaaa',
  'the original signer is unchanged after a refused move'
);

select lives_ok(
  $$select public.save_passkey_signer('cred-a', '0xaaaaaaaa')$$,
  're-supplying the same signer is an idempotent no-op'
);

select is(
  (select signer_address from public.passkey_credentials
    where credential_id = 'cred-a'),
  '0xaaaaaaaa',
  'the signer is still the original after the no-op'
);

-- ---------------------------------------------------------------------------
-- A second resident writes their own signer.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub',
  '22222222-2222-2222-2222-222222222222', true);

select lives_ok(
  $$select public.save_passkey_signer('cred-b', '0xbbbbbbbb')$$,
  'resident B writes the signer on their own credential'
);

select is(
  (select signer_address from public.passkey_credentials
    where credential_id = 'cred-b'),
  '0xbbbbbbbb',
  'the signer is persisted for B'
);

-- ---------------------------------------------------------------------------
-- The granted path works as the `authenticated` role.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111', true);
set local role authenticated;

select public.save_passkey_signer('cred-a2', '0xdddddddd');

reset role;

select is(
  (select signer_address from public.passkey_credentials
    where credential_id = 'cred-a2'),
  '0xdddddddd',
  'authenticated can execute the function for its own credential'
);

-- ---------------------------------------------------------------------------
-- The privilege layer: execute only to authenticated, and the column stays
-- out of the direct write grants.
-- ---------------------------------------------------------------------------
select ok(
  has_function_privilege(
    'authenticated', 'public.save_passkey_signer(text, text)', 'EXECUTE'
  ),
  'authenticated may execute save_passkey_signer'
);

select ok(
  not has_function_privilege(
    'anon', 'public.save_passkey_signer(text, text)', 'EXECUTE'
  ),
  'anon may not execute save_passkey_signer'
);

select ok(
  not has_column_privilege(
    'authenticated', 'public.passkey_credentials', 'signer_address', 'UPDATE'
  ),
  'authenticated has no direct UPDATE on signer_address'
);

select ok(
  not has_column_privilege(
    'authenticated', 'public.passkey_credentials', 'signer_address', 'INSERT'
  ),
  'authenticated has no direct INSERT on signer_address'
);

select * from finish(true);

rollback;
