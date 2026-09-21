-- =============================================================================
-- Kade — the resident Safe deployment record and its pre-deposits.
--
-- Why this exists
--   D4 requires the Sepolia transaction, Safe address, predicted L2 addresses,
--   Safe version, factory, singleton, initializer, handler, owner, threshold,
--   salt and creation-code assumptions to be stored. A review found the address
--   was derived and displayed but never persisted, so the inputs behind it could
--   not be recovered.
--
--   The shape mirrors
--   packages/contracts/safe/SafeDeploymentManifest.schema.json: field names
--   become columns and the three nested objects become jsonb. Every manifest
--   column is NOT NULL on purpose. Funds may be sent to the counterfactual
--   address before the Safe is deployed, and recovering them depends on being
--   able to re-deploy with *exactly* the same inputs, so a prediction row must
--   be complete rather than partial.
--
-- Security
--   Row level security is on with owner-only read/insert policies, matching
--   `passkey_credentials` (20260916000013). The Safe address, the deployment
--   transaction hash and the manifest inputs are server-written: the
--   `authenticated` role has no column privilege on them, so a resident cannot
--   name an address directly. A pre-deposit may only reference a Safe address that
--   has already been predicted (foreign key), which keeps the recovery inputs
--   ahead of any funds movement.
-- =============================================================================

create table public.safe_deployments (
  id                        bigint generated always as identity primary key,
  profile_id                uuid not null references public.profiles (id) on delete cascade,
  /**
   * The single resident Safe address (D4). UNIQUE, which is what makes the
   * record idempotent: a repeat prediction is the same row, not a duplicate.
   */
  safe_address              text not null unique
                              check (safe_address ~ '^0x[0-9a-fA-F]{40}$'),
  status                    text not null default 'predicted'
                              check (status in ('predicted', 'queued', 'deployed', 'failed')),
  deployment_tx_hash        text
                              check (deployment_tx_hash is null
                                     or deployment_tx_hash ~ '^0x[0-9a-fA-F]{64}$'),
  deployment_chain_id       integer not null
                              check (deployment_chain_id = 11155111),
  predicted_l2_addresses    jsonb not null
                              check (jsonb_typeof(predicted_l2_addresses) = 'array'),
  safe_version              text not null,
  factory                   text not null
                              check (factory ~ '^0x[0-9a-fA-F]{40}$'),
  singleton                 text not null
                              check (singleton ~ '^0x[0-9a-fA-F]{40}$'),
  initializer               text not null
                              check (initializer ~ '^0x[0-9a-fA-F]*$'),
  handler                   text not null
                              check (handler ~ '^0x[0-9a-fA-F]{40}$'),
  owner                     text not null
                              check (owner ~ '^0x[0-9a-fA-F]{40}$'),
  threshold                 integer not null default 1 check (threshold = 1),
  salt                      jsonb not null
                              check (salt ? 'saltNonce'
                                     and salt ? 'initializerHash'
                                     and salt ? 'salt'),
  creation_code_assumptions jsonb not null
                              check (creation_code_assumptions ? 'proxyCreationCodeHash'
                                     and creation_code_assumptions ? 'initCodeHash'
                                     and creation_code_assumptions ? 'initCodeFormula'
                                     and creation_code_assumptions ? 'saltFormula'
                                     and creation_code_assumptions ? 'create2Formula'
                                     and creation_code_assumptions ? 'chainSpecific'),
  provenance                text not null default 'unapproved'
                              check (provenance in ('unapproved', 'approved')),
  failure_reason            text,
  predicted_at              timestamptz not null default now(),
  queued_at                 timestamptz,
  deployed_at               timestamptz,
  failed_at                 timestamptz,
  updated_at                timestamptz not null default now(),
  -- Redundant with the UNIQUE on safe_address, but it is the target of the
  -- pre-deposit foreign key so an address can only ever belong to the resident
  -- whose prediction it is.
  unique (safe_address, profile_id)
);

comment on table public.safe_deployments is
  'Resident Safe deployment record (D4). One row per predicted address; the '
  'manifest fields mirror SafeDeploymentManifest.schema.json and every one is '
  'NOT NULL so a prediction is recorded complete. `provenance` flips to approved '
  'only when the Sepolia deployment is recorded.';
comment on column public.safe_deployments.id is
  'Surrogate primary key. [arbitrary] structural: the address is the natural '
  'key, but a stable row id is convenient for references and auditing.';
comment on column public.safe_deployments.profile_id is
  'Owning resident. The prediction is derived from this resident''s passkey.';
comment on column public.safe_deployments.safe_address is
  'SECURITY-CRITICAL: the counterfactual Safe address. Server-derived from the '
  'passkey and frozen deployment inputs, so it is not writable by the browser. '
  'UNIQUE: idempotency and the pre-deposit foreign key both rest on it.';
comment on column public.safe_deployments.status is
  'predicted | queued | deployed | failed. Server-written. A deployment outcome '
  'can only move this row: there is no insert path for an outcome.';
comment on column public.safe_deployments.deployment_tx_hash is
  'SECURITY-CRITICAL: the Ethereum Sepolia deployment transaction. Server-written '
  'and NULL until the Safe is actually deployed (an L2-only case stays NULL).';
comment on column public.safe_deployments.deployment_chain_id is
  'Ethereum Sepolia (11155111), frozen by the contract. The chain where D4 '
  'requires the Safe to be deployed.';
comment on column public.safe_deployments.predicted_l2_addresses is
  'Counterfactual L2 addresses as [{chainId,name,address}]. Each address must '
  'equal safe_address (D4: one address on every active chain).';
comment on column public.safe_deployments.safe_version is
  'The Safe release, from @kade/shared ACTIVE_SAFE_VERSION (currently 1.5.0). '
  'Part of the address digest, so it is a change-control item.';
comment on column public.safe_deployments.factory is
  'SafeProxyFactory used for CREATE2, from @kade/shared SAFE_DEPLOYMENTS.';
comment on column public.safe_deployments.singleton is
  'Safe singleton (SafeL2) the proxy delegates to, from @kade/shared.';
comment on column public.safe_deployments.initializer is
  'The setup calldata (WebAuthn signer, threshold 1). keccak256(initializer) is '
  'the on-chain salt input.';
comment on column public.safe_deployments.handler is
  'CompatibilityFallbackHandler stored in the Safe, from @kade/shared.';
comment on column public.safe_deployments.owner is
  'SECURITY-CRITICAL: the direct Safe WebAuthn signer and only operational owner. '
  'Derived per resident from the passkey; no user EOA is an owner (contract '
  'section 2, items 5-6).';
comment on column public.safe_deployments.threshold is
  'Frozen at 1 (contract section 2, item 6).';
comment on column public.safe_deployments.salt is
  'CREATE2 salt inputs and output: {saltNonce, initializerHash, salt}.';
comment on column public.safe_deployments.creation_code_assumptions is
  'The byte-level assumptions the address depends on: proxyCreationCodeHash, '
  'initCodeHash, the three formulas and chainSpecific. A change to any of these '
  'changes the address.';
comment on column public.safe_deployments.provenance is
  'unapproved until the Sepolia deployment is recorded, then approved. Mirrors '
  'the manifest schema''s provenance field.';
comment on column public.safe_deployments.failure_reason is
  'Populated only when status = failed. Server-written.';
comment on column public.safe_deployments.predicted_at is
  'When the counterfactual address and its inputs were first stored. The address '
  'must not be shown to a depositor before this exists.';
comment on column public.safe_deployments.queued_at is
  'When the deployment was queued, if it was.';
comment on column public.safe_deployments.deployed_at is
  'When the Sepolia deployment transaction was recorded.';
comment on column public.safe_deployments.failed_at is
  'When the deployment was recorded as failed.';
comment on column public.safe_deployments.updated_at is
  'Last change to status, deployment transaction or failure reason.';

create index safe_deployments_profile_id_idx
  on public.safe_deployments (profile_id);

-- ---------------------------------------------------------------------------
-- RLS: the resident reads their own record; the server writes everything else.
-- ---------------------------------------------------------------------------
alter table public.safe_deployments enable row level security;

revoke all on table public.safe_deployments from anon, authenticated;
grant select on table public.safe_deployments to authenticated;
-- The narrow INSERT grant: only the owner key is offered, and every manifest
-- column is NOT NULL and outside the grant, so an authenticated insert cannot
-- produce a row. The address, the inputs and the transaction hash are absent
-- from both grants: server-written only.
grant insert (profile_id)
  on table public.safe_deployments to authenticated;

create policy safe_deployments_select_own
  on public.safe_deployments for select to authenticated
  using (profile_id = auth.uid());

create policy safe_deployments_insert_own
  on public.safe_deployments for insert to authenticated
  with check (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Pre-deposits — funds sent to the counterfactual address before deployment.
--
-- The composite foreign key to safe_deployments (safe_address, profile_id) is
-- deliberate: a pre-deposit cannot exist for an address that was never
-- predicted, nor for another resident's address, so the reproducibility inputs
-- are always stored before any deposit can be recorded.
-- ---------------------------------------------------------------------------
create table public.safe_pre_deposits (
  id                  bigint generated always as identity primary key,
  profile_id          uuid not null references public.profiles (id) on delete cascade,
  safe_address        text not null,
  chain_id            integer not null,
  token_address       text not null
                        check (token_address ~ '^0x[0-9a-fA-F]{40}$'),
  token_symbol        text not null default 'USDC',
  amount_usdc         numeric(20, 6) not null check (amount_usdc > 0),
  tx_hash             text not null
                        check (tx_hash ~ '^0x[0-9a-fA-F]{64}$'),
  /**
   * A mocked hash is not a verified one. Week 1 has no receipt check, so the
   * record is stored unverified; only a later server-side receipt check may
   * move it to verified.
   */
  verification_status text not null default 'unverified'
                        check (verification_status in ('unverified', 'verified')),
  verified_at         timestamptz,
  created_at          timestamptz not null default now(),
  unique (chain_id, tx_hash),
  -- Composite key: the address must be the one this resident predicted. This
  -- is enforced for every writer, including the service role, so a mocked hash
  -- can never be attached to another resident's Safe.
  constraint safe_pre_deposits_prediction_fk
    foreign key (safe_address, profile_id)
    references public.safe_deployments (safe_address, profile_id)
    on delete cascade
);

comment on table public.safe_pre_deposits is
  'USDC sent to a resident''s counterfactual Safe address before it is deployed. '
  'The transaction hash is caller-supplied and, in Week 1, mocked: the record is '
  'stored unverified and must not be treated as confirmation of a deposit.';
comment on column public.safe_pre_deposits.id is
  'Surrogate primary key. [arbitrary] structural; (chain_id, tx_hash) is the '
  'idempotency key.';
comment on column public.safe_pre_deposits.profile_id is
  'Owning resident. RLS restricts reads and proposed inserts to this resident.';
comment on column public.safe_pre_deposits.safe_address is
  'The counterfactual Safe address the funds were sent to. Together with '
  'profile_id it is a foreign key to safe_deployments, so a pre-deposit cannot '
  'be recorded before its prediction or against another resident''s address.';
comment on column public.safe_pre_deposits.chain_id is
  'Chain the deposit was made on.';
comment on column public.safe_pre_deposits.token_address is
  'SECURITY-CRITICAL: the token contract. USDC in iteration 1, taken from '
  '@kade/shared chain configuration rather than hard-coded.';
comment on column public.safe_pre_deposits.token_symbol is
  'Human-readable token symbol. USDC in iteration 1.';
comment on column public.safe_pre_deposits.amount_usdc is
  'Amount of USDC in whole tokens, numeric(20,6).';
comment on column public.safe_pre_deposits.tx_hash is
  'The transaction hash supplied with the deposit. MOCKED in Week 1: it is not '
  'checked against a chain receipt and must not be shown as verified.';
comment on column public.safe_pre_deposits.verification_status is
  'SECURITY-CRITICAL: unverified until a server-side chain receipt check proves '
  'the deposit. The authenticated role has no privilege on this column, so a '
  'client cannot mark its own mocked hash verified.';
comment on column public.safe_pre_deposits.verified_at is
  'When a server-side receipt check verified the deposit. NULL while unverified.';
comment on column public.safe_pre_deposits.created_at is
  'When the pre-deposit record was written.';

create index safe_pre_deposits_profile_id_idx
  on public.safe_pre_deposits (profile_id);
create index safe_pre_deposits_safe_address_idx
  on public.safe_pre_deposits (safe_address);

alter table public.safe_pre_deposits enable row level security;

revoke all on table public.safe_pre_deposits from anon, authenticated;
grant select on table public.safe_pre_deposits to authenticated;
-- verification_status and verified_at are absent from the grant: server-written
-- only. The resident may propose a deposit; the server decides whether it is
-- real.
grant insert (profile_id, safe_address, chain_id, token_address, token_symbol,
              amount_usdc, tx_hash)
  on table public.safe_pre_deposits to authenticated;

create policy safe_pre_deposits_select_own
  on public.safe_pre_deposits for select to authenticated
  using (profile_id = auth.uid());

create policy safe_pre_deposits_insert_own
  on public.safe_pre_deposits for insert to authenticated
  with check (profile_id = auth.uid());
