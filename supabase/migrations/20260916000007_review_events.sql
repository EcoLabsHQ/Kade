-- =============================================================================
-- Kade — reviewers and the append-only review log.
--
-- Schema authority: docs/planning/kade-mvp-build-document-v7.txt section 9.
--
-- The Admin console is excluded from Week 1, so both tables are deny-by-default
-- (ADR 0004). The structure and the status-transition trigger exist now because
-- "status changes via review_events trigger only" is part of the frozen schema.
-- =============================================================================

-- reviewers — DOCX section 9: id, role, signer_address
create table public.reviewers (
  id             uuid primary key references auth.users (id) on delete cascade,
  role           text not null,
  signer_address text
);

comment on table public.reviewers is
  'RLS gate for Admin screens (DOCX section 9). A reviewer is an authenticated '
  'user whose id appears here; public.is_reviewer() reads it with definer rights. '
  'Deny-by-default in Week 1.';
comment on column public.reviewers.role is
  '[arbitrary] encoding. The build guide describes reviewer actions but does not '
  'enumerate roles.';
comment on column public.reviewers.signer_address is
  '[arbitrary] whether reviews are signed by a server key or a reviewer wallet '
  'is an open decision (DOCX section 15).';

-- review_events — DOCX section 9:
--   application_id, reviewer_id, action, note, attestation_uid, created_at
create table public.review_events (
  id              bigint generated always as identity primary key,
  application_id  uuid not null references public.applications (id) on delete cascade,
  reviewer_id     uuid references public.reviewers (id) on delete set null,
  action          text not null check (action in ('approve', 'block', 'reopen')),
  note            text,
  attestation_uid text,
  created_at      timestamptz not null default now()
);

comment on table public.review_events is
  'Append-only review log (DOCX section 9). Realtime feeds both UIs. Status '
  'transitions are applied by trigger, never by direct UPDATE of applications. '
  'Deny-by-default in Week 1.';
comment on column public.review_events.id is
  '[arbitrary] structural primary key.';
comment on column public.review_events.action is
  '[documented] approve | block | reopen, from the Admin console description in '
  'DOCX section 6.';
comment on column public.review_events.attestation_uid is
  '[arbitrary] the UID of the kade.review.v1 attestation signed for the action.';

-- ---------------------------------------------------------------------------
-- Status transitions: the only path that changes applications.status.
--
-- SECURITY DEFINER so the trigger can write the protected status column that
-- the authenticated role has no privilege on. search_path is pinned.
-- ---------------------------------------------------------------------------
create or replace function public.apply_review_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.action = 'approve' then
    update public.applications set status = 'approved' where id = new.application_id;
  elsif new.action = 'block' then
    update public.applications set status = 'blocked' where id = new.application_id;
  elsif new.action = 'reopen' then
    update public.applications set status = 'pre_approved' where id = new.application_id;
  end if;
  return new;
end;
$$;

comment on function public.apply_review_event() is
  'Applies a review_events insert to applications.status. This is deliberately '
  'the only writer of that protected column (D2).';

create trigger review_events_apply
  after insert on public.review_events
  for each row execute function public.apply_review_event();

-- ---------------------------------------------------------------------------
-- Append-only: reject UPDATE and DELETE on review_events for every role.
-- ---------------------------------------------------------------------------
create or replace function public.review_events_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'review_events is append-only (DOCX section 9)';
end;
$$;

create trigger review_events_no_update
  before update on public.review_events
  for each row execute function public.review_events_immutable();

create trigger review_events_no_delete
  before delete on public.review_events
  for each row execute function public.review_events_immutable();

create index review_events_application_id_idx on public.review_events (application_id);
