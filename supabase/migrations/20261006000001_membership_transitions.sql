-- =============================================================================
-- Kade — the Colosseum membership transition record.
--
-- Why this exists
--   The Colosseum membership contracts are on `main` (compiled and
--   Foundry-tested; NOT deployed). The app-side flow prepares an owner-Safe call
--   for `issueResident` / `promoteToCitizen` / `revokeMembership` and never
--   sends it. The spec requires that the app persist, for each transition, the
--   **event identifier, the address, the operation, the state and the
--   transaction hash**, and that before a retry it consult `membershipOf` to
--   avoid a duplicate issuance. This table is that record.
--
--   Two kinds of row share the table:
--     - an **intent** (`status = 'prepared'`): the reviewable plan the server
--       built for the owner Safe, before any send. No event key or tx hash.
--     - an **outcome** (`status = 'confirmed'`): the `MembershipChanged` event
--       the indexer read, carrying the event key, the transaction hash and the
--       block. The outcome is written only from a real log, never asserted.
--   A pending intent is promoted to `confirmed` when its event is indexed, so
--   the intent and its outcome are one row rather than two.
--
-- Trust boundary
--   The record is server-written: a resident may read their own rows, but may
--   not write any. The two writers are SECURITY DEFINER and EXECUTE is granted
--   only to `service_role`, exactly like `record_identity_attestation`
--   (20260924000020). The prepare path has no resident session.
--
-- Idempotency
--   `unique (chain_id, event_key)` makes the indexer's reconcile idempotent: a
--   redelivered event is the same row, not a duplicate. The partial unique index
--   on `(chain_id, account, operation) where status in ('prepared','submitted')`
--   makes a retried prepare for the same account and operation the same pending
--   row, so a retry cannot stack duplicate intents. The chain read of
--   `membershipOf` remains the authority that a transition is still needed; this
--   table is the record, not the guard.
-- =============================================================================

create table public.membership_transitions (
  id                 bigint generated always as identity primary key,
  profile_id         uuid references public.profiles (id) on delete set null,
  -- The member's address (the resident's Safe). SECURITY-CRITICAL: it is the
  -- subject of the manager call and is server-resolved, never client-supplied.
  account            text not null check (account ~ '^0x[0-9a-fA-F]{40}$'),
  operation          text not null
                       check (operation in ('issue-resident', 'promote-to-citizen', 'revoke')),
  status             text not null default 'prepared'
                       check (status in ('prepared', 'submitted', 'confirmed', 'failed')),
  chain_id           integer not null check (chain_id > 0),
  manager_address    text not null check (manager_address ~ '^0x[0-9a-fA-F]{40}$'),
  membership_before  text check (membership_before in ('none', 'resident', 'citizen')),
  membership_after   text check (membership_after in ('none', 'resident', 'citizen')),
  -- The on-chain event identifier: `txHash:logIndex`. NULL until indexed.
  event_key          text,
  tx_hash            text check (tx_hash is null or tx_hash ~ '^0x[0-9a-fA-F]{64}$'),
  block_number       bigint check (block_number is null or block_number >= 0),
  failure_reason     text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- A confirmed row must carry the event it was confirmed from.
  constraint membership_transitions_confirmed_event
    check (
      status <> 'confirmed'
      or (event_key is not null and tx_hash is not null and membership_after is not null)
    )
);

comment on table public.membership_transitions is
  'Colosseum membership transition record. An intent row (status=prepared) is '
  'the reviewable owner-Safe plan; a confirmed row is the MembershipChanged '
  'event the indexer read, carrying the event key, tx hash and block. The chain '
  'read of membershipOf is the guard against a duplicate issuance; this table is '
  'the record of what was prepared and what happened.';
comment on column public.membership_transitions.profile_id is
  'Owning resident, when the account resolves to one (via safe_deployments). '
  'NULL for an event whose account is not a recorded resident.';
comment on column public.membership_transitions.account is
  'SECURITY-CRITICAL: the member address (the resident Safe). Server-resolved.';
comment on column public.membership_transitions.operation is
  'issue-resident | promote-to-citizen | revoke. The manager call the row describes.';
comment on column public.membership_transitions.status is
  'prepared | submitted | confirmed | failed. Server-written only.';
comment on column public.membership_transitions.chain_id is
  'The chain the manager is deployed on. Part of both idempotency keys.';
comment on column public.membership_transitions.manager_address is
  'SECURITY-CRITICAL: the MembershipManager the call targets. Server-resolved.';
comment on column public.membership_transitions.membership_before is
  'The membership read before the operation, when known. NULL means the read '
  'did not happen or could not be trusted — it is NOT "none".';
comment on column public.membership_transitions.membership_after is
  'The membership the event moved to. Required on a confirmed row.';
comment on column public.membership_transitions.event_key is
  'The on-chain event identifier `txHash:logIndex`. Idempotency key with chain_id.';
comment on column public.membership_transitions.tx_hash is
  'The transaction that emitted MembershipChanged. NULL until indexed.';
comment on column public.membership_transitions.block_number is
  'The block the event was mined in. NULL until indexed.';
comment on column public.membership_transitions.failure_reason is
  'Populated only when status = failed. Server-written.';
comment on column public.membership_transitions.created_at is
  'When the intent or event row was first written.';
comment on column public.membership_transitions.updated_at is
  'Last change to the row (a pending intent confirmed, or a replayed event).';

create index membership_transitions_profile_id_idx
  on public.membership_transitions (profile_id);
create index membership_transitions_account_idx
  on public.membership_transitions (account);

-- The indexer's idempotency key. NULL event keys are distinct in Postgres, so
-- pending intents do not collide here.
create unique index membership_transitions_event_key_idx
  on public.membership_transitions (chain_id, event_key);

-- One pending intent per (chain, account, operation): a retried prepare is the
-- same row, not a duplicate. Once confirmed, the row leaves the predicate, so a
-- later, legitimate transition (for example a re-issue after a revoke) can be
-- recorded.
create unique index membership_transitions_pending_intent_idx
  on public.membership_transitions (chain_id, account, operation)
  where status in ('prepared', 'submitted');

-- ---------------------------------------------------------------------------
-- RLS: the resident reads their own rows; the server writes everything.
-- ---------------------------------------------------------------------------
alter table public.membership_transitions enable row level security;

revoke all on table public.membership_transitions from anon, authenticated;
grant select on table public.membership_transitions to authenticated;

create policy membership_transitions_select_own
  on public.membership_transitions for select to authenticated
  using (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Writers (SECURITY DEFINER, service_role only)
-- ---------------------------------------------------------------------------

-- Record (or refresh) the reviewable intent for a transition. Idempotent on the
-- pending-intent key, so a retry updates the same row rather than stacking one.
create or replace function public.record_membership_intent(
  p_profile_id        uuid,
  p_account           text,
  p_operation         text,
  p_chain_id          integer,
  p_manager_address   text,
  p_membership_before text default null
)
returns public.membership_transitions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account   text := nullif(trim(coalesce(p_account, '')), '');
  v_manager   text := nullif(trim(coalesce(p_manager_address, '')), '');
  v_before    text := nullif(trim(coalesce(p_membership_before, '')), '');
  v_row       public.membership_transitions;
begin
  if v_account is null or v_account !~ '^0x[0-9a-fA-F]{40}$' then
    raise exception 'record_membership_intent requires a 20-byte hex account'
      using errcode = '22023';
  end if;
  if v_manager is null or v_manager !~ '^0x[0-9a-fA-F]{40}$' then
    raise exception 'record_membership_intent requires a 20-byte hex manager address'
      using errcode = '22023';
  end if;
  if p_operation not in ('issue-resident', 'promote-to-citizen', 'revoke') then
    raise exception 'record_membership_intent requires a known operation'
      using errcode = '22023';
  end if;
  if p_chain_id is null or p_chain_id <= 0 then
    raise exception 'record_membership_intent requires a positive chain id'
      using errcode = '22023';
  end if;
  if v_before is not null and v_before not in ('none', 'resident', 'citizen') then
    raise exception 'record_membership_intent requires a known membership_before'
      using errcode = '22023';
  end if;

  insert into public.membership_transitions (
    profile_id,
    account,
    operation,
    status,
    chain_id,
    manager_address,
    membership_before
  )
  values (
    p_profile_id,
    v_account,
    p_operation,
    'prepared',
    p_chain_id,
    v_manager,
    v_before
  )
  -- The partial unique index is the conflict target; the predicate must match.
  on conflict (chain_id, account, operation)
    where status in ('prepared', 'submitted')
  do update
    set membership_before = coalesce(excluded.membership_before,
                                     membership_transitions.membership_before),
        manager_address    = excluded.manager_address,
        updated_at         = now()
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.record_membership_intent(
  uuid, text, text, integer, text, text
) is
  'Records the reviewable owner-Safe plan for a membership transition. '
  'SECURITY DEFINER, service_role only. Idempotent on the pending-intent key '
  '(chain_id, account, operation) where status in (prepared, submitted), so a '
  'retry is the same row. The chain read of membershipOf remains the guard '
  'against a duplicate issuance.';

-- Record a MembershipChanged event, promoting a matching pending intent to
-- confirmed when one exists. Idempotent on (chain_id, event_key).
create or replace function public.record_membership_event(
  p_account          text,
  p_operation        text,
  p_chain_id         integer,
  p_manager_address  text,
  p_event_key        text,
  p_tx_hash          text,
  p_membership_before text,
  p_membership_after  text,
  p_block_number     bigint,
  p_profile_id       uuid default null
)
returns public.membership_transitions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account  text := nullif(trim(coalesce(p_account, '')), '');
  v_manager  text := nullif(trim(coalesce(p_manager_address, '')), '');
  v_event    text := nullif(trim(coalesce(p_event_key, '')), '');
  v_tx       text := nullif(trim(coalesce(p_tx_hash, '')), '');
  v_before   text := nullif(trim(coalesce(p_membership_before, '')), '');
  v_after    text := nullif(trim(coalesce(p_membership_after, '')), '');
  v_row      public.membership_transitions;
begin
  if v_account is null or v_account !~ '^0x[0-9a-fA-F]{40}$' then
    raise exception 'record_membership_event requires a 20-byte hex account'
      using errcode = '22023';
  end if;
  if v_manager is null or v_manager !~ '^0x[0-9a-fA-F]{40}$' then
    raise exception 'record_membership_event requires a 20-byte hex manager address'
      using errcode = '22023';
  end if;
  if p_operation not in ('issue-resident', 'promote-to-citizen', 'revoke') then
    raise exception 'record_membership_event requires a known operation'
      using errcode = '22023';
  end if;
  if p_chain_id is null or p_chain_id <= 0 then
    raise exception 'record_membership_event requires a positive chain id'
      using errcode = '22023';
  end if;
  if v_event is null or v_event !~ '^0x[0-9a-fA-F]{64}:[0-9]+$' then
    raise exception 'record_membership_event requires an event key of txHash:logIndex'
      using errcode = '22023';
  end if;
  if v_tx is null or v_tx !~ '^0x[0-9a-fA-F]{64}$' then
    raise exception 'record_membership_event requires a 32-byte transaction hash'
      using errcode = '22023';
  end if;
  if v_after is null or v_after not in ('none', 'resident', 'citizen') then
    raise exception 'record_membership_event requires a known membership_after'
      using errcode = '22023';
  end if;
  if v_before is not null and v_before not in ('none', 'resident', 'citizen') then
    raise exception 'record_membership_event requires a known membership_before'
      using errcode = '22023';
  end if;

  -- Promote a matching pending intent to confirmed, so the intent and its
  -- outcome are one row. The operation and account identify it; the partial
  -- unique index guarantees at most one pending row.
  update public.membership_transitions
    set status            = 'confirmed',
        event_key         = v_event,
        tx_hash           = v_tx,
        block_number      = p_block_number,
        membership_before = coalesce(membership_transitions.membership_before, v_before),
        membership_after  = v_after,
        profile_id        = coalesce(membership_transitions.profile_id, p_profile_id),
        updated_at        = now()
    where chain_id = p_chain_id
      and account = v_account
      and operation = p_operation
      and status in ('prepared', 'submitted')
    returning * into v_row;

  if v_row.id is not null then
    return v_row;
  end if;

  -- No pending intent: insert the outcome. Idempotent on the event key, so a
  -- replayed event returns the existing row rather than a duplicate.
  insert into public.membership_transitions (
    profile_id,
    account,
    operation,
    status,
    chain_id,
    manager_address,
    membership_before,
    membership_after,
    event_key,
    tx_hash,
    block_number
  )
  values (
    p_profile_id,
    v_account,
    p_operation,
    'confirmed',
    p_chain_id,
    v_manager,
    v_before,
    v_after,
    v_event,
    v_tx,
    p_block_number
  )
  on conflict (chain_id, event_key) do update
    set updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.record_membership_event(
  text, text, integer, text, text, text, text, text, bigint, uuid
) is
  'Records a MembershipChanged event and promotes a matching pending intent to '
  'confirmed. SECURITY DEFINER, service_role only. Idempotent on '
  '(chain_id, event_key). Writes only what a real log carried; an unread chain '
  'is reported by the caller as unread, never as an event.';

revoke all on function public.record_membership_intent(
  uuid, text, text, integer, text, text
) from public, anon, authenticated;
revoke all on function public.record_membership_event(
  text, text, integer, text, text, text, text, text, bigint, uuid
) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.record_membership_intent(
      uuid, text, text, integer, text, text
    ) to service_role;
    grant execute on function public.record_membership_event(
      text, text, integer, text, text, text, text, text, bigint, uuid
    ) to service_role;
  end if;
end
$$;
