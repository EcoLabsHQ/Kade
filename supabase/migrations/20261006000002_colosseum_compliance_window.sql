-- =============================================================================
-- Kade — the Colosseum compliance window, server-side.
--
-- Why this exists
--   The Citizenship claim's 2-minute compliance window currently lives only in
--   the browser (`apps/web/src/components/residency/colosseum-progress.ts`, a
--   `localStorage` store), so the server cannot validate it. With the claim as
--   the mint trigger, the Citizen mint would otherwise be gated on the four
--   real residency checks alone and the 2-minute wait would remain cosmetic.
--
--   This migration adds the server-side record:
--     - `applications.colosseum_resident_since` — the instant the resident first
--       became eligible for the Colosseum track. The server reads it and refuses
--       the Citizen claim until two minutes have elapsed.
--     - `record_colosseum_resident_since(profile_id)` — writes it once,
--       idempotently. SECURITY DEFINER, `service_role` only, exactly like the
--       membership writers (20261006000001).
--
-- Bounded and additive
--   One nullable column and one writer. No existing column, constraint, policy
--   or function is changed. The column is readable by the resident (the
--   `applications` table already grants table-level SELECT to `authenticated`);
--   it is writable only through the SECURITY DEFINER function.
--
-- NOT APPLIED
--   This migration was written by the delegated implementation task but is
--   deliberately not applied. The orchestrator applies migrations. Until it is
--   applied, `colosseumResidentSince` reports `unread` and the mint degrades
--   honestly to the four-check gate rather than inventing an elapsed window.
-- =============================================================================

alter table public.applications
  add column if not exists colosseum_resident_since timestamptz;

comment on column public.applications.colosseum_resident_since is
  'When the resident first satisfied the four residency checks for the '
  'Colosseum track, server-side. The Citizen claim is refused until two minutes '
  'have elapsed from this instant. NULL until recorded. Written only through '
  'record_colosseum_resident_since.';

-- Record the window start once. Idempotent: a second call returns the existing
-- instant rather than moving it, so a retry cannot reset the clock.
create or replace function public.record_colosseum_resident_since(
  p_profile_id uuid
)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_since timestamptz;
begin
  if p_profile_id is null then
    raise exception 'record_colosseum_resident_since requires a profile id'
      using errcode = '22023';
  end if;

  update public.applications
     set colosseum_resident_since = now()
   where profile_id = p_profile_id
     and colosseum_resident_since is null
   returning colosseum_resident_since into v_since;

  if v_since is null then
    select colosseum_resident_since into v_since
      from public.applications
     where profile_id = p_profile_id;
  end if;

  return v_since;
end;
$$;

comment on function public.record_colosseum_resident_since(uuid) is
  'Records the Colosseum compliance-window start once. SECURITY DEFINER, '
  'service_role only. Idempotent: a second call returns the existing instant. '
  'The Citizen claim reads the column and refuses until two minutes have '
  'elapsed.';

revoke all on function public.record_colosseum_resident_since(uuid)
  from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.record_colosseum_resident_since(uuid)
      to service_role;
  end if;
end
$$;
