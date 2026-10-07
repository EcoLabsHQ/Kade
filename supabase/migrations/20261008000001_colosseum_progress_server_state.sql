-- =============================================================================
-- Kade — the Colosseum demo state, moved server-side and per account.
--
-- Why this exists
--   The Colosseum demo clock and the virtual certificate lived only in the
--   browser (`apps/web/src/components/residency/colosseum-progress.ts`, a
--   `localStorage` store keyed per application id, plus the
--   `kade.documents.complete.v2.*` flag). Two browsers signed into the same
--   account therefore showed different demo states, and clearing the browser
--   silently reset the demo — the opposite of what an account-bound credential
--   demo should do. This migration is the server record the state moves to.
--
-- What it adds
--   - `public.colosseum_progress` — one row per profile holding the demo
--     fields that are NOT already recorded elsewhere:
--       * `citizen_at` / `passport_serial` — the demo citizenship instant and
--         certificate serial;
--       * `residency_pass_at` / `residency_pass_serial` — the demo residency
--         pass claim instant and serial;
--       * `documents_complete` — the demo "Documents complete" flag.
--   - Resident-scoped SECURITY DEFINER writers for the DEMO values. Every writer
--     derives the account from `auth.uid()`; a profile id is never accepted from
--     the client. These record values the resident is entitled to set (their own
--     demo pass/certificate and documents flag).
--
-- Reconciliation with the compliance window (single source of truth)
--   The 2-minute compliance window is ALREADY server-side in
--   `applications.colosseum_resident_since` (migration
--   `20261006000002_colosseum_compliance_window.sql`), and the Citizen mint
--   already reads it. This migration deliberately does NOT add a second
--   `resident_since` field. The window is a GATE, not a demo value, so it is
--   started by the server action `startColosseumWindow`, which re-derives the
--   four real checks server-side and writes through the service-role
--   `record_colosseum_resident_since()` writer — the same authority migration
--   `20261006000002` established. There is NO resident-callable window writer:
--   an earlier revision of this migration added `start_colosseum_window()`
--   granted to `authenticated` with only an `auth.uid()` guard, which let a
--   signed-in resident pre-start the clock and satisfy the 2-minute Citizen gate
--   early. That function is dropped below and must not be reintroduced.
--   `clear_colosseum_window()` stays resident-callable: clearing only resets the
--   resident's own clock (it can only delay citizenship, never grant it), and it
--   is scoped to `auth.uid()` and blocked once the resident is a citizen.
--
-- Trust boundary
--   A resident may read their own row (`SELECT` grant + owner policy) and may
--   write the demo values only through the SECURITY DEFINER writers, which are
--   scoped to `auth.uid()`. Direct `INSERT`/`UPDATE`/`DELETE` grants are
--   withheld, so a resident cannot write another resident's row or bypass the
--   writers.
--
-- APPLIED, with a security repair
--   The orchestrator applied this migration. The resident-callable
--   `start_colosseum_window()` it originally created is dropped by the
--   `drop function if exists` below; re-applying this file (it is idempotent)
--   removes it. The table, the demo writers and `clear_colosseum_window()` are
--   unchanged. The server read degrades honestly to an empty demo state when the
--   record is absent.
-- =============================================================================

create table if not exists public.colosseum_progress (
  profile_id            uuid primary key references public.profiles (id) on delete cascade,
  citizen_at            timestamptz,
  passport_serial       text check (passport_serial is null or passport_serial ~ '^KADE-CL-[A-Z0-9]{8}$'),
  residency_pass_at     timestamptz,
  residency_pass_serial text check (residency_pass_serial is null or residency_pass_serial ~ '^KADE-RES-[A-Z0-9]{8}$'),
  documents_complete    boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.colosseum_progress is
  'The Colosseum demo state, per account. Holds only the fields not recorded '
  'elsewhere: the demo citizenship instant/serial, the demo residency-pass '
  'instant/serial and the demo documents flag. The 2-minute compliance window '
  'lives in applications.colosseum_resident_since and is deliberately NOT '
  'duplicated here. Written through the resident-scoped demo writers; the '
  'window is started server-side through the service-role writer.';
comment on column public.colosseum_progress.profile_id is
  'SECURITY-CRITICAL: the owning resident (auth.uid()). Server-derived; never '
  'client-supplied.';
comment on column public.colosseum_progress.citizen_at is
  'The demo instant the resident became a Colosseum Citizen. Write-once.';
comment on column public.colosseum_progress.passport_serial is
  'The demo citizenship-certificate serial (KADE-CL-…). Non-sensitive demo value.';
comment on column public.colosseum_progress.residency_pass_at is
  'The demo instant the virtual residency pass was claimed. Write-once.';
comment on column public.colosseum_progress.residency_pass_serial is
  'The demo residency-pass serial (KADE-RES-…). Non-sensitive demo value.';
comment on column public.colosseum_progress.documents_complete is
  'The demo "Documents complete" flag. No document is uploaded.';
comment on column public.colosseum_progress.created_at is
  'When the demo row was first written.';
comment on column public.colosseum_progress.updated_at is
  'Last change to the demo row.';

-- ---------------------------------------------------------------------------
-- RLS: the resident reads their own row; the server writes everything.
-- ---------------------------------------------------------------------------
alter table public.colosseum_progress enable row level security;

revoke all on table public.colosseum_progress from anon, authenticated;
grant select on table public.colosseum_progress to authenticated;

drop policy if exists colosseum_progress_select_own on public.colosseum_progress;
create policy colosseum_progress_select_own
  on public.colosseum_progress for select to authenticated
  using (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Writers (SECURITY DEFINER, pinned search_path)
--
-- The DEMO writers are resident-scoped and derive the account from `auth.uid()`;
-- none accepts a profile id. They record values the resident is entitled to set.
--
-- The window is NOT one of them: it is a gate, not a demo value, and is started
-- only by the server action `startColosseumWindow` (which re-derives the four
-- real checks) through the service-role `record_colosseum_resident_since`
-- writer. `clear_colosseum_window` stays resident-callable because clearing can
-- only delay the resident's own citizenship, never grant it.
-- ---------------------------------------------------------------------------

-- SECURITY REPAIR: remove the resident-callable window start. It was granted to
-- `authenticated` and guarded only on `auth.uid() is not null`, so a signed-in
-- resident could start the clock before the four checks were green and satisfy
-- the 2-minute Citizen gate early. The window is now started server-side after a
-- server-side re-derivation of the checks, through the service-role writer.
drop function if exists public.start_colosseum_window();

-- Clear the compliance window before citizenship (the checks stopped being
-- green). A citizen keeps the record: citizenship is never cleared.
create or replace function public.clear_colosseum_window()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'clear_colosseum_window requires a signed-in resident'
      using errcode = '28000';
  end if;

  update public.applications
     set colosseum_resident_since = null
   where profile_id = auth.uid()
     and not exists (
       select 1
         from public.colosseum_progress cp
        where cp.profile_id = auth.uid()
          and cp.citizen_at is not null
     );
end;
$$;

comment on function public.clear_colosseum_window() is
  'Clears the Colosseum compliance window for the signed-in resident, matching '
  'the pre-citizenship decay. SECURITY DEFINER, authenticated only. Safe to '
  'leave resident-callable: it is scoped to auth.uid(), can only reset the '
  'resident''s own clock (delaying, never granting, citizenship), and a recorded '
  'citizen is never cleared.';

-- Claim the virtual residency pass: record the instant and demo serial once.
create or replace function public.claim_colosseum_residency_pass(p_serial text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_serial text := nullif(trim(coalesce(p_serial, '')), '');
begin
  if auth.uid() is null then
    raise exception 'claim_colosseum_residency_pass requires a signed-in resident'
      using errcode = '28000';
  end if;
  if v_serial is not null and v_serial !~ '^KADE-RES-[A-Z0-9]{8}$' then
    raise exception 'claim_colosseum_residency_pass requires a KADE-RES serial'
      using errcode = '22023';
  end if;

  insert into public.colosseum_progress (
    profile_id,
    residency_pass_at,
    residency_pass_serial
  )
  values (auth.uid(), now(), v_serial)
  on conflict (profile_id) do update
    set residency_pass_at     = coalesce(public.colosseum_progress.residency_pass_at, now()),
        residency_pass_serial = coalesce(public.colosseum_progress.residency_pass_serial,
                                         excluded.residency_pass_serial),
        updated_at            = now();
end;
$$;

comment on function public.claim_colosseum_residency_pass(text) is
  'Records the demo residency-pass claim once for the signed-in resident. '
  'SECURITY DEFINER, authenticated only, account from auth.uid(). Idempotent: '
  'an existing instant/serial is kept.';

-- Become a Colosseum Citizen: record the instant and demo serial once.
create or replace function public.become_colosseum_citizen(p_serial text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_serial text := nullif(trim(coalesce(p_serial, '')), '');
begin
  if auth.uid() is null then
    raise exception 'become_colosseum_citizen requires a signed-in resident'
      using errcode = '28000';
  end if;
  if v_serial is not null and v_serial !~ '^KADE-CL-[A-Z0-9]{8}$' then
    raise exception 'become_colosseum_citizen requires a KADE-CL serial'
      using errcode = '22023';
  end if;

  insert into public.colosseum_progress (
    profile_id,
    citizen_at,
    passport_serial
  )
  values (auth.uid(), now(), v_serial)
  on conflict (profile_id) do update
    set citizen_at      = coalesce(public.colosseum_progress.citizen_at, now()),
        passport_serial = coalesce(public.colosseum_progress.passport_serial,
                                   excluded.passport_serial),
        updated_at      = now();
end;
$$;

comment on function public.become_colosseum_citizen(text) is
  'Records the demo citizenship once for the signed-in resident. SECURITY '
  'DEFINER, authenticated only, account from auth.uid(). Idempotent: an '
  'existing instant/serial is kept.';

-- Set the demo "Documents complete" flag.
create or replace function public.set_colosseum_documents_complete(p_complete boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'set_colosseum_documents_complete requires a signed-in resident'
      using errcode = '28000';
  end if;

  insert into public.colosseum_progress (profile_id, documents_complete)
  values (auth.uid(), coalesce(p_complete, false))
  on conflict (profile_id) do update
    set documents_complete = coalesce(p_complete, false),
        updated_at         = now();
end;
$$;

comment on function public.set_colosseum_documents_complete(boolean) is
  'Sets the demo "Documents complete" flag for the signed-in resident. '
  'SECURITY DEFINER, authenticated only, account from auth.uid(). No document '
  'is uploaded.';

revoke all on function public.clear_colosseum_window()
  from public, anon, authenticated;
revoke all on function public.claim_colosseum_residency_pass(text)
  from public, anon, authenticated;
revoke all on function public.become_colosseum_citizen(text)
  from public, anon, authenticated;
revoke all on function public.set_colosseum_documents_complete(boolean)
  from public, anon, authenticated;

grant execute on function public.clear_colosseum_window() to authenticated;
grant execute on function public.claim_colosseum_residency_pass(text) to authenticated;
grant execute on function public.become_colosseum_citizen(text) to authenticated;
grant execute on function public.set_colosseum_documents_complete(boolean) to authenticated;
