-- =============================================================================
-- Kade — per-chain resident Safe deployment records.
--
-- Why this exists
--   A resident Safe address is counterfactual and identical on every chain: the
--   same passkey derives the same address, but the `SafeProxy` contract only
--   exists where it has actually been deployed. `safe_deployments` records the
--   *Sepolia* deployment only: `deployment_chain_id` is frozen to 11155111 and
--   `deployment_tx_hash` is the Sepolia transaction. There is no dimension for a
--   deployment on the membership chain (Arbitrum One, 42161), which is where the
--   Colosseum credential is minted.
--
--   The mint path now refuses to mint to a Safe with no code on the membership
--   chain and deploys it first (see apps/web/src/lib/safe/ensure-deployed.ts).
--   Without a per-chain record that deployment is not persisted anywhere.
--
-- What this adds
--   One row per `(safe_address, chain_id)`: the deployment outcome on a specific
--   chain. The composite foreign key to `safe_deployments (safe_address,
--   profile_id)` means a per-chain deployment can only reference a Safe that was
--   already predicted, and can only belong to the resident whose prediction it
--   is — the same guarantee `safe_pre_deposits` relies on.
--
-- APPLIED
--   The orchestrator applied this migration; the table, its constraints, its
--   RLS policy and every column comment are present in the live database.
--   NOTE: the first apply ran a draft of this file that omitted the `comment
--   on column` statements; those were applied separately afterwards, so the
--   live schema and this file now agree.
--
--   The readiness guard does not depend on this table: it reads real bytecode
--   on the membership chain. The row here is the audit record of the
--   deployment, not the gate.
--
-- Security
--   Row level security with owner-only read, matching `safe_deployments`. The
--   row is server-written through the service role (the mint path carries no
--   resident session); the `authenticated` role may only select its own rows.
-- =============================================================================

create table public.safe_chain_deployments (
  id                 bigint generated always as identity primary key,
  profile_id         uuid not null references public.profiles (id) on delete cascade,
  safe_address       text not null check (safe_address ~ '^0x[0-9a-fA-F]{40}$'),
  chain_id           integer not null check (chain_id > 0),
  status             text not null default 'deployed'
                       check (status in ('deployed', 'failed')),
  deployment_tx_hash text
                       check (deployment_tx_hash is null
                              or deployment_tx_hash ~ '^0x[0-9a-fA-F]{64}$'),
  failure_reason     text,
  deployed_at        timestamptz,
  failed_at          timestamptz,
  updated_at         timestamptz not null default now(),
  -- One outcome per address per chain: a redeploy of the same counterfactual
  -- address is the same row, not a duplicate.
  unique (safe_address, chain_id),
  -- The address must be one this resident predicted. Enforced for every writer,
  -- including the service role.
  constraint safe_chain_deployments_prediction_fk
    foreign key (safe_address, profile_id)
    references public.safe_deployments (safe_address, profile_id)
    on delete cascade
);

comment on table public.safe_chain_deployments is
  'Per-chain resident Safe deployment outcomes. `safe_deployments` records the '
  'Sepolia deployment; this records a deployment on any other chain, notably the '
  'membership chain (Arbitrum One, 42161) where the Colosseum credential is '
  'minted. The address is the same on every chain; the contract exists only '
  'where a row here (or the Sepolia record) says it was deployed.';
comment on column public.safe_chain_deployments.profile_id is
  'Owning resident. The prediction is derived from this resident''s passkey.';
comment on column public.safe_chain_deployments.safe_address is
  'SECURITY-CRITICAL: the counterfactual Safe address. Together with profile_id '
  'it is a foreign key to safe_deployments, so a per-chain deployment cannot be '
  'recorded before its prediction or against another resident''s address.';
comment on column public.safe_chain_deployments.chain_id is
  'The chain the Safe was deployed on (Arbitrum One, 42161, for the membership '
  'credential). A deployment on one chain says nothing about any other.';
comment on column public.safe_chain_deployments.status is
  'deployed | failed. Server-written. A failed attempt leaves the prediction '
  'intact and can be retried; the engine is idempotent.';
comment on column public.safe_chain_deployments.deployment_tx_hash is
  'SECURITY-CRITICAL: the deployment transaction on `chain_id`. NULL for a '
  'failure, or when code was already present and this repository has no hash.';
comment on column public.safe_chain_deployments.failure_reason is
  'Populated only when status = failed. Server-written.';
comment on column public.safe_chain_deployments.deployed_at is
  'When the deployment transaction on `chain_id` was recorded.';
comment on column public.safe_chain_deployments.failed_at is
  'When the deployment on `chain_id` was recorded as failed.';
comment on column public.safe_chain_deployments.updated_at is
  'Last change to status, transaction or failure reason.';

create index safe_chain_deployments_profile_id_idx
  on public.safe_chain_deployments (profile_id);
create index safe_chain_deployments_chain_id_idx
  on public.safe_chain_deployments (chain_id);

alter table public.safe_chain_deployments enable row level security;

revoke all on table public.safe_chain_deployments from anon, authenticated;
grant select on table public.safe_chain_deployments to authenticated;

create policy safe_chain_deployments_select_own
  on public.safe_chain_deployments for select to authenticated
  using (profile_id = auth.uid());
