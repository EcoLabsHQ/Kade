-- =============================================================================
-- Kade — fiat rails and card ledger.
--
-- Schema authority: docs/planning/kade-mvp-build-document-v7.txt section 9.
-- Week 3+. Created in full and left deny-by-default in Week 1 (ADR 0004).
-- =============================================================================

-- gos_transfers — DOCX section 9:
--   application_id, direction, currency, amount, fee_bps, gos_ref, user_chain,
--   settlement_chain, bridge_msg_hash, status, settled_at
create table public.gos_transfers (
  id               bigint generated always as identity primary key,
  application_id   uuid not null references public.applications (id) on delete cascade,
  direction        text not null,
  currency         text,
  amount           numeric(20, 6) not null,
  fee_bps          integer,
  gos_ref          text,
  user_chain       integer,
  settlement_chain integer,
  bridge_msg_hash  text,
  status           text not null default 'pending',
  settled_at       timestamptz
);

comment on table public.gos_transfers is
  'Fund / cash-out history through the GOS fiat partner (DOCX section 9). '
  'status includes bridging; source and settlement chains record the CCTP leg. '
  'Deny-by-default in Week 1.';
comment on column public.gos_transfers.id is
  '[arbitrary] structural primary key.';
comment on column public.gos_transfers.direction is
  '[documented] the build guide distinguishes fund and cash-out; the encoded '
  'values are [arbitrary] because the DOCX does not fix them.';
comment on column public.gos_transfers.currency is
  '[arbitrary] the Build guide shows USD, EUR and XCG tabs; the column is left '
  'unconstrained.';
comment on column public.gos_transfers.status is
  '[arbitrary] the DOCX says status includes bridging but does not enumerate '
  'values; pending is the initial state.';

-- card_transactions — DOCX section 9:
--   application_id, kind (topup | spend), source_chain, amount_usdc, amount_xcg,
--   tx, bridge_msg_hash, created_at
create table public.card_transactions (
  id              bigint generated always as identity primary key,
  application_id  uuid not null references public.applications (id) on delete cascade,
  kind            text not null check (kind in ('topup', 'spend')),
  source_chain    integer,
  amount_usdc     numeric(20, 6),
  amount_xcg      numeric(20, 6),
  tx              text,
  bridge_msg_hash text,
  created_at      timestamptz not null default now()
);

comment on table public.card_transactions is
  'Card top-ups and spends (DOCX section 9). Spends show XCG at the CBCS peg '
  '(1.79). Deny-by-default in Week 1.';
comment on column public.card_transactions.id is
  '[arbitrary] structural primary key.';
comment on column public.card_transactions.kind is
  '[documented] topup | spend, per DOCX section 9.';

create index gos_transfers_application_id_idx on public.gos_transfers (application_id);
create index card_transactions_application_id_idx on public.card_transactions (application_id);
