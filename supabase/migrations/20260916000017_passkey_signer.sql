-- =============================================================================
-- Kade — write the server-derived signer address for the resident's passkey.
--
-- Why this exists
--   `public.passkey_credentials.signer_address` is deliberately not granted to
--   `authenticated` (20260916000013): the browser must never be able to name its
--   own signer (D2). Writing it therefore used a service-role client, which is
--   the most powerful key in the project and is not configured in the deployed
--   environment; two deploys stalled on it.
--
--   This function is the narrow replacement, in the shape of
--   `save_onboarding_step2` (20260916000011): a SECURITY DEFINER function that
--   writes exactly the one protected column, for exactly one row, and grants no
--   general capability.
--
-- Security
--   SECURITY DEFINER, so it can write the column the `authenticated` role cannot.
--   RLS is bypassed by the definition, so the owner predicate is written out
--   explicitly: the only row it can reach is the one whose `credential_id` is
--   given AND whose `profile_id = auth.uid()`. A resident cannot touch another
--   resident's signer.
--
--   The signer address is derived off-chain (from the credential's public key
--   through the deployed Safe signer factory), so the function cannot recompute
--   it and takes it as an argument. It is therefore possible for a resident to
--   set the signer on their *own* credential by calling this function directly;
--   what is closed is naming another resident's signer and moving an existing
--   one. The value is immutable once set: a non-null `signer_address` can only
--   be re-supplied unchanged, never changed to a different address.
--
--   `search_path` is pinned, EXECUTE is revoked from `public` and `anon`, and
--   granted only to `authenticated` — matching `save_onboarding_step2` and
--   `reset_demo_data`.
-- =============================================================================

create or replace function public.save_passkey_signer(
  p_credential_id text,
  p_signer_address text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_existing text;
begin
  if v_uid is null then
    raise exception 'save_passkey_signer requires an authenticated user'
      using errcode = '28000';
  end if;

  if p_credential_id is null or p_credential_id = '' then
    raise exception 'save_passkey_signer requires a credential id'
      using errcode = '22023';
  end if;

  if p_signer_address is null or p_signer_address = '' then
    raise exception 'save_passkey_signer requires a signer address'
      using errcode = '22023';
  end if;

  -- SECURITY DEFINER bypasses RLS, so the owner predicate below is the *only*
  -- thing that decides which row may be touched. Lock it to keep two concurrent
  -- calls from racing the immutability check.
  select signer_address
    into v_existing
    from public.passkey_credentials
   where credential_id = p_credential_id
     and profile_id = v_uid
   for update;

  if not found then
    raise exception 'no passkey credential % for the current resident',
      p_credential_id
      using errcode = 'P0002';
  end if;

  -- The signer is derived from the credential and is immutable for it. A
  -- re-supplied identical value is a no-op; a different value is refused.
  if v_existing is not null and v_existing <> p_signer_address then
    raise exception 'the signer address for credential % is already set',
      p_credential_id
      using errcode = '23514';
  end if;

  update public.passkey_credentials
     set signer_address = p_signer_address
   where credential_id = p_credential_id
     and profile_id = v_uid
     and signer_address is null;
end;
$$;

comment on function public.save_passkey_signer(text, text) is
  'Writes the server-derived Safe signer address for one of the caller''s own '
  'passkey credentials. SECURITY DEFINER because `authenticated` has no column '
  'privilege on signer_address; the explicit owner predicate (profile_id = '
  'auth.uid()) is the only row it can reach, so it grants no general write '
  'capability. Refuses to change an existing non-null signer: the signer is '
  'derived from the credential and is immutable. Replaces the service-role '
  'client the enrolment path used to require.';

revoke all on function public.save_passkey_signer(text, text) from public, anon;
grant execute on function public.save_passkey_signer(text, text)
  to authenticated;
