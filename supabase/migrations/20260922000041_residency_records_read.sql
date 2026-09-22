-- =============================================================================
-- Kade — read access the residency checks need.
--
-- Why this exists
--   D16 renders four checks (identity, funds, review, service fee) from the
--   resident's own records. Two of them read tables that were created for
--   later weeks and left deny-by-default in 20260916000009_rls.sql:
--     * identity_attestations — the mirrored kade.kyc.v1 fields;
--     * container_balances       — the qualified balance summed for the tier.
--   Without an owner-scoped SELECT policy a resident cannot see their own
--   state, so the check could only be presented as unknown.
--
-- What this migration does
--   Adds an owner-only SELECT policy and the SELECT privilege for each table.
--   It grants no INSERT/UPDATE/DELETE: identity and qualified balances stay
--   server-written, exactly as the deny-by-default design intended. The write
--   authority is unchanged.
--
-- Scope
--   * identity_attestations: profile_id = auth.uid().
--   * container_balances:     via the owning application (profile_id = auth.uid()).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- identity_attestations — a resident may read their own attestation records.
-- ---------------------------------------------------------------------------
grant select on table public.identity_attestations to authenticated;

create policy identity_attestations_select_own
  on public.identity_attestations for select to authenticated
  using (profile_id = auth.uid());

comment on policy identity_attestations_select_own on public.identity_attestations is
  'A resident may read the kade.kyc.v1 fields mirrored for their own profile. '
  'No write privilege is granted: identity rows remain server-written.';

-- ---------------------------------------------------------------------------
-- container_balances — a resident may read the qualified balance of their own
-- application.
-- ---------------------------------------------------------------------------
grant select on table public.container_balances to authenticated;

create policy container_balances_select_own
  on public.container_balances for select to authenticated
  using (
    exists (
      select 1 from public.applications a
      where a.id = container_balances.application_id
        and a.profile_id = auth.uid()
    )
  );

comment on policy container_balances_select_own on public.container_balances is
  'A resident may read the qualified balance recorded against their own '
  'application, which is what the residency funds check sums. No write '
  'privilege is granted: the balance is indexer/server-written.';
