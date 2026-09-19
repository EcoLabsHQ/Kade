-- =============================================================================
-- Kade — applications and household.
--
-- Schema authority: docs/planning/kade-mvp-build-document-v7.txt section 9.
-- See 20260916000001_profiles.sql for the RLS/schema split rationale.
-- =============================================================================

-- applications — DOCX section 9:
--   id, ref, profile_id, tier, status, preapproval_usdc, service_usdc,
--   fee_tx, fee_uid, app_uid, review_uid, service_uid
create table public.applications (
  id               uuid primary key default gen_random_uuid(),
  ref              text unique,
  profile_id       uuid not null references public.profiles (id) on delete cascade,
  tier             text not null
                     check (tier in ('3-year', '5-year', 'indefinite')),
  status           text not null default 'draft'
                     check (status in ('draft', 'pre_approved', 'submitted', 'approved', 'blocked')),
  preapproval_usdc numeric(20, 6),
  service_usdc     numeric(20, 6),
  fee_tx           text,
  fee_uid          text,
  app_uid          text,
  review_uid       text,
  service_uid      text
);

comment on table public.applications is
  'Application workflow row (DOCX section 9). Status changes flow through '
  'review_events, not direct updates: see 20260916000007_review_events.sql.';
comment on column public.applications.ref is
  'Human-readable application reference. Server-generated; not client-writable.';
comment on column public.applications.tier is
  'Qualifying tier. [documented] values from DOCX section 4 (3-year / 5-year / '
  'Indefinite); the lower-case encoding of "indefinite" is [arbitrary].';
comment on column public.applications.status is
  'SECURITY-CRITICAL (D2): server-written only. [documented] pre_approved '
  '(STEP 4), submitted, approved, blocked (Admin console). [arbitrary] draft is '
  'the pre-fee working state; the exact set is not frozen by the build guide.';
comment on column public.applications.preapproval_usdc is
  'SECURITY-CRITICAL (D2): recomputed server-side from the active fee_schedule '
  '(contract section 2.1). Never client-supplied. [arbitrary] numeric(20,6) '
  'precision.';
comment on column public.applications.service_usdc is
  'SECURITY-CRITICAL (D2): server-written. [arbitrary] numeric(20,6) precision.';
comment on column public.applications.fee_tx is
  'SECURITY-CRITICAL (D2): on-chain payment transaction hash. Server-written.';
comment on column public.applications.fee_uid is
  'SECURITY-CRITICAL (D2): kade.fee.v1 attestation UID. Server-written.';
comment on column public.applications.app_uid is
  'SECURITY-CRITICAL (D2): kade.application.v1 attestation UID. Server-written.';
comment on column public.applications.review_uid is
  'SECURITY-CRITICAL (D2): kade.review.v1 attestation UID. Server-written.';
comment on column public.applications.service_uid is
  'SECURITY-CRITICAL (D2): kade.permit.v1 / service attestation UID. '
  'Server-written.';

-- household_members — DOCX section 9: application_id, name, relation, dob, citizenship
create table public.household_members (
  id             bigint generated always as identity primary key,
  application_id uuid not null references public.applications (id) on delete cascade,
  name           text not null,
  relation       text,
  dob            date,
  citizenship    text
);

comment on table public.household_members is
  'Household members of an application (DOCX section 9). household_size drives '
  'the pre-approval fee (contract section 2.1).';
comment on column public.household_members.id is
  '[arbitrary] structural primary key: the DOCX column list has no key and name '
  'is not unique, so a surrogate key is required.';
comment on column public.household_members.citizenship is
  '[arbitrary] encoding: ISO 3166-1 alpha-2, consistent with the other country '
  'columns. The DOCX names the field but not its encoding.';

-- The DOCX notes "DB function recomputes the pre-approval fee". That formula is
-- intentionally NOT reimplemented in SQL here: ADR 0005 makes
-- preapprovalFeeUsdc() in @kade/shared the single implementation, used to seed
-- fee_schedule and to verify, so a second copy in PL/pgSQL could drift from the
-- one the contracts enforce. The server recomputes from the seeded schedule.
