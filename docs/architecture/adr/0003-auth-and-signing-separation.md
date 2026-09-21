# ADR 0003 — Authentication and signing separation

**Status:** accepted · 17 September 2026
**Refs:** week-1 contract section 2 items 2–6, section 4 (D3), Appendix B.1, B.3

## Context

> **Amended by contract v1.2.** The contract originally permitted Google OAuth
> only; it now also permits email magic link. See section 8.2 of
> `docs/week-1-frozen-delivery-contract.md`.

The DOCX (Step 1) says "Email + passkey, or an existing wallet". The Week 1
contract overrides this and records the resolution in Appendix B.1:

- Google OAuth and email magic link through Supabase are the permitted
  application logins (contract v1.2, section 8.2). Password authentication and
  wallet login are excluded.
- The passkey is **separate** from the login session and authorises Safe
  transactions only.
- Session credentials **cannot** authorise financial transactions, whichever
  provider issued them.
- The signer is the **direct Safe WebAuthn signer**; no managed embedded signer
  (Privy, Turnkey) in Week 1.
- The resident Safe has one operational owner — the passkey — and threshold 1.
  No user EOA is an owner.

## Decision

Model the two authorities as distinct types that cannot be substituted:

```text
ApplicationSession    { domain: 'application-session', provider: LoginProvider, userId, email }
TransactionAuthorisation { domain: 'transaction-signing', method: 'passkey', credentialId }
```

- `LOGIN_PROVIDERS = ['google', 'email']` lists the permitted providers, with
  `EXCLUDED_LOGIN_PROVIDERS` recording what is deliberately not offered
  (password, wallet, SAML, phone). Email is used for magic links only; there is
  no password field. The set was widened from Google-only by contract v1.2
  (section 8.2); the separation below is unchanged by that, because it is a
  property of the session, not of the provider.
- `assertSessionCannotAuthoriseTransaction()` is a type-guard: passing a session
  to the signing path is a compile error where possible and a runtime throw
  everywhere else.
- `assertLoginDoesNotRequirePasskey()` fails if the sign-in flow acquires a
  WebAuthn step. This encodes D3's "login does not prompt for a passkey" as an
  executable check.
- Passkey enrolment requires user verification and is reachable only from an
  authenticated session.
- Credential metadata (credential id, public key, transports, whether user
  verification was required, and the derived signer address) is held
  server-side. The credential id, public key, transports and user-verification
  flag are written to `passkey_credentials` and survive a reload; the derived
  `signer_address` is written by `public.save_passkey_signer`, a SECURITY
  DEFINER function scoped to the caller's own credential, so no service-role key
  is involved. It was previously written only when `SUPABASE_SERVICE_ROLE_KEY`
  was configured. The private key never leaves the authenticator.

## Consequences

- A regression that couples login to the passkey, or that lets a session from
  either provider reach the signing path, fails a test rather than shipping.
- The Supabase session is an *application* credential. It grants access to
  rows the RLS policy allows; it grants no on-chain authority.
- Because there is no managed signer, the WebAuthn signer is a contract derived
  from the resident's own passkey. Its address is computed from the credential,
  not configured, so it arrives with the resident rather than with the
  deployment.

## Alternatives considered

- **Privy / Turnkey embedded signer** — rejected by contract section 2 item 5.
- **Passkey at login (passkey as the primary credential)** — rejected; contract
  section 2 item 3 requires the passkey to be a separate transaction authority
  and D3 requires that login not prompt for it.
- **A single combined "authenticated + signer" object** — exactly the coupling
  the contract forbids.
