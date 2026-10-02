# Colosseum residency (COLOSSEUM-1)

A **hackathon/demo residency layer** added by human request on 2 October 2026 and
declared as amendment v1.1 to the Week 3 delivery contract
(`docs/week-3-frozen-delivery-contract.md` §8). It is **off by default**.

It reuses the real residency machinery — the qualified-position read and the four
real residency checks — but the **Colosseum Resident / Colosseum Citizen** labels
and the **virtual passport** are demo constructs: they confer **no real
residency, citizenship, legal status or on-chain record**. See "What is real and
what is demo" below.

This document describes the declared increment. The surface carries **no
on-screen demo banner** by owner decision (consistent with FIN-1/VOTE-1, Week 3
contract §3); the declaration in the contract and in this document — not a UI
badge — is what makes it honest.

## What it is

`/colosseum` is a residency surface for the hackathon demo. It reuses the four
real residency checks (`identity`, `funds`, `review`, `service-fee` in
`apps/web/src/lib/residency/checks.ts`) and the real qualified-position read
(`loadVaultHoldings` reduced by `summarizeQualifiedPosition`), so the checkmarks
reflect real records and the chain. Nothing is fabricated.

A new residency tier value `'colosseum'` ("Colosseum Resident") carries a **10
USDC** qualifying minimum. It is registered through a dedicated **"Register for
Colosseum Residency"** action, **not** through an onboarding tier card. The
production tiers (`3-year` $280k, `5-year` $425k, `Indefinite` $850k) are
unchanged.

## The gate — off by default

The route and the feature are enabled only when:

```text
KADE_COLOSSEUM=1
```

The value must be exactly the string `1`. Unset, empty, `true`, `yes` or `0`
leave `/colosseum` a **404** (`notFound()`) and the feature inert. The flag is
read on the server; there is no query parameter or header that can turn it on.
When enabled, the route is auth-gated like every other app page. This mirrors the
`KADE_OPERATOR_WITHDRAW` gate (`docs/operator-vault-withdraw.md`).

## How the flow works

1. **Register.** From the Colosseum surface the resident chooses "Register for
   Colosseum Residency". This records the `'colosseum'` tier for the resident; it
   is not an onboarding tier card and does not change the production tiers. It
   **replaces the resident's own recorded `applications.tier`** with the
   `colosseum` value (a declared demo behaviour, confined to the gated demo
   environment).
2. **Meet the 10 USDC threshold.** The `funds` check reads the real qualified
   position and requires **10 USDC** when the tier is `colosseum`. A qualified
   position at or above 10 USDC makes the check `met`.
3. **Complete the real residency checks.** The resident completes the same four
   checks the Residency step uses: `identity`, `funds`, `review` and
   `service-fee`. After the real qualified position meets the 10 USDC minimum, a
   pop-up points the resident to complete their residency steps.
4. **Colosseum Resident.** When all four real checks are `met`, a loading screen
   congratulates the resident as a **Colosseum Resident**, lists the perks, and
   states: *"Remain a compliant resident for 2 minutes to be eligible to become a
   Colosseum Citizen."*
5. **2-minute compliance window.** A persisted 2-minute window starts when all
   four checks first become `met`. The start timestamp is `resident_since` in
   `public.colosseum_memberships`. If any check stops being `met` before
   citizenship, the clock resets. Eligibility is enforced **server-side**, not
   client-only.
6. **Become a Citizen.** After 2 minutes of continued compliance, the **"Become a
   Citizen"** control unlocks. Becoming a citizen persists `citizen_at` and a
   server-generated `passport_serial`, plays an animation, and shows a **saved
   virtual passport** on the Colosseum surface.

## Authority and state model

- Membership is a per-resident row in `public.colosseum_memberships`, scoped to
  the owner (`auth.uid()`) for reads: one resident cannot read another's row.
- Eligibility **writes are server-only**. The three `SECURITY DEFINER` RPCs —
  `register_colosseum_residency(p_profile_id)`,
  `sync_colosseum_residency(p_profile_id, p_met)` and
  `record_colosseum_citizen(p_profile_id)` — have `EXECUTE` revoked from
  `public`, `anon` and `authenticated` and granted only to `service_role`. A
  signed-in resident cannot call them through the Supabase REST/RPC endpoint
  with their own JWT, so the client cannot start the clock or mint the passport.
- The server actions call the RPCs with the elevated service client and pass the
  session's `userId` explicitly as `p_profile_id`; each function predicates every
  read and write on `profile_id = p_profile_id`, so it can reach only that
  resident's row. `p_met` is the server's recomputation of the four real checks,
  never a client-supplied value.
- `SUPABASE_SERVICE_ROLE_KEY` is **required**. Without it the actions return a
  distinct "not configured" refusal and touch nothing: the feature is inert, and
  no membership row, clock or passport can be written.
- `passport_serial` is **server-generated**, never client-supplied.
- Timing eligibility (the 2-minute window) is computed **server-side** from
  `resident_since`, so a client cannot claim eligibility early.
- No on-chain write, EAS emission or permit is involved.

## What is real and what is demo

| Aspect | Real | Demo / declared |
|---|---|---|
| Residency checks (`identity`, `funds`, `review`, `service-fee`) | Real state from records and the chain | — |
| Qualified position | Real read (`loadVaultHoldings` + `summarizeQualifiedPosition`) | — |
| 10 USDC minimum | Enforced by the `funds` check | A hackathon value, not a production permit minimum |
| Colosseum Resident / Colosseum Citizen | — | Labels with **no real residency, citizenship or legal status** |
| Virtual passport | Persisted (`passport_serial`) | A **visual artifact**, not a document, and not an attestation |
| On-chain effect | — | None: no on-chain write, no EAS emission, no permit |
| Production tiers | Unchanged (`3-year` $280k, `5-year` $425k, `Indefinite` $850k) | — |

## Configuration

Add the flag to the web app's environment (never the repository root):

```text
KADE_COLOSSEUM=1
```

Leave it unset or empty to keep `/colosseum` a 404 and the feature off.

## Change control

Making citizenship, the passport or the residency status real, enabling the
`colosseum` tier in production, or exposing the surface to residents outside the
gate is a new change-control item requiring explicit human approval (Week 3
contract §8.6).
