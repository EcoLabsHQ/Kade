# KadeLock threat model

KadeLock is the Week 1 minimum Safe Guard for Kade. This document records its
threat assumptions, roles, external interface, the invariants the Foundry tests
protect, what is deliberately out of scope, and every `[arbitrary]` value that
still needs a human decision.

> **Status:** proposal. The development contract freezes KadeLock as the
> **minimum Safe Guard/Module** (model A) *pending explicit confirmation*
> (`week-1-frozen-delivery-contract.md` section 6.2). The interface, threat
> model and exact EAS encodings must be approved at the **Onchain gate**
> (section 7, checkpoint 3) before any irreversible write or contract
> implementation is treated as approved.
>
> **Not deployed, not registered.** KadeLock is compiled and Foundry-tested
> only. The EAS schemas are not registered (sections 6.2 and 9).

## 1. Purpose and scope

**What KadeLock does, stated exactly:** *KadeLock blocks non-allowlisted
native-value transactions while locked.*

That sentence is deliberately narrow, because the implementation is narrow:

- It inspects `to` and `value` only. It does **not** inspect call data.
- A call with `value == 0` is never blocked, so ERC-20 operations and arbitrary
  contract calls pass through even while the lock is engaged.
- It is a demonstration of the mechanism, not complete protection of the assets
  held in a resident Safe.

KadeLock permits native-value transfers to allowlisted destinations (for example
the treasury fee address, approved instruments, the GOS settlement address, the
CCTP TokenMessenger, and the Self verifier) while locked. This is the frozen
Week 1 enforcement model; it is **not** the qualified vault described elsewhere
in the build guide.

In scope for the Week 1 model:

- native value cannot leave the guarded Safe before `unlockAt` unless the
  destination is allowlisted;
- the allowlist and the unlock time are admin-controlled;
- after `unlockAt` the lock no longer blocks.

> **Future improvement:** The Week 1 KadeLock implementation is intentionally
> limited to demonstrating time-based locking and destination allowlisting. A
> production version should authorize each locked-asset operation
> individually—for example, through a single-use approval signed by Kade's
> backend and bound to the exact transaction—and extend enforcement to ERC-20
> transfers and protocol interactions.

## 2. Trust assumptions

- **The guard is installed.** `KadeLock` has no effect unless the Safe's owner
  installs it with `setGuard`. Installation is out of Week 1 scope.
- **The Safe calls its guard.** The canonical Safe `GuardManager` invokes
  `checkTransaction` before every execution and `checkAfterExecution` after.
  `KadeLock` assumes that contract behaviour.
- **The admin is trusted to configure the lock.** A compromised admin can add
  destinations, move the unlock time, or unlock the Safe. There is no timelock
  and no second approver in this model.
- **`block.timestamp` is the clock.** Validators can influence it within a
  small window; the lock is not intended to be precise to the second.
- **Native value is the thing being protected.** Value carried in call data
  (ERC-20 transfers, delegatecall payloads) is not inspected by this model.
- **The guard is immutable and not upgradeable.** A defect is fixed by replacing
  the guard from the Safe, not by upgrading KadeLock.

## 3. Roles

| Role | Holder (proposal) | Authority |
|---|---|---|
| Admin | `[arbitrary]` — see section 8 | Configure allowlist, unlock time and admin; no value access. |
| Safe owner | Direct Safe WebAuthn signer, threshold 1 (D4) | Install/remove the guard and execute Safe transactions. |
| Anyone | Public | May call `checkTransaction`; it has no state effect. Value movement still requires the Safe. |

The Admin and the Safe owner are separate authorities. Whether the Safe owner
should also be the Admin is an open Onchain-gate decision.

## 4. External interface

Source: `packages/contracts/src/KadeLock.sol`. It inherits the canonical `Guard`
interface from `safe-smart-account` v1.4.1 and implements ERC-165.

### Functions

| Signature | Access | Behaviour |
|---|---|---|
| `constructor(address initialAdmin, uint64 initialUnlockAt)` | deploy | Reverts `ZeroAdmin` if `initialAdmin == 0`; emits `AdminChanged` and `UnlockAtChanged`. |
| `setAdmin(address newAdmin)` | admin | Reverts `ZeroAdmin` on zero; reassigns admin. |
| `lock(uint64 until)` | admin | Reverts `UnlockAtNotInFuture` unless `until > block.timestamp`; sets `unlockAt`. |
| `unlock()` | admin | Sets `unlockAt` to the current block time. |
| `allowDestination(address destination)` | admin | Reverts `ZeroDestination` on zero; allowlists. |
| `disallowDestination(address destination)` | admin | Removes from the allowlist. |
| `isLocked() view` | public | `true` while `block.timestamp < unlockAt`. |
| `admin() view` | public | Auto-generated getter. |
| `unlockAt() view` | public | Auto-generated getter; the single source of truth. |
| `allowedDestinations(address) view` | public | Auto-generated allowlist getter. |
| `checkTransaction(address to, uint256 value, bytes data, Enum.Operation operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address payable refundReceiver, bytes signatures, address msgSender) view` | public | Guard hook. Reverts `DestinationNotAllowed(to)` when locked, `value > 0` and `to` is not allowlisted; otherwise returns. Only `to` and `value` are inspected. |
| `checkAfterExecution(bytes32 txHash, bool success)` | public | No-op. |
| `supportsInterface(bytes4 interfaceId) pure` | public | `true` for `type(Guard).interfaceId` (`0xe6d7a83a`) and `type(IERC165).interfaceId` (`0x01ffc9a7`). |

### Events

| Event | Meaning |
|---|---|
| `AdminChanged(address indexed previousAdmin, address indexed newAdmin)` | Admin reassigned (constructor emits with `previousAdmin = 0`). |
| `UnlockAtChanged(uint64 previousUnlockAt, uint64 newUnlockAt)` | `lock()` / `unlock()` / constructor. |
| `DestinationAllowed(address indexed destination)` | Destination added to the allowlist. |
| `DestinationDisallowed(address indexed destination)` | Destination removed from the allowlist. |

### Errors

| Error | Raised when |
|---|---|
| `NotAdmin(address caller)` | A non-admin calls a configuration function. |
| `ZeroAdmin()` | Admin is set to the zero address. |
| `ZeroDestination()` | The zero address is allowlisted. |
| `UnlockAtNotInFuture(uint64 unlockAt)` | `lock()` is called with a timestamp not in the future. |
| `DestinationNotAllowed(address destination)` | Locked value transfer to a non-allowlisted destination. |

### Access control summary

- All configuration is gated by the `onlyAdmin` modifier.
- `checkTransaction` is intentionally permissionless; it is a policy check with
  no state effect. It does not verify that `msg.sender` is the guarded Safe,
  because the guard does not store the Safe address (see section 7).

## 5. Invariants protected by the tests

Test source: `packages/contracts/test/KadeLock.t.sol` and
`test/KadeLockSafeIntegration.t.sol`.

| ID | Invariant | Tests |
|---|---|---|
| I1 | Locked: positive native value to a non-allowlisted destination reverts. | `test_LockBlocksOutboundValueBeforeUnlockAt`, `test_RejectedDestinationRevertsBeforeUnlockAt`, `test_RejectedDestinationRevertsForAnyPositiveValue`, `test_IntegrationValueToRejectedDestinationIsBlockedBeforeUnlock` |
| I2 | Locked: positive native value to an allowlisted destination succeeds. | `test_PermittedDestinationAllowsValueBeforeUnlockAt`, `test_IntegrationValueToAllowedDestinationMovesBeforeUnlock` |
| I3 | Locked: zero-value calls are not blocked. | `test_LockAllowsZeroValueTransfersBeforeUnlockAt` |
| I4 | At or after `unlockAt` the lock no longer blocks. | `test_PostUnlockBehaviourLockNoLongerBlocks`, `test_PostUnlockBehaviourAnyDestinationSucceeds`, `test_IsLockedIsFalseAtExactUnlockBoundary`, `test_IntegrationValueMovesAfterUnlock` |
| I5 | Only the admin can configure; anyone else reverts. | `test_UnauthorizedConfigurationChangesAreRejected`, `test_UnauthorizedSetAdminReverts`, `test_UnauthorizedLockReverts`, `test_UnauthorizedUnlockReverts`, `test_UnauthorizedAllowDestinationReverts`, `test_UnauthorizedDisallowDestinationReverts` |
| I6 | The admin can add and remove allowlist entries; removal re-blocks. | `test_AdminCanConfigureAllowlistAndUnlockTime`, `test_PermittedDestinationCanBeRemovedBeforeUnlockAt`, `test_DisallowDestinationEmitsEvent` |
| I7 | `unlockAt` is the single source of truth: `unlock()` sets it to now, `lock()` requires the future, and a lock can be re-engaged. | `test_UnlockControlMovesUnlockAtToNow`, `test_LockControlExtendsTheLock`, `test_LockControlRejectsTimestampInThePast`, `test_UnlockedLockCanBeReEngagedByAdmin` |
| I8 | The contract advertises the Guard and ERC-165 interfaces. | `test_SupportsGuardAndErc165Interfaces` |
| I9 | `checkAfterExecution` is a callable no-op. | `test_CheckAfterExecutionIsCallableAndDoesNotRevert` |
| I10 | Constructor input validation and admin transfer. | `test_ConstructorRejectsZeroAdmin`, `test_ConstructorRecordsAdminAndUnlockAt`, `test_SetAdminRejectsZeroAddress`, `test_AdminSetAdminTransfersConfigurationAuthority` |
| I11 | Allowlisting the zero address is rejected. | `test_AllowDestinationRejectsZeroAddress` |
| I12 | Configuration changes emit their events. | `test_AllowDestinationEmitsEvent`, `test_DisallowDestinationEmitsEvent`, `test_UnlockEmitsUnlockAtChanged` |

### Test evidence

```bash
cd packages/contracts
forge build
forge test
```

Expected: `forge build` succeeds; `forge test` reports 33 passed across
`KadeLockTest` (30) and `KadeLockSafeIntegrationTest` (3).

## 6. Explicitly out of Week 1 scope

The development contract excludes the following from the minimum model (D7 and
section 9). They are **not** implemented and **not** tested:

- **Compliance co-signing** (the build guide's 2-of-2 withdrawal model).
- **Cure-event behaviour** when the cross-chain qualified sum falls below tier.
- **Bypass tests** — explicitly outside the Week 1 minimum model.
- Token/ERC-20 value enforcement and arbitrary call-data inspection.
- Delegatecall value extraction and other guard bypass analysis.
- Guard installation (`setGuard`), guard removal, and Safe recovery.
- KadeLock deployment, EAS registration, and the off-chain indexer.
- Upgradability or a timelock on admin actions.

## 7. Known limitations and residual risks

| ID | Risk | Impact |
|---|---|---|
| R1 | **Native value only — the largest limitation.** ERC-20 transfers call the token contract, so `to` is the token, not the recipient, and `value == 0` calls are never blocked. USDC movement is not destination-restricted. | This is why KadeLock is described as a demonstration of the mechanism, not as asset protection. It is the first item for the production version: see the *Future improvement* note in section 1. |
| R2 | **Delegatecall.** A locked Safe can move value through a delegatecall payload the guard does not inspect. | Bypass; bypass tests are out of scope per D7. |
| R3 | **Admin compromise.** A compromised admin can unlock or reconfigure the lock; there is no timelock or second signer. | Weakens the lock by design. |
| R4 | **Single source of truth is a timestamp.** Validator clock manipulation shifts the boundary within a small window. | Low precision, not a full bypass. |
| R5 | **No caller check.** `checkTransaction` does not verify `msg.sender` is the guarded Safe; the Safe address is not stored. | Only matters if the guard is used outside its intended Safe; no state effect. |
| R6 | **Not deployed.** The tests exercise the guard hook directly and through a mock host, not a real Safe. End-to-end Safe wiring is a later milestone. | Integration untested beyond the hook contract. |
| R7 | **No pause / no per-asset limits.** The model has no emergency stop. | Recovery relies on Safe ownership. |

## 8. `[arbitrary]` values awaiting the Onchain gate

Every value not fixed by the governing documents is `[arbitrary]` and must be
confirmed at the matching human gate. The Onchain gate is checkpoint 3 in
`week-1-frozen-delivery-contract.md` section 7.

| Value | Where | Why arbitrary | Gate |
|---|---|---|---|
| Admin address | `KadeLock` constructor | No source names it. | Onchain gate |
| Initial `unlockAt` / lock duration | `KadeLock` constructor | No source states a duration. | Onchain gate |
| Allowlist entries | runtime config | The build guide names categories, not addresses. | Onchain gate + project |
| Single-admin role model | design | No source defines guard roles. | Onchain gate |
| `solc_version = 0.8.24` | `foundry.toml` | Not specified. | Onchain gate |
| `forge-std` v1.16.2 | `lib/` | Not specified. | Onchain gate |
| `safe-smart-account` v1.4.1 | `lib/` | The Safe version is itself `[arbitrary]` in `@kade/shared` (`safe.ts`). | Account gate |
| EAS field types / encodings | `@kade/shared`, surfaced in the manifest | `@kade/shared` marks types `arbitrary`. | Onchain gate |
| EAS `revocable` and `resolver` | `@kade/shared`, surfaced in the manifest | `arbitrary`. | Onchain gate |
| EAS `attester = 'kade-authorized'` | `@kade/shared`, surfaced in the manifest | Not resolved to an on-chain address. | Onchain gate |
| EAS `recipient` | `@kade/shared`, surfaced in the manifest | Partly `documented`, partly `arbitrary`. | Onchain gate |
| Predicted schema UIDs | registration planner output | Derived from the unregistered encodings; informational only. | Onchain gate |
| `SEPOLIA_RPC_URL` | environment | Provider not specified; read-only use. | Foundation / ops |

Documented (not arbitrary): chain id `11155111`, the five schema names, the fee
model, and the Safe threshold/ownership model from D4.

## 9. Onchain gate review checklist

- [ ] Confirm model A (minimum Guard/Module) per section 6.2.
- [ ] Approve the external interface in section 4.
- [ ] Decide whether native-value-only enforcement (R1) is acceptable for
      Week 1, given the USDC-centric product model.
- [ ] Decide the Admin address and whether it should equal the Safe owner.
- [ ] Approve the allowlist categories and their concrete addresses.
- [ ] Approve the exact EAS encodings, revocability, resolver, attester and
      recipient surfaced in `eas/eas-schema-manifest.json`.
- [ ] Approve the pinned Solidity and dependency versions.
- [ ] Re-affirm that KadeLock is not deployed and EAS is not registered in
      Week 1.
