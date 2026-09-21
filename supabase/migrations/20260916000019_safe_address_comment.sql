-- =============================================================================
-- Kade — correct the Safe address column comment.
--
-- `safe_deployments.safe_address` described itself as "not writable by the
-- browser". That stopped being true when migration 18 granted
-- `record_safe_prediction` to `authenticated`: a signed-in resident can write
-- their own prediction, including the address. What is closed is naming another
-- resident's row, not writing one's own.
--
-- Comment-only. No column, constraint, policy or function changes.
-- =============================================================================

comment on column public.safe_deployments.safe_address is
  'SECURITY-CRITICAL: the counterfactual Safe address. Server-derived from the '
  'passkey and frozen deployment inputs. A direct write is refused; migration 18 '
  'adds record_safe_prediction, which can write it for the caller''s own row. '
  'UNIQUE: idempotency and the pre-deposit foreign key both rest on it.';
