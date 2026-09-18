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
| Registration cannot happen accidentally | `assertRegistrationApproved` throws unless an approval record names an approver and a timestamp; `eas/approval.json` is `false`; the planner prints calldata and never signs |
| The verifier is read-only | `npm run eas:verify --workspace @kade/contracts` reads the registry and compares it with the manifest; no broadcast path exists anywhere |
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

- **Nothing is registered.** `eas/registered-uids.json` is empty, so there are no
  UIDs and no explorer links yet.
- **The registry-comparison path has never been executed against a live
  registry**, because there is nothing registered to compare.

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

_Not yet recorded._

Required for the guard to release:

```json
{
  "onchainGateApproved": true,
  "approvedBy": "<who>",
  "approvedAt": "<ISO timestamp>"
}
```
