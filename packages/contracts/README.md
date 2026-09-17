# @kade/contracts

Onchain core for the Kade Week 1 build: the **KadeLock** Safe Guard and the
**EAS schema manifest** tooling.

> **Warning:** Nothing in this package is deployed or registered.
>
> - KadeLock is compiled and Foundry-tested only. It is **not** deployed in
>   Week 1 (`docs/week-1-frozen-delivery-contract.md` sections 6.2 and 9).
> - The five EAS schemas are **not** registered. Registration is irreversible
>   and blocked behind the Onchain gate (section 7, checkpoint 3).

## Quick start

```bash
cd packages/contracts
forge build
forge test
```

`forge test --summary` prints a compact pass/fail table.

## Layout

| Path | Contents |
|---|---|
| `src/KadeLock.sol` | The minimum Safe Guard (frozen model A). |
| `test/KadeLock.t.sol` | Guard policy tests (D7). |
| `test/KadeLockSafeIntegration.t.sol` | Value actually moves through the guard. |
| `test/mocks/MockGuardHost.sol` | Minimal Safe-like host; test-only, never deployed. |
| `scripts/` | EAS manifest generation, registration planner, read-only verifier. |
| `eas/` | Approval record, committed manifest, registered-UID record. |
| `lib/` | Foundry dependencies, installed by `scripts/setup.sh`. **Not committed.** |

## KadeLock

**What it does, stated exactly:** *KadeLock blocks non-allowlisted native-value
transactions while locked.*

`KadeLock` is a Safe transaction guard. Before `unlockAt` it blocks outbound
native value to any address that is not on its allowlist; at or after
`unlockAt` it stops blocking. Configuration (admin, unlock time, allowlist) is
restricted to the configured admin.

> **Scope:** this is a Week 1 demonstration of time-based locking and
> destination allowlisting, not the production enforcement layer and not
> complete protection of the assets in a resident Safe. It inspects `to` and
> `value` only: a call with `value == 0` is never blocked, so ERC-20 movements
> and arbitrary contract calls pass through while the lock is engaged.

> **Future improvement:** a production version should authorize each
> locked-asset operation individually—for example, through a single-use approval
> signed by Kade's backend and bound to the exact transaction—and extend
> enforcement to ERC-20 transfers and protocol interactions.

The full interface, roles, threat assumptions, invariants and limitations are in
[`docs/architecture/kadelock-threat-model.md`](../../docs/architecture/kadelock-threat-model.md).

### Guard source

KadeLock inherits the canonical `Guard` interface from
`safe-smart-account` v1.4.1 (`contracts/base/GuardManager.sol`). It also
implements `IERC165` via `supportsInterface`.

## EAS schema tooling

The manifest is generated from `@kade/shared`; no field list is hand-copied.

```bash
# Regenerate the committed manifest (no network, no writes beyond the file).
npm run eas:manifest --workspace @kade/contracts

# Print the exact register(...) calldata. Never signs or sends.
npm run eas:register --workspace @kade/contracts

# Read the SchemaRegistry and compare it with the manifest. Read-only.
npm run eas:verify --workspace @kade/contracts
```

Both the registration planner and the verifier **refuse to run unless an
approval record exists and names an approver and a timestamp**. The guard is
`assertRegistrationApproved()` from `@kade/shared`, so there is one definition
of "approved".

| File | Role |
|---|---|
| `eas/approval.json` | Approval record. Intentionally unapproved in Week 1. |
| `eas/approval.example.json` | Template; fails closed because approval stays false. |
| `eas/eas-schema-manifest.json` | Generated review artifact. |
| `eas/registered-uids.json` | Populated only after a human registers the schemas. |

> **Note:** the EAS scripts need Node >= 22.6 for native TypeScript stripping.
> The Foundry build and tests have no extra requirement beyond the repository
> minimum.

To approve after the Onchain gate, set `onchainGateApproved` to `true` and fill
`approvedBy` and `approvedAt`, or point `KADE_EAS_APPROVAL_FILE` at an approved
record. The verification script needs `SEPOLIA_RPC_URL` only when there are
recorded registrations to compare.

> **Note:** There is no broadcast mode. The planner rejects every argument and
> prints calldata for a human to execute with the authorised registration
> account.

## Dependencies

- **Solidity:** `0.8.24` (pinned in `foundry.toml`).
- **forge-std:** v1.16.2 (MIT / Apache-2.0).
- **safe-smart-account:** v1.4.1 (**LGPL-3.0**).
- Both are installed into `lib/` by `scripts/setup.sh` and are **not committed**.
  `safe-smart-account` is LGPL-3.0 and is deliberately kept out of this
  MIT-licensed repository rather than vendored into it. A clean checkout runs
  the setup script once; after that, `forge build` needs no network access.
- **No npm dependencies.** `packages/contracts/package.json` intentionally has
  none. The ESM scripts import `@kade/shared` from the workspace through a small
  resolver (`scripts/ts-module-loader.mjs`) rather than re-declaring its types.

## What is not here

Deployment scripts, broadcast tooling, EAS registration execution, compliance
co-signing, cure-event evaluation and bypass tests are out of the Week 1 minimum
model. See the threat model for the full exclusion list.
