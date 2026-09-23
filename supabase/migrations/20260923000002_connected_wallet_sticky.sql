-- =============================================================================
-- Kade — make the `connected-wallet` provider encoding STICKY (week-2 v1.2).
--
-- Why this exists (review finding F2)
--   Step 3 ("show proof of wealth") offers two independent actions: connect a
--   wallet through the browser extension or WalletConnect, or paste an address.
--   They can be performed in either order and can target the same address.
--   Migration 20260921000001 made `record_wallet_address` idempotent with
--   `on conflict ... do nothing`, so the second write of an address was always a
--   silent no-op and the provider of the first write survived. That meant:
--
--     * paste-then-connect left the row as `pasted-address`. Holdings reads the
--       `connected-wallet` encoding to decide what belongs in its labelled
--       unverified section, so the connected wallet then became invisible.
--     * connect-then-paste kept `connected-wallet` only by accident of order.
--
--   The fix makes the encoding order-independent. A connected write re-encodes
--   an existing **unverified** row; a pasted write never changes an existing
--   row's provider. The connected encoding is "sticky".
--
-- What changes
--   * `grant update (provider)` to authenticated, column-scoped only.
--   * `record_wallet_address` replaces its `do nothing` conflict clause with a
--     conditional `do update` guarded to the connected encoding and to
--     `verified_at is null`.
--
-- What does NOT change
--   * The signature, return type, SECURITY INVOKER, `search_path`, the auth
--     guard, the address canonicalisation and the id-return fallback.
--   * The pasted path: `addWalletAddress` still writes `pasted-address`, and a
--     repeat paste is still a no-op that returns the existing id.
--   * `siwe_sig` / `verified_at`: still never written here and still withheld
--     from `authenticated`. A verified row is never re-encoded.
--   * `record_wallet_ownership`, the EAS schemas, KadeLock, the Safe/passkey
--     code, the 5-address cap trigger and every table, column, policy, index or
--     data value.
--
-- Trust boundary
--   The connected encoding is not a capability and `provider` is not proof of
--   control: a connected row stays `verified_at NULL`, is not evidence that the
--   resident controls the address, and is excluded from the Holdings total
--   (contract v1.2). `verified_at` remains the only verified marker and is
--   written only by `public.record_wallet_ownership`. The resident can only
--   reach their own rows (`profile_id = auth.uid()`), so this narrow UPDATE
--   grant lets a resident re-label the provider of their own unverified row —
--   not another resident's row, and not the verified marker.
--
-- Applied state
--   Migration 27 (`20260923000001_connected_wallet_provider.sql`) is
--   comment-only and migration 28 (this file) is DDL; neither is applied to the
--   live project yet. See docs/known-gaps.md and docs/gates/foundation.md.
-- =============================================================================

-- Column-scoped UPDATE, matching the column-scoped INSERT in migration
-- 20260921000001: only `provider` is granted. `siwe_sig` and `verified_at` stay
-- ungranted, so no write path can let a resident declare their own address
-- verified.
grant update (provider) on table public.wallets to authenticated;

-- ---------------------------------------------------------------------------
-- Record the caller's own address. Idempotent on (profile_id, address, chain):
-- a repeat returns the existing row's id rather than inserting a second one.
--
-- The conflict clause is the sticky encoding: an existing row is re-encoded to
-- `connected-wallet` only when the incoming write is connected AND the row is
-- still unverified. Every other conflict (a pasted write over anything, or a
-- connected write over a verified row) leaves the stored provider untouched,
-- and the fallback below returns the existing id.
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
  -- The connected encoding is sticky (week-2 contract v1.2): a connected write
  -- re-encodes an existing unverified row; a pasted write never changes one.
  k_connected_provider constant text := 'connected-wallet';
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
  on conflict (profile_id, address, chain) do update
    set provider = excluded.provider
    where excluded.provider = k_connected_provider
      and public.wallets.verified_at is null
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
  'Stores a watch-only address for the calling resident and returns its id. '
  'SECURITY INVOKER, so RLS still applies as the resident; the policy is the '
  'only thing that decides which row may be written. Idempotent on '
  '(profile_id, address, chain): a repeat returns the existing id. The '
  '`connected-wallet` encoding is sticky (week-2 contract v1.2): an incoming '
  'connected write re-encodes an existing row only when that row is still '
  'unverified, and a pasted write never changes an existing row''s provider, so '
  'the outcome does not depend on the order of the connect and paste actions. '
  'siwe_sig and verified_at are never touched here and remain withheld from '
  '`authenticated`; verified_at is written only by '
  'public.record_wallet_ownership, and a verified row is never re-encoded. '
  '`provider` is not a capability and the resident can only reach their own '
  'rows.';
