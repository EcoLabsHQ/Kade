-- =============================================================================
-- Kade — pasted EVM addresses on the existing wallets table.
--
-- Why this exists
--   The Proof-of-wealth step also lets a resident paste an EVM address. Exactly
--   like the Bitcoin path (20260921000001), only the address is persisted; the
--   native balances are read fresh from a Blockscout-compatible provider through
--   a server action, never the browser. There is no new table and no new column:
--   `public.wallets` (20260916000003_wealth.sql) already carries profile_id,
--   address, chain, provider, siwe_sig and verified_at, and its table comment
--   already says "one row per chain the EOA is read on". The EVM write reuses
--   `record_wallet_address(p_address, p_chain, p_provider)` from migration 20
--   once per chain, so this migration only extends the cap, adds a
--   delete-by-address function, and documents the encoding.
--
-- Encoding of the amendment (the existing column comments are not rewritten)
--   * chain is the EVM chain id (1 for Ethereum, 8453 for Base). Unlike Bitcoin
--     there is no sentinel: the real ids are used. The complement `chain <> 0`
--     is therefore "an EVM row" for the cap below.
--   * provider = 'pasted-address' is the [arbitrary] encoding for a pasted,
--     unverified EVM address. The column comment from migration 03 fixes no
--     value; this is the EVM counterpart of 'bitcoin-address'.
--   * verified_at NULL is the documented meaning "unverified, pasted": the
--     resident supplied the address and no signature proved ownership. siwe_sig
--     stays NULL for the same reason. Migration 20 already records this meaning
--     in the column comment; these rows are always NULL too.
--
-- Security
--   Migration 09 already enables RLS and migration 20 already granted the table
--   to authenticated and added the owner policy, so neither the grants nor the
--   policy are touched here. `delete_wallet_addresses` below is SECURITY
--   INVOKER and pins `search_path`, so row level security still applies as the
--   resident: it can only ever delete the caller's own rows. Granting execute to
--   authenticated adds no capability the session did not already have.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- The 5-address cap is the contract **v1.8** product rule, and it applies to
-- both encodings. It is enforced here, at the database boundary, not only in
-- the server action: the resident holds the insert privilege for their own
-- rows, and a trigger is the one place that sees every path — the RPC and a
-- direct PostgREST insert alike.
--
--   * chain = 0 (Bitcoin): at most 5 rows for the profile — unchanged from
--     migration 20.
--   * chain <> 0 (pasted EVM): at most 5 **distinct `address` values** for the
--     profile, because one address is written as one row per chain it is read
--     on. Counting rows would let two chains consume the whole budget.
--
-- A repeat of an address the resident already saved is not a new row (the
-- unique index from migration 20 makes it a no-op), so it is let through rather
-- than failing the cap. That keeps `record_wallet_address` idempotent at the
-- cap for both encodings.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_wallet_address_cap()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  -- One shared constant: the contract v1.8 rule is 5 saved watch-only
  -- addresses for each encoding (Bitcoin and pasted EVM alike).
  k_bitcoin_chain constant integer := 0;
  k_max_addresses constant integer := 5;
  v_count integer;
begin
  -- A repeat of an address already saved on this chain is idempotent: the
  -- unique index turns it into a no-op, so it must pass even when the cap is
  -- reached.
  if exists (
    select 1
      from public.wallets
     where profile_id = new.profile_id
       and address = new.address
       and chain = new.chain
  ) then
    return new;
  end if;

  if new.chain = k_bitcoin_chain then
    select count(*) into v_count
      from public.wallets
     where profile_id = new.profile_id
       and chain = k_bitcoin_chain;

    if v_count >= k_max_addresses then
      raise exception 'At most % Bitcoin addresses may be saved.', k_max_addresses
        using errcode = '23514';
    end if;

    return new;
  end if;

  -- chain <> 0 is a pasted EVM row: cap distinct addresses, because the same
  -- address is stored once per chain it is read on.
  --
  -- An address already saved — on this chain (above) or on another chain — is
  -- not a new distinct address, so it passes. That keeps the write idempotent
  -- for a chain that was previously unreadable when the cap is already reached.
  if exists (
    select 1
      from public.wallets
     where profile_id = new.profile_id
       and address = new.address
       and chain <> k_bitcoin_chain
  ) then
    return new;
  end if;

  select count(distinct address) into v_count
    from public.wallets
   where profile_id = new.profile_id
     and chain <> k_bitcoin_chain;

  if v_count >= k_max_addresses then
    raise exception 'At most % EVM addresses may be saved.', k_max_addresses
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.enforce_wallet_address_cap() is
  'BEFORE INSERT guard on public.wallets. Enforces the contract v1.8 product '
  'rule — at most 5 saved watch-only addresses — for both encodings: 5 rows for '
  'Bitcoin (chain = 0), unchanged from migration 20260921000001, and 5 distinct '
  'address values for pasted EVM rows (chain <> 0), which are stored one row per '
  'chain read. A repeat of an address already saved passes through, so the write '
  'stays idempotent at the cap.';

-- ---------------------------------------------------------------------------
-- Delete every row of one address for the caller. The delete-by-id function
-- (delete_wallet_address from migration 20) cannot remove a pasted EVM address
-- whose rows span multiple chains in one call, so this takes the address and
-- removes the caller's rows for it across both encodings.
-- ---------------------------------------------------------------------------
create or replace function public.delete_wallet_addresses(p_address text)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'delete_wallet_addresses requires an authenticated user'
      using errcode = '28000';
  end if;

  delete from public.wallets
   where profile_id = v_uid
     and address = p_address;
end;
$$;

comment on function public.delete_wallet_addresses(text) is
  'Deletes all of the calling resident''s own rows for one address, across the '
  'pasted EVM encoding (chain <> 0, one row per chain) and the Bitcoin encoding '
  '(chain = 0). SECURITY INVOKER and scoped to profile_id = auth.uid(); a caller '
  'can never remove another resident''s row. The exact address is matched, so '
  'the caller must pass the stored canonical form.';

revoke all on function public.delete_wallet_addresses(text) from public, anon;
grant execute on function public.delete_wallet_addresses(text) to authenticated;
