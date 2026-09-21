# Gate 3 — Onchain

**Approves:** the exact EAS schema encodings, and the KadeLock interface and
threat model.
**Blocks:** irreversible EAS registration.

## Decision requested

Read `packages/contracts/eas/REVIEW.md` and either approve it, or change
specific fields. That document is generated from `@kade/shared`, so approving it
is approving the exact bytes that would be registered.

## What is already proven

| Requirement | Evidence |
|---|---|
| The five schema names are frozen | Contract section 2 item 8; asserted in `tests/acceptance/week-1-contract.test.ts` |
| The encodings are generated, not hand-copied | `npm run eas:manifest --workspace @kade/contracts` regenerates both `eas-schema-manifest.json` and `REVIEW.md` from `@kade/shared` |
| Every field carries its provenance | `documented` or `arbitrary` per field in `packages/shared/src/eas.ts` |
| Registration cannot happen accidentally | `assertRegistrationApproved` throws unless an approval record names an approver and a timestamp; `eas/approval.json` records the approval (`onchainGateApproved: true`, with the approver and date); the planner prints calldata and never signs |
| The EAS tooling is read-only | `npm run eas:verify --workspace @kade/contracts` reads `getSchema()` from the registry and compares it with the manifest; `eas:manifest`, `eas:calldata` and `eas:register` produce the plan and calldata for review and never sign or send. The repository's only send path is the resident Safe deployment engine (`apps/web/src/lib/safe/deploy.ts`), which is wired into onboarding and has deployed one Safe on Sepolia |
| KadeLock compiles and its policy passes | `forge test` — 33 tests |
| KadeLock is described exactly | "blocks non-allowlisted native-value transactions while locked"; the ERC-20 gap and the production fix are documented rather than glossed |

## What approval costs you

`eas/REVIEW.md` is written to be read in one pass. The decisions inside it are:

- the exact schema string for each of the five schemas (field order determines
  the UID);
- `revocable` per schema;
- whether a resolver is used (currently none);
- the attester rule (currently a Kade-authorized attester, not an address);
- the recipient per schema.

Every one is currently `[arbitrary]` unless the DOCX states it.

## What is not proven

- **No attestation has been issued.** The five schemas exist on chain, but no
  `kade.*` attestation has been written against any of them.
- **KadeLock is not deployed.** The resident Safe **is** deployed on Sepolia
  (`0x01C16fEc6C9E4b3DFa7eCA4464C55554a49d8918`), through the deployment engine
  wired into onboarding.

## What approval authorises

Registering the five schemas on **Sepolia** from the authorised registration
account. This is **irreversible**: a schema UID cannot be deleted, and a wrong
field order produces a different UID forever.

## What approval does not authorise

- Deploying KadeLock (compiled and tested only in Week 1).
- Registering on mainnet.
- Changing a schema after registration — that requires a new version
  (`kade.*.v2`), which is why the names are versioned.

## Approval record

**Approved 18 September 2026 by the project owner.** EAS schema registration on
Ethereum Sepolia is approved. The machine-readable record is
`packages/contracts/eas/approval.json` (`onchainGateApproved: true`).

The exact `register(string,address,bool)` calldata for all five schemas is
committed at `packages/contracts/eas/registration-calldata.json`, together with
each schema's string, resolver, revocable flag, target registry and expected UID.
The registry is `0x0a7E2Ff54e76B8E6659aedc9103FB21c038050D0`, confirmed against
EAS's published deployments and by reading `getSchemaRegistry()` from the EAS
core contract on Sepolia.

**Executed 18 September 2026.** All five schemas are registered on Ethereum
Sepolia. The UIDs, transactions and block numbers are recorded in
`packages/contracts/eas/registered-uids.json`, and the schemas are bound to the
chain: `npm run eas:verify` re-reads `getSchema()` from the registry and confirms
the schema string, resolver and revocable flag against the manifest.

| Schema | UID |
|---|---|
| `kade.kyc.v1` | `0xeb5d6cfe8e91ca85f091bee9521cd611f2779b224499bb0b2f0b9ef584eb9c7b` |
| `kade.fee.v1` | `0x1b173af4c9740b087df5f00f7c9c6bed9ee60880fe87b0b3ede6b7cc7059f3d3` |
| `kade.application.v1` | `0xb62efa605d2ebb777977c5a1f6efc74fff2d6739fa9ab693c1bc79fb2a961a5c` |
| `kade.review.v1` | `0xae51d8fdc55e065858eba289b43aa679190cf4190fffe4c7728c1e25042d5fce` |
| `kade.permit.v1` | `0x30be014defdd34f04f9f756f8f94f40476cdf97735dc54cac7a98a4e58a9181e` |

The EAS plan is generated and verified here and does not broadcast; these five
transactions were sent from outside the repository. The repository's only send
path is the resident-Safe deployment engine in
`apps/web/src/lib/safe/deploy.ts`, which is wired into onboarding,
so it has never sent a transaction.

> **Note:** `approvedBy` is the literal string "project owner". Replace it with a
> named person if the gate record needs one.

Required for the guard to release:

```json
{
  "onchainGateApproved": true,
  "approvedBy": "<who>",
  "approvedAt": "<ISO timestamp>"
}
```
