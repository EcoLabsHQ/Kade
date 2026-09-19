# Onchain gate review — EAS schema registration

<!-- GENERATED FILE. Do not edit by hand. Regenerate with
     npm run eas:manifest --workspace @kade/contracts -->

This is the review pack the human approves at the **Onchain gate**
(week-1-frozen-delivery-contract.md section 7, checkpoint 3) before any
irreversible EAS registration. It is generated from `@kade/shared`; the schema
strings below are never hand-copied.

> **Warning:** Nothing is registered. Generating, committing or reading this
> file performs no on-chain action. Registration is irreversible.

- Source of truth: `@kade/shared registrationManifest()`
- Target chain: Ethereum Sepolia (chain 11155111)
- Schema registry: `0x0a7E2Ff54e76B8E6659aedc9103FB21c038050D0`
- Registration order: `kade.kyc.v1`, `kade.fee.v1`, `kade.application.v1`, `kade.review.v1`, `kade.permit.v1`
- Approval record: approved by project owner at 2026-09-18

## 1. The irreversible action approval authorises

Approving this pack authorises **one** thing: registering the five exact schema
strings below, once each, against the EAS SchemaRegistry at
`0x0a7E2Ff54e76B8E6659aedc9103FB21c038050D0` on Ethereum Sepolia, from the project's
authorised Sepolia EAS registration account.

The command a human runs is:

```bash
npm run eas:register --workspace @kade/contracts
```

It **never signs or sends a transaction**. It prints the exact
`register(string,address,bool)` calldata for each schema, which the authorised
account then executes manually. No script in this repository has a broadcast
mode. Registration takes effect only when that manual transaction is mined.

Before running it, the human must record the approval in `eas/approval.json`
(or set `KADE_EAS_APPROVAL_FILE`): the planner refuses to run unless the record
sets `onchainGateApproved: true` and names an approver and timestamp.

## 2. Registration order and exact encodings

Field order is significant: it determines the schema UID.

1. **kade.kyc.v1**

   ```text
   string nationality,bool over18,bool notSanctioned,bytes32 selfNullifier,uint64 expiresAt
   ```

2. **kade.fee.v1**

   ```text
   string applicationRef,uint256 amountUSDC,bytes32 txHash,string feeType
   ```

3. **kade.application.v1**

   ```text
   string applicationRef,string tier,bytes32 docsRoot,uint256 qualifyingBalance
   ```

4. **kade.review.v1**

   ```text
   string applicationRef,bool cleared,string note
   ```

5. **kade.permit.v1**

   ```text
   string applicationRef,string tier,uint64 validUntil
   ```

## 3. Per-schema detail

Each row states the attribute, its value, its provenance and the consequence of
the value. A provenance of `[arbitrary]` means the value is not fixed by the
governing documents; the Onchain gate reviewed and accepted these values on 18
September 2026.

### 1. kade.kyc.v1

Exact encoded string (this is what is hashed into the schema UID):

```text
string nationality,bool over18,bool notSanctioned,bytes32 selfNullifier,uint64 expiresAt
```

| Attribute | Value | Provenance | Consequence |
|---|---|---|---|
| revocable | true | [arbitrary] | Attestations can be revoked by the attester, so Kade can retract or supersede an attestation. |
| resolver | none (0x0000…0000) | [arbitrary] | No resolver is called. The schema is written directly, with no on-chain validation, fee or side effect on attest or revoke. |
| attester rule | kade-authorized | [arbitrary] | The registry does not enforce an attester. This is an off-chain rule: only the account the project authorises is expected to attest. Consumers MUST filter by the approved attester address; otherwise any address can attest to this public schema. |
| recipient | resident-safe | documented | The recipient is chosen at attestation time, not at registration. This records Kade's intended recipient (the resident Safe); the registry does not enforce it. Consumers MUST check the recipient. |

Fields:

| # | Field | Solidity type | Type provenance |
|---:|---|---|---|
| 1 | nationality | `string` | [arbitrary] |
| 2 | over18 | `bool` | [arbitrary] |
| 3 | notSanctioned | `bool` | [arbitrary] |
| 4 | selfNullifier | `bytes32` | [arbitrary] |
| 5 | expiresAt | `uint64` | [arbitrary] |

### 2. kade.fee.v1

Exact encoded string (this is what is hashed into the schema UID):

```text
string applicationRef,uint256 amountUSDC,bytes32 txHash,string feeType
```

| Attribute | Value | Provenance | Consequence |
|---|---|---|---|
| revocable | false | [arbitrary] | Attestations are permanent; a mistaken or superseded attestation cannot be retracted on-chain. |
| resolver | none (0x0000…0000) | [arbitrary] | No resolver is called. The schema is written directly, with no on-chain validation, fee or side effect on attest or revoke. |
| attester rule | kade-authorized | [arbitrary] | The registry does not enforce an attester. This is an off-chain rule: only the account the project authorises is expected to attest. Consumers MUST filter by the approved attester address; otherwise any address can attest to this public schema. |
| recipient | treasury-safe | documented | The recipient is chosen at attestation time, not at registration. This records Kade's intended recipient (the treasury Safe); the registry does not enforce it. Consumers MUST check the recipient. |

Fields:

| # | Field | Solidity type | Type provenance |
|---:|---|---|---|
| 1 | applicationRef | `string` | [arbitrary] |
| 2 | amountUSDC | `uint256` | [arbitrary] |
| 3 | txHash | `bytes32` | [arbitrary] |
| 4 | feeType | `string` | [arbitrary] |

### 3. kade.application.v1

Exact encoded string (this is what is hashed into the schema UID):

```text
string applicationRef,string tier,bytes32 docsRoot,uint256 qualifyingBalance
```

| Attribute | Value | Provenance | Consequence |
|---|---|---|---|
| revocable | true | [arbitrary] | Attestations can be revoked by the attester, so Kade can retract or supersede an attestation. |
| resolver | none (0x0000…0000) | [arbitrary] | No resolver is called. The schema is written directly, with no on-chain validation, fee or side effect on attest or revoke. |
| attester rule | kade-authorized | [arbitrary] | The registry does not enforce an attester. This is an off-chain rule: only the account the project authorises is expected to attest. Consumers MUST filter by the approved attester address; otherwise any address can attest to this public schema. |
| recipient | resident-safe | documented | The recipient is chosen at attestation time, not at registration. This records Kade's intended recipient (the resident Safe); the registry does not enforce it. Consumers MUST check the recipient. |

Fields:

| # | Field | Solidity type | Type provenance |
|---:|---|---|---|
| 1 | applicationRef | `string` | [arbitrary] |
| 2 | tier | `string` | [arbitrary] |
| 3 | docsRoot | `bytes32` | [arbitrary] |
| 4 | qualifyingBalance | `uint256` | [arbitrary] |

### 4. kade.review.v1

Exact encoded string (this is what is hashed into the schema UID):

```text
string applicationRef,bool cleared,string note
```

| Attribute | Value | Provenance | Consequence |
|---|---|---|---|
| revocable | true | [arbitrary] | Attestations can be revoked by the attester, so Kade can retract or supersede an attestation. |
| resolver | none (0x0000…0000) | [arbitrary] | No resolver is called. The schema is written directly, with no on-chain validation, fee or side effect on attest or revoke. |
| attester rule | kade-authorized | [arbitrary] | The registry does not enforce an attester. This is an off-chain rule: only the account the project authorises is expected to attest. Consumers MUST filter by the approved attester address; otherwise any address can attest to this public schema. |
| recipient | resident-safe | documented | The recipient is chosen at attestation time, not at registration. This records Kade's intended recipient (the resident Safe); the registry does not enforce it. Consumers MUST check the recipient. |

Fields:

| # | Field | Solidity type | Type provenance |
|---:|---|---|---|
| 1 | applicationRef | `string` | [arbitrary] |
| 2 | cleared | `bool` | [arbitrary] |
| 3 | note | `string` | [arbitrary] |

### 5. kade.permit.v1

Exact encoded string (this is what is hashed into the schema UID):

```text
string applicationRef,string tier,uint64 validUntil
```

| Attribute | Value | Provenance | Consequence |
|---|---|---|---|
| revocable | true | [arbitrary] | Attestations can be revoked by the attester, so Kade can retract or supersede an attestation. |
| resolver | none (0x0000…0000) | [arbitrary] | No resolver is called. The schema is written directly, with no on-chain validation, fee or side effect on attest or revoke. |
| attester rule | kade-authorized | [arbitrary] | The registry does not enforce an attester. This is an off-chain rule: only the account the project authorises is expected to attest. Consumers MUST filter by the approved attester address; otherwise any address can attest to this public schema. |
| recipient | resident-safe | documented | The recipient is chosen at attestation time, not at registration. This records Kade's intended recipient (the resident Safe); the registry does not enforce it. Consumers MUST check the recipient. |

Fields:

| # | Field | Solidity type | Type provenance |
|---:|---|---|---|
| 1 | applicationRef | `string` | [arbitrary] |
| 2 | tier | `string` | [arbitrary] |
| 3 | validUntil | `uint64` | [arbitrary] |

> **Note:** the EAS `register` call takes only `(schema, resolver, revocable)`.
> `attester` and `recipient` are therefore **not** enforced by registration.
> They are recorded here as the intended off-chain rules, and consumers must
> enforce them.

## 4. What approval does NOT authorise

- Deployment of KadeLock. It is compiled and Foundry-tested only in Week 1
  (contract sections 6.2 and 9).
- Deployment or configuration of the resident Safe, or any change to the Safe
  version, factory, singleton, initializer, handler, signer, threshold or salt.
  Those are the **Account gate** (section 7, checkpoint 2).
- Mainnet registration, or registration on any chain other than
  Ethereum Sepolia.
- Registration on Arbitrum Sepolia or Base Sepolia.
- Issuing, revoking or altering any EAS attestation.
- Changing the schema fields, encodings, order, `revocable` or `resolver`.
  Those are change-control items (section 8).
- Approving the registration account, the RPC provider or the deployment payer.
- Automating or broadcasting the transaction. No script here sends it.
- Waiving the read-only verification step after registration.

## 5. What could still go wrong after approval

1. **An encoding error is permanent.** The schema string is hashed into the UID
   and cannot be edited. A typo or wrong field order requires a new schema
   version with a new UID.
2. **A wrong `revocable` flag is permanent.** Setting it false makes every
   attestation impossible to retract.
3. **A resolver cannot be added later.** Registering with no resolver means no
   on-chain hook on attest or revoke; adding one requires a new schema and UID.
4. **The predicted UID may already exist.** If the same
   `(schema, resolver, revocable)` triple is already registered, the
   registration transaction reverts; compare the registry before executing.
5. **The registry does not enforce attester or recipient.** Any address can
   attest to a public schema; consumers must filter. This is not fixed by
   approval.
6. **A front-run is possible.** Another account could register the identical
   triple first; the UID is unchanged, but Kade would not be the registering
   account and the call would revert.
7. **The registry address is an assumption.** `0x0a7E2Ff54e76B8E6659aedc9103FB21c038050D0` is
   the published EAS Sepolia deployment; a wrong or upgraded address would send
   the transaction elsewhere.
8. **Approval can go stale.** If the manifest is regenerated after approval and
   the encodings change, the recorded approval no longer covers them. The
   registration planner refuses to run if the committed manifest drifts from
   `@kade/shared`, but the human record itself must be re-checked.
9. **Field order binds downstream code.** Indexers and encoders must consume
   fields in exactly this order.

## 6. `[arbitrary]` values reviewed at the Onchain gate

| Value | Where | Gate that must confirm it |
|---|---|---|
| `revocable` (kade.kyc.v1) | manifest | Onchain gate |
| `resolver` (kade.kyc.v1) | manifest | Onchain gate |
| `attester` (kade.kyc.v1) | manifest | Onchain gate |
| `nationality: string` (kade.kyc.v1) | manifest | Onchain gate |
| `over18: bool` (kade.kyc.v1) | manifest | Onchain gate |
| `notSanctioned: bool` (kade.kyc.v1) | manifest | Onchain gate |
| `selfNullifier: bytes32` (kade.kyc.v1) | manifest | Onchain gate |
| `expiresAt: uint64` (kade.kyc.v1) | manifest | Onchain gate |
| `revocable` (kade.fee.v1) | manifest | Onchain gate |
| `resolver` (kade.fee.v1) | manifest | Onchain gate |
| `attester` (kade.fee.v1) | manifest | Onchain gate |
| `applicationRef: string` (kade.fee.v1) | manifest | Onchain gate |
| `amountUSDC: uint256` (kade.fee.v1) | manifest | Onchain gate |
| `txHash: bytes32` (kade.fee.v1) | manifest | Onchain gate |
| `feeType: string` (kade.fee.v1) | manifest | Onchain gate |
| `revocable` (kade.application.v1) | manifest | Onchain gate |
| `resolver` (kade.application.v1) | manifest | Onchain gate |
| `attester` (kade.application.v1) | manifest | Onchain gate |
| `applicationRef: string` (kade.application.v1) | manifest | Onchain gate |
| `tier: string` (kade.application.v1) | manifest | Onchain gate |
| `docsRoot: bytes32` (kade.application.v1) | manifest | Onchain gate |
| `qualifyingBalance: uint256` (kade.application.v1) | manifest | Onchain gate |
| `revocable` (kade.review.v1) | manifest | Onchain gate |
| `resolver` (kade.review.v1) | manifest | Onchain gate |
| `attester` (kade.review.v1) | manifest | Onchain gate |
| `applicationRef: string` (kade.review.v1) | manifest | Onchain gate |
| `cleared: bool` (kade.review.v1) | manifest | Onchain gate |
| `note: string` (kade.review.v1) | manifest | Onchain gate |
| `revocable` (kade.permit.v1) | manifest | Onchain gate |
| `resolver` (kade.permit.v1) | manifest | Onchain gate |
| `attester` (kade.permit.v1) | manifest | Onchain gate |
| `applicationRef: string` (kade.permit.v1) | manifest | Onchain gate |
| `tier: string` (kade.permit.v1) | manifest | Onchain gate |
| `validUntil: uint64` (kade.permit.v1) | manifest | Onchain gate |
| Registration account (not in the manifest) | project supply | Onchain gate + project |
| `SEPOLIA_RPC_URL` | environment | Foundation / ops |

Documented (not arbitrary): the five schema names, the target chain
11155111, the SchemaRegistry address's external source, and the
intended recipient categories. See
`docs/architecture/kadelock-threat-model.md` section 8 for the consolidated
list.
