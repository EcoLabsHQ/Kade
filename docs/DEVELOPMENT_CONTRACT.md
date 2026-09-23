# Agent Development Contract

This document is the normative contract for all development work in this
repository.

## Prime Directive

Never build new work on top of a state known or suspected to be broken.

Before modifying the repository, establish a known-good baseline. After
modifying it, prove that the new state preserves the baseline behavior plus the
requested change.

- A passing state is evidence.
- An untested state is unknown.
- A failing state must not become the foundation for further work.
- A commit is not automatically a known-good state.

A state becomes known-good only after the complete development iteration has
passed both:

1. mechanical verification; and
2. independent reviewer/adversarial verification.

The Git tag `known-good` identifies the latest state that satisfied both gates.
The `known-good` tag must never be advanced merely because an intermediate
commit passes tests.

## 1. Establish the Baseline

Before making changes:

1. Inspect repository status and recent history.
2. Identify the current known-good commit.
3. Run the project's canonical verification suite against the current state when
   appropriate.
4. Record the baseline result.
5. Identify the functionality and invariants relevant to the requested change.

The canonical mechanical verification command is:

```bash
./scripts/verify.sh
```

If the current state passes verification and corresponds to an already reviewed
state:

```text
BASELINE = known-good
```

If HEAD contains newer unreviewed work:

```text
BASELINE  = known-good
CANDIDATE = HEAD
```

Do not silently redefine HEAD as known-good.

If the baseline itself fails:

Do not immediately patch the failure. Determine whether the failure:

- predates the requested work;
- is environmental or flaky;
- represents a historical regression;
- indicates that the known-good assumption is no longer valid.

Use repository history, regression tests, and when appropriate `git bisect` to
investigate.

Do not build new functionality on top of an unresolved broken baseline.

## 2. Preserve Existing Behavior

Existing passing behavior is considered part of the contract unless the task
explicitly requires changing it.

Before changing behavior:

- identify existing tests protecting it;
- identify relevant contracts and invariants;
- add regression coverage when meaningful protection is missing;
- do not weaken or delete existing tests merely to make a change pass.

A test may only be changed when:

1. the requested behavior intentionally changes the contract; or
2. the test itself is demonstrably incorrect.

When an existing test is changed or removed, document why.

Passing tests are not proof that every behavior is correct, but existing passing
behavior must not be intentionally discarded without justification.

## 3. Regression-First Bug Fixing

When fixing a reproducible bug:

1. Reproduce the bug.
2. Reduce the reproduction to the smallest useful case when practical.
3. Add a regression test that fails because of the bug.
4. Verify that the regression test fails before the fix.
5. Determine whether the bug was introduced historically or by current
   uncommitted work.
6. Find the last known-good state when useful.
7. Understand the violated invariant or root cause before modifying the
   implementation.
8. Implement the smallest coherent fix.
9. Verify that the regression test passes.
10. Run the complete applicable verification suite.

Do not patch symptoms repeatedly.

Prefer restoring the violated invariant or correcting the original regression.

Every meaningful fixed regression should leave behind executable evidence that
prevents the same failure from silently returning.

## 4. Known-Good States

The repository uses the Git tag `known-good` as the canonical pointer to the
latest fully verified development state.

A known-good state means:

```text
mechanical verification PASS
    AND
reviewer/adversarial verification PASS
```

The tag is intentionally movable.

After a complete successful development iteration:

```bash
git tag -f known-good HEAD
```

may be used to advance it to the newly accepted state.

The tag must not be moved:

- after every commit;
- before the development iteration is complete;
- when verification fails;
- when reviewer verification fails;
- while a regression remains unresolved.

Intermediate commits may be valid, useful, and intentionally granular without
being known-good. Therefore:

```text
COMMIT != KNOWN_GOOD
```

A typical iteration may look like:

```text
known-good
    |
    v
    A --- B --- C --- D
                    ^
                   HEAD
```

where A, B, C, and D are granular development commits.

The reviewer does not need to review each one independently.

At the end of the iteration, the complete transition is evaluated:

```text
known-good -> HEAD
```

If verification and review pass, the tag may advance:

```text
                    known-good
                        |
                        v
    A --- B --- C --- D
```

## 5. Known-Good Recovery

When current code contains cascading, uncertain, or compensating fixes:

Do not continue stacking patches. Prefer recovering causal understanding before
adding another modification.

The preferred investigation procedure is:

```text
current failure
     |
     v
reproduce failure
     |
     v
encode regression test
     |
     v
confirm failure at HEAD
     |
     v
confirm success at known-good
     |
     v
  git bisect
     |
     v
first bad commit
     |
     v
inspect introducing change
     |
     v
identify root cause / violated invariant
     |
     v
choose recovery strategy
     |
     +----------------------+
     |                      |
     v                      v
repair forward       rebuild from known-good
```

Do not reset, revert, rebase, checkout destructively, rewrite history, or
discard user work without explicit authorization.

Historical commits may be inspected freely.

Temporary checkouts performed as part of a controlled `git bisect` investigation
are allowed when the working tree is clean and user work is not at risk.

If uncommitted user work exists, protect it before any operation that could
alter the working tree.

## 6. Git Bisect Regression Protocol

Use `git bisect` when:

- a regression is reproducible;
- the current state is bad;
- an earlier known-good state is confirmed good;
- the regression's origin is unknown or materially useful to identify;
- an automated GOOD/BAD oracle can be constructed.

Do not use bisect mechanically for every failure. Before bisecting, classify and
reproduce the failure.

### 6.1 The Regression Oracle

`git bisect` requires a deterministic or sufficiently reliable command that
determines whether a historical commit exhibits the regression.

Prefer creating a focused regression test. Example:

```bash
./scripts/regression/test_checkout_regression.sh
```

The command should return:

```text
exit 0      behavior is GOOD
exit 1-127  behavior is BAD
exit 125    commit cannot be reliably tested
```

Before starting the bisect, verify:

```text
regression test at HEAD       -> BAD
regression test at known-good -> GOOD
```

If both states produce the same result, the proposed bisect range or regression
oracle is invalid and must be investigated before continuing.

### 6.2 Running the Bisect

The standard procedure is:

```bash
git bisect start
git bisect bad HEAD
git bisect good known-good
git bisect run ./scripts/regression/<regression-test>.sh
```

Git will perform a binary search over the relevant history.

For each selected commit it will:

1. check out the commit;
2. execute the regression oracle;
3. classify the commit as GOOD, BAD, or SKIP;
4. select another commit;
5. repeat until the first bad commit is identified.

After investigation:

```bash
git bisect reset
```

must be used to restore the original working state.

### 6.3 Purpose of Bisect

The purpose of bisect is not merely to identify a bad commit. Its purpose is to
reduce the debugging problem from:

```text
Why is the current repository broken?
```

to:

```text
What changed between the last good state and the first bad state
that caused this specific regression?
```

After bisect identifies the first bad commit, inspect:

```bash
git show <first-bad-commit>
```

and determine:

- what behavior changed;
- which invariant was violated;
- whether the change was intentional;
- whether later commits depend on the broken behavior;
- whether later commits are independent valuable work;
- whether subsequent commits are primarily compensating patches.

## 7. Regression Recovery Strategy

After identifying the root cause, explicitly choose between:

```text
REPAIR FORWARD
```

and:

```text
REBUILD FROM KNOWN-GOOD
```

### Repair Forward

Prefer repair-forward when:

- later commits contain valid independent features or fixes;
- the regression has a localized root cause;
- correcting the cause at current HEAD preserves a coherent architecture;
- later work does not primarily depend on compensating for the regression;
- rebuilding would unnecessarily discard or recreate valuable independent work.

In this case, fix the root cause on top of the current development state and
preserve legitimate subsequent work.

### Rebuild From Known-Good

Prefer rebuilding the affected work from known-good when:

- subsequent commits primarily consist of patches or workarounds for the same
  underlying regression;
- patches depend on earlier patches in a fragile chain;
- the implementation has accumulated contradictory fixes;
- current behavior has become difficult to reason about;
- restoring the original invariant and rebuilding the affected change is simpler
  and safer;
- preserving the broken chain provides little independent value.

Conceptually:

```text
GOOD
  |
  +-- bad implementation
  +-- patch
  +-- patch of patch
  +-- workaround
  |
 HEAD
```

should not automatically receive another patch. Prefer, when justified:

```text
GOOD
  |
  +-- correct implementation
  +-- preserved legitimate subsequent work
  |
NEW HEAD
```

This decision concerns the engineering strategy. It does not authorize
destructive Git operations.

Any destructive reset, history rewrite, rebase, or removal of user work still
requires explicit authorization.

## 8. Commit Discipline

Commits must be small, coherent, and independently understandable.

A commit should represent one logical change. Prefer:

```text
test: reproduce duplicate-session regression
fix: preserve session during token refresh
test: cover refresh after page reload
```

Avoid:

```text
fix auth and refactor middleware and cleanup stuff
```

Do not mix unrelated refactors, formatting across unrelated files, dependency
upgrades, feature work, and bug fixes in the same commit unless technically
inseparable.

Granular commits are important not only for readability but also for causal
debugging. A clean commit history makes `git bisect` substantially more useful.

Commits should therefore be structured so that a future agent can reasonably
understand what behavioral transition each commit introduced.

Intermediate commits do not need independent adversarial review. The reviewer
operates on the complete iteration from `known-good` to candidate.

## 9. Minimal Change Principle

Make the smallest coherent change that solves the root problem.

Do not perform unrelated refactors while implementing a task. If a refactor is
necessary, isolate it in a separate commit whenever possible.

"Minimal" does not mean applying the smallest textual patch. A slightly larger
change that restores the correct invariant or removes a faulty patch chain is
preferable to a tiny workaround that increases structural fragility.

Optimize for the smallest coherent root-cause fix, not the smallest diff at any
cost.

## 10. Verification Gate

A candidate is not ready for review until all applicable mechanical gates pass.
These may include:

- tests;
- regression tests;
- typecheck;
- lint;
- build;
- relevant integration tests;
- relevant E2E tests.

Repository-specific verification commands must be defined in one canonical
location.

The canonical local verification interface is:

```bash
./scripts/verify.sh
```

Agents should prefer the canonical verification command over manually inventing
subsets of the verification process.

The verification script must:

- return exit code 0 when verification succeeds;
- return a non-zero exit code when verification fails;
- avoid modifying source code;
- avoid automatically fixing formatting or lint problems;
- avoid committing changes;
- never move the `known-good` tag;
- produce enough output to identify which gate failed.

When expensive system or E2E verification exists, the repository may
additionally define:

```bash
./scripts/verify-full.sh
```

The distinction should be:

```text
verify.sh       fast enough for normal development,
                strong enough to establish mechanical confidence
verify-full.sh  expensive integration, E2E, system, or release-level
                verification
```

Passing mechanical verification does not promote a candidate to known-good. It
only makes the candidate eligible for reviewer/adversarial verification.

## 11. Development Iteration

An **iteration** is one attempt to move the repository from the current
`known-good` state to a new candidate state satisfying a coherent unit of
requested work.

An iteration may contain several granular commits. The reviewer does not run per
commit:

```text
known-good
    |
    +-- commit A
    +-- commit B
    +-- commit C
             |
             v
           VERIFY
             |
             v
           REVIEW
```

The normal development loop is:

```text
known-good
     |
     v
understand task
     |
     v
identify invariants
     |
     v
implement
     |
     +--> granular commit
     |
     +--> granular commit
     |
     +--> granular commit
     |
     v
mechanical verification
     |
     +------ FAIL ------+
     |                  |
     |                  v
     |             failure protocol
     |                  |
     |          regression if relevant
     |                  |
     |              reproduce
     |                  |
     |           regression test
     |                  |
     |              bisect
     |                  |
     |             root cause
     |                  |
     +<-----------------+
     |
    PASS
     |
     v
reviewer/adversarial gate
     |
  +--+--+
  |     |
 FAIL  PASS
  |     |
  |     v
  |   promote candidate
  |     |
  |     v
  |   move known-good
  |
  v
review session: fix batch -> recheck -> resume
```

The reviewer runs as one incremental review session per completed development
iteration. It runs in several modes within that session, but not after every
granular commit.

The iteration is a state machine, not a linear script:

```text
    IMPLEMENT
        |
        v
    VERIFY
      /   \
   FAIL   PASS
    |       |
    |       v
    |     REVIEW
    |     /    \
    |   FAIL   PASS
    |    |       |
    +----+       v
             PROMOTE
```

- **VERIFY FAIL** returns to IMPLEMENT after the failure protocol in section 13.
  The reviewer is not invoked.
- **REVIEW FAIL** pauses the review session on a batch of at most three blocking
  findings. The batch is corrected, verified, and rechecked; the session then
  resumes instead of starting over. Findings are evidence, not implementation
  instructions.
- The `known-good` tag stays fixed for the entire iteration. It must not move
  during IMPLEMENT, VERIFY failure recovery, or review recovery.

The reviewer always evaluates:

```bash
git diff known-good...HEAD
```

even across corrective work, so all corrective work remains visible relative to
the last trusted baseline.

### 11.1 Review Session

Review is incremental. A **review session** spans one iteration and may run the
reviewer in several modes:

```text
DISCOVERY  find at most three blocking findings, then pause
RECHECK    confirm the batch fixes; no unrelated discovery
RESUME     continue discovery from the recorded state
```

The session is complete only when every scope has been reviewed, no blocking
finding is open, and no scope was invalidated by later corrective work. A fresh
full review is not required after each corrective batch; that would discard the
session's work and re-audit already-closed scopes.

Session state is persisted per `docs/review-state.md`.

### 11.2 Circuit Breakers

An unbounded `while not reviewer_passes: fix()` loop is forbidden; it produces
exactly the patch-on-patch behavior this contract prohibits. The orchestrator
drives the cycle and runs root-cause recovery plus focused tests between every
batch.

Operational limits (tunable by evals):

```text
MAX_BLOCKERS_PER_BATCH           = 3
MAX_RECHECK_ATTEMPTS_PER_FINDING = 2
MAX_FULL_REVIEW_RESTARTS         = 1
```

There is deliberately no limit on the number of healthy batches. A sequence such
as `3 blockers -> fix -> 2 blockers -> fix -> 0 blockers` is a healthy session.

A full `DISCOVERY` restart is permitted at most once, and only when corrective
work materially invalidates the session: the architecture or public interfaces
change, the schema changes substantially, a security boundary changes, earlier
reviewed assumptions no longer hold, or large unrelated implementation changes
are introduced. Otherwise the existing session continues with `RECHECK` then
`RESUME`.

When a limit is exceeded:

1. STOP;
2. report the repeated failure with evidence;
3. escalate to the human / change-control gate.

Do not keep patching.

## 12. Reviewer / Risk-Based Adversarial Gate

After the implementation loop is complete and mechanical verification passes,
the `reviewer` subagent must independently inspect the complete change from the
last known-good baseline to the current candidate state.

The reviewer runs as a single incremental review session per completed
development iteration, not once per commit.

The reviewer must initially operate read-only. Its job is not to modify the
implementation but to determine whether the candidate state can safely be
promoted to known-good.

The reviewer acts both as:

- a conventional code reviewer; and
- an adversarial regression reviewer.

"Adversarial" means actively looking for realistic ways in which the change
could violate existing behavior, contracts, invariants, or the requested
functionality.

Adversarial does not mean pessimistic by default. The reviewer must not
manufacture concerns merely to produce findings.

A clean review is a valid and successful outcome. Saying `REVIEW PASSED` when
the evidence supports it fulfills the reviewer's function just as much as
finding a legitimate defect.

Findings should only be reported when supported by:

- concrete evidence;
- a plausible failure mode;
- a violated contract or invariant;
- or a meaningful engineering risk.

### 12.1 Review Scope

The reviewer must compare:

```text
KNOWN_GOOD
    vs
CANDIDATE
```

and inspect the complete iteration diff rather than reviewing commits
independently.

The primary comparison should be equivalent to inspecting:

```bash
git diff known-good...HEAD
```

The reviewer should use available evidence including:

- task requirements;
- the complete iteration diff;
- existing regression tests;
- newly added tests;
- mechanical verification results;
- repository invariants;
- public contracts and interfaces;
- relevant implementation context.

### 12.2 Reviewer Responsibilities

The reviewer must consider:

- regressions;
- unintended behavior changes;
- deleted or unreachable functionality;
- API or contract changes;
- violated system invariants;
- weakened, removed, or bypassed tests;
- missing meaningful regression coverage;
- edge cases materially affected by the change;
- compatibility problems;
- suspicious error handling;
- unnecessary scope expansion;
- unrelated changes;
- cases where tests pass but behavior may still be incorrect.

This list is assessed as risk dictates. The reviewer is not required to
exhaustively check every item for every change; it prioritizes what the diff
could plausibly affect.

The reviewer should actively challenge assumptions made by the implementation.
However, it must distinguish:

```text
"I can imagine a theoretical problem"
```

from:

```text
"This change introduces a plausible or demonstrated problem."
```

Only the latter should normally become a finding.

### 12.3 Reviewer Checklist

The reviewer must produce a checklist containing meaningful positive and
negative findings. Example:

```text
Reviewer Checklist
[PASS] Requested behavior is covered by tests.
[PASS] Existing public API remains compatible.
[PASS] No unrelated files were modified.
[PASS] Existing regression suite passes.
[WARN] New retry path is not covered by an integration test.
[FAIL] Existing session invalidation behavior changed unexpectedly.
```

`PASS` items are meaningful evidence and must represent properties the reviewer
actually verified. Report them explicitly.

`WARN` and `FAIL` items must include concrete reasoning.

### 12.4 Severity Semantics

```text
PASS
    Verified desirable property.
WARN
    Credible risk that deserves consideration but does not establish
    that the candidate is incorrect.
FAIL
    Concrete regression, contract violation, correctness problem, or
    sufficiently evidenced blocking risk.
```

The reviewer must not use `WARN` as a catch-all for speculative concerns.

Warnings do not automatically cause the review to fail.

### 12.5 Reviewer Verdict

The reviewer must finish with exactly one verdict:

```text
REVIEW PASSED
REVIEW FAILED
REVIEW INCOMPLETE
```

`REVIEW PASSED` means the review session is complete: every scope has been
reviewed, no blocking finding is open, and no scope was invalidated by later
corrective work. This is the only verdict that permits promotion.

`REVIEW FAILED` means at least one blocking finding is open, or a recheck failed.
Discovery pauses on the reported batch.

`REVIEW INCOMPLETE` means the current batch is resolved but scopes remain
un-reviewed. Review resumes from the recorded state.

Warnings never by themselves produce `REVIEW FAILED`.

If review fails or is incomplete:

1. do not move `known-good`;
2. treat findings as evidence, not implementation instructions;
3. validate blocking findings before acting on them;
4. correct root causes rather than blindly satisfying reviewer wording;
5. rerun mechanical verification;
6. recheck the batch, then resume the session — do not start a fresh full review
   unless section 11.2 permits a restart.

Correcting a review means fixing the underlying defect, not producing the
smallest patch that makes the reviewer stop objecting.

Only after:

```text
mechanical verification PASS on the exact promoted HEAD
    AND
review session COMPLETE (REVIEW PASSED)
```

may the candidate be promoted to known-good.

### 12.6 Risk-Based Review

Review is **risk-based adversarial**, not exhaustive. The reviewer's mission is
to find material regressions introduced by the candidate, prioritizing effort
according to risk. It is not required to inspect every file, and a clean review
is a valid outcome.

Review effort scales with the change, not with the repository. Trivial changes
(docs, comments, an isolated fix) are reviewed with targeted reads. Cross-cutting
or security-critical changes may justify additional depth or delegation. A
one-line fix must not be escalated into a multi-agent review.

### 12.7 Materiality Threshold

A finding may block promotion only when it has all of:

- concrete evidence (a path and line, and/or a diff hunk);
- a plausible, specific failure mode;
- a violated contract, invariant, or material regression;
- introduction or exposure by this candidate.

Stale wording, formatting, naming preference, speculative concerns, and
pre-existing issues are not blocking findings. A factually false claim is
material only when it misstates behavior in a way that would mislead an operator
or reviewer; pure phrasing is not.

### 12.8 Review Session State

Incremental review requires persisted state. Each iteration keeps its session
state under `.review/<iteration>/`, with the schema defined in
`docs/review-state.md`.

The state records reviewed scopes, open and resolved findings with stable ids
(`F1`, `F2`, …), and the last verdict. The orchestrator owns and writes it; the
reviewer is read-only and returns updated state, which the orchestrator persists.
Because the completed session is the evidence justifying promotion, it is
committed with the promotion.

A `complete` scope remains valid until later corrective work touches its files,
at which point it is invalidated back to `partial` and revisited on resume.

### 12.9 Delegated Scoped Review

The reviewer may act as a review lead and delegate a single domain to the
`subreviewer` agent when a change is cross-cutting or security-critical.

A delegated subreviewer:

- is read-only;
- receives exactly one narrow scope;
- returns evidence-backed findings or `NO_FINDINGS_IN_SCOPE`;
- never issues a verdict.

The reviewer, not the delegate, deduplicates findings, rejects speculative ones,
requires evidence, classifies severity, selects the batch of at most three
blockers, and issues the verdict.

Delegation must reduce effort, not multiply it. When a scope is not affected by
the diff, it is marked `not_applicable` and no subreviewer is launched.

## 13. Failure Protocol

If verification fails after a change:

Do not blindly patch the newest error.

First classify the failure:

```text
REGRESSION
NEW REQUIREMENT FAILURE
PRE-EXISTING FAILURE
FLAKY/ENVIRONMENTAL FAILURE
UNKNOWN
```

For a regression:

1. identify the behavior that changed;
2. identify the invariant that was violated;
3. reproduce the failure;
4. create regression coverage when appropriate;
5. determine whether the regression belongs to current work or historical work;
6. identify the introducing commit with `git bisect` when doing so materially
   improves diagnosis;
7. understand the root cause;
8. choose repair-forward or rebuild-from-known-good;
9. implement the correction;
10. rerun the complete applicable verification suite.

Repeated local patches without understanding the regression are prohibited.

If multiple consecutive fixes target the same underlying behavior, explicitly
consider whether the system has entered a patch-on-patch state. If so, stop and
reevaluate from the last known-good state.

## 14. Regression Test Infrastructure

Regression tests should be identifiable and reusable.

When compatible with the repository's testing conventions, place them under:

```text
tests/regressions/
```

A regression test should document through executable behavior:

```text
this failed before;
this must continue working.
```

When a regression test is useful for historical diagnosis, provide a focused
executable command or wrapper suitable for:

```bash
git bisect run
```

Repository-specific bisect wrappers may live under:

```text
scripts/regression/
```

These scripts must be non-destructive and should test one regression as directly
as practical.

Documentation for regression investigation should live in:

```text
scripts/regression/README.md
```

## 15. Promotion to Known-Good

Promotion is an explicit operation performed only at the end of a successful
development iteration.

Required state:

```text
requested behavior implemented
        +
mechanical verification PASS on the exact promoted HEAD
        +
review session COMPLETE (REVIEW PASSED)
        +
no unresolved blocking finding
        +
no reviewed scope invalidated by later corrective work
        +
no unresolved material regression known
```

This preserves the strength of known-good without requiring a fresh full review
after every corrective batch. The session's incremental coverage, not a repeated
full audit, is what establishes that the candidate was reviewed.

Then:

```text
CANDIDATE  = HEAD
```

may become:

```text
KNOWN_GOOD = HEAD
```

by advancing:

```bash
git tag -f known-good HEAD
```

Moving the tag is the final acknowledgement that the iteration produced a new
trusted foundation. Future development should begin from this state unless
explicitly working with unreviewed work.

## 16. Definition of Done

A task is DONE only when:

- requested behavior is implemented;
- existing behavior has been preserved unless intentionally changed;
- regression coverage exists where appropriate;
- new regressions have reproducible tests when practical;
- existing tests still pass;
- canonical mechanical verification passes;
- relevant full/E2E verification passes when required;
- the diff contains no unexplained unrelated changes;
- reviewer/adversarial gate passes;
- reviewer findings contain no unresolved blocking issues;
- the review session is complete, with its state persisted under `.review/`;
- no reviewed scope remains invalidated by later corrective work;
- commits are logically structured and granular;
- no unexplained patch-on-patch chain remains;
- recovery strategy was explicitly considered when historical regression
  investigation occurred;
- the repository ends in a verified state;
- the `known-good` tag identifies the latest accepted foundation.

The final lifecycle is:

```text
KNOWN_GOOD
    |
    v
DEVELOPMENT
    |
    v
GRANULAR COMMITS
    |
    v
VERIFY
    |
    v
REVIEW / ADVERSARIAL
    |
    v
PROMOTE
    |
    v
NEW KNOWN_GOOD
```

The objective is not to prevent agents from making mistakes. The objective is to
ensure that mistakes are detectable, attributable, reversible, and prevented
from becoming the foundation for further work.

## 17. Delegated Execution and Isolation (Harness v3)

This section is normative. It preserves every guarantee in sections 1–16 and
adds the invariants that govern delegated, isolated development. Operational
mechanics live in `docs/orchestration.md` and `docs/iteration-profiles.md`; those
documents must not weaken these invariants.

### 17.1 Implementation isolation

Every delegated implementation task executes in isolated state:

```text
1 delegated implementation task = 1 branch = 1 worktree
```

The orchestrator owns worktree creation, base selection, and cleanup. Workers do
not create their own execution environments and do not operate on the
integration workspace.

A task worktree begins from the commit containing all of its satisfied
dependencies, which may be newer than `known-good`.

### 17.2 Orchestrator integration ownership

Workers never integrate themselves. Only the orchestrator inspects a completed
worker, checks its acceptance criteria, chooses an integration strategy
(cherry-pick or merge), and integrates. Workers must not:

- integrate another worker's branch;
- modify the integration workspace;
- push or deploy without authorization;
- perform irreversible actions outside the existing human gates;
- silently expand scope beyond their task contract.

### 17.3 `known-good` immutability

A worker can never move `known-good`. The tag moves only at the promotion gate in
section 15, after mechanical verification and a complete review session.

### 17.4 Delegation default

Substantial product implementation is delegated by default. The orchestrator may
directly perform integration, bookkeeping, task-state maintenance, trivial
harness operations, and tiny mechanical corrections where delegation would cost
more than the work. It should not directly perform substantial product
implementation.

### 17.5 Verification ownership

Verification ownership is unchanged from section 10. Workers may run focused
tests for their own task and never establish repository trust. The orchestrator
runs `./scripts/verify.sh`. The reviewer consumes the recorded result and does
not re-run mechanical verification. The exact HEAD being promoted must pass
`./scripts/verify.sh`.

### 17.6 Review independence

Review independence is preserved. The `reviewer` remains the independent review
lead and the sole owner of the verdict. `subreviewer` agents remain read-only,
bounded, evidence-producing, and non-verdict. Delegation must reduce effort, not
multiply it.

The review session gains one bounded mode, `TARGETED`, used for QUICKFIX diffs.
`TARGETED` examines the quickfix diff, directly affected behavior, and
immediately adjacent effects. It must not become repository-wide `DISCOVERY`. A
`TARGETED` review may still produce blocking findings.

### 17.7 Iteration profiles

```text
ITERATION_PROFILE=NORMAL     default
ITERATION_PROFILE=QUICKFIX   narrow human-directed correction
```

QUICKFIX is not a shortcut past verification or review. It requires all of:

1. eligibility (narrow scope, clear behavior, small/local diff, no architecture
   change, no substantial schema migration, no security-boundary change, no
   public-contract change, no new feature);
2. explicit human approval of the profile;
3. a human result checkpoint before integration;
4. a bounded `TARGETED` review;
5. a final `./scripts/verify.sh` PASS on the exact promotion HEAD.

When eligibility is uncertain, the profile is NORMAL.

### 17.8 QUICKFIX escalation

The orchestrator must not silently upgrade QUICKFIX to NORMAL. If the change
reveals cross-cutting impact, an architecture or public-interface change, schema
or security implications, a large diff, multiple independent root causes, or
significant unrelated cleanup, the orchestrator stops, reports the evidence, and
asks the human to approve escalation. Useful worker state is preserved where
safe after approval.

### 17.9 Human steering

The human may steer, stop, reject, or continue delegated work. The orchestrator
forwards steering to the same child session when OpenCode supports it, rather
than spawning a fresh worker with lost context. If steering materially changes
architecture, task dependencies, public interfaces, scope, or security
assumptions, the orchestrator recomputes the affected task dependencies before
continuing.

### 17.10 Failure isolation

A failed worker must not corrupt `known-good`, the integration workspace, or
another worker. The orchestrator prefers explicit failure over speculative
continuation: a blocked worker is reported or investigated, an ambiguous
dependency does not launch dependent work, a semantic integration conflict is
returned to a worker or the human, and a suspected broken foundation triggers the
recovery protocol in sections 5–7.

### 17.11 Runtime state

Runtime orchestration state is lightweight and ephemeral, is ignored by Git, and
is not a substitute for commits. Transitions are not individually versioned. A
compact final iteration summary may be retained for observability.
