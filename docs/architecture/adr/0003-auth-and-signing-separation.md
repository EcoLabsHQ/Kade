# ADR 0003 — Authentication and signing separation

**Status:** accepted · 17 September 2026
**Refs:** week-1 contract section 2 items 2–6, section 4 (D3), Appendix B.1, B.3

## Context

The DOCX (Step 1) says "Email + passkey, or an existing wallet". The Week 1
contract overrides this and records the resolution in Appendix B.1:

- Google OAuth through Supabase is the **only** application login.
- No email OTP fallback.
- The passkey is **separate** from the login session and authorises Safe
  transactions only.
- Google credentials **cannot** authorise financial transactions.
- The signer is the **direct Safe WebAuthn signer**; no managed embedded signer
  (Privy, Turnkey) in Week 1.
- The resident Safe has one operational owner — the passkey — and threshold 1.
  No user EOA is an owner.

## Decision

Model the two authorities as distinct types that cannot be substituted:

```text
ApplicationSession    { domain: 'application-session', provider: 'google', userId, email }
TransactionAuthorisation { domain: 'transaction-signing', method: 'passkey', credentialId }
```

- A single `LOGIN_PROVIDER = 'google'` constant is the only permitted provider,
  with `EXCLUDED_LOGIN_PROVIDERS` recording what is deliberately not offered.
- `assertSessionCannotAuthoriseTransaction()` is a type-guard: passing a session
  to the signing path is a compile error where possible and a runtime throw
  everywhere else.
- `assertLoginDoesNotRequirePasskey()` fails if the sign-in flow acquires a
  WebAuthn step. This encodes D3's "login does not prompt for a passkey" as an
  executable check.
- Passkey enrolment requires user verification and is reachable only from an
  authenticated session.
- Credential metadata (credential id, public key, derived signer address,
  transports) is stored server-side and re-read on reload. The private key never
  leaves the authenticator.

## Consequences

- A regression that couples login to the passkey, or that lets a Google session
  reach the signing path, fails a test rather than shipping.
- The Supabase session is an *application* credential. It grants access to
  rows the RLS policy allows; it grants no on-chain authority.
- Because there is no managed signer, the WebAuthn signer address is a
  deployment input and is frozen with the rest of D4's inputs.

## Alternatives considered

- **Privy / Turnkey embedded signer** — rejected by contract section 2 item 5.
- **Passkey at login (passkey as the primary credential)** — rejected; contract
  section 2 item 3 requires the passkey to be a separate transaction authority
  and D3 requires that login not prompt for it.
- **A single combined "authenticated + signer" object** — exactly the coupling
  the contract forbids.
