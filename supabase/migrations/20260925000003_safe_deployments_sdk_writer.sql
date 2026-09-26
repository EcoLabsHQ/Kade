-- =============================================================================
-- Kade — record the SDK-derived account address without a direct table write.
--
-- Why this exists
--   Migration 02 (`20260925000002`) moved the resident account address onto
--   Safe's SDK: the address is read from `Safe4337Pack`, not reproduced from
--   Kade's own create2 arithmetic. The onboarding step then persisted that
--   address with a **direct insert** on the user-session client
--   (`apps/web/src/app/onboarding/account-actions.ts`):
--
--     client.from('safe_deployments').insert({
--       profile_id, safe_address, status, deployment_chain_id,
--     })
--
--   That is refused on a fresh database. Migration 16 revokes table-level write
--   from `authenticated` and grants only `insert (profile_id)`; `safe_address`,
--   `status` and `deployment_chain_id` are outside the grant, so the insert
--   fails with `permission denied for column`. The action caught the error,
--   returned `status: 'failed'`, and no row was ever written — which left
--   `safeAddress` null everywhere and permanently locked the Move-to-vault path.
--
--   (An out-of-band `grant insert` was applied to the live project to work
--   around this. It is in no committed migration; the defensive revoke below
--   removes it so the live and fresh databases converge. The write path must
--   not depend on it.)
--
-- The shape
--   `record_safe_sdk_address` mirrors `record_safe_prediction` (migration 18):
--   SECURITY DEFINER, caller resolved from `auth.uid()`, scoped to the caller's
--   own row, idempotent, EXECUTE revoked from `public`/`anon` and granted only
--   to `authenticated`.
--
-- What it deliberately does NOT write
--   The SDK reports no create2 inputs, so this function writes only
--   `profile_id`, `safe_address`, `status` and `deployment_chain_id`. It never
--   touches `initializer`, `salt`, `factory`, `singleton`, `handler`, `owner`,
--   `predicted_l2_addresses` or `creation_code_assumptions`: fabricating a
--   value Kade did not compute would be a false record of how the account was
--   created. An absent value stays NULL.
--
-- `owner` is relaxed here
--   Migration 02 left `owner` NOT NULL because the passkey's signer address was
--   assumed to be available. It is not: `deriveAccountFromPasskey` returns the
--   address and deployment state, and the SDK's owner resolution is internal.
--   Writing `signer.verifierAddress` as the owner would be exactly the kind of
--   fabrication this migration refuses, so `owner` becomes nullable on the SDK
--   path. A row written by `record_safe_prediction` still carries its owner.
-- =============================================================================

-- `owner` must be nullable for the SDK path: the function does not write it.
alter table public.safe_deployments
  alter column owner drop not null;

comment on column public.safe_deployments.owner is
  'The account''s owner, when Kade derived it (the direct Safe WebAuthn signer, '
  'NOT a user EOA). NULL on the SDK path: `deriveAccountFromPasskey` reads only '
  'the address and deployment state, and the SDK does not expose the resolved '
  'owner, so nothing is fabricated. `record_safe_prediction` populates it for a '
  'Kade-derived prediction.';

comment on column public.safe_deployments.safe_address is
  'SECURITY-CRITICAL: the counterfactual Safe address. Server-derived from the '
  'passkey and frozen deployment inputs. A direct write is refused; '
  '`record_safe_prediction` (migration 18) writes it for a Kade-derived '
  'prediction, and `record_safe_sdk_address` (migration 20260925000003) writes '
  'it when the address came from Safe''s SDK — both only for the caller''s own '
  'row. UNIQUE: idempotency and the pre-deposit foreign key both rest on it.';

-- ---------------------------------------------------------------------------
-- Record the SDK-derived address. `p_status` is the SDK's own deployment
-- reading: 'predicted' while the account is counterfactual, 'deployed' once the
-- contract exists on chain. It is validated, not free text. Idempotent on
-- safe_address: a repeat returns the existing row and never moves it.
-- ---------------------------------------------------------------------------
create or replace function public.record_safe_sdk_address(
  p_safe_address        text,
  p_deployment_chain_id integer,
  p_status              text default 'predicted'
)
returns public.safe_deployments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.safe_deployments;
begin
  if v_uid is null then
    raise exception 'record_safe_sdk_address requires an authenticated user'
      using errcode = '28000';
  end if;

  if p_status not in ('predicted', 'deployed') then
    raise exception 'unsupported account status %', p_status
      using errcode = '22023';
  end if;

  -- Only the columns the SDK reports. Everything else is left to its default
  -- or stays NULL: an absent create2 input is never invented.
  insert into public.safe_deployments (
    profile_id, safe_address, status, deployment_chain_id
  ) values (
    v_uid, p_safe_address, p_status, p_deployment_chain_id
  )
  on conflict (safe_address) do nothing;

  select * into v_row
    from public.safe_deployments
   where safe_address = p_safe_address
     and profile_id = v_uid;

  if not found then
    -- The address exists but belongs to someone else. Refuse rather than
    -- silently returning another resident's record.
    raise exception 'safe address % is already recorded for another resident',
      p_safe_address
      using errcode = '23505';
  end if;

  return v_row;
end;
$$;

comment on function public.record_safe_sdk_address(text, integer, text) is
  'Records the account address Safe''s SDK derived for the calling resident. '
  'SECURITY DEFINER because `authenticated` has no column privilege on '
  'safe_address or status; scoped to profile_id = auth.uid(), so it grants no '
  'general write capability. Writes only four columns — profile_id from '
  'auth.uid(), plus the SDK-reported safe_address, status and '
  'deployment_chain_id — and never fabricates a create2 input. Idempotent on '
  'safe_address: a repeat is the same row.';

-- The write path is the function, never a direct insert. This also removes the
-- out-of-band table-level `grant insert` the live project carried, which is in
-- no migration; a fresh database never had it. Migration 16's narrow
-- `insert (profile_id)` column grant remains but cannot produce a row, because
-- safe_address and deployment_chain_id are NOT NULL and outside it. The
-- SECURITY DEFINER writers (and record_safe_prediction) run as the owner and
-- are unaffected by this revoke.
revoke insert on table public.safe_deployments from authenticated;

revoke all on function public.record_safe_sdk_address(text, integer, text)
  from public, anon;
grant execute on function public.record_safe_sdk_address(text, integer, text)
  to authenticated;
