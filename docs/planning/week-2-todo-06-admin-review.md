# Week 2 — Front 06 admin-review (D19 / EXE-015)

**Branch:** `week-2/06-admin-review`
**Status:** Built on the real DB path; the on-chain `kade.review.v1` write is
gated; the reviewer account is not supplied.

## BLOCKED

- `BLOCKED: attestation issuance gate` — the on-chain `kade.review.v1` write is
  not performed. `issueReviewAttestation` encodes the exact frozen payload and
  then refuses (`AttestationIssuanceGatedError`). The review is still recorded in
  `review_events`; only `attestation_uid` is left NULL.
- `BLOCKED: reviewer account not supplied` — no row in `public.reviewers` is
  provisioned. The RLS policy, the server action and the non-reviewer-denied
  tests are implemented and pass; the two-screen live acceptance test (a human
  reviewer approving and a resident watching the gate flip) needs a reviewer
  account and a running Supabase project, neither of which is available here.

## Nav change requested (integration owner owns `nav.ts`)

The resident nav is unchanged and correct: an admin surface is a separate role,
not a resident destination. The requested change is in the shell's disabled
`Admin` toggle (`apps/web/src/components/shell/Sidebar.tsx`), which currently
renders locked with the Week 1 reason. It should become a link to `/admin` for a
signed-in reviewer (the route is already reachable by URL and enforces the role
itself). This needs a reviewer flag threaded through `AppShell`/`Sidebar`; it was
not edited here because the shell is shared across fronts.

## Appendix D — evidence note

- **Front / branch:** 06-admin-review · `week-2/06-admin-review`
- **Commits:** see `git log` on the branch (granular; migration, domain libs,
  admin surface, resident gate, DB suite, evidence).
- **Files:**
  - `supabase/migrations/20260922000060_admin_review.sql`
  - `apps/web/src/lib/review/{attestation,decision,gate,realtime,queue,errors}.ts`
  - `apps/web/src/app/admin/{page.tsx,review-actions.ts}`
  - `apps/web/src/components/admin/ReviewQueue.tsx`
  - `apps/web/src/components/review/ReviewGateWatcher.tsx`
  - `apps/web/src/app/page.tsx` (intake-review stage reads the real status)
  - `supabase/tests/0003_admin_review.test.sql`
  - `apps/web/tests/{admin-review-actions,admin-review-queue,review-attestation,review-decision,review-realtime}.test.*`
- **Tests:**
  - `npx vitest run tests/admin-review-actions.test.ts tests/review-attestation.test.ts tests/review-decision.test.ts tests/review-realtime.test.ts tests/admin-review-queue.test.tsx` → **21 passed (5 files)**.
  - `npm test --workspace @kade/web` → **419 passed (48 files)**.
  - pgTAP against a disposable `postgres:16` with the shim, all migrations and
    the seed: `supabase/tests/0003_admin_review.test.sql` → **22/22 ok, psql exit 0**.
- **verify.sh:** see the branch report (run after the final commit).
- **Runtime proof:** migration `20260922000060_admin_review.sql` applies cleanly
  and the pgTAP suite proves the DB path: a reviewer INSERT into `review_events`
  flips `applications.status` for approve → `approved`, block → `blocked`,
  reopen → `pre_approved`; a non-reviewer INSERT is refused (`42501`) and reads
  nothing. No chain UID exists (issuance gated).
- **Security notes:** RLS is the gate — `review_events` insert requires
  `is_reviewer() and reviewer_id = auth.uid()`; `applications.status` stays
  trigger-only (no UPDATE/INSERT privilege for `authenticated`); reviewers get
  read-only access to `wallets`, `identity_attestations`, `profile_residences`
  and `profile_citizenships`; `reviewers` is self-read only and has no write
  grant, so a user cannot make themselves a reviewer. No secret, no service-role
  key and no irreversible write is involved.
