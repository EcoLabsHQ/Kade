-- =============================================================================
-- Repair: `reset_demo_data()` could not run once an application had been reviewed.
--
-- Why it broke
--   The reset deletes `auth.users` and relies on the cascade to remove every
--   resident row. `review_events.reviewer_id` references `profiles`, so the
--   cascade tries to null it — and `review_events` carries a `BEFORE UPDATE`
--   trigger that raises, because the table is append-only by design (DOCX
--   section 9). With any review recorded, the whole reset aborts:
--
--     ERROR: P0001: review_events is append-only (DOCX section 9)
--
--   That made the function unusable in exactly the state a demo leaves behind.
--
-- The fix, and why this shape
--   `TRUNCATE` does not fire row-level triggers, so the append-only guard is not
--   bypassed — it simply does not apply to a deliberate whole-table reset, which
--   is what this function is. The guard keeps protecting the ordinary paths
--   (a stray UPDATE or DELETE of a row still raises); nothing about the
--   invariant is weakened.
--
--   The audit trail is truncated first, before anything that would cascade into
--   it, so no FK action can attempt the blocked update. The seeded configuration
--   (`chains`, `fee_schedule`) is never touched, and the assertions at the end
--   still prove both outcomes rather than assuming them.
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
  v_events   integer;
begin
  -- The append-only guard is a row trigger, so it blocks the cascade's
  -- `reviewer_id = NULL`. Truncating the audit trail first removes that
  -- interaction entirely, and TRUNCATE does not fire row triggers.
  truncate table public.review_events;

  -- Now the cascade from auth.users can run: nothing references review_events,
  -- and every remaining child row is deleted rather than updated.
  delete from auth.users;

  select count(*) into v_profiles from public.profiles;
  select count(*) into v_apps     from public.applications;
  select count(*) into v_chains   from public.chains;
  select count(*) into v_fees     from public.fee_schedule;
  select count(*) into v_events   from public.review_events;

  -- Assert the outcome instead of assuming the cascade did what it should.
  if v_profiles <> 0 or v_apps <> 0 or v_events <> 0 then
    raise exception
      'reset left resident data behind: % profiles, % applications, % review events',
      v_profiles, v_apps, v_events;
  end if;
  if v_chains = 0 or v_fees = 0 then
    raise exception 'reset removed the seeded configuration: % chains, % fee rows',
      v_chains, v_fees;
  end if;
end;
$$;

comment on function public.reset_demo_data() is
  'Deletes all resident data and verifies the seeded configuration survived. '
  'Truncates review_events first, because its append-only guard blocks the '
  'cascade''s reviewer_id update; TRUNCATE does not fire row triggers, so a '
  'deliberate whole-table reset is unaffected while the guard keeps protecting '
  'ordinary updates and deletes. For demo resets only; not exposed through the API.';

revoke all on function public.reset_demo_data() from public, anon, authenticated;
