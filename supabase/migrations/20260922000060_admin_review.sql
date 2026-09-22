-- =============================================================================
-- Kade — the reviewer surface (Week 2, D19 / EXE-015).
--
-- Why this exists
--   Week 1 created `public.reviewers` and the append-only `public.review_events`
--   log and left both deny-by-default (20260916000007, 20260916000009), because
--   the Admin console was out of Week 1 scope. Week 2 makes the console real, so
--   this migration opens exactly the surface a reviewer needs and nothing more.
--
-- What a reviewer can reach, and why each one is required by D19
--   * `reviewers`      — read their own row, so the console can confirm the role.
--   * `review_events`  — read the log and INSERT one review action. The insert is
--                        the only write path; `applications.status` is flipped by
--                        the existing `review_events_apply` trigger, never by a
--                        direct UPDATE.
--   * `profiles` / `applications` — already reviewer-readable
--                        (`profiles_select_own_or_reviewer`,
--                        `applications_select_own_or_reviewer`), so the queue can
--                        show the applicant and the application state.
--   * `wallets`, `identity_attestations`, `profile_residences`,
--     `profile_citizenships` — the decide fields D19 names: proof of wealth and
--                        the residency checks. Read-only for reviewers.
--
-- Security model
--   `public.is_reviewer()` (20260916000009) is SECURITY DEFINER and reads
--   `reviewers` with definer rights, so it can gate policies on a table that is
--   itself closed. Every policy below is additive to the existing owner policies;
--   none widens a resident's own access. The insert policy pins
--   `reviewer_id = auth.uid()`, so a reviewer cannot attribute an action to
--   another reviewer, and a non-reviewer insert is refused by RLS even if the
--   server action is bypassed.
--
--   `applications.status` stays trigger-only: the `authenticated` column
--   privileges (20260916000009) still exclude it, and this migration grants no
--   UPDATE on `applications` at all.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- reviewers — a reviewer reads their own row. Writes stay server/human-only:
-- there is deliberately no insert/update/delete grant, so a user cannot make
-- themselves a reviewer.
-- ---------------------------------------------------------------------------
grant select on table public.reviewers to authenticated;

create policy reviewers_select_self
  on public.reviewers for select to authenticated
  using (id = auth.uid());

-- ---------------------------------------------------------------------------
-- review_events — reviewers read the log and append their own actions.
--
-- The append-only triggers (20260916000007) still refuse UPDATE and DELETE, so
-- an attestation UID supplied at insert cannot be edited afterwards. That is why
-- the review action writes the UID in the same row as the action, or leaves it
-- NULL when the on-chain write is gated.
-- ---------------------------------------------------------------------------
grant select, insert on table public.review_events to authenticated;

create policy review_events_select_reviewer
  on public.review_events for select to authenticated
  using (public.is_reviewer());

create policy review_events_insert_reviewer
  on public.review_events for insert to authenticated
  with check (public.is_reviewer() and reviewer_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Proof of wealth — reviewer read. `wallets` already grants SELECT to
-- `authenticated` and has the owner policy (20260921000001); this only adds the
-- reviewer predicate.
-- ---------------------------------------------------------------------------
create policy wallets_select_reviewer
  on public.wallets for select to authenticated
  using (public.is_reviewer());

-- ---------------------------------------------------------------------------
-- Residency checks — reviewer read. `profile_residences` and
-- `profile_citizenships` already grant SELECT to `authenticated` and have owner
-- policies (20260916000009); `identity_attestations` is deny-by-default, so it
-- needs the grant as well.
-- ---------------------------------------------------------------------------
grant select on table public.identity_attestations to authenticated;

create policy identity_attestations_select_reviewer
  on public.identity_attestations for select to authenticated
  using (public.is_reviewer());

create policy profile_residences_select_reviewer
  on public.profile_residences for select to authenticated
  using (public.is_reviewer());

create policy profile_citizenships_select_reviewer
  on public.profile_citizenships for select to authenticated
  using (public.is_reviewer());

-- ---------------------------------------------------------------------------
-- Realtime: the resident's gate flips from the reviewer's action, not a manual
-- edit. The client subscribes to `applications` row changes; Supabase Realtime
-- applies RLS, so a resident only receives their own row and a reviewer receives
-- the rows their policies allow. The publication exists in a Supabase project;
-- on a plain PostgreSQL (the pgTAP harness) it does not, so this is guarded and
-- a no-op there.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.applications;
    exception
      when duplicate_object then
        null; -- already a member; adding it twice is not an error.
    end;
  end if;
end
$$;

comment on policy review_events_insert_reviewer on public.review_events is
  'A reviewer may append a review action only under their own reviewer_id. The '
  'applications.status flip is performed by the review_events_apply trigger, so '
  'this policy is the only way a review reaches the application state.';
