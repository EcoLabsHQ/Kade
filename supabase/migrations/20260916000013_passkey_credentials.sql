-- =============================================================================
-- Kade — the transaction passkey's credential metadata.
--
-- Why this exists
--   D3 requires the credential metadata needed for future signing to be stored
--   securely and to survive a reload. The build guide's section 9 data model has
--   no table for it: `wallets` is for self-custodied EOAs and Bitcoin xpubs, not
--   for a WebAuthn credential. Without a home the metadata lived in the browser
--   and was lost on reload, so D3 could not be met.
--
--   Contract v1.5 records the addition. The column set is deliberately the
--   minimum needed to sign later, and nothing that could reconstruct the private
--   key: the key never leaves the authenticator.
--
-- Security
--   Row level security is on. A resident may read their own credential and may
--   propose one, but `signer_address` is server-written: it is derived from the
--   public key and the frozen Safe inputs, so the browser cannot name its own
--   signer. Nothing here stores the credential's private key, the raw attestation
--   object, or any document.
-- =============================================================================

create table public.passkey_credentials (
  id                bigint generated always as identity primary key,
  profile_id        uuid not null references public.profiles (id) on delete cascade,
  /** WebAuthn credential id (base64url). Unique per credential. */
  credential_id     text not null unique,
  /** COSE public key, used to derive the Safe WebAuthn signer address. */
  public_key        text not null,
  /**
   * The signer contract this credential owns. Derived server-side from the
   * public key and the Safe inputs; NULL until the Account gate approves them.
   */
  signer_address    text,
  /** Authenticator transports, for future assertion hints. */
  transports        text[] not null default '{}'::text[],
  /** Enrolment required user verification. Always true in this build. */
  user_verification boolean not null default true,
  created_at        timestamptz not null default now(),
  last_used_at      timestamptz
);

comment on table public.passkey_credentials is
  'The resident transaction passkey (D3). Contract v1.5: not in the DOCX data '
  'model, added because D3 requires credential metadata to persist. Holds no '
  'private key and no raw attestation.';
comment on column public.passkey_credentials.signer_address is
  'SECURITY-CRITICAL: the Safe WebAuthn signer contract this credential owns. '
  'Derived server-side from the public key plus the frozen Safe inputs, so it '
  'is not writable by the browser. NULL until the Account gate approves them.';
comment on column public.passkey_credentials.public_key is
  'COSE public key. Public by construction; the private key never leaves the '
  'authenticator and is not stored anywhere.';

create index passkey_credentials_profile_id_idx
  on public.passkey_credentials (profile_id);

-- ---------------------------------------------------------------------------
-- RLS: owner reads and proposes; the server decides the derived columns.
-- ---------------------------------------------------------------------------
alter table public.passkey_credentials enable row level security;

revoke all on table public.passkey_credentials from anon, authenticated;
grant select on table public.passkey_credentials to authenticated;
-- signer_address is absent from both grants: server-written only.
grant insert (profile_id, credential_id, public_key, transports, user_verification)
  on table public.passkey_credentials to authenticated;
grant update (last_used_at)
  on table public.passkey_credentials to authenticated;

create policy passkey_credentials_select_own
  on public.passkey_credentials for select to authenticated
  using (profile_id = auth.uid());

create policy passkey_credentials_insert_own
  on public.passkey_credentials for insert to authenticated
  with check (profile_id = auth.uid());

create policy passkey_credentials_update_own
  on public.passkey_credentials for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
