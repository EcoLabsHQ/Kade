# Week 2 — Front 05 (Residency) working todo

**Branch:** `week-2-05-residency`
**Deliverable:** D16 / EXE-012 (Residency step end to end), priority 1.
**Scope source:** `docs/week-2-frozen-delivery-contract.md` §2.1, §2.3, §4.2 (D16).

This is a working document, not a governing one. The governing scope is the
Week 2 contract; the process is `docs/DEVELOPMENT_CONTRACT.md`.

## Done in this front

- Residency service-fee rail, mirroring the pre-approval receipt path in
  `apps/web/src/lib/payments/`: the amount is read server-side from
  `fee_schedule` (key `service`) and the USDC `Transfer` is proved from the
  transaction receipt. No amount is hard-coded in the client.
- `kade.permit.v1` issuance path: the attestation payload is built from the
  frozen shared schema (`packages/shared/src/eas.ts`), and issuance is gated
  behind an explicit approval so no irreversible write happens.
- Four residency checks (identity, funds, review, service fee) derived from
  records, and a six-stage residency tracker derived from records, not fixtures.
- Residency step UI reachable from the shell, rendering the real state of each
  check, the service-fee card (unlocked only when identity, funds and review are
  green), the tracker and the permit status.
- Migrations in the `20260922000040–59` range: the service-fee record and the
  owner-scoped read policies the checks need.

## BLOCKED: Self config + permit issuance gate

- **Self (self.xyz) project configuration is not supplied.** The identity check
  and the Self action are config-gated: with no `KADE_SELF_*` configuration the
  step reports "not configured" and the identity check stays pending. No KYC
  result is fabricated and no `identity_attestations` row is written by this
  front. The `kade.kyc.v1` encoding is reused from
  `packages/shared/src/eas.ts` and is unchanged.
- **`kade.permit.v1` issuance is a gated on-chain write.** The Onchain gate
  (Week 2 contract §7, checkpoint 3) has not approved issuance and no mainnet
  RPC/payer/attester is supplied. The issuance path builds and validates the
  payload but returns `blocked` and performs no write. No permit is faked.

Both blockers are implemented up to the boundary and then STOP, per the shared
front rules. They are recorded here as required.

## Integration notes (not blockers)

- **Nav entry.** `apps/web/src/components/shell/nav.ts` is integration-owned, so
  this front did not edit it. The Residency step is reachable from the shell via
  the **Start Residency** action on Overview. The integration owner may add a
  `Residency` nav item pointing at `/residency`.
- **Service-fee rail keys.** On the testnet configuration the rail reuses
  `TREASURY_ADDRESS` and `SEPOLIA_RPC_URL`. On a mainnet configuration it reads
  `MAINNET_TREASURY_ADDRESS` and `ETHEREUM_RPC_URL`, which the mainnet-config
  front owns; when they are absent the rail reports `not-configured` rather than
  sending to a Sepolia address on mainnet. Only the Sepolia chain is wired in
  the payment control today.
- **Self keys.** The gated Self path reads `KADE_SELF_APP_ID`,
  `KADE_SELF_SCOPE`, `KADE_SELF_VERIFIER_ADDRESS` and `KADE_SELF_CHAIN_ID`; the
  env schema is owned by the mainnet-config front.
- **Permit gate keys.** `KADE_PERMIT_ISSUANCE_APPROVED`,
  `KADE_PERMIT_ISSUANCE_APPROVED_BY`, `KADE_PERMIT_ISSUANCE_APPROVED_AT` record
  the Onchain-gate approval. Issuance still needs an attester key and a
  broadcast path, which this front deliberately does not add.
