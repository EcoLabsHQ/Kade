-- =============================================================================
-- Kade — Self verification facts (backend / off-chain half of D16 / EXE-012).
--
-- Why this exists
--   Self has moved from on-chain mode to **backend (off-chain) mode**: Self's
--   own servers verify the proof and deliver the result by signed webhook. In
--   backend mode the webhook also carries the **disclosed facts** in
--   `proof_attributes` (`nationality`, `expiryDate`), where on-chain mode sent an
--   empty `{}`. This migration teaches the outcome store those facts so the
--   `kade.kyc.v1` payload can be prepared. The emit itself stays gated:
--   apps/web/src/lib/residency/kyc-attestation.ts builds and validates the
--   payload but has no broadcast path.
--
-- Storage shape, and why not `identity_attestations`
--   `identity_attestations` is the frozen mirror of `kade.kyc.v1` and is the
--   natural home for the five facts, but it cannot hold an unattested fact
--   honestly:
--     * `chain` is NOT NULL and there is no chain to record before an
--       attestation is emitted; any placeholder would be a false claim;
--     * `attestation_uid` would be NULL, so the row would claim a mirror with no
--       attestation behind it;
--     * `self_nullifier` is NOT NULL UNIQUE, but Self's nullifier is optional
--       (the mapper allows a valid outcome without one) and a resident may
--       verify more than once.
--   The facts therefore live on the event store they arrived on,
--   `self_verifications`, whose `verification_id` is already the idempotency
--   key and whose reviewer/resident read policies already exist. When an
--   attestation is actually emitted, a gated writer mirrors the facts into
--   `identity_attestations`; `chain` then holds the EAS chain id of the emitted
--   attestation (Ethereum Sepolia = 11155111, the chain the five schemas are
--   registered on) and `attestation_uid` the emitted UID. Until then
--   `identity_attestations` stays empty: no placeholder row and no invented
--   chain.
--
-- Fail-closed derivation
--   `over18` and `notSanctioned` are derived by the mapper from the resolved
--   outcome (both true on `valid`, both false on `invalid`). The check below
--   enforces the same rule at the storage boundary, so a row cannot persist an
--   inconsistent claim. Rows written before this migration keep NULL (the check
--   allows a both-null legacy row).
--
-- Trust boundary
--   `record_self_verification` keeps the shape from 20260924000002: SECURITY
--   DEFINER, EXECUTE granted only to `service_role`, callable with no
--   auth.uid(). The 6-argument overload is dropped and replaced by the
--   10-argument function below, so there is exactly one writer and a call cannot
--   silently fall back to the old, fact-less signature. The reviewer/resident
--   read policies from 20260924000002 are table-wide and cover the new columns:
--   a reviewer reads every resident's facts, a resident only their own.
-- =============================================================================

alter table public.self_verifications
  add column nationality     text,
  add column over18          boolean,
  add column not_sanctioned  boolean,
  add column expires_at      date;

comment on column public.self_verifications.nationality is
  'The disclosed nationality as ISO 3166-1 alpha-2 (NL), converted from the '
  'alpha-3 code Self sends. NULL when Self disclosed nothing or the code is '
  'unknown to the frozen table; never guessed.';
comment on column public.self_verifications.over18 is
  'The age predicate, derived from the resolved outcome: true only for a valid '
  'row, false for an invalid one. The check below forbids an inconsistent claim.';
comment on column public.self_verifications.not_sanctioned is
  'The OFAC predicate, derived from the resolved outcome: true only for a valid '
  'row, false for an invalid one. The check below forbids an inconsistent claim.';
comment on column public.self_verifications.expires_at is
  'The passport MRZ expiry as a calendar date (the MRZ carries no time). The '
  'mapper reads YYMMDD as 20YY and stores an ISO date; NULL when unparseable. '
  'This is a date, not an instant: the kade.kyc.v1 encoding takes the UTC '
  'midnight of this day.';

-- Correct the table comment from 20260924000002, which said the facts are never
-- stored here. It is a later migration that changes the meaning, so the
-- correction belongs here rather than in the already-applied file.
comment on table public.self_verifications is
  'The outcome of a Self (self.xyz) passport verification plus, since the move '
  'to backend/off-chain mode, the disclosed identity facts (nationality, '
  'over18, not_sanctioned, expires_at). One row per Self verification_id '
  '(at-least-once delivery dedupe). Kade still emits no kade.kyc.v1 of its own: '
  'the payload is prepared and gated (kyc-attestation.ts).';

alter table public.self_verifications
  add constraint self_verifications_predicates_match_status_check check (
    (over18 is null and not_sanctioned is null)
    or (status = 'valid' and over18 is true and not_sanctioned is true)
    or (status = 'invalid' and over18 is false and not_sanctioned is false)
  ),
  add constraint self_verifications_nationality_format_check check (
    nationality is null or nationality ~ '^[A-Z]{2}$'
  ),
  -- The century policy (20YY) is enforced, not only applied by the mapper.
  add constraint self_verifications_expires_at_century_check check (
    expires_at is null or expires_at >= date '2000-01-01'
  );

-- ---------------------------------------------------------------------------
-- The privileged writer. Drop the fact-less overload so only the richer function
-- remains; the webhook route always passes the facts.
-- ---------------------------------------------------------------------------
drop function if exists public.record_self_verification(
  uuid, text, timestamptz, text, text, text
);

create or replace function public.record_self_verification(
  p_profile_id      uuid,
  p_status          text,
  p_verified_at     timestamptz,
  p_self_nullifier  text,
  p_session_id      text,
  p_verification_id text,
  p_nationality     text,
  p_over18          boolean,
  p_not_sanctioned  boolean,
  p_expires_at      date
)
returns public.self_verifications
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status      text := lower(trim(coalesce(p_status, '')));
  v_verification text := nullif(trim(coalesce(p_verification_id, '')), '');
  v_nullifier   text := nullif(trim(coalesce(p_self_nullifier, '')), '');
  v_session     text := nullif(trim(coalesce(p_session_id, '')), '');
  v_nationality text := nullif(upper(trim(coalesce(p_nationality, ''))), '');
  v_row         public.self_verifications;
begin
  if p_profile_id is null then
    raise exception 'record_self_verification requires a profile id'
      using errcode = '22023';
  end if;

  if v_status not in ('valid', 'invalid') then
    raise exception 'record_self_verification requires status valid|invalid, got %',
      p_status
      using errcode = '22023';
  end if;

  -- Without a dedupe key an at-least-once redelivery would write a second row.
  if v_verification is null then
    raise exception 'record_self_verification requires a non-empty verification_id'
      using errcode = '22023';
  end if;

  -- Every new row states the predicates; NULL is reserved for rows written
  -- before this migration (the table check allows a both-null legacy row).
  if p_over18 is null or p_not_sanctioned is null then
    raise exception 'record_self_verification requires over18 and not_sanctioned'
      using errcode = '22023';
  end if;

  insert into public.self_verifications (
    profile_id,
    provider,
    status,
    verified_at,
    self_nullifier,
    session_id,
    verification_id,
    nationality,
    over18,
    not_sanctioned,
    expires_at
  )
  values (
    p_profile_id,
    'self',
    v_status,
    case when v_status = 'valid' then coalesce(p_verified_at, now()) else null end,
    v_nullifier,
    v_session,
    v_verification,
    v_nationality,
    p_over18,
    p_not_sanctioned,
    p_expires_at
  )
  on conflict (verification_id) do update
    set status         = excluded.status,
        verified_at    = excluded.verified_at,
        nationality    = excluded.nationality,
        over18         = excluded.over18,
        not_sanctioned = excluded.not_sanctioned,
        expires_at     = excluded.expires_at
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.record_self_verification(
  uuid, text, timestamptz, text, text, text, text, boolean, boolean, date
) is
  'Records the outcome of a Self passport verification and the disclosed '
  'identity facts (nationality alpha-2, over18, not_sanctioned, expires_at). '
  'SECURITY DEFINER with EXECUTE granted only to service_role: the webhook has '
  'no auth.uid(), so the resident-scoped writers cannot reach it. The caller '
  'must verify the Self signature over the raw body first; this function only '
  'persists. Idempotent on the UNIQUE verification_id: a redelivered event '
  'refreshes the outcome and the facts and writes no second row. over18 and '
  'not_sanctioned are required (NULL is reserved for pre-migration rows), and '
  'the predicates-match-status check keeps a valid row from claiming a '
  'predicate did not hold (and vice versa).';

revoke all on function public.record_self_verification(
  uuid, text, timestamptz, text, text, text, text, boolean, boolean, date
) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.record_self_verification(
      uuid, text, timestamptz, text, text, text, text, boolean, boolean, date
    ) to service_role;
  end if;
end
$$;
