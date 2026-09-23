-- =============================================================================
-- Kade — signed-wallet ownership proof (Week 2 contract section 2.2, D17).
--
-- Why this exists
--   Holdings may only show a wallet whose control was proven by a signature.
--   Pasting an address is registration-only (week-2 contract 2.2 item 3): a
--   pasted row is unverified and must never feed Holdings. This migration adds
--   the storage and the write path for the ownership proof:
--
--     * `wallet_ownership_challenges` holds the server-issued nonce and the
--       exact EIP-191 / EIP-4361-style message the resident signs. It is
--       owner-only (RLS + an owner policy), consistent with migrations
--       20260921000001 and 20260921000002.
--     * `record_wallet_ownership` is the SECURITY DEFINER writer that sets
--       `public.wallets.siwe_sig` / `verified_at` — two columns the
--       `authenticated` role is deliberately not granted (migration
--       20260921000001 grants insert on only profile_id, address, chain,
--       provider). It is scoped to `profile_id = auth.uid()` and refuses to run
--       without a matching, live, unconsumed challenge.
--
-- What "verified" means
--   `verified_at IS NOT NULL` means the resident signed a server-issued
--   challenge with the private key of `address`. It is set here and nowhere
--   else. The pasted paths (migrations 20 and 21) write through
--   `record_wallet_address`, which never sets either column, so every pasted
--   row keeps `verified_at NULL` by construction. The signature confers no
--   authority over the resident Safe and is not a login (week-2 contract 2.2
--   items 2 and 4; week-1 section 8.10).
--
-- Trust boundary (declared, matching `save_passkey_signer` 20260916000017)
--   The ECDSA recovery is done off-chain by `apps/web/src/lib/wallet/
--   ownership.ts` (viem). Postgres cannot recover a secp256k1 key, so this
--   function takes the signature as an argument and cannot itself recompute the
--   signer. It is therefore possible, in principle, for an authenticated
--   resident to call `record_wallet_ownership` directly for their *own* address
--   with a fabricated signature. What is closed by construction is: a pasted
--   address is never verified by the paste path; no resident can verify or
--   touch another resident's row; a proof must use a fresh, unconsumed,
--   unexpired challenge for that exact address; and the challenge is single-use.
--   The value is a product-integrity flag on the resident's own view, not a
--   capability, so the residual is bounded and declared rather than hidden. A
--   server-side re-verification in Holdings is the future closure.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Challenges: one row per server-issued nonce. The message is stored verbatim
-- so verification can require the signature to be over exactly what the server
-- issued, not merely a message the caller happens to present.
-- ---------------------------------------------------------------------------
create table public.wallet_ownership_challenges (
  id          bigint generated always as identity primary key,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  address     text not null,
  nonce       text not null,
  message     text not null,
  issued_at   timestamptz not null default now(),
  expires_at  timestamptz not null,
  consumed_at timestamptz
);

comment on table public.wallet_ownership_challenges is
  'Server-issued ownership-proof challenges (week-2 contract D17). One row per '
  'nonce, holding the exact EIP-191 / EIP-4361-style message the resident signs. '
  'Owner-only via RLS; `record_wallet_ownership` consumes the row on a '
  'successful verification. A challenge is single-use and expires.';
comment on column public.wallet_ownership_challenges.id is
  '[arbitrary] structural primary key.';
comment on column public.wallet_ownership_challenges.nonce is
  'The server-generated nonce embedded in the message. Globally unique, so a '
  'challenge cannot be confused across residents.';
comment on column public.wallet_ownership_challenges.message is
  'The exact message issued to the browser. Verification requires an exact '
  'string match, so a signature over different content is refused.';
comment on column public.wallet_ownership_challenges.consumed_at is
  'When the challenge was used. Non-null means it can never verify again.';

create index wallet_ownership_challenges_profile_id_idx
  on public.wallet_ownership_challenges (profile_id);
-- One live nonce per value; also the lookup key for verification.
create unique index wallet_ownership_challenges_nonce_key
  on public.wallet_ownership_challenges (nonce);

alter table public.wallet_ownership_challenges enable row level security;

revoke all on table public.wallet_ownership_challenges from anon, authenticated;
-- Column-scoped insert: the resident (through the server) supplies the nonce,
-- message and expiry; issued_at and consumed_at are the database's to set.
grant select, delete on table public.wallet_ownership_challenges
  to authenticated;
grant insert (profile_id, address, nonce, message, expires_at)
  on table public.wallet_ownership_challenges to authenticated;

create policy wallet_ownership_challenges_all_own
  on public.wallet_ownership_challenges for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- The writer. SECURITY DEFINER because `authenticated` has no column privilege
-- on wallets.siwe_sig / wallets.verified_at; the explicit owner predicate is
-- the only row it can reach, so it grants no general write capability.
-- ---------------------------------------------------------------------------
create or replace function public.record_wallet_ownership(
  p_address   text,
  p_nonce     text,
  p_message   text,
  p_signature text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid       uuid := auth.uid();
  v_challenge public.wallet_ownership_challenges;
  v_rows      integer;
begin
  if v_uid is null then
    raise exception 'record_wallet_ownership requires an authenticated user'
      using errcode = '28000';
  end if;

  if p_address is null or p_address = '' then
    raise exception 'record_wallet_ownership requires an address'
      using errcode = '22023';
  end if;

  if p_nonce is null or p_nonce = '' then
    raise exception 'record_wallet_ownership requires a nonce'
      using errcode = '22023';
  end if;

  -- A secp256k1 signature is 65 bytes. Refusing anything else keeps junk out of
  -- the column the read path treats as proof.
  if p_signature is null or p_signature !~ '^0x[0-9a-fA-F]{130}$' then
    raise exception 'record_wallet_ownership requires a 65-byte hex signature'
      using errcode = '22023';
  end if;

  -- Lock the challenge so two concurrent calls cannot both consume it.
  select * into v_challenge
    from public.wallet_ownership_challenges
   where profile_id = v_uid
     and address = p_address
     and nonce = p_nonce
     and consumed_at is null
   for update;

  if not found then
    raise exception 'no live ownership challenge for this address and nonce'
      using errcode = 'P0002';
  end if;

  if v_challenge.expires_at <= now() then
    raise exception 'the ownership challenge has expired'
      using errcode = '22023';
  end if;

  -- The signature must be over exactly the message the server issued, not a
  -- message the caller presents with a genuine nonce embedded in it.
  if v_challenge.message <> p_message then
    raise exception 'the signed message does not match the issued challenge'
      using errcode = '22023';
  end if;

  -- Ownership is proven for the address, not for one chain: a key controls the
  -- address on every chain it is read on, so every linked row for it is marked.
  update public.wallets
     set siwe_sig    = p_signature,
         verified_at = now()
   where profile_id = v_uid
     and address = p_address
     and verified_at is null;

  get diagnostics v_rows = row_count;

  -- Either no row is linked, or the address was already verified. The latter is
  -- a harmless repeat, so check for the row separately.
  if v_rows = 0 then
    if not exists (
      select 1
        from public.wallets
       where profile_id = v_uid
         and address = p_address
    ) then
      raise exception 'no linked wallet with this address'
        using errcode = 'P0002';
    end if;
  end if;

  update public.wallet_ownership_challenges
     set consumed_at = now()
   where id = v_challenge.id;
end;
$$;

comment on function public.record_wallet_ownership(text, text, text, text) is
  'Marks one of the caller''s own linked wallets as ownership-verified: sets '
  'wallets.siwe_sig and wallets.verified_at from a signature over a live, '
  'unconsumed server-issued challenge. SECURITY DEFINER because `authenticated` '
  'has no column privilege on those columns; the explicit owner predicate '
  '(profile_id = auth.uid()) is the only row it can reach. Refuses without a '
  'matching, unexpired challenge whose message is byte-identical to the signed '
  'message, and consumes the challenge so it can never verify twice. Owned by '
  'apps/web/src/lib/wallet/ownership.ts; the paste paths never call it.';

-- Re-state the column meanings now that a writer exists. Migration 20 documents
-- `verified_at` as always NULL for pasted rows; this narrows that comment to
-- point at the one path that may set it.
comment on column public.wallets.verified_at is
  'When ownership of the address was cryptographically proven. NULL means the '
  'address was pasted and never verified. Set only by '
  'public.record_wallet_ownership after a signature over a server-issued '
  'challenge (week-2 contract D17); the pasted paths (migrations '
  '20260921000001 and 20260921000002) always leave it NULL.';
comment on column public.wallets.siwe_sig is
  'The EIP-191 signature over the server-issued ownership challenge. NULL for '
  'pasted, unverified rows. Written only by public.record_wallet_ownership.';

revoke all on function public.record_wallet_ownership(text, text, text, text)
  from public, anon;
grant execute on function public.record_wallet_ownership(text, text, text, text)
  to authenticated;
