-- =============================================================================
-- Kade — residency service fee.
--
-- Why this exists
--   Week 2 contract section 2.3 charges the residency service fee as part of
--   D16 / EXE-012: "pay the configured residency service fee on the approved
--   chain, verified server-side from the receipt as in D10". The fee amount is
--   already seeded in `fee_schedule` (key `service`), but `applications` had no
--   column to record the service-fee transaction, and no way to store the
--   server-resolved amount `applications.service_usdc`.
--
-- What this migration does
--   1. adds `applications.service_tx` (the on-chain service-fee transaction
--      hash), mirroring `applications.fee_tx` for the pre-approval fee;
--   2. adds `public.residency_service_fee_usdc(mode)`, which reads the seeded
--      `fee_schedule` row so the amount is never hard-coded;
--   3. adds `public.record_residency_service_fee_tx(hash)`, a SECURITY DEFINER
--      writer scoped to the caller's own application, in the shape of
--      `record_preapproval_fee_tx` (20260921000003).
--
-- Security
--   `service_tx` and `service_usdc` are server-written and remain outside the
--   `authenticated` column grants (see 20260916000009_rls.sql). The definer
--   function writes only the row where `profile_id = auth.uid()`.
--
--   The stored hash is a CLAIM, not a proof: the function cannot read the
--   chain. The server verifies the receipt before calling it, and the read path
--   re-verifies the receipt and never derives "paid" from the presence of
--   `service_tx`. The claim is replaceable so a wrong first claim cannot lock
--   the resident out of recording a real payment.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. applications.service_tx.
-- ---------------------------------------------------------------------------
alter table public.applications
  add column if not exists service_tx text;

comment on column public.applications.service_tx is
  'SECURITY-CRITICAL (D2): on-chain residency service fee transaction hash. '
  'Server-written through record_residency_service_fee_tx(), a claim that the '
  'read path re-verifies against the receipt. [arbitrary] the DOCX column list '
  'names service_usdc and service_uid but not a service-fee transaction hash; '
  'this column mirrors fee_tx for the second fee (contract section 2.3).';

-- A claim is scoped per resident, not global: a global unique index would let
-- one resident's claim block another's, exactly as the fee_tx index comment
-- records. The server binds the transfer to the payer; this index must not.
create unique index if not exists applications_profile_service_tx_key
  on public.applications (profile_id, service_tx);

-- ---------------------------------------------------------------------------
-- 2. The service fee as a queryable function.
--
-- SECURITY INVOKER: it reads only `fee_schedule`, which authenticated may
-- already read, so it grants no new capability. The service row stores its fee
-- as base_amount with a zero per-member increment; applying the shared formula
-- keeps this consistent with preapproval_fee_usdc() rather than re-typing the
-- amount.
-- ---------------------------------------------------------------------------
create or replace function public.residency_service_fee_usdc(
  p_mode text
)
returns numeric
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_fee numeric;
begin
  select round(s.base_amount + s.per_member_amount, s.rounding_scale)
    into v_fee
    from public.fee_schedule s
   where s.mode = p_mode
     and s.key = 'service';

  if v_fee is null then
    raise exception 'no residency service fee configured for mode %', p_mode
      using errcode = '22023';
  end if;

  return v_fee;
end;
$$;

comment on function public.residency_service_fee_usdc(text) is
  'Residency service fee in USDC for a mode, computed from the seeded '
  'fee_schedule service row (contract section 2.3). Authoritative for the D16 '
  'service fee; the client may display the result but cannot override it.';

-- ---------------------------------------------------------------------------
-- 3. Record the service-fee transaction.
--
-- SECURITY DEFINER: `service_tx` and `service_usdc` are outside the
-- authenticated column grants, so a resident cannot write them directly. The
-- explicit owner predicate (profile_id = auth.uid()) is the only row it can
-- reach.
-- ---------------------------------------------------------------------------
create or replace function public.record_residency_service_fee_tx(
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
  v_mode text := coalesce(nullif(current_setting('kade.fee_mode', true), ''), 'demo');
  v_row  public.applications;
begin
  if v_uid is null then
    raise exception 'record_residency_service_fee_tx requires an authenticated user'
      using errcode = '28000';
  end if;

  if v_hash !~ '^0x[0-9a-f]{64}$' then
    raise exception 'record_residency_service_fee_tx requires a 32-byte hex hash, got %',
      p_tx_hash
      using errcode = '22023';
  end if;

  select * into v_row
    from public.applications
   where profile_id = v_uid
   for update;

  if not found then
    raise exception 'no application belongs to the current resident'
      using errcode = 'P0002';
  end if;

  -- The amount is the database's own, read from fee_schedule for the active
  -- mode; the client never supplies it (contract section 2.3). The hash is the
  -- resident's latest claim and is replaceable, matching the pre-approval rail.
  update public.applications
     set service_tx = v_hash,
         service_usdc = public.residency_service_fee_usdc(v_mode)
   where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.record_residency_service_fee_tx(text) is
  'Records the residency service fee payment transaction hash on the calling '
  'resident''s own application and stores the fee_schedule-resolved amount. '
  'SECURITY DEFINER because authenticated has no column privilege on '
  'applications.service_tx/service_usdc; the explicit owner predicate '
  '(profile_id = auth.uid()) is the only row it can reach. The hash is a claim, '
  'not a proof: the read path re-verifies the receipt. Replaces the service-role '
  'client this write would otherwise require (contract section 2.3).';

revoke all on function public.residency_service_fee_usdc(text) from public, anon;
grant execute on function public.residency_service_fee_usdc(text)
  to authenticated;

revoke all on function public.record_residency_service_fee_tx(text) from public, anon;
grant execute on function public.record_residency_service_fee_tx(text)
  to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.residency_service_fee_usdc(text)
      to service_role;
    grant execute on function public.record_residency_service_fee_tx(text)
      to service_role;
  end if;
end
$$;
