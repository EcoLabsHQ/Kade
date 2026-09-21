-- =============================================================================
-- Kade — record the pre-approval fee transaction without the service role.
--
-- Why this exists
--   Week-1 contract section 8.9 / v1.9 adds the pre-approval fee payment from
--   an external wallet. The payment transaction hash belongs in
--   `applications.fee_tx`, which the schema already documents as the
--   "on-chain payment transaction hash, server-written" (20260916000002).
--   `authenticated` has no column privilege on it and the owner may update only
--   `applications.tier`, so a resident cannot write it directly. Writing it
--   therefore needs either the service-role key (the most powerful key in the
--   project, deliberately not configured) or a narrow SECURITY DEFINER function.
--   This is that function, in the shape of `save_passkey_signer`
--   (20260916000017) and the Safe-record writers (20260916000018).
--
-- Security
--   SECURITY DEFINER, so it can write a column `authenticated` cannot. RLS is
--   bypassed by the definition, so the owner predicate is written out
--   explicitly: the only row it can reach is the caller's own application
--   (`profile_id = auth.uid()`). A resident cannot touch another resident's row.
--
--   The stored hash is a CLAIM, not a proof. The function cannot read the chain,
--   so it accepts the hash the server supplies after it has verified the Sepolia
--   receipt; the read path re-verifies the receipt on chain and never derives
--   "paid" from the mere presence of `fee_tx`. Because the hash is only a claim,
--   the function REPLACES the recorded value rather than refusing a different
--   one: refusing would let a fabricated first claim lock the resident out of
--   ever recording a real payment. What is closed is touching another resident's
--   application.
--
--   `search_path` is pinned, EXECUTE is revoked from `public` and `anon`, and
--   granted only to `authenticated` — matching `save_onboarding_step2`,
--   `save_passkey_signer` and the Safe-record writers.
-- =============================================================================

create or replace function public.record_preapproval_fee_tx(
  p_tx_hash text
)
returns public.applications
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_hash text := lower(trim(coalesce(p_tx_hash, '')));
  v_row  public.applications;
begin
  if v_uid is null then
    raise exception 'record_preapproval_fee_tx requires an authenticated user'
      using errcode = '28000';
  end if;

  if v_hash !~ '^0x[0-9a-f]{64}$' then
    raise exception 'record_preapproval_fee_tx requires a 32-byte hex hash, got %',
      p_tx_hash
      using errcode = '22023';
  end if;

  -- Lock the application row so two concurrent calls cannot race the
  -- immutability check below.
  select * into v_row
    from public.applications
   where profile_id = v_uid
   for update;

  if not found then
    raise exception 'no application belongs to the current resident'
      using errcode = 'P0002';
  end if;

  -- The hash is the resident's latest claim, not an immutable fact. The paid
  -- state is re-derived from the receipt, so a later genuine payment must be
  -- recordable even if an earlier claim was wrong. Replacing rather than
  -- refusing is what keeps a fabricated hash from locking the resident out.
  update public.applications
     set fee_tx = v_hash
   where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

-- One transaction proves at most one application's fee, so a real treasury
-- payment cannot be counted twice across residents. A resident can still
-- replace their own claim; only a hash already held by another row collides.
create unique index if not exists applications_fee_tx_key
  on public.applications (fee_tx);

comment on function public.record_preapproval_fee_tx(text) is
  'Records the pre-approval fee payment transaction hash on the calling '
  'resident''s own application. SECURITY DEFINER because `authenticated` has no '
  'column privilege on applications.fee_tx; the explicit owner predicate '
  '(profile_id = auth.uid()) is the only row it can reach, so it grants no '
  'general write capability. The hash is a claim, not a proof: the read path '
  're-verifies the Sepolia receipt. The claim is replaceable, never immutable, '
  'so a fabricated first claim cannot lock the resident out of recording a real '
  'payment. A unique index on applications.fee_tx keeps one transaction from '
  'proving two applications. Replaces the service-role client this write would '
  'otherwise require (week-1 contract v1.9, section 8.9).';

revoke all on function public.record_preapproval_fee_tx(text) from public, anon;
grant execute on function public.record_preapproval_fee_tx(text)
  to authenticated;
