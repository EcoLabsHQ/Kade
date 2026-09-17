-- =============================================================================
-- Kade — documents.
--
-- Schema authority: docs/planning/kade-mvp-build-document-v7.txt section 9 and
-- section 14 ("Documents: hash + pin, attest the root, show the CID").
--
-- Hash and pin only. No document bytes live in Postgres; sha256 and cid are
-- computed server-side over the uploaded object and are security-critical (D2).
-- Week 3; deny-by-default in Week 1.
-- =============================================================================

-- documents — DOCX section 9: application_id, kind, owner, sha256, cid, status
create table public.documents (
  id             bigint generated always as identity primary key,
  application_id uuid not null references public.applications (id) on delete cascade,
  kind           text not null,
  owner          text,
  sha256         text,
  cid            text,
  status         text not null default 'pending'
);

comment on table public.documents is
  'Document metadata: hash + pin only, never the document itself (DOCX section '
  '9; section 14). Uploads live in Residency, not pre-registration. '
  'Deny-by-default in Week 1.';
comment on column public.documents.id is
  '[arbitrary] structural primary key.';
comment on column public.documents.kind is
  '[arbitrary] encoding. The DOCX names the column but not its values.';
comment on column public.documents.owner is
  '[arbitrary] encoding. Intended to record who supplied the document (resident '
  'or programme); the DOCX does not fix the values.';
comment on column public.documents.sha256 is
  'SECURITY-CRITICAL (D2): content hash. Server-computed over the pinned object; '
  'never client-supplied. Client-supplied hashes are a document-substitution '
  'attack.';
comment on column public.documents.cid is
  'SECURITY-CRITICAL (D2): content-addressed pointer to the pinned object. '
  'Server-written.';
comment on column public.documents.status is
  '[arbitrary] the DOCX names the column but not its values; pending is the '
  'initial state.';

create index documents_application_id_idx on public.documents (application_id);
