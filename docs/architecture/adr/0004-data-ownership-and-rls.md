# ADR 0004 — Data ownership and row-level security

**Status:** accepted · 17 September 2026
**Refs:** week-1 contract section 2 item 10, section 4 (D2); DOCX sections 4 and 9

## Context

The build guide separates two kinds of truth:

> **DATA** Supabase (Postgres + Auth + Realtime + RLS) owns workflow; the chains
> own money and attestations.

The Week 1 contract freezes the database scope as the **full DOCX schema** with
RLS enabled, or deny-by-default for unused tables. D2 additionally requires:

- residents cannot read or modify another resident's records;
- Safe, passkey, fee and attestation security fields cannot be arbitrarily
  overwritten by the browser;
- `chains` and `fee_schedule` contain the approved demo and production records;
- migrations and seeds run from a clean database.

## Decision

- **Supabase owns workflow state.** It never becomes the source of truth for a
  balance or an attestation; those are read from chain and cached.
- **Every table has RLS enabled.** Tables not used in Week 1 are enabled with no
  permissive policy, which is deny-by-default, rather than left unprotected.
- **Security-critical columns are server-written.** `safe_address`, credential
  metadata, `fee_*`, `*_uid` and status transitions are not writable by the
  `authenticated` role through RLS; the client proposes, the server decides.
  Status changes flow through `review_events` rather than direct updates.
- **Ownership is by `profile_id` tied to the Supabase user**, and the resident
  Safe address is the cross-chain identity used on-chain.
- **The `self_nullifier` is unique and indexed** (build guide section 9): it is
  the duplicate-application / Sybil guard, not name plus date of birth.
- **No raw proof payload is stored.** Only the attestation UID and the disclosed
  fields the programme is required to keep.

## Consequences

- RLS policies are reviewed as SQL, not exercised by a committed harness. The
  enforcement mechanism is Postgres, configured through Supabase; the policy set
  itself is ours. It began in a single auditable migration
  (`20260916000009_rls.sql`) and now spans three: tables added later carry their
  policies with them — `passkey_credentials` (migration 13) and
  `safe_deployments` / `safe_pre_deposits` (migration 16). `supabase/README.md`
  holds the current matrix. `scripts/verify.sh` and `scripts/verify-full.sh` do not test RLS,
  so no green run should be read as an RLS claim.
- A migration that forgets `enable row level security` is a defect, not a
  detail. The guard loop at the end of the RLS migration raises at apply time, so
  the migration fails rather than shipping an unprotected table. That loop
  executes once: a table added by a later migration is not covered by it, and
  reviewing that is manual.
- Deny-by-default means a future week must add policies deliberately, which is
  the intended cost.

## Alternatives considered

- **Partial schema for Week 1** — rejected; contract section 2 item 10 freezes
  the full schema.
- **RLS disabled with application-side filtering** — rejected; the contract
  requires database-enforced isolation, and D2 names it explicitly.
- **Storing documents rather than hashes** — rejected; documents are hashed and
  pinned, and the root is attested.
