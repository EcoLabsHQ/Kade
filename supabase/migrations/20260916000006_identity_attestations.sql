-- =============================================================================
-- Kade — identity attestations.
--
-- Schema authority: docs/planning/kade-mvp-build-document-v7.txt section 9, and
-- section 8 (Identity: "Kade stores the attestation UID and the disclosed fields
-- only — never the raw proof payload").
--
-- Week 3+; deny-by-default in Week 1. The table exists now because the
-- duplicate-application guard (self_nullifier) is part of the frozen schema.
-- =============================================================================

-- identity_attestations — DOCX section 9:
--   profile_id, attestation_uid, chain, nationality, over18, not_sanctioned,
--   self_nullifier, expires_at, created_at
create table public.identity_attestations (
  id             bigint generated always as identity primary key,
  profile_id     uuid not null references public.profiles (id) on delete cascade,
  attestation_uid text unique,
  chain          integer not null,
  nationality    text,
  over18         boolean,
  not_sanctioned boolean,
  self_nullifier text not null,
  expires_at     timestamptz,
  created_at     timestamptz not null default now()
);

comment on table public.identity_attestations is
  'Mirror of kade.kyc.v1 for querying (DOCX section 9). Stores only the '
  'attestation UID and the disclosed fields; NO raw proof payload is stored '
  'anywhere (DOCX section 8, ADR 0004). Deny-by-default in Week 1.';
comment on column public.identity_attestations.id is
  '[arbitrary] structural primary key.';
comment on column public.identity_attestations.self_nullifier is
  'SECURITY-CRITICAL (D2) and the duplicate-application / Sybil guard: UNIQUE '
  'and indexed. Treat it as the primary identity key for duplicate detection, '
  'not name + date of birth (DOCX section 14).';
comment on column public.identity_attestations.attestation_uid is
  '[arbitrary] UNIQUE is not stated in the DOCX, but two rows claiming the same '
  'on-chain attestation is a data-integrity defect, so it is constrained here.';
comment on column public.identity_attestations.nationality is
  '[documented] kade.kyc.v1 discloses nationality; the encoding is [arbitrary] '
  '(ISO 3166-1 alpha-2 is used consistently with the other country columns).';

-- The self_nullifier must be indexed AND unique (DOCX section 9). The unique
-- index below is the guard; it also serves lookups.
create unique index identity_attestations_self_nullifier_key
  on public.identity_attestations (self_nullifier);

create index identity_attestations_profile_id_idx
  on public.identity_attestations (profile_id);
