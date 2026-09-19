# Account step, and the passkey signer path

Seventh iteration report for the Kade Week 1 build. Covers the work from
`08819b8` (the current `known-good`) to `82a8e8c` (this commit).

| | |
|---|---|
| `known-good` (unchanged) | `08819b8` |
| Candidate `HEAD` | `82a8e8c` |
| Window (local time) | 18 September 2026 |
| Commits since `known-good` | 18 |
| Change size | 65 files, +4,667 / −733 |
| Mechanical gate | `./scripts/verify.sh` — passed |
| Adversarial review | **not passed** — see section 4 |

> **Status: not promoted.** `known-good` has deliberately not moved. The
> remaining blocker is described in section 4 and needs a human decision.

## 1. What was requested

Four things, in sequence:

1. Findings on why the deployed app was not working end to end.
2. Use passkeys for Safe creation (or at least address calculation) in the UI.
3. Make the account step feel like a normal product screen — no disclaimers, no
   warnings, no internal copy.
4. Finish, push, and write this summary.

## 2. The account step now reads like a product screen

The step had been written as a status report. It carried internal vocabulary
into the UI: "transaction passkey created with user verification", the raw
credential id, and a paragraph explaining that the Safe factory, singleton,
fallback handler and salt nonce were project-supplied and awaiting the Account
gate. A successful passkey was also rendered through `AccountSummary`'s error
state, so the resident's first completed action earned a red **"Needs
attention"** badge.

Creating a passkey is the ordinary path, so the screen now behaves like one:

| Before | After |
|:--|:--|
| Red "Needs attention" badge on success | Green check, "Passkey created" |
| "Transaction passkey created with user verification" | "Passkey created" |
| Raw credential id printed | Not shown |
| Paragraph explaining the Account gate | Not shown |

The Safe address is still not shown and still not invented — it is simply not
discussed on this step. The gate vocabulary is an internal matter, and the
address belongs to the account once the account exists. Saying so told the
resident about our approval process rather than about their account.

Two things were left deliberately:

- **Steps 3 and 4 keep their demo labels.** Those steps genuinely do not touch a
  chain, which is a different thing from explaining an internal gate, and the
  contract treats presenting mock state as real as blocking at any maturity.
- **The absence of the caveat is recorded in `docs/known-gaps.md`**, so its
  removal reads as a decision rather than as an oversight.

The test that pinned the old copy now asserts the guarantee instead: no
address-shaped string is rendered, and no internal gate language appears.

## 3. The passkey signer path — verified, not yet wired

The passkey step creates a real WebAuthn credential, but the Safe address could
not be computed: the signer address was an unresolved sentinel.

That is now unblocked, and the cause was an error of mine. The recorded passkey
module addresses were labelled `[arbitrary]` in `safe-deployments.ts`, and my
first probe found the factory did not expose `getSigner`. **The probe was
wrong**: the third parameter is `P256.Verifiers`, a `uint176`, not `uint256`.
With the correct selector the real interface answers.

| Fact | Evidence |
|:--|:--|
| `0x1d31F259…1195` is `SafeWebAuthnSignerFactory` | Dedaudb decompiles it as such; a chain registry lists it as v0.2.1; it answers `getSigner(uint256,uint256,uint176)` |
| `0xc2b78104…4De4` is `DaimoP256Verifier` v0.2.1 | Same registry; it has code on Sepolia |
| The derivation is reproducible | `getSigner` returns exactly the CREATE2 address computed from the pinned creation code |

Running the whole chain with the P-256 generator point as a stand-in key:

```text
signer (on-chain getSigner): 0x8d36E6FF7e49e1b665c0b83B5394606bEed804A9
safe   (predicted)         : 0x9E183D76fE72821b4fF7268b9dE79ec380FFd420
creation-code hash         : 0xa547798e…adc906cf   ← matches the pinned Foundry constant
```

So `passkey → signer address → Safe address` resolves. It is **not yet wired
into the UI**; that needs the decision in section 5, and it is new scope, so it
belongs to its own iteration.

**Correction worth recording:** the passkey module addresses are `[external]`,
not `[arbitrary]`. The code under-claims.

## 4. Review status — the outstanding blocker

This iteration has failed adversarial review five times, all on one class: stale
claims left behind when the Safe version moved to v1.5.0 and Arbitrum was
dropped from the active chain set.

The last failure is a single fixture in `packages/shared/tests/safe.test.ts`,
where a three-chain fixture was labelled "every active chain". The root cause of
the repeated failures was process, not any one file: the sweep was done with
`grep` and, on one attempt, silently truncated by `head`. The reviewer's own
note is the key one — *"no test asserts documentation truth"* — so nothing
mechanical catches this class.

This was escalated to the owner under the circuit breaker, who authorised one
further corrective iteration (since applied) and asked to review before the
reviewer runs again.

## 5. Open decisions

| Decision | Options |
|:--|:--|
| How to derive the signer address | Call the deployed factory's `getSigner` over RPC (authoritative; needs a Sepolia RPC URL in the web app, none configured) — or pin the passkey module in Foundry and compute offline |
| When to build it | Now, joining this review diff — or as its own iteration after this one is promoted |
| The review failure | Authorise a fourth corrective iteration, promote with the fixture declared as a gap, or change-control a mechanical guard for this claim class |

## 6. Verification

```text
./scripts/verify.sh  →  exit 0
web 117 · shared 68 · acceptance 12 · regressions 4 · Foundry 45
```

- `known-good` unmoved at `08819b8`.
- No Safe deployed; no on-chain write; all four approval gates unapproved.
- Demo database reset to base state.
- Dev server was run locally to confirm the step renders; not left as a
  committed artifact.

## 7. Files changed in this commit

| File | Change |
|:--|:--|
| `apps/web/src/components/onboarding/AccountSetupStep.tsx` | Rewritten as a product screen |
| `apps/web/tests/onboarding-flow.test.tsx` | Asserts the guarantee rather than the old copy |
| `docs/known-gaps.md` | Records the removed caveat as a decision |
