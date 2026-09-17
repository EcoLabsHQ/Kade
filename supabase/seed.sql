-- -----------------------------------------------------------------------------
-- supabase/seed.sql - GENERATED FILE, DO NOT EDIT BY HAND.
-- Regenerate with: node scripts/db/generate-seed.mjs
--
-- Source of truth: @kade/shared (packages/shared/src/chains.ts, fees.ts).
-- Decision: docs/architecture/adr/0005-config-over-code.md.
-- Contract: week-1 section 3 (EXE-002) and section 2.1 (frozen fee model).
--
-- Provenance markers: [documented] contract/DOCX; [external] issuer docs;
-- [arbitrary] not stated in the governing documents (human gate required).
-- -----------------------------------------------------------------------------
begin;

-- chains: three testnets and three mainnets (contract EXE-002).
-- [arbitrary] values in these rows:
--   Ethereum Sepolia: kadelock_address (compiled and tested only in Week 1)
--   Ethereum Sepolia: paymaster_policy_id (paymaster policy is out of Week 1 scope)
--   Arbitrum Sepolia: kadelock_address (L2 deployment is out of Week 1 scope)
--   Arbitrum Sepolia: paymaster_policy_id
--   Base Sepolia: kadelock_address (L2 deployment is out of Week 1 scope)
--   Base Sepolia: paymaster_policy_id
--   Ethereum: eas_address (mainnet EAS address not verified in Week 1)
--   Ethereum: schema_registry_address (mainnet registry not verified in Week 1)
--   Ethereum: kadelock_address (no mainnet deployment in Week 1)
--   Ethereum: paymaster_policy_id
--   Arbitrum One: eas_address
--   Arbitrum One: schema_registry_address
--   Arbitrum One: kadelock_address (no mainnet deployment in Week 1)
--   Arbitrum One: paymaster_policy_id
--   Base: eas_address
--   Base: schema_registry_address
--   Base: kadelock_address (no mainnet deployment in Week 1)
--   Base: paymaster_policy_id
insert into public.chains (chain_id, name, env, usdc_address, eas_address, schema_registry_address, kadelock_address, paymaster_policy_id, explorer_url)
values
  (11155111, 'Ethereum Sepolia', 'testnet', '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', '0xC2679fBD37d54388Ce493F1DB75320D236e1815e', '0x0a7E2Ff54e76B8E6659aedc9103FB21c038050D0', null, null, 'https://sepolia.etherscan.io'),
  (421614, 'Arbitrum Sepolia', 'testnet', '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', '0x4200000000000000000000000000000000000021', '0x4200000000000000000000000000000000000020', null, null, 'https://sepolia.arbiscan.io'),
  (84532, 'Base Sepolia', 'testnet', '0x036CbD53842c5426634e7929541eC2318f3dCF7e', '0x4200000000000000000000000000000000000021', '0x4200000000000000000000000000000000000020', null, null, 'https://sepolia.basescan.org'),
  (1, 'Ethereum', 'mainnet', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', null, null, 'https://etherscan.io'),
  (42161, 'Arbitrum One', 'mainnet', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', null, null, 'https://arbiscan.io'),
  (8453, 'Base', 'mainnet', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', null, null, 'https://basescan.org')
on conflict (chain_id) do update set
  name = excluded.name,
  env = excluded.env,
  usdc_address = excluded.usdc_address,
  eas_address = excluded.eas_address,
  schema_registry_address = excluded.schema_registry_address,
  kadelock_address = excluded.kadelock_address,
  paymaster_policy_id = excluded.paymaster_policy_id,
  explorer_url = excluded.explorer_url;

-- fee_schedule: both keys in both modes (contract section 2.1).
-- amount is the household-size-1 fee (pre-approval) or flat fee (service).
-- The pre-approval formula parameters are data, in USDC:
--   fee = round(base_amount + per_member_amount x household_size, rounding_scale)
-- Production folds the documented XCG 500 / XCG 100 table into USDC through
-- XCG_PER_USDC from @kade/shared. feeRows() asserts these parameters
-- reproduce preapprovalFeeUsdc() before this seed is written (ADR 0005).
insert into public.fee_schedule (mode, key, amount, base_amount, per_member_amount, rounding_scale, currency)
values
  ('demo', 'preapproval', 1.25, 1, 0.25, 2, 'USDC'),
  ('demo', 'service', 10, 10, 0, 2, 'USDC'),
  ('production', 'preapproval', 335, 279.329609, 55.865922, 0, 'USDC'),
  ('production', 'service', 2000, 2000, 0, 2, 'USDC')
on conflict (mode, key) do update set
  amount = excluded.amount,
  base_amount = excluded.base_amount,
  per_member_amount = excluded.per_member_amount,
  rounding_scale = excluded.rounding_scale,
  currency = excluded.currency;

commit;
