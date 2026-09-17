-- =============================================================================
-- Pre-approval fee recomputation (D2, contract section 2.1).
--
-- Asserts:
--   * public.preapproval_fee_usdc() reproduces the frozen formula for both
--     modes and both worked examples (demo 3 -> 1.75, production 3 -> 447);
--   * applications.preapproval_usdc is recomputed by the household_members
--     trigger on insert, delete and a move between applications;
--   * the active mode is read from the `kade.fee_mode` setting;
--   * an insert performed as the `authenticated` role still recomputes the
--     protected column, which only works because the trigger runs as definer;
--   * `authenticated` has no column privilege on preapproval_usdc.
--
-- finish(true) raises on a failed assertion so psql exits non-zero. A bare
-- finish() only prints a summary and still exits 0, which would let a failing
-- suite be reported as success (the failure mode the RLS harness was removed
-- for; see the contract, section 8.1). Note the plan must be exact: pgTAP's
-- _finish() checks curr_test <> plan first and returns a diagnostic instead of
-- raising, so a wrong plan(n) can mask failing assertions. The count below is
-- asserted by running the suite and is deliberately exact.
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(19);

-- ---------------------------------------------------------------------------
-- The function reproduces the frozen fee model (contract section 2.1).
-- ---------------------------------------------------------------------------
select is(
  public.preapproval_fee_usdc('demo', 3),
  1.75::numeric,
  'demo, household of 3 -> 1.75 USDC'
);

select is(
  public.preapproval_fee_usdc('production', 3),
  447::numeric,
  'production, household of 3 -> 447 USDC'
);

select is(
  public.preapproval_fee_usdc('demo', 1),
  1.25::numeric,
  'demo, applicant only -> 1.25 USDC'
);

select is(
  public.preapproval_fee_usdc('production', 1),
  335::numeric,
  'production, applicant only -> 335 USDC'
);

select is(
  public.preapproval_fee_usdc('demo', 4),
  2.00::numeric,
  'demo, household of 4 -> 2.00 USDC (per-member increment is applied)'
);

select throws_ok(
  'select public.preapproval_fee_usdc(''demo'', 0)',
  '22023',
  null,
  'household_size below 1 is rejected'
);

select throws_ok(
  'select public.preapproval_fee_usdc(''nope'', 3)',
  '22023',
  null,
  'an unknown mode is rejected instead of returning NULL'
);

-- ---------------------------------------------------------------------------
-- Fixtures. This runs as the migration owner, so RLS does not apply here.
-- ---------------------------------------------------------------------------
insert into auth.users (id, aud, role, email, encrypted_password)
values (
  '11111111-1111-1111-1111-111111111111',
  'authenticated', 'authenticated', 'resident@example.test', ''
);

insert into public.profiles (id, email, first_name, last_name)
values (
  '11111111-1111-1111-1111-111111111111',
  'resident@example.test', 'Resident', 'Test'
);

set local kade.fee_mode = 'demo';

insert into public.applications (id, profile_id, tier)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '11111111-1111-1111-1111-111111111111', '3-year');

-- ---------------------------------------------------------------------------
-- Application creation initialises the applicant-only (size 1) fee.
-- ---------------------------------------------------------------------------
select is(
  (select preapproval_usdc from public.applications
    where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1.25::numeric,
  'inserting an application sets the size-1 demo fee'
);

insert into public.household_members (application_id, name)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Member One');

select is(
  (select preapproval_usdc from public.applications
    where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1.50::numeric,
  'adding a household member recomputes to size 2'
);

insert into public.household_members (application_id, name)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Member Two');

select is(
  (select preapproval_usdc from public.applications
    where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1.75::numeric,
  'adding a second member reaches the demo worked example (1.75)'
);

delete from public.household_members
 where application_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
   and name = 'Member Two';

select is(
  (select preapproval_usdc from public.applications
    where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1.50::numeric,
  'deleting a household member recomputes downwards'
);

-- ---------------------------------------------------------------------------
-- The active mode is data: switching the setting changes the fee.
-- ---------------------------------------------------------------------------
set local kade.fee_mode = 'production';

insert into public.applications (id, profile_id, tier)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        '11111111-1111-1111-1111-111111111111', '3-year');

select is(
  (select preapproval_usdc from public.applications
    where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  335::numeric,
  'the same insert in production mode sets 335'
);

insert into public.household_members (application_id, name)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Prod Member One');

insert into public.household_members (application_id, name)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Prod Member Two');

select is(
  (select preapproval_usdc from public.applications
    where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  447::numeric,
  'production household of 3 reaches the worked example (447)'
);

-- ---------------------------------------------------------------------------
-- Moving a member between applications recomputes both sides.
-- ---------------------------------------------------------------------------
update public.household_members
   set application_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
 where application_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select is(
  (select preapproval_usdc from public.applications
    where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  335::numeric,
  'the source application returns to the size-1 production fee'
);

select is(
  (select preapproval_usdc from public.applications
    where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  503::numeric,
  'the destination application recomputes at size 4 (503)'
);

-- ---------------------------------------------------------------------------
-- A resident-driven insert must still recompute the protected column.
-- ---------------------------------------------------------------------------
set local kade.fee_mode = 'demo';
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111',
  true
);
set local role authenticated;

insert into public.household_members (application_id, name)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Resident Member');

-- No explicit id: the authenticated role is granted insert on (profile_id,
-- tier) only, mirroring how the browser creates an application.
insert into public.applications (profile_id, tier)
values ('11111111-1111-1111-1111-111111111111', '3-year');

reset role;

select is(
  (select preapproval_usdc from public.applications
    where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1.50::numeric,
  'an authenticated household insert triggers the definer recompute'
);

select is(
  (select preapproval_usdc from public.applications
    where profile_id = '11111111-1111-1111-1111-111111111111'
      and id not in ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                     'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')),
  1.25::numeric,
  'an authenticated application insert triggers the size-1 definer recompute'
);

-- ---------------------------------------------------------------------------
-- The column stays protected at the privilege layer.
-- ---------------------------------------------------------------------------
select ok(
  not has_column_privilege(
    'authenticated', 'public.applications', 'preapproval_usdc', 'UPDATE'
  ),
  'authenticated may not UPDATE applications.preapproval_usdc'
);

select ok(
  not has_column_privilege(
    'authenticated', 'public.applications', 'preapproval_usdc', 'INSERT'
  ),
  'authenticated may not INSERT applications.preapproval_usdc'
);

select * from finish(true);

rollback;
