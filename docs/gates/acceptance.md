# Gate 4 — Acceptance

**Approves:** the D8 integrated journey, executed by a human.
**Blocks:** declaring Week 1 complete.

A human, not an agent, executes this. No manual database edits and no
fixture-only state are permitted: everything must come from the running app.

## Before you start

```bash
./scripts/setup.sh          # installs workspaces + pinned Foundry deps
cp .env.example apps/web/.env.local   # then fill from the project
npm run dev                 # http://localhost:3000
```

Clean browser profile recommended, so no stale session or passkey survives.

## The journey

Status today: ✅ runnable · ⚠️ partial · ⛔ blocked by a gate.

| # | Step | Status |
|---|---|---|
| 1 | Sign in with Google | ✅ |
| 2 | Create or retrieve the Ethereum Sepolia Safe | ⛔ gate 2 |
| 3 | Verify matching Sepolia / Arbitrum Sepolia / Base Sepolia addresses | ⛔ gate 2 |
| 4 | Complete Steps 1–2 | ⚠️ write path unproven |
| 5 | Observe the correct fee | ✅ |
| 6 | Reload and recover application state | ⚠️ same as 4 |
| 7 | Inspect the EAS UIDs | ⛔ gate 3 |
| 8 | Inspect a passing KadeLock test report | ✅ |
| 9 | Create the transaction passkey | ⚠️ scaffolded |

### 1. Sign in with Google ✅

Go to `/login`, choose *Continue with Google*, complete consent.

**Expected:** you land back on the app, signed in. `/login` redirects away, and
the overview greets you by your actual provider.
**Evidence:** screenshot of the signed-in overview.
**Done already:** the project owner completed this.

### 2. The resident Safe ⛔

**Blocked by gate 2.** No Safe exists yet; the overview shows `Not deployed` and
withholds the address rather than fabricating one. Correct behaviour until the
deployment is approved.

### 3. Matching addresses on three chains ⛔

**Blocked by gate 2.** Requires the D4 manifest, which the deployment produces.

### 4. Steps 1–2 ⚠️

Open `/onboarding`. Enter profile, citizenships, residence history covering five
years, a tier, and at least one household member.

**Expected:** validation blocks Continue while something is missing; the fee
recalculates as household members change; saving reports honestly.
**Then:** reload the page and confirm the data returns.
**Evidence:** before/after screenshots plus the rows in Supabase.

> **This step is the one that proves the most.** The schema, triggers and RLS are
> verified directly with SQL, but no write has yet gone through the running app
> with a real session. If anything in the journey is going to be wrong, it is
> here — for example a policy that permits the read but not the write.

### 5. The fee ✅

On `/onboarding`, the pre-approval fee for a household of three must read
**1.75 USDC** in demo mode.

**Why it is trustworthy:** it is not a client constant. `preapproval_fee_usdc`
in the database returns 1.75 for `('demo', 3)` and 447 for `('production', 3)`,
and `@kade/shared` computes the same. All three agree.
**Evidence:** screenshot; the value is also asserted in the acceptance tests.

### 6. Reload ✅/⚠️

Reload after step 4. A Supabase session must survive, and the onboarding data
must return from the database rather than from browser storage.

### 7. EAS UIDs ⛔

**Blocked by gate 3.** Nothing is registered, so there are no UIDs.
After registration: `npm run eas:verify --workspace @kade/contracts`.

### 8. KadeLock report ✅

```bash
cd packages/contracts && forge test
```

**Expected:** 33 tests pass (30 `KadeLockTest`, 3 integration), plus the 12
`SafeAddress` tests. Record the output.

### 9. The transaction passkey ⚠️

Open `/account`. The passkey panel exists and enforces user verification, but
the credential is not yet persisted to the database and the signer address is
unresolved until gate 2. "Not enrolled" is the honest current state.

## What a pass looks like

- Steps 1, 5 and 8 pass today.
- Step 4 plus 6 are the highest-value remaining check and need no gate.
- Steps 2, 3, 7 and 9 cannot pass until gates 2 and 3 are approved, and Week 1
  cannot be declared complete while they are blocked.

## Approval record

_Not yet recorded._
