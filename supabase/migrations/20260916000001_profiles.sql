-- =============================================================================
-- Kade — profiles and the residency history that hangs off it.
--
-- Schema authority: docs/planning/kade-mvp-build-document-v7.txt section 9
-- ("Supabase schema"). Column names are taken verbatim from that table unless a
-- comment says otherwise.
--
-- RLS is enabled in 20260916000009_rls.sql, in one auditable place. This file
-- creates structure only. A migration that forgets to enable row level security
-- is a defect (docs/architecture/adr/0004-data-ownership-and-rls.md).
-- =============================================================================

-- profiles — DOCX section 9: id, safe_address, email, first_name, last_name, dob
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  safe_address  text unique,
  email         text,
  first_name    text,
  last_name     text,
  dob           date
);

comment on table public.profiles is
  'Resident profile (DOCX section 9). One Safe address serves all chains. '
  'RLS: owner read/write, reviewer read (ADR 0004).';
comment on column public.profiles.safe_address is
  'SECURITY-CRITICAL (D2): the resident Safe address. Server-written only; the '
  'authenticated role has no column privilege on it. Per DOCX section 9 and '
  'STEP 1 ("profiles row keyed by Safe address") the Safe lives on profiles, '
  'not on applications. UNIQUE because one Safe cannot belong to two residents.';
comment on column public.profiles.dob is
  'Date of birth. Self proves over-18 without transmitting the raw value; this '
  'column is the programme intake record for Steps 1-2, not an attestation.';

-- profile_citizenships — DOCX section 9: profile_id, country_code
create table public.profile_citizenships (
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  country_code text not null,
  primary key (profile_id, country_code)
);

comment on table public.profile_citizenships is
  'Multiple citizenships (DOCX section 9, STEP 2).';
comment on column public.profile_citizenships.country_code is
  '[arbitrary] the build guide requires "country dropdowns" but does not fix an '
  'encoding. Recorded as an ISO 3166-1 alpha-2 code; no CHECK is imposed so a '
  'future change does not require a migration.';

-- profile_residences — DOCX section 9: profile_id, country_code, from_year, to_year
create table public.profile_residences (
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  country_code text not null,
  from_year    integer not null,
  to_year      integer,
  primary key (profile_id, country_code, from_year),
  constraint profile_residences_year_order check (to_year is null or to_year >= from_year)
);

comment on table public.profile_residences is
  'Residences covering the required five-year period (DOCX section 9, STEP 2). '
  'Drives the police-clearance checklist. A NULL to_year means current.';
comment on column public.profile_residences.country_code is
  '[arbitrary] encoding: ISO 3166-1 alpha-2, as for profile_citizenships.';
comment on column public.profile_residences.from_year is
  '[arbitrary] the DOCX does not fix the year type; integer calendar year.';
