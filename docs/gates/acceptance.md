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
| 1 | Sign in with Google or an email link | ✅ |
| 2 | Create or retrieve the Ethereum Sepolia Safe | ✅ deployed |
| 3 | Verify matching Sepolia / Base Sepolia addresses | ✅ |
| 4 | Complete Steps 1–2 | ✅ |
| 5 | Observe the correct fee | ✅ |
| 6 | Reload and recover application state | ✅ |
| 7 | Inspect the EAS UIDs | ✅ registered |
| 8 | Inspect a passing KadeLock test report | ✅ |
| 9 | Create the transaction passkey | ✅ |

### 1. Sign in ✅

Go to `/login`, choose either method, and complete it: *Continue with Google*,
or *Email link* followed by the emailed link. Both are permitted (contract
v1.2), and neither asks for a passkey.

**Expected:** you land back on the app, signed in. `/login` redirects away, and
the overview greets you by your actual provider.
**Evidence:** screenshot of the signed-in overview.
**Done already:** the project owner completed this.

### 2. The resident Safe ⛔

**Done.** The resident Safe is deployed on Sepolia (`0x9a87d79c9B051936D490741e8d45e5CE1034D17B`, tx `0x608f1c6709be262020f20f27652249bd2c75807395a96beba09118c299587e7d`), and
the shell shows the address with its state and an explorer link.

### 3. Matching addresses on the active chains ⛔

**Done.** The D4 manifest is persisted in `safe_deployments`, and the address is
identical across the active chains by construction.

### 4. Steps 1–2 ⚠️

Open `/onboarding`. Enter profile, citizenships, residence history covering five
years, a tier, and at least one household member.

**Expected:** validation blocks Continue while something is missing; the fee
recalculates as household members change; saving reports honestly.
**Then:** reload the page and confirm the data returns.
**Evidence:** before/after screenshots plus the rows in Supabase.

> **This step is the one that proves the most.** The schema, triggers and RLS are
> verified directly with SQL, and a signed-in run has now written through the
> running app: the profile, the household and the Safe record all exist for the
> test resident.

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

### 7. EAS UIDs ✅

**Registered 18 September 2026, after Gate 3 approval.** All five schemas are on
Ethereum Sepolia. The UIDs, transactions and block numbers are in
`packages/contracts/eas/registered-uids.json`; the repository's EAS tooling is
read-only, and the owner sent each transaction. Verify the on-chain state with
`npm run eas:verify --workspace @kade/contracts`.

### 8. KadeLock report ✅

```bash
cd packages/contracts && forge test
```

**Expected:** 33 tests pass (30 `KadeLockTest`, 3 integration), plus the 12
`SafeAddress` tests. Record the output.

### 9. The transaction passkey ⚠️

Open `/account`. The passkey panel enforces user verification and shows the
signer address derived from the credential. Credential metadata and the derived
`signer_address` are written to `passkey_credentials` — the signer through
`public.save_passkey_signer`, a SECURITY DEFINER function, so no service-role key
is needed — and reloaded on the next visit.

## What a pass looks like

- Steps 1, 2, 3, 5, 7, 8 and 9 pass today.
- Step 4 plus 6 are the highest-value remaining check and need no gate.
- Week 1 cannot be declared complete until the acceptance gate is recorded.

## Approval record

_Not yet recorded._
