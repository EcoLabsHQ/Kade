# @kade/contracts

Onchain core for the Kade Week 1 build: the **KadeLock** Safe Guard and the
**EAS schema manifest** tooling.

> **Status:** KadeLock and Colosseum Membership are not deployed; the five EAS
> schemas are registered.
>
> - KadeLock is compiled and Foundry-tested only. It is **not** deployed in
>   Week 1 (`docs/week-1-frozen-delivery-contract.md` sections 6.2 and 9).
> - **Colosseum Membership v1** (`ColosseumResident`, `ColosseumCitizen`,
>   `MembershipManager`) is compiled and Foundry-tested only. It is **not**
>   deployed on any network. The human approved the *contracts* as a
>   change-control item (`docs/week-3-frozen-delivery-contract.md` section 6);
>   that approval does **not** cover a deployment.
> - The five EAS schemas **are registered** on Ethereum Sepolia. The Onchain
>   gate (section 7, checkpoint 3) approved the encodings on 2026-09-18 and the
>   project owner executed the registration outside this repository. The
>   registrar, UIDs, transactions and block numbers are in
>   `eas/registered-uids.json`; the committed calldata that was executed is in
>   `eas/registration-calldata.json`. Registration is irreversible.

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
| `src/SafeAddress.sol` | Pure CREATE2 Safe proxy address derivation (D4). |
| `src/ColosseumMembership.sol` | Abstract soulbound ERC-721 + ERC-5192 credential base. |
| `src/ColosseumResident.sol` | Resident credential collection. |
| `src/ColosseumCitizen.sol` | Citizen credential collection. |
| `src/MembershipManager.sol` | Issues, promotes and revokes credentials. |
| `src/interfaces/IERC5192.sol` | In-repo minimal ERC-5192 interface. |
| `test/KadeLock.t.sol` | Guard policy tests (D7). |
| `test/KadeLockSafeIntegration.t.sol` | Value actually moves through the guard. |
| `test/SafeAddress.t.sol` | Deterministic-address vector and sensitivity tests (D4). |
| `test/ColosseumMembership.t.sol` | Token rules for the soulbound collections. |
| `test/MembershipManager.t.sol` | Manager access control, state machine, atomicity, reentrancy. |
| `test/mocks/MockGuardHost.sol` | Minimal Safe-like host; test-only, never deployed. |
| `test/mocks/RejectingReceiver.sol` | ERC-721 receiver that rejects one collection; test-only. |
| `test/mocks/ReentrantReceiver.sol` | ERC-721 receiver that re-enters the manager; test-only. |
| `scripts/` | EAS manifest generation, registration planner, read-only verifier, Safe address/manifest tooling. |
| `eas/` | Approval record, committed manifest, review pack, registered-UID record. |
| `safe/` | `SafeDeploymentManifest` JSON Schema and placeholder example. |
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
`safe-smart-account` v1.5.0 (`contracts/base/GuardManager.sol`,
`BaseTransactionGuard`). It also
implements `IERC165` via `supportsInterface`.

## Colosseum Membership v1

Two soulbound credential collections plus a manager, all compiled and
Foundry-tested only. **Nothing is deployed.**

| Contract | Responsibility |
|---|---|
| `ColosseumResident` | ERC-721 + ERC-5192 collection for Residents. |
| `ColosseumCitizen` | ERC-721 + ERC-5192 collection for Citizens. |
| `MembershipManager` | Coordinates issue, promote and revoke. |

Both collections share `ColosseumMembership` and follow the same token rules:

- `balanceOf(wallet)` is `0` or `1` — one active credential per address;
- `locked(tokenId)` returns `true` for an existing token and **reverts** when the
  token does not exist or was burned;
- every mint emits both `Transfer` and `Locked`;
- every transfer between two non-zero addresses reverts (`Soulbound`);
- there is **no** unlock function; revocation **burns** the token;
- burned ids are never reused;
- only the `MembershipManager` may mint or burn (`ERC721Burnable` is
  deliberately not inherited);
- metadata carries the name, image and membership type only — **no personal
  data**.

`MembershipManager` is `Ownable2Step` with the Safe as owner. All
membership-changing functions are restricted to the Safe; no administrative
permission remains with the deployer wallet. It is `ReentrancyGuard`-protected
and updates state before `_safeMint` callbacks.

```text
None --issueResident--> Resident --promoteToCitizen--> Citizen
Resident | Citizen --revokeMembership--> None
```

Promotion is atomic: the Resident credential is burned and the Citizen
credential minted in one transaction, so a rejected Citizen mint reverts the
whole promotion and leaves the Resident credential intact.

**Deployment inputs still required** (none is set here): the target network, the
Safe address that owns the manager, and the wallet ↔ account mapping used to
decide who is issued a credential. Wiring is a one-time `setCollections` call by
the Safe, after the two collections are deployed with the manager address as
their only minter/burner.

> **Note:** adding the pinned OpenZeppelin dependency changes each artifact's
> metadata (Foundry compiles every source in one solc input), so the pinned
> `SafeProxy` creation-code hash in `test/SafeAddress.t.sol` was re-derived with
> `npm run safe:vector --workspace @kade/contracts`. The vector arithmetic is
> unchanged.

## EAS schema tooling

The manifest is generated from `@kade/shared`; no field list is hand-copied.

```bash
# Regenerate the committed manifest (no network, no writes beyond the file).
npm run eas:manifest --workspace @kade/contracts

# Print the exact register(...) calldata. Never signs or sends.
npm run eas:register --workspace @kade/contracts

# Write the exact register(...) calldata, expected UIDs and current
# registration state to the committed calldata record.
npm run eas:calldata --workspace @kade/contracts

# Read the SchemaRegistry and compare it with the manifest. Read-only.
npm run eas:verify --workspace @kade/contracts
```

Both the registration planner and the verifier **refuse to run unless an
approval record exists and names an approver and a timestamp**. The guard is
`assertRegistrationApproved()` from `@kade/shared`, so there is one definition
of "approved".

| File | Role |
|---|---|
| `eas/approval.json` | Approval record. Approved at the Onchain gate on 2026-09-18. |
| `eas/approval.example.json` | Template; fails closed because approval stays false. |
| `eas/eas-schema-manifest.json` | Generated review artifact. |
| `eas/REVIEW.md` | Generated Onchain-gate review pack (same generator). |
| `eas/registration-calldata.json` | Generated record: the exact `register(...)` calldata and expected UIDs, plus the registration state read from `registered-uids.json`. The plan was executed outside this repository. |
| `eas/registered-uids.json` | Record of the executed registrations: UID, transaction, block and registrar per schema. |

> **Note:** the EAS scripts need Node >= 22.6 for native TypeScript stripping.
> The Foundry build and tests have no extra requirement beyond the repository
> minimum.

The committed approval record already sets `onchainGateApproved` to `true` with
the approver and date. To use a different record, point `KADE_EAS_APPROVAL_FILE`
at it. The verification script needs `SEPOLIA_RPC_URL` to re-read the registry;
the five recorded registrations are all compared.

> **Note:** The EAS tooling has no broadcast mode. The planner rejects every
> argument and prints calldata for a human to execute with the authorised
> registration account; the five registrations were executed that way, outside
> this repository.

## Safe address machinery (D4)

D4 requires one resident Safe address across every active chain — iteration 1:
Ethereum Sepolia and Base Sepolia, with Arbitrum deferred (contract v1.6) —
derived from frozen deployment inputs. `src/SafeAddress.sol`
implements the canonical `SafeProxyFactory.createProxyWithNonce` arithmetic;
`test/SafeAddress.t.sol` pins a known vector, cross-checks
`vm.computeCreate2Address`, and proves that changing any one input changes the
address.

> **Warning:** These tests use a synthetic all-`[arbitrary]` vector to pin the
> arithmetic, not the deployment's real values. The deployment inputs are now
> recorded in `@kade/shared`: the Safe release's addresses are `[external]`
> (Safe's published deployments) and the passkey module is confirmed.
>
> **The one input that cannot be pinned is the `SafeProxy` creation code.** This
> repository's build of `SafeProxy` is 649 bytes; the deployed v1.5.0 factory
> returns 438 bytes from `proxyCreationCode()`, and the creation code is part of
> the CREATE2 digest. An address derived from the local build is one the factory
> will never deploy, so the application reads the code from the factory at
> runtime. See `DEPLOYED_SAFE_PROXY_CREATION_CODE` in `@kade/shared`.
>
> A resident Safe is deployed on Sepolia; the example below still carries
> placeholders because it is a shape example, not a record.

```bash
# Validate the D4 manifest shape against its JSON Schema (read-only).
npm run safe:manifest --workspace @kade/contracts

# Re-derive the known address vector independently with viem (reads out/).
npm run safe:vector --workspace @kade/contracts
```

The persisted shape is `safe/SafeDeploymentManifest.schema.json`; an all-
placeholder example is `safe/safe-deployment-manifest.example.json`.

## Dependencies

- **Solidity:** `0.8.24` (pinned in `foundry.toml`).
- **forge-std:** v1.16.2 (MIT / Apache-2.0).
- **safe-smart-account:** v1.5.0 (**LGPL-3.0**).
- **openzeppelin-contracts:** v5.7.0 (MIT). Used by the Colosseum Membership
  contracts (`ERC721`, `Ownable2Step`, `ReentrancyGuard`, `Base64`, `Strings`).
- All are installed into `lib/` by `scripts/setup.sh` and are **not committed**.
  `safe-smart-account` is LGPL-3.0 and is deliberately kept out of this
  MIT-licensed repository rather than vendored into it. A clean checkout runs
  the setup script once; after that, `forge build` needs no network access.
- **No npm dependencies.** `packages/contracts/package.json` intentionally has
  none. The ESM scripts import `@kade/shared` from the workspace through a small
  resolver (`scripts/ts-module-loader.mjs`) rather than re-declaring its types.

## What is not here

Deployment scripts, EAS broadcast tooling, compliance co-signing, cure-event
evaluation and bypass tests are out of the Week 1 minimum model. See the threat
model for the full exclusion list.

There is also no deployment path for the Colosseum Membership contracts: no
script, no broadcast, no network or Safe address configured. They are contracts
and tests only.
