-- =============================================================================
-- The sticky `connected-wallet` provider encoding (week-2 contract v1.2,
-- review finding F2).
--
-- Asserts that the order of the two Step 3 actions no longer matters:
--   (a) paste then connect  => the row's provider becomes 'connected-wallet';
--   (b) connect then paste  => the provider stays 'connected-wallet';
--   (c) a repeat pasted write is still a no-op returning the existing id and
--       writing no second row;
--   (d) a verified row is never re-encoded;
--   (e) the 5-distinct-EVM-address cap is unaffected, and the UPDATE grant is
--       column-scoped to `provider` only.
--
-- The RPC is SECURITY INVOKER, so it is exercised as the `authenticated` role
-- with the request subject set, exactly as the server action calls it. That is
-- also what makes the column-scoped UPDATE grant load-bearing: the ON CONFLICT
-- DO UPDATE privilege is checked even when its guard matches no row.
--
-- finish(true) raises on a failed assertion so psql exits non-zero; a bare
-- finish() would still exit 0. Keep the plan count exact.
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(13);

-- ---------------------------------------------------------------------------
-- Fixtures. Runs as the migration owner, so RLS does not apply here.
-- ---------------------------------------------------------------------------
insert into auth.users (id, aud, role, email, encrypted_password)
values (
  '33333333-3333-3333-3333-333333333333',
  'authenticated', 'authenticated', 'sticky@example.test', ''
);

insert into public.profiles (id, email, first_name, last_name)
values (
  '33333333-3333-3333-3333-333333333333',
  'sticky@example.test', 'Sticky', 'Resident'
);

-- The ids the RPC returns, captured so the "same id" assertions are exact.
create temporary table t4_ids (label text primary key, id bigint);
grant all on t4_ids to authenticated;

select set_config(
  'request.jwt.claim.sub',
  '33333333-3333-3333-3333-333333333333',
  true
);
set local role authenticated;

-- (a) paste then connect: the connected write re-encodes the unverified row.
insert into t4_ids values (
  'a_pasted',
  public.record_wallet_address(
    '0x1111111111111111111111111111111111111111', 1, 'pasted-address'
  )
);
insert into t4_ids values (
  'a_connected',
  public.record_wallet_address(
    '0x1111111111111111111111111111111111111111', 1, 'connected-wallet'
  )
);

-- (b) connect then paste: the pasted write leaves the connected encoding.
insert into t4_ids values (
  'b_connected',
  public.record_wallet_address(
    '0x2222222222222222222222222222222222222222', 1, 'connected-wallet'
  )
);
insert into t4_ids values (
  'b_pasted',
  public.record_wallet_address(
    '0x2222222222222222222222222222222222222222', 1, 'pasted-address'
  )
);

-- (c) a repeat pasted write is a no-op that returns the existing id.
insert into t4_ids values (
  'c_first',
  public.record_wallet_address(
    '0x3333333333333333333333333333333333333333', 1, 'pasted-address'
  )
);
insert into t4_ids values (
  'c_repeat',
  public.record_wallet_address(
    '0x3333333333333333333333333333333333333333', 1, 'pasted-address'
  )
);

reset role;

-- ---------------------------------------------------------------------------
-- (a) paste then connect.
-- ---------------------------------------------------------------------------
select is(
  (select id from t4_ids where label = 'a_pasted'),
  (select id from t4_ids where label = 'a_connected'),
  'a connected write over an existing unverified pasted row returns the same id'
);

select is(
  (select provider
     from public.wallets
    where profile_id = '33333333-3333-3333-3333-333333333333'
      and address = '0x1111111111111111111111111111111111111111'
      and chain = 1),
  'connected-wallet',
  'paste-then-connect ends as connected-wallet'
);

-- ---------------------------------------------------------------------------
-- (b) connect then paste.
-- ---------------------------------------------------------------------------
select is(
  (select id from t4_ids where label = 'b_connected'),
  (select id from t4_ids where label = 'b_pasted'),
  'a pasted write over an existing connected row returns the same id'
);

select is(
  (select provider
     from public.wallets
    where profile_id = '33333333-3333-3333-3333-333333333333'
      and address = '0x2222222222222222222222222222222222222222'
      and chain = 1),
  'connected-wallet',
  'connect-then-paste stays connected-wallet'
);

-- ---------------------------------------------------------------------------
-- (c) a repeat pasted write is a no-op.
-- ---------------------------------------------------------------------------
select is(
  (select id from t4_ids where label = 'c_first'),
  (select id from t4_ids where label = 'c_repeat'),
  'a repeat pasted write returns the existing id'
);

select is(
  (select count(*)
     from public.wallets
    where profile_id = '33333333-3333-3333-3333-333333333333'
      and address = '0x3333333333333333333333333333333333333333'
      and chain = 1),
  1::bigint,
  'a repeat pasted write inserts no second row'
);

select is(
  (select provider
     from public.wallets
    where profile_id = '33333333-3333-3333-3333-333333333333'
      and address = '0x3333333333333333333333333333333333333333'
      and chain = 1),
  'pasted-address',
  'a new pasted write is still encoded pasted-address'
);

-- ---------------------------------------------------------------------------
-- (d) a verified row is never re-encoded. Only record_wallet_ownership sets
-- verified_at, so the fixture is written directly as the owner.
-- ---------------------------------------------------------------------------
with inserted as (
  insert into public.wallets (profile_id, address, chain, provider, verified_at)
  values (
    '33333333-3333-3333-3333-333333333333',
    '0x4444444444444444444444444444444444444444',
    1, 'pasted-address', now()
  )
  returning id
)
insert into t4_ids select 'd_verified', id from inserted;

set local role authenticated;
insert into t4_ids values (
  'd_call',
  public.record_wallet_address(
    '0x4444444444444444444444444444444444444444', 1, 'connected-wallet'
  )
);
reset role;

select is(
  (select id from t4_ids where label = 'd_verified'),
  (select id from t4_ids where label = 'd_call'),
  'a connected write against a verified row returns the existing id'
);

select is(
  (select provider
     from public.wallets
    where profile_id = '33333333-3333-3333-3333-333333333333'
      and address = '0x4444444444444444444444444444444444444444'
      and chain = 1),
  'pasted-address',
  'a verified row is never re-encoded'
);

-- ---------------------------------------------------------------------------
-- The UPDATE grant is column-scoped: only `provider` is reachable.
-- ---------------------------------------------------------------------------
select ok(
  has_column_privilege(
    'authenticated', 'public.wallets', 'provider', 'UPDATE'
  ),
  'authenticated may UPDATE wallets.provider'
);

select ok(
  not has_column_privilege(
    'authenticated', 'public.wallets', 'verified_at', 'UPDATE'
  ),
  'authenticated may not UPDATE wallets.verified_at'
);

select ok(
  not has_column_privilege(
    'authenticated', 'public.wallets', 'siwe_sig', 'UPDATE'
  ),
  'authenticated may not UPDATE wallets.siwe_sig'
);

-- ---------------------------------------------------------------------------
-- (e) the 5-distinct-EVM-address cap is unaffected. Four distinct addresses
-- exist; a fifth is accepted, a sixth is refused.
-- ---------------------------------------------------------------------------
set local role authenticated;
insert into t4_ids values (
  'e_fifth',
  public.record_wallet_address(
    '0x5555555555555555555555555555555555555555', 1, 'pasted-address'
  )
);

select throws_ok(
  $$select public.record_wallet_address(
      '0x6666666666666666666666666666666666666666', 1, 'pasted-address'
    )$$,
  '23514',
  null,
  'the 5-address cap still refuses a 6th distinct EVM address'
);

reset role;

select * from finish(true);

rollback;
