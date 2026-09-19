# Account step, and the account address derived from the passkey

Seventh iteration report for the Kade Week 1 build. Covers the work from
`08819b8` (the current `known-good`) to `4326f0c` (this commit).

| | |
|:--|:--|
| `known-good` (unchanged) | `08819b8` |
| Candidate `HEAD` | `4326f0c` |
| Window (local time) | 18 September 2026 |
| Commits since `known-good` | 21 |
| Change size | 72 files, +5,472 / −751 |
| Mechanical gate | `./scripts/verify.sh` — passed: web 132 · shared 68 · acceptance 12 · regressions 4 · Foundry 45 |
| Adversarial review | **failed, then corrected** — see section 4 |

## 1. What was requested

1. Findings on why the deployed app was not working end to end.
2. Use passkeys for Safe creation (or address calculation) in the UI, deriving
   the address over RPC.
3. Make the account step feel like a normal product screen — no disclaimers, no
   warnings, no internal copy.
4. Finish, push, and write this summary.

## 2. The account step reads like a product screen

The step had been written as a status report, carrying internal vocabulary into
the UI, and a successful passkey was rendered through `AccountSummary`'s *error*
state — so the resident's first completed action earned a red "Needs attention"
badge.

| Before | After |
|:--|:--|
| Red "Needs attention" badge on success | Green check, "Passkey created" |
| "Transaction passkey created with user verification" | "Passkey created" |
| Raw credential id printed | Not shown |
| Paragraph explaining the Account gate | Not shown |

The step now shows the resident's **account address** once the passkey exists. A
counterfactual address is the normal state of a Safe before its first
transaction, not a claim that a contract is on chain. If the chain cannot be
reached the passkey still succeeds and the address is simply not shown, because
the passkey exists either way.

Steps 3 and 4 keep their demo labels: those steps genuinely do not touch a
chain, which is a different thing from explaining an internal gate.

## 3. The account address is derived from the passkey

```text
credential public key → P-256 (x, y) → signer address → Safe address
```

- **P-256 parsing.** The credential's `publicKey` (SubjectPublicKeyInfo,
  base64url) is parsed to its coordinates by a pure function that refuses
  anything which is not an uncompressed P-256 key rather than guessing.
- **Signer address.** `SafeWebAuthnSignerFactory.getSigner` is called through a
  server action, so the RPC provider key stays server-side.
- **Safe address.** Frozen inputs from `@kade/shared`, plus the salt nonce
  `keccak256(userId)`.

The passkey module addresses had been labelled `[arbitrary]`. They are now
confirmed and marked `[external]`. An earlier probe of mine concluded the factory
did not expose `getSigner`; the probe was wrong — the third parameter is
`P256.Verifiers`, a packed `uint176`, not a `uint256`.

## 4. The review found a real defect, and it was mine

The derivation was wrong. It computed CREATE2 over `SAFE_PROXY_CREATION_CODE`,
which is **this repository's** build of `SafeProxy` — 649 bytes, solc 0.8.24 —
while the deployed v1.5.0 factory returns **438 bytes** from
`proxyCreationCode()`. The creation code is part of the CREATE2 digest, so the
address shown to the resident was one that factory will never deploy.

It was convincing because it was self-consistent: the Foundry test pins our own
artifact, and viem's `getContractAddress` agreed with our arithmetic. Both used
the same wrong input. **Cross-checking an implementation does not validate a
constant** — which is the lesson worth keeping from this iteration.

Fixed by applying the reasoning already used for the signer: ask the contract
that will do the work. `deriveAccount` now reads `proxyCreationCode()` from the
factory and `getSigner` from the signer factory, then runs the frozen arithmetic.
Verified against the chain — with the factory's own creation code our arithmetic
reproduces `createProxyWithNonce`'s returned address exactly
(`0x3e8cD8C29a32912f7E6e659c6f8645e4f178A9bb`).

A regression test now asserts the two hashes do not converge, so the failure
cannot return quietly.

The same review also found the flow test claiming a signer address that did not
correspond to the key it named, and three contract documents still describing the
Safe inputs as unapproved. Both corrected.

## 5. Review history and the process question

Earlier in this iteration the review failed five times, all one class: stale
claims left behind when Safe moved to v1.5.0 and Arbitrum was dropped (contract
v1.6). Root cause was process — sweeps done with `grep`, once silently truncated
by `head`. The reviewer's own note is the important one: *no test asserts
documentation truth*, so nothing mechanical catches that class. Escalated to the
owner under the circuit breaker; one further corrective iteration was authorised
and applied.

That class is now largely closed, but this report does not claim it is perfectly
closed — the sweep is still manual.

## 6. Open decisions

| Decision | Options |
|:--|:--|
| Salt nonce strategy | Implemented as `keccak256(userId)` and **declared as proposed, not approved**. It fixes every resident's address, so confirm at the Account gate before anything is deployed |
| The creation-code pin | `SafeAddress.t.sol` pins our own build. It tests our artifact, not the deployment. Now stated in the test, the README and the shared constant |
| Deployment | Nothing is deployed; all four gates are unapproved |

## 7. Verification

```text
./scripts/verify.sh  →  exit 0
web 132 · shared 68 · acceptance 12 · regressions 4 · Foundry 45
```

- `known-good` unmoved at `08819b8`. No on-chain write; all four gates unapproved.
- The RPC provider key supplied by the owner is **not** in any tracked file; it
  lives in the gitignored `apps/web/.env.local` and is read server-side only.
- Demo database reset to base state.

## 8. Files added or changed

| File | Change |
|:--|:--|
| `apps/web/src/lib/passkey/public-key.ts` | P-256 SPKI → `(x, y)`, new |
| `apps/web/src/lib/safe/account.ts` | Account derivation; creation code is an input, new |
| `apps/web/src/app/onboarding/signer-actions.ts` | Server action reading the two contracts, new |
| `apps/web/src/components/onboarding/AccountSetupStep.tsx` | Product-screen rewrite; shows the account address |
| `packages/shared/src/safe-deployments.ts` | Passkey module `[external]`; local vs deployed creation code recorded |
| `apps/web/tests/p256-public-key.test.ts` | New, with an OpenSSL-generated vector |
| `apps/web/tests/safe-account.test.ts` | New, golden vector + regression guard |
| `docs/known-gaps.md`, `docs/gates/account.md` | Derivation, salt strategy, creation-code mismatch |
