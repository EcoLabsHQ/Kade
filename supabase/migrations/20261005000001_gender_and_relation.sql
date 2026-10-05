-- =============================================================================
-- Kade — gender on profiles/household_members and the Step 2 save RPC.
--
-- Human-directed onboarding change (end to end): gender is required for new
-- submissions on the principal applicant and every household member. The
-- columns are additive and NULLABLE so existing rows keep a NULL value; a value
-- is never invented for them.
--
--   * profiles.gender          text, nullable
--   * household_members.gender text, nullable
--
-- `profiles` carries explicit per-column grants (20260916000009_rls.sql), so
-- `gender` must be added to BOTH the insert and update grant lists or the RPC's
-- SECURITY INVOKER write fails with `42501 permission denied`. The household
-- table has a table-level grant, so it needs no column change.
--
-- The RPC below replaces `save_onboarding_step2` from
-- 20260916000011_save_onboarding.sql. Its parameter list is fixed, so a
-- `create or replace` with a new arity would create an overload instead of
-- replacing it. The old signature is dropped explicitly first, then the new one
-- is created, commented and re-granted. Transaction semantics are unchanged:
-- the whole save still happens in one SECURITY INVOKER transaction.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Additive columns. Idempotent so re-running the migration is safe.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists gender text;

alter table public.household_members
  add column if not exists gender text;

comment on column public.profiles.gender is
  '[human-directed] Principal applicant gender, one of Male/Female/Other for '
  'new submissions. NULLABLE so existing rows stay NULL; the application layer '
  'requires a value on write. No value is invented for legacy rows.';
comment on column public.household_members.gender is
  '[human-directed] Household member gender, one of Male/Female/Other for new '
  'submissions. NULLABLE so existing rows stay NULL; the application layer '
  'requires a value on write. No value is invented for legacy rows.';

-- ---------------------------------------------------------------------------
-- profiles: add gender to the column-level insert/update grants.
--
-- Additive grants; the existing column grants are untouched. Without these the
-- SECURITY INVOKER RPC cannot write the new column as `authenticated`.
-- ---------------------------------------------------------------------------
grant insert (gender) on table public.profiles to authenticated;
grant update (gender) on table public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Drop the old fixed-arity signature so the new one replaces it rather than
-- overloading it. `if exists` keeps the migration safe to re-run.
-- ---------------------------------------------------------------------------
drop function if exists public.save_onboarding_step2(
  text, text, date, text[], jsonb, text, jsonb
);

create or replace function public.save_onboarding_step2(
  p_first_name   text,
  p_last_name    text,
  p_dob          date,
  p_gender       text,
  p_citizenships text[],
  p_residences   jsonb,
  p_tier         text,
  p_members      jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_app_id uuid;
  v_item   jsonb;
  v_to     text;
begin
  if v_uid is null then
    raise exception 'save_onboarding_step2 requires an authenticated user'
      using errcode = '28000';
  end if;

  -- Profile. Explicit column list: `id` is the conflict target only, never
  -- assigned in the UPDATE, which is what the privilege model requires. gender
  -- is written here; the column grant added above makes it permitted.
  insert into public.profiles (id, first_name, last_name, dob, gender)
  values (v_uid, p_first_name, p_last_name, p_dob, p_gender)
  on conflict (id) do update set
    first_name = excluded.first_name,
    last_name  = excluded.last_name,
    dob        = excluded.dob,
    gender     = excluded.gender;

  -- Citizenships and residences are replaced wholesale; the UI always sends the
  -- complete set, and a partial diff would need ordering the form does not have.
  delete from public.profile_citizenships where profile_id = v_uid;
  if p_citizenships is not null and array_length(p_citizenships, 1) > 0 then
    insert into public.profile_citizenships (profile_id, country_code)
    select v_uid, code
      from unnest(p_citizenships) as code;
  end if;

  delete from public.profile_residences where profile_id = v_uid;
  for v_item in select * from jsonb_array_elements(coalesce(p_residences, '[]'::jsonb))
  loop
    v_to := nullif(v_item ->> 'toYear', 'present');
    insert into public.profile_residences (profile_id, country_code, from_year, to_year)
    values (
      v_uid,
      v_item ->> 'countryCode',
      (v_item ->> 'fromYear')::integer,
      v_to::integer
    );
  end loop;

  -- The application. `tier` is the only resident-writable column; `status` and
  -- `preapproval_usdc` belong to the server. The insert trigger sets the initial
  -- fee, and the household trigger below keeps it in step.
  select id into v_app_id
    from public.applications
   where profile_id = v_uid
   order by id
   limit 1;

  if v_app_id is null then
    insert into public.applications (profile_id, tier)
    values (v_uid, p_tier)
    returning id into v_app_id;
  else
    update public.applications set tier = p_tier where id = v_app_id;
  end if;

  -- Household members, replaced wholesale like the sets above. Relation stays a
  -- `text` column (legacy rows are not rejected by a CHECK); the application
  -- layer accepts only Spouse/Partner/Child on write.
  delete from public.household_members where application_id = v_app_id;
  for v_item in select * from jsonb_array_elements(coalesce(p_members, '[]'::jsonb))
  loop
    insert into public.household_members (application_id, name, relation, dob, citizenship, gender)
    values (
      v_app_id,
      v_item ->> 'name',
      nullif(v_item ->> 'relation', ''),
      nullif(v_item ->> 'dob', '')::date,
      nullif(v_item ->> 'citizenship', ''),
      nullif(v_item ->> 'gender', '')
    );
  end loop;

  return v_app_id;
end;
$$;

comment on function public.save_onboarding_step2(text, text, date, text, text[], jsonb, text, jsonb) is
  'Atomic Step 2 save (D5). SECURITY INVOKER so RLS still applies as the '
  'resident. Writes only the columns the resident may write; the fee stays '
  'server-computed. Replaces the 7-argument signature to add p_gender: the '
  'fixed-arity function would otherwise be overloaded, not replaced.';

revoke all on function public.save_onboarding_step2(text, text, date, text, text[], jsonb, text, jsonb)
  from public, anon;
grant execute on function public.save_onboarding_step2(text, text, date, text, text[], jsonb, text, jsonb)
  to authenticated;
