-- =============================================================================
-- Kade — row level security, privileges and the RLS guard.
--
-- This is the single place RLS is enabled, so the review checklist can assert
-- "every table has RLS" by reading one file. Decision record:
-- docs/architecture/adr/0004-data-ownership-and-rls.md.
--
-- Model:
--   * Every table gets `enable row level security`. None is left unprotected.
--   * Owner tables (profiles, citizenships, residences, applications, household)
--     are readable and writable only by the owning resident.
--   * Security-critical columns are removed from the `authenticated` column
--     privileges, so a direct write by an owner is refused. Where a resident must
--     supply such a value for their own row it goes through a SECURITY DEFINER
--     function (migrations 17, 18). applications.status is written only by the
--     review trigger.
--   * Post-Week-1 tables are deny-by-default: RLS on, no permissive policy, no
--     privileges for anon/authenticated.
--   * chains and fee_schedule are public configuration, readable by any
--     authenticated resident and writable only by the server.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper: is the current user a reviewer?
--
-- SECURITY DEFINER so the check can read public.reviewers, which is itself
-- deny-by-default. search_path is pinned to prevent search_path attacks.
-- ---------------------------------------------------------------------------
create or replace function public.is_reviewer()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.reviewers r where r.id = auth.uid());
$$;

revoke all on function public.is_reviewer() from public, anon;
grant execute on function public.is_reviewer() to authenticated;

-- ===========================================================================
-- profiles — owner read/write, reviewer read (DOCX section 9)
-- ===========================================================================
alter table public.profiles enable row level security;

revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
-- safe_address is deliberately absent from both grants: a direct write is
-- refused. Migration 18 adds record_safe_prediction for the caller's own row.
grant insert (id, email, first_name, last_name, dob) on table public.profiles to authenticated;
grant update (email, first_name, last_name, dob) on table public.profiles to authenticated;

create policy profiles_select_own_or_reviewer
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_reviewer());

create policy profiles_insert_self
  on public.profiles for insert to authenticated
  with check (id = auth.uid());

create policy profiles_update_self
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ===========================================================================
-- profile_citizenships / profile_residences — owner full access
-- ===========================================================================
alter table public.profile_citizenships enable row level security;
revoke all on table public.profile_citizenships from anon, authenticated;
grant select, insert, update, delete on table public.profile_citizenships to authenticated;

create policy profile_citizenships_all_own
  on public.profile_citizenships for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

alter table public.profile_residences enable row level security;
revoke all on table public.profile_residences from anon, authenticated;
grant select, insert, update, delete on table public.profile_residences to authenticated;

create policy profile_residences_all_own
  on public.profile_residences for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- ===========================================================================
-- applications — owner read; owner insert/update of the proposal only
--
-- Resident-writable: tier (and profile_id on insert).
-- Server-only (column grants withheld): ref, status, preapproval_usdc,
-- service_usdc, fee_tx, fee_uid, app_uid, review_uid, service_uid.
-- ===========================================================================
alter table public.applications enable row level security;
revoke all on table public.applications from anon, authenticated;
grant select on table public.applications to authenticated;
grant insert (profile_id, tier) on table public.applications to authenticated;
grant update (tier) on table public.applications to authenticated;

create policy applications_select_own_or_reviewer
  on public.applications for select to authenticated
  using (profile_id = auth.uid() or public.is_reviewer());

create policy applications_insert_own
  on public.applications for insert to authenticated
  with check (profile_id = auth.uid());

create policy applications_update_own_proposal
  on public.applications for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- ===========================================================================
-- household_members — owner full access via the parent application
-- ===========================================================================
alter table public.household_members enable row level security;
revoke all on table public.household_members from anon, authenticated;
grant select, insert, update, delete on table public.household_members to authenticated;

create policy household_members_all_own
  on public.household_members for all to authenticated
  using (
    exists (
      select 1 from public.applications a
      where a.id = household_members.application_id and a.profile_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.applications a
      where a.id = household_members.application_id and a.profile_id = auth.uid()
    )
  );

-- ===========================================================================
-- chains and fee_schedule — public configuration, server-written
-- ===========================================================================
alter table public.chains enable row level security;
revoke all on table public.chains from anon, authenticated;
grant select on table public.chains to authenticated;
create policy chains_read_all
  on public.chains for select to authenticated using (true);

alter table public.fee_schedule enable row level security;
revoke all on table public.fee_schedule from anon, authenticated;
grant select on table public.fee_schedule to authenticated;
create policy fee_schedule_read_all
  on public.fee_schedule for select to authenticated using (true);

-- ===========================================================================
-- Post-Week-1 tables — RLS on, deny-by-default.
--
-- Each table is created in full by the earlier migrations but is not part of
-- the Week 1 journey. No permissive policy and no anon/authenticated privilege
-- means nobody but the server can touch them. Adding a policy in a later week is
-- deliberate, which is the intended cost (ADR 0004).
-- ===========================================================================
alter table public.wallets               enable row level security;
alter table public.wealth_snapshots      enable row level security;
alter table public.container_balances     enable row level security;
alter table public.allocations            enable row level security;
alter table public.gos_transfers          enable row level security;
alter table public.card_transactions      enable row level security;
alter table public.documents              enable row level security;
alter table public.identity_attestations  enable row level security;
alter table public.reviewers              enable row level security;
alter table public.review_events          enable row level security;

revoke all on table public.wallets               from anon, authenticated;
revoke all on table public.wealth_snapshots      from anon, authenticated;
revoke all on table public.container_balances    from anon, authenticated;
revoke all on table public.allocations           from anon, authenticated;
revoke all on table public.gos_transfers         from anon, authenticated;
revoke all on table public.card_transactions     from anon, authenticated;
revoke all on table public.documents             from anon, authenticated;
revoke all on table public.identity_attestations from anon, authenticated;
revoke all on table public.reviewers             from anon, authenticated;
revoke all on table public.review_events         from anon, authenticated;

-- ===========================================================================
-- Guard: fail the migration if any public table lacks RLS.
--
-- ADR 0004: "A migration that forgets `enable row level security` is a defect,
-- not a detail." This turns that into an executable check.
-- ===========================================================================
do $$
declare
  unprotected record;
begin
  for unprotected in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relrowsecurity
  loop
    raise exception 'RLS is not enabled on public.% (ADR 0004)', unprotected.relname;
  end loop;
end
$$;
