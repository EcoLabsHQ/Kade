-- =============================================================================
-- Kade — mirror an actually-emitted kade.kyc.v1 attestation.
--
-- Why this exists
--   `identity_attestations` is the frozen mirror of `kade.kyc.v1` (documentation
--   section 9). Until now nothing emitted `kade.kyc.v1`, so the table stayed
--   empty: `chain` is NOT NULL and there is no chain to record before an
--   attestation exists, and a placeholder row would claim a mirror with no
--   attestation behind it (20260924000010_self_verification_facts.sql).
--
--   The `kade.kyc.v1` emitter now exists
--   (apps/web/src/lib/residency/kyc-emitter.ts). When an attestation is actually
--   sent and its receipt confirms, this migration's writer mirrors the five
--   disclosed facts plus the emitted UID and the EAS chain id. It is called only
--   after a confirmed send — never before — so the table still holds no row that
--   is not backed by an on-chain attestation.
--
-- Trust boundary
--   The mirror is server-written: a resident may read their own rows
--   (20260922000041) but may not write any, and the emitter's server path has no
--   resident session. The writer is therefore SECURITY DEFINER and EXECUTE is
--   granted only to `service_role`, exactly like `record_self_verification`
--   (20260924000010). The caller must have already sent and confirmed the
--   attestation; this function only persists.
--
-- Idempotency and the Sybil guard
--   A redelivered mirror call for the same attestation UID is a no-op update (the
--   UID is UNIQUE), so it writes no duplicate row. The self nullifier keeps its
--   UNIQUE index: a *different* attestation UID carrying the same nullifier
--   raises, which is the frozen duplicate-application / Sybil guard, not a bug.
-- =============================================================================

create or replace function public.record_identity_attestation(
  p_profile_id      uuid,
  p_attestation_uid text,
  p_chain           integer,
  p_nationality     text,
  p_over18          boolean,
  p_not_sanctioned  boolean,
  p_self_nullifier  text,
  p_expires_at      timestamptz
)
returns public.identity_attestations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid          text    := nullif(trim(coalesce(p_attestation_uid, '')), '');
  v_nationality  text    := nullif(upper(trim(coalesce(p_nationality, ''))), '');
  v_nullifier    text    := nullif(trim(coalesce(p_self_nullifier, '')), '');
  v_row          public.identity_attestations;
begin
  if p_profile_id is null then
    raise exception 'record_identity_attestation requires a profile id'
      using errcode = '22023';
  end if;

  -- The attestation UID is the idempotency key; a mirror without one would claim
  -- an attestation that cannot be named.
  if v_uid is null or v_uid !~ '^0x[0-9a-fA-F]{64}$' then
    raise exception 'record_identity_attestation requires a 32-byte hex attestation_uid'
      using errcode = '22023';
  end if;

  if p_chain is null or p_chain <= 0 then
    raise exception 'record_identity_attestation requires a positive chain id'
      using errcode = '22023';
  end if;

  -- The schema attests a disclosed nationality as an ISO 3166-1 alpha-2 code.
  if v_nationality is null or v_nationality !~ '^[A-Z]{2}$' then
    raise exception 'record_identity_attestation requires an alpha-2 nationality'
      using errcode = '22023';
  end if;

  if p_over18 is null or p_not_sanctioned is null then
    raise exception 'record_identity_attestation requires over18 and not_sanctioned'
      using errcode = '22023';
  end if;

  -- A valid kade.kyc.v1 attestation only exists when both predicates held.
  if p_over18 is not true or p_not_sanctioned is not true then
    raise exception 'record_identity_attestation mirrors a valid attestation, so both predicates must be true'
      using errcode = '22023';
  end if;

  if v_nullifier is null then
    raise exception 'record_identity_attestation requires the self nullifier'
      using errcode = '22023';
  end if;

  if p_expires_at is null then
    raise exception 'record_identity_attestation requires the passport expiry'
      using errcode = '22023';
  end if;

  insert into public.identity_attestations (
    profile_id,
    attestation_uid,
    chain,
    nationality,
    over18,
    not_sanctioned,
    self_nullifier,
    expires_at
  )
  values (
    p_profile_id,
    v_uid,
    p_chain,
    v_nationality,
    p_over18,
    p_not_sanctioned,
    v_nullifier,
    p_expires_at
  )
  -- Idempotent on the UID. The update is deliberately a no-op on the UID itself
  -- and never touches profile_id, so a replay returns the existing row and can
  -- never move ownership.
  on conflict (attestation_uid) do update
    set attestation_uid = excluded.attestation_uid
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.record_identity_attestation(
  uuid, text, integer, text, boolean, boolean, text, timestamptz
) is
  'Mirrors an actually-emitted kade.kyc.v1 attestation into '
  'identity_attestations: the emitted UID, the EAS chain id and the five '
  'disclosed facts. SECURITY DEFINER with EXECUTE granted only to service_role, '
  'because the resident may not write the table and the emitter''s server path '
  'has no session. Called only after the attestation transaction is sent and '
  'confirmed, never before. Idempotent on the UNIQUE attestation_uid; the '
  'self_nullifier UNIQUE index remains the duplicate-application / Sybil guard, '
  'so a second attestation for the same nullifier raises.';

revoke all on function public.record_identity_attestation(
  uuid, text, integer, text, boolean, boolean, text, timestamptz
) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.record_identity_attestation(
      uuid, text, integer, text, boolean, boolean, text, timestamptz
    ) to service_role;
  end if;
end
$$;
