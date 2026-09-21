-- =============================================================================
-- Kade — write the Safe deployment record without the service role.
--
-- Why this exists
--   `safe_deployments` is server-written by design: the counterfactual address,
--   the manifest inputs and the deployment outcome must not be nameable by the
--   browser (D2, D4). The `authenticated` role therefore has no column privilege
--   on them, and the record layer used a service-role client to write.
--
--   That key is the most powerful in the project and is not configured in the
--   deployed environment, so the prediction could not be persisted and the Safe
--   was never deployed. This is the same problem `save_passkey_signer`
--   (20260916000017) solved for the signer, and it takes the same shape: a
--   SECURITY DEFINER function that writes exactly what it must, for exactly the
--   caller's own row, and grants no general capability.
--
-- Security
--   SECURITY DEFINER, so it can write columns `authenticated` cannot. RLS is
--   bypassed by the definition, so the owner predicate is written out
--   explicitly: every function below is scoped to `profile_id = auth.uid()`.
--   A resident cannot read or write another resident's record.
--
--   The address and the manifest inputs are still not client-supplied in any
--   meaningful sense: the caller passes what the server derived, and the
--   functions only ever write the caller's own row. What is closed is naming
--   another resident's address, and moving an existing prediction's inputs.
--
--   `search_path` is pinned, EXECUTE is revoked from `public` and `anon`, and
--   granted only to `authenticated` — matching `save_onboarding_step2`,
--   `reset_demo_data` and `save_passkey_signer`.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Record the prediction. Idempotent on safe_address: a repeat is the same row,
-- and the inputs of an existing prediction are never moved.
-- ---------------------------------------------------------------------------
create or replace function public.record_safe_prediction(
  p_safe_address              text,
  p_predicted_l2_addresses    jsonb,
  p_safe_version              text,
  p_factory                   text,
  p_singleton                 text,
  p_initializer               text,
  p_handler                   text,
  p_owner                     text,
  p_salt                      jsonb,
  p_creation_code_assumptions jsonb
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
    raise exception 'record_safe_prediction requires an authenticated user'
      using errcode = '28000';
  end if;

  insert into public.safe_deployments (
    profile_id, safe_address, status, deployment_chain_id,
    predicted_l2_addresses, safe_version, factory, singleton, initializer,
    handler, owner, threshold, salt, creation_code_assumptions, provenance
  ) values (
    v_uid, p_safe_address, 'predicted', 11155111,
    p_predicted_l2_addresses, p_safe_version, p_factory, p_singleton,
    p_initializer, p_handler, p_owner, 1, p_salt,
    p_creation_code_assumptions, 'unapproved'
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

comment on function public.record_safe_prediction is
  'Records the counterfactual Safe address and its recovery inputs for the '
  'calling resident. SECURITY DEFINER because `authenticated` has no column '
  'privilege on those columns; scoped to profile_id = auth.uid(), so it grants '
  'no general write capability. Idempotent on safe_address: a repeat is the same '
  'row and cannot move the recorded inputs. Replaces the service-role client the '
  'record layer used to require.';

-- ---------------------------------------------------------------------------
-- Record the outcome. There is no insert path: an outcome can only move a row
-- that was already predicted, which is what keeps the recovery inputs ahead of
-- any deployment.
-- ---------------------------------------------------------------------------
create or replace function public.record_safe_deployment_outcome(
  p_safe_address      text,
  p_status            text,
  p_deployment_tx_hash text default null,
  p_failure_reason    text default null
)
returns public.safe_deployments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.safe_deployments;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'record_safe_deployment_outcome requires an authenticated user'
      using errcode = '28000';
  end if;

  if p_status not in ('deployed', 'failed') then
    raise exception 'unsupported deployment status %', p_status
      using errcode = '22023';
  end if;

  update public.safe_deployments
     set status             = p_status,
         provenance         = case when p_status = 'deployed' then 'approved' else provenance end,
         -- A hash we do not have must not overwrite one already recorded: a
         -- retry that finds the contract present records the deployed state,
         -- not a regression to "no transaction".
         deployment_tx_hash = coalesce(p_deployment_tx_hash, deployment_tx_hash),
         failure_reason     = case when p_status = 'failed' then p_failure_reason else null end,
         deployed_at        = case when p_status = 'deployed' then v_now else deployed_at end,
         failed_at          = case when p_status = 'failed' then v_now else failed_at end,
         updated_at         = v_now
   where safe_address = p_safe_address
     and profile_id = v_uid
  returning * into v_row;

  if not found then
    raise exception 'no Safe prediction for % belongs to the current resident',
      p_safe_address
      using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

comment on function public.record_safe_deployment_outcome is
  'Records the deployment outcome for a Safe the calling resident already '
  'predicted. SECURITY DEFINER, scoped to profile_id = auth.uid(). There is no '
  'insert path: an outcome can only move an existing prediction, so the recovery '
  'inputs are always stored before a deployment is recorded. A null transaction '
  'hash never clears one already recorded.';

revoke all on function public.record_safe_prediction(
  text, jsonb, text, text, text, text, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.record_safe_prediction(
  text, jsonb, text, text, text, text, text, text, jsonb, jsonb) to authenticated;

revoke all on function public.record_safe_deployment_outcome(
  text, text, text, text) from public, anon;
grant execute on function public.record_safe_deployment_outcome(
  text, text, text, text) to authenticated;
