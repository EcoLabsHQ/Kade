# Live Supabase and login methods — iteration report

Third iteration report for the Kade Week 1 build. Covers the work that turned
the project from a verified-in-isolation scaffold into an application wired to a
real Supabase project, and that widened the permitted login methods.

| | |
|---|---|
| Previous `known-good` | `5efe3d4` |
| Window (local time) | 17–18 September 2026 |
| Mechanical gate | `./scripts/verify.sh` — passed |
| Supabase project | `vdziemuadrkwvjuznwzi` |

## 1. What was requested

1. Connect to the project's Supabase project and set it up.
2. Report which Supabase projects were reachable.
3. Implement login: Google OAuth, or email magic link if Google was impractical.

## 2. The Supabase project is now real

The project was empty when reached over MCP: 0 tables, 0 migrations, only
PostgreSQL's default extensions.

**Applied:** all 10 migrations, in order, then the generated seed. The RLS
migration's own guard — which raises if any `public` table is left without row
level security — did not fire, which is the migration confirming itself.

**Verified against the live database, not asserted:**

| Check | Result |
|---|---|
| `preapproval_fee_usdc('demo', 3)` | **1.75** |
| `preapproval_fee_usdc('production', 3)` | **447** |
| `preapproval_fee_usdc('demo', 4)` / `('production', 1)` | 2.00 / 335 |
| Tables | 17, **RLS enabled on all 17** |
| Deny-by-default tables | 10, each with 0 policies |
| Owner tables | `profiles` 3 policies, `applications` 3, the rest 1 each |
| Seed | 6 chain rows, 4 fee rows |
| Trigger on application insert | 1.25 (household size 1) |
| Trigger after adding 2 members | **1.75** (household size 3) |

The trigger was exercised with a real fixture — auth user, profile, application,
household members — and then **deleted**. Confirmed afterwards: 0 fixture rows
remaining, seed rows intact.

`pgtap` is available on the project, so the fee suite can run there rather than
only against a local Docker Postgres.

## 3. The environment file was in the wrong place

Wiring the app exposed a real trap. `.env.example` told the reader to copy it to
`.env.local`, and that file was created at the repository root — where **Next.js
never looks**. Next loads env files from its own project directory, so the app
kept rendering "Authentication not configured" while a perfectly good
`NEXT_PUBLIC_SUPABASE_URL` sat one directory away.

The instructions now say `apps/web/.env.local`, and the variable comments record
which side reads what (the web app from that file; the scripts from the shell).

After the move the app reports Supabase as configured: `/login` shows an enabled
sign-in button, and `/` redirects to `/login?next=%2F` rather than
`?reason=not-configured`.

## 4. Login methods — contract v1.2

The project owner directed that login permit **Google OAuth and email magic
link**. That contradicts the frozen contract, which said Google was the only
login with no email fallback, so the contract was amended rather than quietly
diverged from.

`docs/week-1-frozen-delivery-contract.md` is now **v1.2**, with section 8.2
recording the change and a before/after table for section 2 item 2, the freeze
checklist and Appendix B.1.

What the amendment explicitly does **not** change:

- the passkey remains the only transaction authority, and sign-in still must not
  prompt for one (D3);
- a session from either provider confers row access and nothing else, and cannot
  authorise a transaction — that separation, not the provider's identity, is the
  property the contract protects;
- the resident Safe still has exactly one owner and threshold 1, with no EOA.

Password authentication and wallet login remain excluded.

The rationale is recorded: a single-provider login keyed to a Google Cloud client
was a demo risk, mail delivery runs on the project's own SMTP (Resend) rather
than Supabase's rate-limited built-in mailer, and the design handoff's own Step 1
was email-based — so this restores the baseline rather than departing from it.

## 5. What changed in the code

| Area | Change |
|---|---|
| `@kade/shared` | `LOGIN_PROVIDERS = ['google', 'email']`; excluded set is now `password`, `wallet`, `saml`, `phone` |
| `lib/auth/provider.ts` | `assertPermittedSignIn` replaces the Google-only guard; the D3 invariant (no passkey at sign-in) is unchanged |
| `lib/auth/providers.ts` | Probes the project for both providers; reports `true` / `false` / `null` per method |
| `lib/auth/session.ts` | Derives the session provider from Supabase metadata, with a documented fallback |
| `SignInPanel` | Google button plus an email magic-link form, confirmation state, and `noValidate` so the app's own validation runs |
| `LoginScreen` / login page | Threads provider status; the notice now covers "no method enabled" |

### 5.1 The app can now see a disabled provider

Previously, with Supabase configured but the provider disabled, clicking the
button dropped the resident on Supabase's raw
`{"code":400,"error_msg":"Unsupported provider: provider is not enabled"}`.

The app now asks the project first and renders an explicit
"No sign-in method is enabled" notice naming the fix, with the button disabled.
It **fails open**: if the probe cannot reach the project, the attempt is allowed,
because an unreachable probe is not evidence that sign-in is impossible.

### 5.2 A latent test bug, fixed

`vitest.setup.ts` did not register React Testing Library's cleanup. With
`globals: false`, RTL's automatic cleanup never installs, so renders accumulate
in the same jsdom document and a later test can match elements left behind by an
earlier one — passing against the wrong render, or failing with "found multiple
elements".

Scope, stated precisely: the three test files that already called `render` at
the previous `known-good` happened to register `cleanup` themselves, so no DOM
actually leaked before this change. The new `auth-providers.test.tsx` did not,
which is how the gap surfaced. The fix registers cleanup once in
`vitest.setup.ts` and applies it to every file, present and future.

## 6. Verification

`./scripts/verify.sh` — all nine gates pass.

| Suite | Tests |
|---|---|
| `apps/web` unit | 100 |
| `packages/shared` unit | 61 |
| Acceptance | 12 |
| Regression | 4 |
| Foundry | 45 |

177 JavaScript tests plus 45 Foundry tests. Unit tests grew from 142 (100 web
+ 61 shared, was 81 + 61) because the login surface gained the magic-link path
and its failure modes; the JavaScript total is 177, up from 158.

## 7. Both providers are now enabled

The Google provider was disabled when this work started, which the app now
detects and reports rather than failing into raw JSON. The project owner enabled
it, and the change is verified at the redirect boundary:

```text
enabled providers: ['google', 'email']
google: True | email: True
/authorize?provider=google → 302  https://accounts.google.com/o/oauth2/v2/auth
     ?client_id=<the project's client id>
     &redirect_uri=https://<project-ref>.supabase.co/auth/v1/callback
```

A 302 to Google carrying the correct `client_id` and the project's own
`/auth/v1/callback` as `redirect_uri` is as far as a request can be checked
without a browser and a Google account. Email magic link needs no further
setup: the provider is enabled and SMTP is configured by the project owner.

Two configuration details still belong to the project, and are only observable
when a human completes the flow:

1. `http://localhost:3000/auth/callback` must be in the project's redirect
   allow-list, or the callback will be refused after Google returns.
2. The Google Cloud OAuth client's authorised redirect URI must be
   `https://<project-ref>.supabase.co/auth/v1/callback` (the project hop, not
   the app's callback).

## 8. Verification status

- **Google sign-in: completed end to end.** The project owner signed in with
  Google and the session was established and restored, which proves the two
  configuration details a request cannot prove: the app callback is accepted by
  the project's redirect allow-list, and the Google client's authorised redirect
  URI matches the project's `/auth/v1/callback`. This result is the project
  owner's; the agent verified the redirect boundary only.
- **Email magic link: not delivered and followed.** The provider is enabled and
  the send path is implemented and tested against a mocked client, but no link
  has completed the round trip through a real mailbox.
- **The onboarding write path through the app.** The schema, triggers and RLS are
  verified directly with SQL; no onboarding save has been executed through the
  running application with a signed-in session.
- **Mail delivery.** Resend is configured by the project owner but no message has
  been observed arriving, so the magic-link path is unproven past the API call.

## 9. Secrets handling

The Google OAuth client id and secret were supplied by the project owner in
conversation. They have **not** been written to the repository, to `.env.local`,
or to any file, and they are not reproduced in this report. Nothing under version
control contains them.
