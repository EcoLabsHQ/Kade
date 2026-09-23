-- =============================================================================
-- Kade — the `connected-wallet` provider encoding (week-2 contract v1.2).
--
-- Why this exists
--   The Proof-of-wealth step lets a resident connect a wallet through the
--   browser extension or WalletConnect. As amended v1.2, that connection is
--   persisted — so the wallet survives a reload — with a distinct provider
--   value, `connected-wallet`, rather than the pasted encoding. The row is
--   **not** signature-verified: `verified_at` stays NULL, because a browser
--   connection is not a server-verifiable proof of control.
--
--   In Holdings the row is shown in its own section, explicitly labelled
--   unverified, and it is **excluded from the Holdings total**. Signature-
--   verified wallets (verified_at non-null, set only by
--   public.record_wallet_ownership) remain the only verified class, and pasted
--   rows (`pasted-address` / `bitcoin-address`, verified_at NULL) remain
--   excluded by construction.
--
-- Comment-only. No column, constraint, grant, policy or data change.
-- =============================================================================

comment on column public.wallets.provider is
  '[arbitrary] encoding. The build guide names extension, WalletConnect, '
  'hardware and xpub but fixes no column value. Kade''s encodings: '
  '''pasted-address'' for a hand-pasted EVM address, ''bitcoin-address'' for a '
  'watch-only Bitcoin address, and ''connected-wallet'' (week-2 contract v1.2) '
  'for a wallet connected through the browser extension or WalletConnect. A '
  'connected-wallet row is NOT verified: verified_at is NULL, and Holdings '
  'shows it in a separate, labelled unverified section excluded from the '
  'Holdings total. Only public.record_wallet_ownership ever sets verified_at.';

comment on table public.wallets is
  'Self-custodied EOAs and xpub watch-only rows (DOCX section 9, STEP 3). One '
  'row per chain the EOA is read on. Deny-by-default in Week 1. The provider '
  'column distinguishes pasted rows (''pasted-address'' / ''bitcoin-address'', '
  'never in Holdings) from a connected, unverified wallet '
  '(''connected-wallet'', shown unverified in Holdings and excluded from the '
  'total) and from signature-verified rows (verified_at non-null, set only by '
  'public.record_wallet_ownership).';
