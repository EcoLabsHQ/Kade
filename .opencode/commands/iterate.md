---
description: Start a NORMAL delegated iteration for the given request.
agent: orchestrator
---

Requested work (NORMAL iteration):

$ARGUMENTS

Follow `docs/orchestration.md` and the orchestrator lifecycle: classify the
iteration, decompose the request into a dependency DAG, create one isolated
worktree per delegated implementation task, delegate workers (background when
independent), integrate deliberately, run `./scripts/verify.sh`, then drive the
review session.

Default to `ITERATION_PROFILE=NORMAL`. Only use QUICKFIX with explicit human
approval.
