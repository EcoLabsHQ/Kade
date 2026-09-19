# Gate 2 — Account

**Approves:** authentication separation, the passkey implementation, the Safe
initializer, and the deterministic deployment inputs.
**Blocks:** deploying the resident Safe on Ethereum Sepolia.

## Decision requested

Two things:

1. Confirm the authentication and passkey design (no input needed from you
   beyond agreement).
2. **Supply or confirm the Safe deployment inputs and the Sepolia payer.** These
   are a project-supplied dependency (contract section 5) and are deliberately
   *not* invented by the agent.

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
| The address does not depend on the chain id | `test_AddressIsIndependentOfChainId` — D4 requires one address on three chains |
| The D4 record shape exists | `packages/contracts/safe/SafeDeploymentManifest.schema.json`, with an all-`[arbitrary]` example carrying `provenance: unapproved` |

## What I need from you

None of these is in the DOCX, and I could not retrieve Safe's official
per-version address table, so **I have not guessed them**:

| Input | Note |
|---|---|
| Safe version | **Decided: v1.5.0** (contract v1.6), pinned in `scripts/setup.sh` and recorded with its code hashes in `@kade/shared`. The addresses are no longer needed from the project. |
| Proxy factory address | Supply, or approve fetching them from Safe's published deployments |
| Singleton address | " (SafeL2 if the L2 event variant is wanted) |
| Compatibility fallback handler address | " |
| WebAuthn signer implementation | The direct Safe WebAuthn signer. Confirm the signer-factory approach, which derives the signer address from the passkey's public key at enrolment. |
| Salt nonce strategy | What makes each resident's address unique. |
| Sepolia deployment payer | A funded account, or a decision to deploy from your side. |

> **Note:** the signer address itself is **not** an input. With the direct Safe
> WebAuthn signer it is derived from the credential's public key when the passkey
> is enrolled, so it arrives with the resident, not with the configuration.

## What is not proven

- **Any deployment.** No Safe exists on any chain. `chain.kadelock_address` and
  the manifest examples are `null` / `[arbitrary]`.
- **A signature validating through the signer.** Requires the signer address,
  which requires the deployment above.
- **Passkey metadata persisting across a reload.** Still an in-memory seam; it is
  not written to the database.

## What approval authorises

Deploying one resident Safe on **Ethereum Sepolia**, and recording the D4
manifest: the transaction, the address, the predicted Arbitrum Sepolia and Base
Sepolia addresses, and the inputs that produced them.

## What approval does not authorise

- Any mainnet deployment.
- Deploying the Safe on Arbitrum or Base (predicted only, in Week 1).
- EAS registration (gate 3).
- Deploying KadeLock (out of Week 1 scope).

## Approval record

_Not yet recorded._
