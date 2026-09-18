-- =============================================================================
-- Return the demo database to its base state.
--
--   * removes every resident. `auth.users` cascades to `profiles`, and from
--     there to applications, household members, wallets, attestations,
--     documents, and the rail and card rows.
--   * keeps the seeded configuration: `chains` and `fee_schedule`.
--
-- Run this before a demo, and after any change that writes resident data, so the
-- walkthrough starts from the same state every time.
--
-- The function is not reachable from the API: EXECUTE is granted to nobody, so
-- it cannot be called with the publishable key. It is run by the migrations
-- tooling or by hand.
--
-- Never run this against anything but a demo project.
-- =============================================================================

create or replace function public.reset_demo_data()
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_profiles integer;
  v_apps     integer;
  v_chains   integer;
  v_fees     integer;
begin
  delete from auth.users;

  select count(*) into v_profiles from public.profiles;
  select count(*) into v_apps     from public.applications;
  select count(*) into v_chains   from public.chains;
  select count(*) into v_fees     from public.fee_schedule;

  -- Assert the outcome instead of assuming the cascade did what it should.
  if v_profiles <> 0 or v_apps <> 0 then
    raise exception 'reset left resident data behind: % profiles, % applications',
      v_profiles, v_apps;
  end if;
  if v_chains = 0 or v_fees = 0 then
    raise exception 'reset removed the seeded configuration: % chains, % fee rows',
      v_chains, v_fees;
  end if;
end;
$$;

comment on function public.reset_demo_data() is
  'Deletes all resident data and verifies the seeded configuration survived. '
  'For demo resets only; not exposed through the API.';

revoke all on function public.reset_demo_data() from public, anon, authenticated;
