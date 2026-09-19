-- =============================================================================
-- Kade — seeded configuration: chains and fee_schedule.
--
-- Schema authority: docs/planning/kade-mvp-build-document-v7.txt section 9.
-- Values are inserted by supabase/seed.sql, which is GENERATED from
-- @kade/shared by scripts/db/generate-seed.mjs (ADR 0005). Do not hand-edit the
-- seed.
--
-- These two tables are read by every resident, so unlike resident data they get
-- a permissive SELECT policy (see the RLS migration). Writes stay server-only.
-- =============================================================================

-- chains — DOCX section 9:
--   chain_id, name, usdc_address, kadelock_address, eas_address,
--   paymaster_policy_id, explorer_url
create table public.chains (
  chain_id               integer primary key,
  name                   text not null,
  env                    text not null check (env in ('mainnet', 'testnet')),
  usdc_address           text,
  eas_address            text,
  schema_registry_address text,
  kadelock_address       text,
  paymaster_policy_id    text,
  explorer_url           text
);

comment on table public.chains is
  'Single source of truth for per-chain addresses (DOCX section 9, "New"). Read '
  'by the application instead of environment variables so adding a chain is a '
  'config change with no code edit (ADR 0005, DOCX section 14).';
comment on column public.chains.env is
  'NOT in the DOCX column list. Added because ADR 0005 / EXE-002 require '
  'KADE_CHAIN_ENV to select the active chain set, and both the testnet and '
  'mainnet rows for a chain are seeded.';
comment on column public.chains.schema_registry_address is
  'NOT in the DOCX column list. Added because D6/EXE-002 require the EAS schema '
  'registry address per chain; it is carried by @kade/shared.';
comment on column public.chains.kadelock_address is
  'KadeLock is compiled and Foundry-tested but not deployed in Week 1 (contract '
  'section 6.2), so this is NULL / [arbitrary].';
comment on column public.chains.paymaster_policy_id is
  'Paymaster policy beyond the Week 1 Safe deployment is out of scope (contract '
  'section 9), so this is NULL / [arbitrary].';

-- fee_schedule — DOCX section 9: mode, key, amount, currency
create table public.fee_schedule (
  mode     text not null check (mode in ('demo', 'production')),
  key      text not null check (key in ('preapproval', 'service')),
  amount   numeric(20, 6) not null,
  currency text not null,
  primary key (mode, key)
);

comment on table public.fee_schedule is
  'Active fee configuration (DOCX sections 7 and 9). A single env var '
  '(KADE_FEE_MODE) selects demo or production; no amount is hard-coded in the '
  'client (contract section 2.1, ADR 0005).';
comment on column public.fee_schedule.amount is
  'Base fee for the key in the given mode. The pre-approval per-member increment '
  'is applied at runtime by public.preapproval_fee_usdc() (20260916000010); the '
  'same arithmetic in @kade/shared (preapprovalFeeUsdc) is the reference that '
  'seeds and verifies this table (ADR 0005). [documented] worked examples: demo '
  'household-of-3 = 1.75 USDC; production household-of-3 = 447 USDC.';
comment on column public.fee_schedule.currency is
  '[documented] USDC (contract section 2.1).';
