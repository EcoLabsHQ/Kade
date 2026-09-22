# Week 2 — front 03 ownership-proof: evidence note

**Status:** Delivered in-repo. Not yet integrated or reviewed.
**Package:** EXE-013 enabler (D17 signed-wallet ownership proof).
**Branch:** `week-2-03-ownership-proof`
**Base:** `c49a499` (`week-2` tip at the time of writing)

## Commits

| Commit | Purpose |
|---|---|
| `cd6811c` | `feat(ownership): add signed-wallet proof migration (D17)` |
| `1ec42b9` | `feat(ownership): add challenge/verify module (D17 frozen interface)` |
| `6381e0a` | `test(ownership): cover challenge issuance and signature verification` |

## Files

- `supabase/migrations/20260922000030_wallet_ownership_proof.sql` (new)
- `apps/web/src/lib/wallet/ownership.ts` (new)
- `apps/web/tests/wallet-ownership.test.ts` (new)

## Frozen interface exposed

`apps/web/src/lib/wallet/ownership.ts`:

```ts
issueOwnershipChallenge(address: string): Promise<{ nonce: string; message: string }>
verifyWalletOwnership(input: { address: string; message: string; signature: string }): Promise<{ ok: boolean; error?: string }>
```

Both are preserved unchanged for front 04 (Holdings) to consume.

## Tests

```text
npx vitest run tests/wallet-ownership.test.ts
  Test Files  1 passed (1)
       Tests  15 passed (15)
```

Covers: challenge issuance (session required, invalid address refused, nonce +
exact message stored/returned); verification with a valid viem signature;
tampered message; wrong signer; malformed signature; message not matching the
issued challenge; consumed challenge; expired challenge; missing session; and a
database refusal surfaced as `ok:false`. Real ECDSA signatures are used — the
crypto is not mocked.

`npm run typecheck` — pass. `npm run lint` — pass (3 pre-existing warnings).

## Runtime proof (Supabase project)

- Migration applied live as version `20260922191435` (`wallet_ownership_proof`);
  the committed filename uses the front-03 range `20260922000030`, consistent
  with the repository's existing filename/apply-version pattern.
- Live checks: `wallet_ownership_challenges` exists with RLS enabled and the
  owner-only policy; `record_wallet_ownership` is `SECURITY DEFINER`; `anon` has
  no grants; `authenticated` INSERT is column-scoped to
  `(address, expires_at, message, nonce, profile_id)`.
- A fully rolled-back transaction exercised the writer against a real profile
  (no rows persisted — verified after): `happy_path=true`,
  `replay_rejected=true`, `tampered_message_rejected=true`,
  `no_challenge_rejected=true`, `unauthenticated_rejected=true`.
- `supabase_get_advisors(security)`: the writer appears in the same intentional
  "signed-in users can execute SECURITY DEFINER function" class as
  `record_preapproval_fee_tx`, `save_passkey_signer`, and the Safe-record
  writers. No new blocking finding.

## Security notes

- The signature is a **product-integrity flag**, not a capability. It grants no
  authority over the resident Safe, is never a login, and is never written to
  `safe_deployments` or `passkey_credentials` (week-2 contract 2.2 items 2–4;
  week-1 section 8.10).
- `authenticated` has no INSERT/UPDATE privilege on `wallets.siwe_sig` or
  `wallets.verified_at`; the only write path is the owner-scoped
  `SECURITY DEFINER` function, which refuses without a live, unconsumed,
  unexpired challenge whose message is byte-identical to the signed message.
- The pasted paths (`record_wallet_address`, migrations 20/21) never set these
  columns, so pasted rows stay `verified_at NULL` by construction.
- **Declared trust boundary** (matching `save_passkey_signer`, migration 17):
  Postgres cannot recover a secp256k1 key, so the ECDSA check runs off-chain in
  `ownership.ts` (viem). The function therefore takes the signature as an
  argument and cannot itself recompute the signer; an authenticated resident
  could in principle call it directly for their *own* address. What is closed is
  the paste path, cross-resident access, message substitution, replay and
  expiry. A server-side re-verification in Holdings is the future closure.
- No service-role key is involved. No irreversible on-chain write is made.

## BLOCKED

none
