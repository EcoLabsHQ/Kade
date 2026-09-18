-- =============================================================================
-- Kade — atomic save for pre-registration Step 2.
--
-- Why this exists
--   The app used to save Step 2 as a sequence of independent PostgREST calls
--   from the browser. Two problems, both real:
--
--   1. PostgREST's upsert emits `DO UPDATE SET <every payload column>`,
--      including the conflict target. On `profiles` that asks Postgres to update
--      `id`, which the `authenticated` role deliberately has no UPDATE privilege
--      on (20260916000009_rls.sql), so the request failed with
--      `42501 permission denied for table profiles`. Reproduced exactly:
--      an ON CONFLICT whose SET omits `id` passes the privilege check, and the
--      same statement including `id = excluded.id` fails.
--   2. Several calls with no transaction: a failure part-way left earlier writes
--      committed while the UI reported that nothing was written.
--
--   One SECURITY INVOKER function fixes both. It performs the whole save in a
--   single transaction and names every column explicitly, so it can never echo a
--   protected column back into an UPDATE.
--
-- Security
--   SECURITY INVOKER, so row level security still applies as `authenticated`:
--   the resident may only touch their own rows. This function grants no new
--   capability. The columns it writes are exactly the ones the resident is
--   already permitted to write; the server-only columns (`safe_address`, `ref`,
--   `status`, `preapproval_usdc`, `*_uid`) are untouched.
--
--   `applications.preapproval_usdc` is never written here: the household trigger
--   from 20260916000010_fee_function.sql recomputes it, and the caller reads it
--   back. One writer, one source.
--
-- Called through a Next.js server action, so writes no longer originate in the
-- browser.
-- =============================================================================

create or replace function public.save_onboarding_step2(
  p_first_name   text,
  p_last_name    text,
  p_dob          date,
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
  -- assigned in the UPDATE, which is what the privilege model requires.
  insert into public.profiles (id, first_name, last_name, dob)
  values (v_uid, p_first_name, p_last_name, p_dob)
  on conflict (id) do update set
    first_name = excluded.first_name,
    last_name  = excluded.last_name,
    dob        = excluded.dob;

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

  -- Household members, replaced wholesale like the sets above.
  delete from public.household_members where application_id = v_app_id;
  for v_item in select * from jsonb_array_elements(coalesce(p_members, '[]'::jsonb))
  loop
    insert into public.household_members (application_id, name, relation, dob, citizenship)
    values (
      v_app_id,
      v_item ->> 'name',
      nullif(v_item ->> 'relation', ''),
      nullif(v_item ->> 'dob', '')::date,
      nullif(v_item ->> 'citizenship', '')
    );
  end loop;

  return v_app_id;
end;
$$;

comment on function public.save_onboarding_step2(text, text, date, text[], jsonb, text, jsonb) is
  'Atomic Step 2 save (D5). SECURITY INVOKER so RLS still applies as the '
  'resident. Writes only the columns the resident may write; the fee stays '
  'server-computed. Replaces a sequence of browser-side PostgREST calls that '
  'could not work: PostgREST''s upsert assigns every payload column, including '
  'the conflict target, and `id` has no UPDATE grant.';

revoke all on function public.save_onboarding_step2(text, text, date, text[], jsonb, text, jsonb)
  from public, anon;
grant execute on function public.save_onboarding_step2(text, text, date, text[], jsonb, text, jsonb)
  to authenticated;
