# Orchestration

Operational mechanics for delegated development under the Kade agent harness.
Normative invariants live in `docs/DEVELOPMENT_CONTRACT.md`; this document
describes **how** the orchestrator carries them out. When the two disagree, the
development contract governs.

See also:

- `docs/iteration-profiles.md` — `NORMAL` and `QUICKFIX` lifecycles.
- `docs/review-state.md` — review-session state schema.

## 1. Roles

The harness reuses OpenCode V2 built-in agents where their semantics fit and
adds only the roles that need bespoke instructions.

| Role | Agent | Mode | Purpose |
|---|---|---|---|
| Orchestrator | `orchestrator` (custom) | primary | Coordinator. Owns the DAG, worktrees, integration, verification, review driving, promotion. |
| General worker | `general` (built-in) | subagent | Bounded implementation in an isolated worktree. |
| Explore worker | `explore` (built-in) | subagent | Read-only investigation; safe to run in background. |
| Planner | `plan` (built-in) | primary | Optional planning/exploration when a request needs shaping before delegation. |
| Review lead | `reviewer` (custom) | subagent | Independent adversarial review; sole verdict owner. |
| Subreviewer | `subreviewer` (custom) | subagent | One bounded, read-only risk domain; produces evidence, never a verdict. |

Do **not** create permanent technology-specific workers (`react-worker`,
`solidity-worker`, …). Specialisation belongs in the delegated task prompt
until evals demonstrate a concrete need for a dedicated agent.

## 2. Delegated task contract

Every delegated implementation task is handed to its worker as a bounded
contract. A worker that cannot state all of these should be sent back.

```yaml
task_id: T1
objective: <what should change>
base_sha: <commit the worktree was created from>
scope:
  allowed: [<paths/modules>]
  forbidden: [<paths/modules/invariants>]
dependencies: [<task ids that must be integrated first>]
acceptance_criteria:
  - <observable, testable statement>
verification:
  focused_tests:
    - <exact command(s) the worker must run>
integration_constraints:
  - <interface/contract that must not change>
known_invariants:
  - <invariant from the development contract relevant here>
```

The contract answers four questions: what changes, what must not change, how we
know it works, and what state it depends on.

## 3. Worker output contract

Every worker returns:

```yaml
task_id: T1
status: COMPLETE | BLOCKED | FAILED
base_sha: <sha>
head_sha: <sha>
branch: task/T1
worktree: .worktrees/T1
changed_files: [<paths>]
verification:
  commands: [<commands actually run>]
  result: passed | failed
assumptions: [<...>]
integration_notes: [<...>]
risks: [<...>]
blockers: [<...>]
```

`COMPLETE` means the worker believes the acceptance criteria are met. It does
not mean trusted, reviewed, or known-good.

If a worker finds work outside its contract it reports it; it does not silently
absorb it. The orchestrator then ignores/defers it, expands the task if still
bounded, or creates a new task.

## 4. Task decomposition and the DAG

Decompose the request into coherent tasks before implementation. Each task has
one status:

```text
READY | BLOCKED | RUNNING | COMPLETE | FAILED
```

Dependencies form a DAG. Only `READY` nodes may execute.

```text
T1 schema ─────────┐
                   ▼
                 T3 API ───────► T4 frontend
T2 unrelated UI ─────────────────────────────►
```

`READY` means every dependency is `COMPLETE` and integrated. Do not launch a
dependent worker against ambiguous or unintegrated dependency state.

## 5. Dynamic concurrency

There is deliberately no fixed `MAX_WORKERS`. Choose the smallest number of
independently useful workers that can safely make progress concurrently, based
on:

- dependency independence;
- expected integration conflicts;
- task size and risk;
- available context and cost;
- expected speedup.

Guidance:

| Shape | Concurrency |
|---|---|
| 3 independent bounded tasks | up to 3 workers |
| schema → API → frontend | sequential |
| 5 tasks touching one central file | avoid artificial parallelism |

Dynamic concurrency must not become uncontrolled spawning. Every launched worker
maps to exactly one task in the DAG.

## 6. Worktrees

### 6.1 Invariant

```text
1 delegated implementation task
    =
1 branch
    =
1 worktree
```

The orchestrator owns worktree creation and cleanup. Workers never create their
own execution environments and never touch the integration workspace.

### 6.2 Base

A task worktree begins from the commit containing all of its satisfied
dependencies:

```text
BASE(task) = latest trusted integration state containing
             every dependency required by task
```

Independent task: `BASE = known-good`. Dependent task: `BASE = integrated T1`.

### 6.3 Naming and location

- branch: `task/<task_id>` (e.g. `task/T1`);
- worktree: `.worktrees/<task_id>` (configured via `worktree.directory`);
- runtime state is git-ignored (`.orchestration/`, `.worktrees/`).

### 6.4 Lifecycle

Use the repository helper `scripts/harness/worktree.sh`, which wraps Git
worktrees (the fallback below OpenCode-native worktrees):

```bash
scripts/harness/worktree.sh create T1 known-good
scripts/harness/worktree.sh list
scripts/harness/worktree.sh path T1
scripts/harness/worktree.sh remove T1          # refuses unsafe removal
scripts/harness/worktree.sh remove T1 --force  # explicit override
```

`remove` refuses to delete a worktree with uncommitted changes or unintegrated
commits unless `--force` is given. Never automatically delete a worktree holding
uncommitted work, unintegrated commits, or unresolved evidence — report it.

## 7. Background execution and child sessions

Independent workers may run in background child sessions. Launch them with the
`subagent` tool and `background: true`, or with a command that sets
`subagent: true`. Do not busy-wait; the parent is notified when a child
finishes.

```text
ORCHESTRATOR
     ├── launch T1 background ───────────►
     ├── launch T2 background ───────────►
     ├── launch explore background ──────►
     │
     │    continues coordinating
     │
     ◄──────── T2 complete
     ◄──────── exploration complete
     ◄──────── T1 complete
```

Record the returned child `sessionID` in runtime state:

```yaml
T1:
  agent: general
  session_id: ses_...
  status: running
```

### Continuity

Follow-up work for the same task continues the **same child session** by passing
its `sessionID` back to the `subagent` tool, rather than spawning a fresh worker
with lost context. This applies to human steering, failed focused tests, small
requested corrections, and clarifications.

## 8. Human steering

The human may intervene while workers run. Supported operations:

```text
STEER | STOP | REJECT | CONTINUE
```

The orchestrator forwards a steering instruction to the same child session when
OpenCode supports it. If steering materially changes architecture, task
dependencies, public interfaces, scope, or security assumptions, recompute the
affected task dependencies before continuing.

## 9. Integration ownership

Workers never integrate themselves. For each completed worker:

```text
worker COMPLETE
      │
      ▼
inspect result
      │
      ▼
inspect diff (git diff base...head)
      │
      ▼
check acceptance criteria
      │
      ▼
choose integration strategy
      │
      ▼
integrate
      │
      ▼
focused tests
```

### 9.1 Strategy

Choose dynamically; there is no globally mandatory strategy.

| Strategy | Prefer when |
|---|---|
| `CHERRY-PICK` | small granular commits, only some commits wanted, linear history valuable |
| `MERGE` | one coherent unit, preserving branch history useful, commits belong together |

Do not rebase or rewrite history for aesthetics. Record the chosen strategy in
task/integration state.

### 9.2 Conflicts

If worker results conflict, **stop automatic integration**. Then:

1. identify the conflict;
2. classify it as mechanical or semantic;
3. resolve mechanical conflicts only when intent is clear;
4. otherwise return the work to the worker or escalate to the human.

Never silently prefer one worker's implementation.

## 10. Verification ownership

| Actor | Responsibility |
|---|---|
| Worker | focused tests for its own task; never establishes repository trust |
| Orchestrator | runs `./scripts/verify.sh`; owns the mechanical gate |
| Reviewer | consumes the recorded verify result; does not re-run it |

The exact HEAD being promoted must pass `./scripts/verify.sh`.

## 11. Runtime state and final summary

Runtime orchestration state is lightweight and ephemeral. It lives under
`.orchestration/current/state.yaml` and is git-ignored.

```yaml
iteration: <id>
profile: NORMAL | QUICKFIX
known_good: <sha>
integration_head: <sha>
tasks:
  T1:
    status: READY | BLOCKED | RUNNING | COMPLETE | FAILED
    agent: general
    session_id: ses_...
    branch: task/T1
    worktree: .worktrees/T1
    base_sha: <sha>
    head_sha: <sha>
    integration_strategy: CHERRY-PICK | MERGE
review_session:
verify_status: <command + result + head>
human_gate: <none | foundation | account | onchain | acceptance | quickfix>
```

Do not version every transition. Persist a compact final iteration summary when
useful — profile, task DAG, workers used, integrated heads, integration
strategies, human interventions, quickfix escalation, verification result,
review result, promoted SHA.

## 12. Metrics

Capture lightweight metrics when cheaply available: iteration duration,
implementation/exploration worker counts, parallel vs sequential tasks, worker
failures, integration conflicts, focused-test failures, verify failures, review
batches, findings, recheck attempts, full-review restarts, steering events, and
quickfix iterations/escalations. Record token/cost only if OpenCode exposes it
cheaply. Do not build analytics infrastructure.

## 13. Harness self-verification scenarios

Exercise these against the harness before treating a change to it as complete.
They are recorded here as the acceptance shape.

The executable guard `tests/regressions/harness-config.test.ts` covers the
**configuration invariants** the scenarios depend on (V2 syntax, permission
boundaries under last-match-wins, worktree-helper safety, documented
invariants). It does not execute the runtime scenarios themselves — those are
exercised by the orchestrator during an iteration, and a change to orchestration
behavior should be validated against the relevant scenario, not only the config
test.

| Scenario | Shape | Expected |
|---|---|---|
| A single worker | request → worktree → general → integrate → verify → review | trusted workspace isolated |
| B parallel independent | T1, T2, T3 background | separate worktrees, no cross-contamination |
| C dependency DAG | T1 → T2 | T2 waits for integrated T1 state |
| D worker failure | T1 PASS, T2 FAIL, T3 running | no corruption of T1/T3/integration/known-good |
| E integration conflict | two incompatible workers | automatic integration stops |
| F human steering | constraint change mid-task | same child session receives steering |
| G exploration | read-only explore concurrent with implementation | no write interference |
| H quickfix success | see `docs/iteration-profiles.md` | targeted review + final verify + promote |
| I quickfix rejection | human rejects result | same child session continues |
| J quickfix escalation | cross-cutting work found | STOP → human approval → NORMAL |
| K existing review workflow | DISCOVERY → batch → RECHECK → RESUME | unchanged behavior |
| L repeated finding | another instance of a fixed class | class-level remediation, not instance patching |
