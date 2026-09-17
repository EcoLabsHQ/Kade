-- =============================================================================
-- Kade — wealth, qualified vault and allocations.
--
-- Schema authority: docs/planning/kade-mvp-build-document-v7.txt section 9.
-- These tables arrive in Weeks 2-3 (Steps 3-4 and Holdings). In Week 1 they are
-- created in full and left deny-by-default (ADR 0004; no permissive policy in
-- 20260916000009_rls.sql).
-- =============================================================================

-- wallets — DOCX section 9: profile_id, address, chain, provider, siwe_sig, verified_at
create table public.wallets (
  id          bigint generated always as identity primary key,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  address     text not null,
  chain       integer not null,
  provider    text,
  siwe_sig    text,
  verified_at timestamptz
);

comment on table public.wallets is
  'Self-custodied EOAs and xpub watch-only rows (DOCX section 9, STEP 3). One '
  'row per chain the EOA is read on. Deny-by-default in Week 1.';
comment on column public.wallets.id is
  '[arbitrary] structural primary key: the DOCX column list has no key.';
comment on column public.wallets.chain is
  '[documented] the EVM chain id (1, 42161, 8453 and their testnets).';
comment on column public.wallets.provider is
  '[arbitrary] encoding. The build guide names extension, WalletConnect, '
  'hardware and xpub but fixes no column value.';

-- wealth_snapshots — DOCX section 9: wallet_id, chain, taken_at, assets jsonb, usd_value, provenance
create table public.wealth_snapshots (
  id          bigint generated always as identity primary key,
  wallet_id   bigint not null references public.wallets (id) on delete cascade,
  chain       integer not null,
  taken_at    timestamptz not null default now(),
  assets      jsonb not null default '{}'::jsonb,
  usd_value   numeric(20, 6),
  provenance  text
);

comment on table public.wealth_snapshots is
  'Balance-indexer output per chain (DOCX section 9). Supabase caches chain '
  'reads; it is never the source of truth for a balance (ADR 0004).';
comment on column public.wealth_snapshots.id is
  '[arbitrary] structural primary key.';
comment on column public.wealth_snapshots.provenance is
  '[arbitrary] encoding: how the snapshot was obtained (for example indexer or '
  'RPC). The DOCX names the column but not its values.';

-- container_balances — DOCX section 9: application_id, safe_address, chain, taken_at, assets jsonb, usd_value
create table public.container_balances (
  id             bigint generated always as identity primary key,
  application_id uuid not null references public.applications (id) on delete cascade,
  safe_address   text not null,
  chain          integer not null,
  taken_at       timestamptz not null default now(),
  assets         jsonb not null default '{}'::jsonb,
  usd_value      numeric(20, 6)
);

comment on table public.container_balances is
  'Qualified balance per chain; a view sums it for the tier check (DOCX section '
  '9). The cure event is written here. Deny-by-default in Week 1.';
comment on column public.container_balances.id is
  '[arbitrary] structural primary key.';

-- allocations — DOCX section 9: application_id, chain, instrument, amount_usdc, tx, created_at
create table public.allocations (
  id             bigint generated always as identity primary key,
  application_id uuid not null references public.applications (id) on delete cascade,
  chain          integer not null,
  instrument     text not null,
  amount_usdc    numeric(20, 6) not null,
  tx             text,
  created_at     timestamptz not null default now()
);

comment on table public.allocations is
  'Instrument allocations shown in Holdings (DOCX section 9). An allocation '
  'debits vault USDC and credits an instrument row on the same chain so the '
  'qualified total is unchanged. Deny-by-default in Week 1.';
comment on column public.allocations.id is
  '[arbitrary] structural primary key.';

-- Foreign-key lookup indexes (indexes are not columns; added for the queries the
-- build guide describes, e.g. "per-chain split" and "recent allocations").
create index wallets_profile_id_idx on public.wallets (profile_id);
create index wealth_snapshots_wallet_id_idx on public.wealth_snapshots (wallet_id);
create index container_balances_application_id_idx on public.container_balances (application_id);
create index allocations_application_id_idx on public.allocations (application_id);
