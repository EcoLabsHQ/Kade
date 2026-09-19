# Gate 2 — Account

**Approves:** authentication separation, the passkey implementation, the Safe
initializer, and the deterministic deployment inputs.
**Blocks:** deploying the resident Safe on Ethereum Sepolia.

## Decision requested

Two things:

1. Confirm the authentication and passkey design (no input needed from you
   beyond agreement).
2. **Supply the Sepolia deployment payer, and confirm the salt nonce strategy.**
   The Safe version, its addresses and the signer derivation are now recorded
   rather than project-supplied. The payer is still yours to provide, and the
   salt nonce (`keccak256(userId)`) is proposed rather than approved, because it
   fixes every resident's address.

## What is already proven

| Requirement | Evidence |
|---|---|
| A session, from Google or email magic link, reaches the app and is never the signer | `docs/architecture/adr/0003-auth-and-signing-separation.md`; `assertSessionCannotAuthoriseTransaction` refuses a session, tested |
| Sign-in does not prompt for a passkey (D3) | `assertPermittedSignIn` calls `assertLoginDoesNotRequirePasskey`; `login-flow.test.tsx` asserts `navigator.credentials` is never touched on either path |
| Google sign-in works end to end | Completed by the project owner; the redirect boundary was verified by the agent (`/auth/v1/authorize` → 302 to Google with the project's own callback) |
| Email magic link is implemented | `SignInPanel` posts `signInWithOtp`; delivery not yet observed |
| A passkey can be enrolled with user verification | `lib/passkey/enrolment.ts`; `assertUserVerification` rejects an enrolment without it |
| The Safe address is derivable and deterministic | `packages/contracts/src/SafeAddress.sol`, 12 Foundry tests including a pinned vector cross-checked three ways |
| Changing any input changes the address | `test_Changing*ChangesAddress` (factory, singleton, initializer hash, salt, creation code) |
| The address does not depend on the chain id | `test_AddressIsIndependentOfChainId` — D4 requires one address on every active chain |
| The D4 record shape exists | `packages/contracts/safe/SafeDeploymentManifest.schema.json`, with a placeholder example carrying `provenance: unapproved` |

## What I need from you

**Resolved.** The version and every address now come from Safe's own published
deployments and are recorded in `@kade/shared` (`safe-deployments.ts`) with their
code hashes, so none of them has to be supplied by hand. What remains genuinely
open is below.

| Input | Note |
|---|---|
| Safe version | **Decided: v1.5.0** (contract v1.6), pinned in `scripts/setup.sh` and recorded with its code hashes in `@kade/shared`. The addresses are no longer needed from the project. |
| ~~Proxy factory address~~ | Recorded from Safe's deployments (v1.5.0: `0x14F2982D601c9458F93bd70B218933A6f8165e7b`). |
| ~~Singleton address~~ | Recorded (SafeL2 v1.5.0: `0xEdd160fEBBD92E350D4D398fb636302fccd67C7e`). |
| ~~Compatibility fallback handler~~ | Recorded (v1.5.0: `0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4`). |
| WebAuthn signer implementation | The direct Safe WebAuthn signer. **Resolved:** the factory address is confirmed (not `[arbitrary]`), and the signer address is derived by calling its `getSigner(uint256,uint256,uint176)` view through a server action. The repository no longer reproduces the module's arithmetic locally. |
| Salt nonce strategy | **Proposed for approval:** `keccak256(resident id)`, so each resident's address is stable and distinct without a server-side counter. Implemented in `apps/web/src/lib/safe/account.ts`; confirm before the first deployment, since it fixes every resident's address. |
| Sepolia deployment payer | A funded account, or a decision to deploy from your side. |

> **Note:** the signer address itself is **not** an input. With the direct Safe
> WebAuthn signer it is derived from the credential's public key when the passkey
> is enrolled, so it arrives with the resident, not with the configuration.

## What is not proven

- **Any deployment.** No Safe exists on any chain. `chain.kadelock_address` and
  the manifest examples carry placeholders.
- **A signature validating through the signer.** Requires the signer address,
  which requires the deployment above.
- **Passkey metadata persisting across a reload.** Still an in-memory seam; it is
  not written to the database.

## What approval authorises

Deploying one resident Safe on **Ethereum Sepolia**, and recording the D4
manifest: the transaction, the address, the predicted Base Sepolia address, and
the inputs that produced them.

## What approval does not authorise

- Any mainnet deployment.
- Deploying the Safe on Base Sepolia (predicted only in Week 1), or on Arbitrum
  (deferred by contract v1.6).
- EAS registration (gate 3).
- Deploying KadeLock (out of Week 1 scope).

## Approval record

_Not yet recorded._
