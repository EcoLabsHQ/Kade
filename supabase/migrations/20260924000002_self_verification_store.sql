-- =============================================================================
-- Kade — Self verification result store (on-chain half of D16 / EXE-012).
--
-- Why this exists
--   As amended (week-2 contract v1.7), identity is verified **on chain** by
--   Self's own contract on Celo Sepolia, and a verified resident receives a
--   soulbound token from Self. Kade does **not** mint an attestation and does
--   **not** emit `kade.kyc.v1`. Kade only records the **outcome** of a Self
--   verification so the residency identity check can read it.
--
--   This is deliberately NOT `identity_attestations`: that table mirrors the
--   `kade.kyc.v1` fields (nationality, over18, not_sanctioned, expires_at). The
--   new model does not learn or store nationality or expiry, so those columns
--   stay unused and no row is written there. What is stored here is the smallest
--   honest fact the checks need: did Self report this resident's passport
--   verification as `valid`.
--
--   `identity_attestations` is left in place (frozen schema) but is no longer
--   written by the identity path; see docs/known-gaps.md.
--
-- What is stored
--   { profile_id, provider, status, verified_at, self_nullifier, session_id,
--     verification_id }. No nationality, no date of birth, no expiry.
--   `self_nullifier` is Self's per-person identifier and is kept, when present,
--   for Sybil resistance; it is NOT unique here because a resident may verify
--   more than once and the authoritative non-duplicate guard is Self's own
--   soulbound token. `verification_id` is the at-least-once delivery dedupe key.
--
-- Trust boundary
--   * The webhook has no resident session (`auth.uid()` is null), so writes go
--     through `record_self_verification`, a `SECURITY DEFINER` function whose
--     EXECUTE is granted only to `service_role` (the precedent is the
--     `grant execute … to service_role` block in
--     20260922000040_residency_service_fee.sql).
--   * Residents may only SELECT their own rows, and a reviewer (Admin review
--     surface) may SELECT every row (RLS policies below); there is no
--     insert/update/delete policy, so a client cannot write a verification.
--     Without the reviewer policy the Admin surface would read no rows and
--     wrongly show every verified resident as unverified.
--   * The caller (the webhook route) verifies Self's signature over the raw body
--     before this function is reached. The function is a persistence primitive:
--     it trusts its arguments and must never be granted to a client-invocable
--     role.
--
-- Idempotency
--   `verification_id` is UNIQUE. `ON CONFLICT (verification_id) DO UPDATE`
--   refreshes the outcome of a redelivered event; a repeated delivery therefore
--   writes no second row.
-- =============================================================================

create table public.self_verifications (
  id              bigint generated always as identity primary key,
  profile_id      uuid not null references public.profiles (id) on delete cascade,
  provider        text not null default 'self',
  status          text not null,
  verified_at     timestamptz,
  self_nullifier  text,
  session_id      text,
  verification_id text not null,
  created_at      timestamptz not null default now(),
  constraint self_verifications_provider_check check (provider = 'self'),
  constraint self_verifications_status_check check (status in ('valid', 'invalid')),
  -- A valid outcome always carries the moment it was established; an invalid
  -- one never claims a verification time.
  constraint self_verifications_valid_has_time check (
    (status = 'valid' and verified_at is not null)
    or (status = 'invalid' and verified_at is null)
  ),
  constraint self_verifications_verification_id_key unique (verification_id)
);

comment on table public.self_verifications is
  'The outcome of a Self (self.xyz) passport verification, one row per Self '
  'verification_id (at-least-once delivery dedupe). As amended v1.7, identity '
  'is verified on chain by Self on Celo Sepolia and a soulbound token is issued '
  'by Self; Kade neither mints an attestation nor emits kade.kyc.v1, and this '
  'table stores ONLY the outcome. Nationality and expiry are never stored here.';
comment on column public.self_verifications.provider is
  '[arbitrary] the verification provider; fixed to ''self'' so a future '
  'provider cannot be silently mixed into the same checks.';
comment on column public.self_verifications.status is
  'The Self-reported outcome: ''valid'' (passport proof accepted AND the flow''s '
  'age/OFAC predicates held) or ''invalid''. The residency identity check is '
  'met only when the latest row is ''valid''.';
comment on column public.self_verifications.verified_at is
  'When the valid outcome was established, or NULL for an invalid one.';
comment on column public.self_verifications.self_nullifier is
  'Self''s privacy-preserving per-person identifier, when the provider supplies '
  'it. Kept for Sybil resistance; NOT unique here because a resident may verify '
  'more than once and Self''s soulbound token is the authoritative one-per-'
  'person guard.';
comment on column public.self_verifications.session_id is
  'The Self verification session id, when the webhook carries it. Nullable.';
comment on column public.self_verifications.verification_id is
  'SECURITY-CRITICAL: the at-least-once delivery dedupe key (UNIQUE). A repeated '
  'Self webhook maps to the same verification_id and is absorbed.';

create index self_verifications_profile_id_idx
  on public.self_verifications (profile_id);
create index self_verifications_self_nullifier_idx
  on public.self_verifications (self_nullifier);

-- ---------------------------------------------------------------------------
-- The privileged writer. The webhook has no auth.uid(), so the resident-scoped
-- SECURITY DEFINER writers cannot reach it; this one is granted only to
-- service_role.
-- ---------------------------------------------------------------------------
create or replace function public.record_self_verification(
  p_profile_id      uuid,
  p_status          text,
  p_verified_at     timestamptz,
  p_self_nullifier  text,
  p_session_id      text,
  p_verification_id text
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

  insert into public.self_verifications (
    profile_id,
    provider,
    status,
    verified_at,
    self_nullifier,
    session_id,
    verification_id
  )
  values (
    p_profile_id,
    'self',
    v_status,
    case when v_status = 'valid' then coalesce(p_verified_at, now()) else null end,
    v_nullifier,
    v_session,
    v_verification
  )
  on conflict (verification_id) do update
    set status      = excluded.status,
        verified_at = excluded.verified_at
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.record_self_verification(
  uuid, text, timestamptz, text, text, text
) is
  'Records the outcome of a Self passport verification. SECURITY DEFINER with '
  'EXECUTE granted only to service_role: the webhook has no auth.uid(), so the '
  'resident-scoped writers cannot reach it. The caller must verify the Self '
  'signature over the raw body first; this function only persists. Idempotent '
  'on the UNIQUE verification_id. It stores no nationality and no expiry.';

revoke all on function public.record_self_verification(
  uuid, text, timestamptz, text, text, text
) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.record_self_verification(
      uuid, text, timestamptz, text, text, text
    ) to service_role;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- RLS: a resident may read their own verification rows and nothing else; a
-- reviewer (admins deciding on an application) may read every row, exactly as
-- the reviewer policies in 20260922000060_admin_review.sql allow for
-- `identity_attestations`. The writer is the only insert/update path (granted to
-- service_role).
-- ---------------------------------------------------------------------------
alter table public.self_verifications enable row level security;

revoke all on table public.self_verifications from anon, authenticated;
grant select on table public.self_verifications to authenticated;

create policy self_verifications_select_own
  on public.self_verifications for select to authenticated
  using (profile_id = auth.uid());

create policy self_verifications_select_reviewer
  on public.self_verifications for select to authenticated
  using (public.is_reviewer());

comment on policy self_verifications_select_own on public.self_verifications is
  'A resident may read only their own Self verification outcomes. There is no '
  'write policy: rows are written exclusively by record_self_verification, '
  'granted to service_role.';

comment on policy self_verifications_select_reviewer on public.self_verifications is
  'A reviewer may read every resident''s Self verification outcome, which is '
  'what the Admin review surface shows for the identity check. `is_reviewer()` '
  '(20260922000060_admin_review.sql) is the gate; without this policy the '
  'reviewer would see no rows and wrongly read every verified resident as '
  'unverified.';
