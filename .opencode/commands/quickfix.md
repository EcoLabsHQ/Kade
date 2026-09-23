---
description: Request a QUICKFIX iteration for a narrow, human-directed correction.
agent: orchestrator
---

Requested correction (QUICKFIX candidate):

$ARGUMENTS

Treat this as an `ITERATION_PROFILE=QUICKFIX` request under
`docs/iteration-profiles.md`.

1. Check the eligibility rules against the request. If any non-example applies
   (architecture change, schema migration, security boundary, public contract,
   new feature) or the scope is unclear, stop and recommend NORMAL.
2. Present the proposed profile, the bounded scope, the acceptance criteria, and
   the focused tests you intend to use.
3. Do not create a worktree or delegate a worker until the human explicitly
   approves the QUICKFIX profile.

This command selects a workflow. It does not bypass the eligibility check, the
human checkpoint, TARGETED review, or the final `./scripts/verify.sh` on the
exact promotion HEAD.
