-- =============================================================================
-- Kade — Colosseum residency foundation.
--
-- Why this exists
--   The Colosseum Crypto World's Fair increment adds a fourth residency track
--   alongside the three production programme tiers: a Colosseum resident
--   qualifies at a demo-scale 10 USDC and progresses resident -> citizen ->
--   passport. This migration is the database foundation only — the tier value,
--   the membership record, and the owner-scoped writers the residency surface
--   (a separate task) will call. There is no UI here.
--
-- What this migration does
--   1. extends `applications.tier` to accept 'colosseum' while keeping the three
--      production values ('3-year', '5-year', 'indefinite');
--   2. creates `public.colosseum_memberships`, one row per profile;
--   3. enables RLS with an owner-only SELECT policy and no client writes;
--   4. adds SECURITY DEFINER writers in the exact shape of
--      `public.record_residency_service_fee_tx` (20260922000040):
--        register_colosseum_residency()          -> tier = 'colosseum'
--        sync_colosseum_residency(p_met boolean) -> membership clock
--        record_colosseum_citizen()              -> citizen_at + passport_serial
--      Their names and signatures are the interface a later task calls; they
--      are stable.
--
-- Security
--   Membership rows are server-written. `authenticated` has SELECT only, scoped
--   by `profile_id = auth.uid()`; the three writers are SECURITY DEFINER and
--   predicate every read/write on the caller's own profile. Reads fail closed:
--   a missing row is "not a resident", never a fabricated membership. The tier
--   value is written only through `register_colosseum_residency()`, so the
--   authenticated role gains no new direct write path.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. applications.tier accepts the Colosseum value.
--
-- The original inline CHECK (20260916000002_applications.sql) was unnamed, so
-- Postgres named it `applications_tier_check`. Drop it if present and re-add an
-- explicit named constraint that keeps the three production values and adds
-- 'colosseum'. Re-running is safe: the drop-if-exists removes whatever this
-- migration last installed before it is added again.
-- ---------------------------------------------------------------------------
alter table public.applications
  drop constraint if exists applications_tier_check;

alter table public.applications
  add constraint applications_tier_check
    check (tier in ('3-year', '5-year', 'indefinite', 'colosseum'));

comment on constraint applications_tier_check on public.applications is
  'Qualifying tier. The three production values are [documented] (DOCX section '
  '4); ''colosseum'' is the Colosseum residency track, a demo-scale tier '
  'qualifying at 10 USDC (see @kade/shared COLOSSEUM_TIER). The lower-case '
  'encoding of "indefinite" is [arbitrary].';

-- ---------------------------------------------------------------------------
-- 2. colosseum_memberships — one row per profile.
--
-- Keyed by the auth user, like `profiles`, so the membership follows the
-- resident and is removed with them. `application_id` is the application the
-- membership belongs to (nullable). It is a plain uuid rather than a foreign
-- key: the column is informational for the residency surface, and a second
-- cascade path into a table that `reset_demo_data()` deletes wholesale would
-- add nothing but risk. `resident_since` is the start of the current continuous
-- qualifying period; `citizen_at` and `passport_serial` are written once, on
-- the citizen transition.
-- ---------------------------------------------------------------------------
create table if not exists public.colosseum_memberships (
  profile_id       uuid primary key references auth.users (id) on delete cascade,
  application_id   uuid,
  resident_since   timestamptz,
  citizen_at       timestamptz,
  passport_serial  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.colosseum_memberships is
  'Colosseum residency membership, one row per profile. Server-written through '
  'the SECURITY DEFINER functions below; authenticated may only read its own '
  'row. A missing row means "not a Colosseum resident".';
comment on column public.colosseum_memberships.profile_id is
  'The owning resident. Primary key: one membership per profile.';
comment on column public.colosseum_memberships.application_id is
  'The application this membership belongs to. Nullable; informational for the '
  'residency surface (no foreign key, so it never participates in a delete '
  'cascade).';
comment on column public.colosseum_memberships.resident_since is
  'Start of the current continuous qualifying period. Set when residency is met, '
  'cleared on decay while not yet a citizen so the clock restarts.';
comment on column public.colosseum_memberships.citizen_at is
  'When the caller completed the Colosseum citizen transition. Server-set once '
  'the resident clock has elapsed; never client-supplied.';
comment on column public.colosseum_memberships.passport_serial is
  'Server-generated Colosseum passport serial, issued once at the citizen '
  'transition. Never client-supplied.';

create index if not exists colosseum_memberships_application_id_idx
  on public.colosseum_memberships (application_id);

-- ---------------------------------------------------------------------------
-- 3. RLS — owner-only read, server-only writes.
--
-- No INSERT/UPDATE/DELETE privilege is granted to anon or authenticated: the
-- membership is written only by the SECURITY DEFINER functions below, matching
-- the deny-by-default model in 20260916000009_rls.sql / ADR 0004.
-- ---------------------------------------------------------------------------
alter table public.colosseum_memberships enable row level security;

revoke all on table public.colosseum_memberships from anon, authenticated;
grant select on table public.colosseum_memberships to authenticated;

drop policy if exists colosseum_memberships_select_own
  on public.colosseum_memberships;

create policy colosseum_memberships_select_own
  on public.colosseum_memberships for select to authenticated
  using (profile_id = auth.uid());

comment on policy colosseum_memberships_select_own on public.colosseum_memberships is
  'A resident may read their own Colosseum membership. No write privilege is '
  'granted: the membership is server-written through the SECURITY DEFINER '
  'functions.';

-- ---------------------------------------------------------------------------
-- 4a. Register the caller's Colosseum residency.
--
-- SECURITY DEFINER: `applications.tier` is writable by authenticated directly
-- (20260916000009), but this is the single, explicit path that sets the
-- Colosseum value, and it refuses when the caller has no application. The
-- explicit owner predicate (profile_id = auth.uid()) is the only row it reaches.
-- ---------------------------------------------------------------------------
create or replace function public.register_colosseum_residency()
returns public.applications
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.applications;
begin
  if v_uid is null then
    raise exception 'register_colosseum_residency requires an authenticated user'
      using errcode = '28000';
  end if;

  select * into v_row
    from public.applications
   where profile_id = v_uid
   for update;

  if not found then
    raise exception 'no application belongs to the current resident'
      using errcode = 'P0002';
  end if;

  update public.applications
     set tier = 'colosseum'
   where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.register_colosseum_residency() is
  'Sets the calling resident''s own application tier to ''colosseum''. '
  'SECURITY DEFINER so the Colosseum value is written through one controlled '
  'path; the explicit owner predicate (profile_id = auth.uid()) is the only row '
  'it can reach. Refuses when the caller has no application.';

-- ---------------------------------------------------------------------------
-- 4b. Sync the Colosseum residency clock.
--
-- Upserts the caller's membership row:
--   * p_met true  -> resident_since = coalesce(resident_since, now());
--   * p_met false -> clear resident_since only while not yet a citizen, so the
--                    2-minute clock restarts on decay; a citizen keeps the
--                    record they earned.
-- SECURITY DEFINER: authenticated has no INSERT/UPDATE privilege on the table.
-- ---------------------------------------------------------------------------
create or replace function public.sync_colosseum_residency(
  p_met boolean
)
returns public.colosseum_memberships
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.colosseum_memberships;
begin
  if v_uid is null then
    raise exception 'sync_colosseum_residency requires an authenticated user'
      using errcode = '28000';
  end if;

  insert into public.colosseum_memberships as m (
    profile_id,
    application_id,
    resident_since
  )
  values (
    v_uid,
    (
      select a.id
        from public.applications a
       where a.profile_id = v_uid
       order by a.id
       limit 1
    ),
    case when coalesce(p_met, false) then now() else null end
  )
  on conflict (profile_id) do update
    set application_id = coalesce(m.application_id, excluded.application_id),
        resident_since = case
          when coalesce(p_met, false) then coalesce(m.resident_since, now())
          when m.citizen_at is null then null
          else m.resident_since
        end,
        updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.sync_colosseum_residency(boolean) is
  'Upserts the calling resident''s Colosseum membership row. When p_met is true '
  'it sets resident_since = coalesce(resident_since, now()); when false and the '
  'resident is not yet a citizen it clears resident_since so the 2-minute clock '
  'restarts on decay. SECURITY DEFINER because authenticated has no write '
  'privilege on the table; the row is scoped to profile_id = auth.uid().';

-- ---------------------------------------------------------------------------
-- 4c. Record the Colosseum citizen transition.
--
-- Fail closed: requires an existing membership with a resident_since at least
-- 2 minutes old. Only then does it set citizen_at and issue a server-generated
-- passport_serial. Idempotent: a second call preserves the first citizen_at and
-- passport_serial rather than re-issuing them.
-- SECURITY DEFINER: authenticated has no UPDATE privilege on the table.
-- ---------------------------------------------------------------------------
create or replace function public.record_colosseum_citizen()
returns public.colosseum_memberships
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.colosseum_memberships;
begin
  if v_uid is null then
    raise exception 'record_colosseum_citizen requires an authenticated user'
      using errcode = '28000';
  end if;

  select * into v_row
    from public.colosseum_memberships
   where profile_id = v_uid
   for update;

  if not found or v_row.resident_since is null then
    raise exception 'record_colosseum_citizen requires a residency clock'
      using errcode = 'P0001';
  end if;

  if now() - v_row.resident_since < interval '2 minutes' then
    raise exception 'record_colosseum_citizen requires 2 minutes of residency'
      using errcode = 'P0001';
  end if;

  update public.colosseum_memberships
     set citizen_at = coalesce(v_row.citizen_at, now()),
         passport_serial = coalesce(
           v_row.passport_serial,
           'KADE-CL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
         ),
         updated_at = now()
   where profile_id = v_uid
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.record_colosseum_citizen() is
  'Records the calling resident''s Colosseum citizen transition: requires a '
  'resident_since at least 2 minutes old, then sets citizen_at and a '
  'server-generated passport_serial. Fails closed otherwise and never accepts a '
  'client-supplied serial. SECURITY DEFINER because authenticated has no write '
  'privilege on the table; the row is scoped to profile_id = auth.uid().';

-- ---------------------------------------------------------------------------
-- 5. Privileges — matching 20260922000040_residency_service_fee.sql.
-- ---------------------------------------------------------------------------
revoke all on function public.register_colosseum_residency() from public, anon;
grant execute on function public.register_colosseum_residency()
  to authenticated;

revoke all on function public.sync_colosseum_residency(boolean) from public, anon;
grant execute on function public.sync_colosseum_residency(boolean)
  to authenticated;

revoke all on function public.record_colosseum_citizen() from public, anon;
grant execute on function public.record_colosseum_citizen()
  to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.register_colosseum_residency()
      to service_role;
    grant execute on function public.sync_colosseum_residency(boolean)
      to service_role;
    grant execute on function public.record_colosseum_citizen()
      to service_role;
  end if;
end
$$;
