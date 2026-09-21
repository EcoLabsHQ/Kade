-- =============================================================================
-- Kade — watch-only Bitcoin addresses on the existing wallets table.
--
-- Why this exists
--   Step 3 ("show proof of wealth") lets a resident paste a Bitcoin address.
--   Only the address is persisted; the balance is read fresh from a
--   mempool.space-compatible provider through a server action, never the
--   browser. No new table and no new column: `public.wallets`
--   (20260916000003_wealth.sql) already carries profile_id, address, chain,
--   provider, siwe_sig and verified_at.
--
-- Encoding of the amendment (the existing column comments are not rewritten)
--   * chain = 0 is an [arbitrary] sentinel: Bitcoin has no EVM chain id. The
--     column comment from migration 03 still describes the EVM chain ids; this
--     sentinel is the Bitcoin exception.
--   * provider = 'bitcoin-address' is the [arbitrary] encoding for a pasted,
--     watch-only address.
--   * verified_at NULL is the documented meaning "unverified, pasted": the
--     resident supplied the address and no signature proved ownership. siwe_sig
--     stays NULL for the same reason.
--
-- Security
--   Migration 09 already enables RLS and revokes the table from anon and
--   authenticated, so those statements are not repeated. This migration grants
--   the minimum the path needs (select, insert, delete) and adds one owner
--   policy. Both functions are SECURITY INVOKER and pin `search_path`, so row
--   level security still applies as the resident: they grant no capability the
--   session did not already have and can only ever touch the caller's own rows.
--
--   `wealth_snapshots` is deliberately left deny-by-default: only the address is
--   persisted, never a snapshot of the balance.
-- =============================================================================

grant select, delete on table public.wallets to authenticated;
-- Column-scoped insert, like `profiles`: `siwe_sig` and `verified_at` are
-- withheld, so a resident can never declare their own pasted address verified.
-- `record_wallet_address` below inserts exactly these four columns.
grant insert (profile_id, address, chain, provider) on table public.wallets
  to authenticated;

create policy wallets_all_own
  on public.wallets for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- Idempotency for a repeated paste of the same address on the same chain. This
-- is also the conflict target of record_wallet_address below.
create unique index wallets_profile_address_chain_key
  on public.wallets (profile_id, address, chain);

-- ---------------------------------------------------------------------------
-- The 5-address cap is a product rule from contract section 8.7 / v1.7 ("up to
-- 5 Bitcoin addresses"). It is enforced here, at the database boundary, not
-- only in the server action: the resident holds the insert privilege for their
-- own rows, and a trigger is the one place that sees every path — the RPC and a
-- direct PostgREST insert alike.
--
-- A repeat of an address the resident already saved is not a new row (the
-- unique index above makes it a no-op), so it is let through rather than
-- failing the cap, which keeps `record_wallet_address` idempotent at the cap.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_wallet_address_cap()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  k_bitcoin_chain constant integer := 0;
  k_max_addresses constant integer := 5;
  v_count integer;
begin
  if new.chain <> k_bitcoin_chain then
    return new;
  end if;

  if exists (
    select 1
      from public.wallets
     where profile_id = new.profile_id
       and address = new.address
       and chain = new.chain
  ) then
    return new;
  end if;

  select count(*) into v_count
    from public.wallets
   where profile_id = new.profile_id
     and chain = k_bitcoin_chain;

  if v_count >= k_max_addresses then
    raise exception 'At most % Bitcoin addresses may be saved.', k_max_addresses
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.enforce_wallet_address_cap() is
  'BEFORE INSERT guard on public.wallets: refuses a 6th Bitcoin address '
  '(chain = 0) for the same resident. Enforces the contract v1.7 product rule at '
  'the database boundary, because a resident holds the insert privilege for '
  'their own rows and the server action is not the only write path. A repeat of '
  'an address already saved passes through, so the write stays idempotent.';

create trigger wallets_bitcoin_address_cap
  before insert on public.wallets
  for each row execute function public.enforce_wallet_address_cap();

comment on column public.wallets.verified_at is
  'When ownership of the address was cryptographically proven. NULL means the '
  'address was pasted and never verified (the Bitcoin watch-only rows added by '
  'migration 20260921000001 are always NULL).';

-- ---------------------------------------------------------------------------
-- Record the caller's own address. Idempotent on (profile_id, address, chain):
-- a repeat returns the existing row's id rather than inserting a second one.
-- ---------------------------------------------------------------------------
create or replace function public.record_wallet_address(
  p_address  text,
  p_chain    integer,
  p_provider text
)
returns bigint
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_id      bigint;
  v_address text;
begin
  if v_uid is null then
    raise exception 'record_wallet_address requires an authenticated user'
      using errcode = '28000';
  end if;

  if p_address is null or p_address = '' then
    raise exception 'record_wallet_address requires an address'
      using errcode = '22023';
  end if;

  -- Canonicalise like the server action does: trim, and lower-case bech32
  -- (`bc1`/`tb1`) only, never base58, which is case-sensitive. Without this a
  -- direct caller could store the same bech32 address twice.
  v_address := trim(p_address);
  if lower(v_address) like 'bc1%' or lower(v_address) like 'tb1%' then
    v_address := lower(v_address);
  end if;

  insert into public.wallets (profile_id, address, chain, provider)
  values (v_uid, v_address, p_chain, p_provider)
  on conflict (profile_id, address, chain) do nothing
  returning id into v_id;

  if v_id is null then
    select id
      into v_id
      from public.wallets
     where profile_id = v_uid
       and address = v_address
       and chain = p_chain;
  end if;

  return v_id;
end;
$$;

comment on function public.record_wallet_address(text, integer, text) is
  'Stores a pasted watch-only address for the calling resident and returns its '
  'id. SECURITY INVOKER, so RLS still applies as the resident; the policy is the '
  'only thing that decides which row may be written. Idempotent on '
  '(profile_id, address, chain): a repeat returns the existing id. siwe_sig and '
  'verified_at stay NULL, which is the documented "unverified, pasted" meaning.';

-- ---------------------------------------------------------------------------
-- Delete one of the caller's own addresses. Scoped to profile_id = auth.uid();
-- the RLS policy already enforces this, and the predicate repeats it.
-- ---------------------------------------------------------------------------
create or replace function public.delete_wallet_address(p_id bigint)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'delete_wallet_address requires an authenticated user'
      using errcode = '28000';
  end if;

  delete from public.wallets
   where id = p_id
     and profile_id = v_uid;
end;
$$;

comment on function public.delete_wallet_address(bigint) is
  'Deletes one of the calling resident''s own watch-only addresses. SECURITY '
  'INVOKER and scoped to profile_id = auth.uid(); a caller can never remove '
  'another resident''s row.';

revoke all on function public.record_wallet_address(text, integer, text)
  from public, anon;
grant execute on function public.record_wallet_address(text, integer, text)
  to authenticated;

revoke all on function public.delete_wallet_address(bigint) from public, anon;
grant execute on function public.delete_wallet_address(bigint)
  to authenticated;
