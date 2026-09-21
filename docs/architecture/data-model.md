# Data model

**Status:** implemented in `supabase/migrations/` · 16 September 2026
**Refs:** DOCX §9 (authoritative schema), `docs/architecture/adr/0004-data-ownership-and-rls.md`,
`docs/architecture/adr/0005-config-over-code.md`, week-1 contract §2 item 10 and §4 (D2).

The schema is the full DOCX §9 model. Week 1 uses only the pre-registration
tables; the rest are created in full and left deny-by-default so a later week
adds a policy deliberately rather than discovering an open table.

The design handoff is the visual and interaction baseline, but its schema table
is not the frozen authority. See "Handoff vs DOCX" below for every difference
and how each was resolved.

## Migration order

| Migration | Creates |
|---|---|
| `20260916000001_profiles.sql` | `profiles`, `profile_citizenships`, `profile_residences` |
| `20260916000002_applications.sql` | `applications`, `household_members` |
| `20260916000003_wealth.sql` | `wallets`, `wealth_snapshots`, `container_balances`, `allocations` |
| `20260916000004_rails.sql` | `gos_transfers`, `card_transactions` |
| `20260916000005_documents.sql` | `documents` |
| `20260916000006_identity_attestations.sql` | `identity_attestations` |
| `20260916000007_review_events.sql` | `reviewers`, `review_events` (+ status trigger) |
| `20260916000008_config.sql` | `fee_schedule`, `chains` |
| `20260916000009_rls.sql` | none; enable RLS, grants, policies, guard |
| `20260916000010_fee_function.sql` | no tables; `fee_schedule` formula columns, `preapproval_fee_usdc()`, fee-recompute triggers |
| `20260916000011_save_onboarding.sql` | no tables; `save_onboarding(...)` atomic save RPC |
| `20260916000012_reset_demo.sql` | no tables; `reset_demo_data()` (demo reset) |
| `20260916000013_passkey_credentials.sql` | `passkey_credentials`, its RLS policies and column grants |
| `20260916000014_passkey_public_key_comment.sql` | no tables; comment-only correction of the public-key description |
| `20260916000015_fee_authority_comment.sql` | no tables; comment-only correction of who computes the pre-approval fee |
| `20260916000016_safe_deployments.sql` | `safe_deployments` (the D4 manifest as explicit columns) and `safe_pre_deposits`; RLS on both, server-written columns withheld from `authenticated` |
| `20260916000017_passkey_signer.sql` | no tables; `save_passkey_signer`, a SECURITY DEFINER writer for `passkey_credentials.signer_address` |
| `20260916000018_safe_deployment_writes.sql` | no tables; `record_safe_prediction` and `record_safe_deployment_outcome`, SECURITY DEFINER writers for the Safe record |
| `20260916000019_safe_address_comment.sql` | no tables; comment-only correction of the Safe address description |

Also created: trigger/helper functions (`apply_review_event`,
`review_events_immutable`, `is_reviewer`, `preapproval_fee_usdc`,
`recompute_application_preapproval_fee`, `recompute_preapproval_fee`,
`init_preapproval_fee`), the `save_onboarding` and `reset_demo_data` RPCs, and
foreign-key lookup indexes. The original table migrations create structure only;
`…_rls.sql` is the single place RLS is declared for them. The later
`passkey_credentials` migration (13) and `safe_deployments` migration (16) carry
their own RLS and policies with their tables, so migrations 9, 13 and 16 are the
complete policy set.

## Columns

Column names are taken verbatim from DOCX §9. Columns not in the DOCX column
list are flagged in the migrations, and are marked `[added]` here.

| Table | Columns |
|---|---|
| `profiles` | `id`, `safe_address`, `email`, `first_name`, `last_name`, `dob` |
| `profile_citizenships` | `profile_id`, `country_code` |
| `profile_residences` | `profile_id`, `country_code`, `from_year`, `to_year` |
| `applications` | `id`, `ref`, `profile_id`, `tier`, `status`, `preapproval_usdc`, `service_usdc`, `fee_tx`, `fee_uid`, `app_uid`, `review_uid`, `service_uid` |
| `household_members` | `[added] id`, `application_id`, `name`, `relation`, `dob`, `citizenship` |
| `passkey_credentials` | `[added] id`, `profile_id`, `credential_id`, `public_key`, `signer_address`, `transports`, `user_verification`, `created_at`, `last_used_at` |
| `safe_deployments` | `[added] id`, `profile_id`, `safe_address`, `status`, `deployment_tx_hash`, `deployment_chain_id`, `predicted_l2_addresses`, `safe_version`, `factory`, `singleton`, `initializer`, `handler`, `owner`, `threshold`, `salt`, `creation_code_assumptions`, `provenance`, `failure_reason`, `predicted_at`, `queued_at`, `deployed_at`, `failed_at`, `updated_at` |
| `safe_pre_deposits` | `[added] id`, `profile_id`, `safe_address`, `chain_id`, `token_address`, `token_symbol`, `amount_usdc`, `tx_hash`, `verification_status`, `verified_at`, `created_at` |
| `wallets` | `[added] id`, `profile_id`, `address`, `chain`, `provider`, `siwe_sig`, `verified_at` |
| `wealth_snapshots` | `[added] id`, `wallet_id`, `chain`, `taken_at`, `assets`, `usd_value`, `provenance` |
| `container_balances` | `[added] id`, `application_id`, `safe_address`, `chain`, `taken_at`, `assets`, `usd_value` |
| `allocations` | `[added] id`, `application_id`, `chain`, `instrument`, `amount_usdc`, `tx`, `created_at` |
| `gos_transfers` | `[added] id`, `application_id`, `direction`, `currency`, `amount`, `fee_bps`, `gos_ref`, `user_chain`, `settlement_chain`, `bridge_msg_hash`, `status`, `settled_at` |
| `card_transactions` | `[added] id`, `application_id`, `kind`, `source_chain`, `amount_usdc`, `amount_xcg`, `tx`, `bridge_msg_hash`, `created_at` |
| `documents` | `[added] id`, `application_id`, `kind`, `owner`, `sha256`, `cid`, `status` |
| `identity_attestations` | `[added] id`, `profile_id`, `attestation_uid`, `chain`, `nationality`, `over18`, `not_sanctioned`, `self_nullifier`, `expires_at`, `created_at` |
| `review_events` | `[added] id`, `application_id`, `reviewer_id`, `action`, `note`, `attestation_uid`, `created_at` |
| `reviewers` | `id`, `role`, `signer_address` |
| `fee_schedule` | `mode`, `key`, `amount`, `currency`, `[added] base_amount`, `[added] per_member_amount`, `[added] rounding_scale` (PK `mode, key`) |
| `chains` | `chain_id`, `name`, `[added] env`, `usdc_address`, `eas_address`, `[added] schema_registry_address`, `kadelock_address`, `paymaster_policy_id`, `explorer_url` |

`[added] id` is a surrogate primary key: several DOCX tables name no key and
their natural fields are not unique. `chains.env` and
`chains.schema_registry_address` are required by ADR 0005 (environment switch)
and D6 (schema registry address) but are absent from the DOCX §9 column list.
`passkey_credentials` is an added *table*, not an added column: DOCX §9 has no
home for a WebAuthn credential, so contract v1.5 adds one to meet D3.
`safe_deployments` and `safe_pre_deposits` are likewise added tables: D4 requires
the resident Safe's deployment inputs and any pre-deposits to be recoverable, and
DOCX §9 has no home for them.

`fee_schedule` keeps the four DOCX columns and adds three. `amount` is retained
as the household-size-1 fee (pre-approval) or flat fee (service), in
`currency` = USDC. `base_amount` and `per_member_amount` are the frozen
formula's constant and per-member components, in USDC; `rounding_scale` is the
number of decimal places the result is rounded to. They are required to make
the DOCX's "DB function recomputes the pre-approval fee" possible, because the
old table stored only the size-1 fee and no increment. The regenerated seed is
the authoritative writer for the new columns, as for the existing rows
(ADR 0005); there is no way to recover the per-member increment from the old
`amount`, so the migration deliberately does not backfill.

## Handoff vs DOCX

Two schema sources exist and they disagree:

- **DOCX §9** (`docs/planning/kade-mvp-build-document-v7.txt`), the frozen
  authority. The Week 1 contract (§2 item 10, §4 D2) freezes the full DOCX
  schema.
- **Design handoff** (`reference/design-handoff/README.md`, "Supabase schema"),
  the visual/interaction baseline. Useful, but it is a design reference written
  from the prototype's state object, not a data-model authority.

Rule applied: where the two disagree, DOCX §9 wins for anything already
implemented; handoff-only constructs that belong to a later week are **listed
as deferred, not added**. The handoff's own four-week plan places Reflect in
week 3, which corroborates the deferrals.

Every difference, verified against both tables:

| Handoff | DOCX §9 | This repository | Resolution |
|---|---|---|---|
| `profiles.reflect_default` | absent | absent | **Deferred.** Reflect is week 3 (contract §9 excludes it). |
| `wealth_snapshots` key columns omit `chain` | `wealth_snapshots` includes `chain` | `chain` present | **DOCX wins.** The handoff omission is a documentation gap; its own architecture notes read balances per chain. |
| `container_balances.usdtplus_ratio` | absent | absent | **Deferred.** Reflect USDT+ ratio is week 3. |
| `reflect_positions` (whole table) | absent | absent | **Deferred.** Reflect position tracking is week 3. |
| `gos_transfers.chain` (a single chain) | `gos_transfers.user_chain`, `.settlement_chain`, `.bridge_msg_hash` | `user_chain`, `settlement_chain`, `bridge_msg_hash` | **DOCX wins.** A single `chain` cannot express the CCTP source leg, the settlement leg and the bridge message. |
| absent | `card_transactions` | present | **DOCX wins.** Implemented in `20260916000004_rails.sql`. |
| absent | `identity_attestations` | present | **DOCX wins.** Implemented in `20260916000006_identity_attestations.sql`; carries the `self_nullifier` Sybil guard. |
| absent | `chains` | present | **DOCX wins.** Implemented in `20260916000008_config.sql`. |
| `fee_schedule` = `mode, key, amount, currency` | `fee_schedule` = `mode, key, amount, currency` | plus `base_amount`, `per_member_amount`, `rounding_scale` | **Additive extension**, not a replacement: the four DOCX columns are unchanged. Required for the DOCX fee function; see `20260916000010_fee_function.sql`. |
| `allocations` key columns ordered `application_id, instrument, …` | ordered `application_id, chain, instrument, …` | DOCX order | Same column set; only declaration order differs. No action. |
| business rule `round((500 + 100 × householdMembers) / 1.79)` | §7 fee table, §9 household note | `preapprovalFeeUsdc()` in `@kade/shared` + the DB function | **Both agree.** The seeded parameters (`base_amount`, `per_member_amount`, `rounding_scale`) reproduce both worked examples exactly. |

Deferred handoff-only items, recorded so they are not mistaken for coverage:
`profiles.reflect_default`, `container_balances.usdtplus_ratio`,
`reflect_positions`. They are the Reflect surface, which is week 3 work.

## RLS matrix

Legend: **RW** = read/write own rows; **R** = read; **R(rev)** = reviewer read;
**—** = deny-by-default (RLS on, no policy, no privilege).

| Table | anon | owner | reviewer | server |
|---|---|---|---|---|
| `profiles` | — | RW (Safe address excluded) | R(rev) | all |
| `profile_citizenships` | — | RW | — | all |
| `profile_residences` | — | RW | — | all |
| `applications` | — | R own; insert own; update `tier` | R(rev) | all |
| `household_members` | — | RW via application | — | all |
| `passkey_credentials` | — | read own; insert own; update `last_used_at` (`signer_address` excluded) | — | all |
| `safe_deployments` | — | read own; insert own (`profile_id` only; the manifest columns are written by `record_safe_prediction`) | — | all |
| `safe_pre_deposits` | — | read own; insert own (`verification_status` and `verified_at` excluded) | — | all |
| `chains` | — | read | read | all |
| `fee_schedule` | — | read | read | all |
| `wallets` | — | — | — | all |
| `wealth_snapshots` | — | — | — | all |
| `container_balances` | — | — | — | all |
| `allocations` | — | — | — | all |
| `gos_transfers` | — | — | — | all |
| `card_transactions` | — | — | — | all |
| `documents` | — | — | — | all |
| `identity_attestations` | — | — | — | all |
| `reviewers` | — | — | — | all |
| `review_events` | — | — | — | all (append-only) |

"Own" means the row's `profile_id` equals `auth.uid()`, or, for
`household_members`, the parent application's `profile_id` does. A second
resident sees zero rows and can modify zero rows.

## Reasoning

- **Records in Supabase, money and attestations on chain.** Supabase owns
  workflow; it is never the source of truth for a balance or an attestation
  (ADR 0004, DOCX §8).
- **Deny-by-default for unused tables is stronger than owner-only.** A table
  with no policy denies every client; when its week arrives, the policy is added
  deliberately. This is why the Week 1 tables are not the only ones protected.
- **Security-critical columns use column privileges, not application checks.**
  Removing a column from the `authenticated` `INSERT`/`UPDATE` grants makes the
  write impossible at the database boundary, independent of any UI or server bug.
- **Status is trigger-only.** `applications.status` is not writable by residents
  and is changed by the `SECURITY DEFINER` trigger on `review_events` inserts.
  The review log is append-only, so the audit trail cannot be rewritten.
- **The nullifier is the identity key.** `self_nullifier` is unique and indexed;
  duplicate detection is over the nullifier, not name + date of birth
  (DOCX §14).
- **Hash and pin, never store the document.** `documents` holds `sha256` and
  `cid`; `identity_attestations` holds the UID and disclosed fields. No raw proof
  payload and no document bytes are stored (DOCX §8, §14).
- **Config is data.** `chains` and `fee_schedule` are seeded from `@kade/shared`
  (ADR 0005) so switching demo/production or adding a chain is a config change,
  not a code edit.

## Invariants enforced by the database

- Every public table has RLS enabled; `20260916000009_rls.sql` raises on apply
  if any does not.
- `identity_attestations.self_nullifier` is unique (index
  `identity_attestations_self_nullifier_key`).
- `identity_attestations.attestation_uid` is unique.
- `review_events` rejects `UPDATE` and `DELETE` for every role.
- `applications.status` is the only field changed by the review trigger.
- `applications.preapproval_usdc` is recomputed by `SECURITY DEFINER` triggers
  from `fee_schedule`: `public.preapproval_fee_usdc(mode, household_size)` is
  `round(base_amount + per_member_amount × household_size, rounding_scale)`.
  The formula parameters are data, and the seed generator asserts they
  reproduce `preapprovalFeeUsdc()` in `@kade/shared` for household sizes 1-1000
  before it writes a row, so the two cannot drift silently (ADR 0005).

## `[arbitrary]` values

Everything not fixed by the governing documents is labelled in the migrations
and the generated seed. These are the notable ones:

| Item | Value | Why arbitrary |
|---|---|---|
| `chains.kadelock_address` | `NULL` | KadeLock is compiled/tested only in Week 1 (contract §6.2) |
| `chains.paymaster_policy_id` | `NULL` | paymaster policy is out of Week 1 scope (contract §9) |
| mainnet `chains.eas_address`, `schema_registry_address` | zero address | mainnet EAS not verified in Week 1 |
| country encodings | ISO 3166-1 alpha-2 | DOCX names country fields, not an encoding |
| `applications.status` set | `draft`, `pre_approved`, `submitted`, `approved`, `blocked` | only `pre_approved` / `submitted` / `approved` / `blocked` are named |
| `applications.tier` set | `3-year`, `5-year`, `indefinite` | the DOCX uses "Indefinite"; the encoding is chosen |
| `gos_transfers.direction`, `.currency`, `.status` | unconstrained text | DOCX names the columns, not the values |
| `documents.kind`, `.owner`, `.status` | unconstrained text | DOCX names the columns, not the values |
| `wallets.provider`, `wealth_snapshots.provenance` | unconstrained text | DOCX names the columns, not the values |
| surrogate `id` columns | `bigint identity` | not in the DOCX column list; required keys |
| numeric precision | `numeric(20, 6)` | not stated; covers USDC's 6 decimals |
| `chains.env`, `chains.schema_registry_address` | added columns | required by ADR 0005 / D6, absent from DOCX §9 |
| `fee_schedule.base_amount`, `.per_member_amount`, `.rounding_scale` | added columns | required by the DOCX fee function, absent from its column list |
| `kade.fee_mode` | Postgres setting name | the database mirror of `KADE_FEE_MODE`; the mapping is deliberate, the setting name is chosen |
