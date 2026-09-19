-- =============================================================================
-- Kade — correct who computes the pre-approval fee.
--
-- `fee_schedule.amount` described the per-member increment as applied by
-- `preapprovalFeeUsdc()` in `@kade/shared`, "the single implementation". That
-- stopped being true when `20260916000010_fee_function.sql` added
-- `public.preapproval_fee_usdc()`: the database can now recompute the fee from
-- the seeded schedule, and the runtime path reads the database rather than the
-- shared formula. The shared function is the reference the seed is checked
-- against, not the runtime authority.
--
-- Comment-only. No column, constraint, policy or function changes.
-- =============================================================================

comment on column public.fee_schedule.amount is
  'Base fee for the key in the given mode. The pre-approval per-member increment '
  'is applied at runtime by public.preapproval_fee_usdc() (20260916000010); the '
  'same arithmetic in @kade/shared (preapprovalFeeUsdc) is the reference that '
  'seeds and verifies this table (ADR 0005). [documented] worked examples: demo '
  'household-of-3 = 1.75 USDC; production household-of-3 = 447 USDC.';
