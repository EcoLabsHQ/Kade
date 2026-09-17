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
next corrective iteration
```

The reviewer runs once per completed development iteration. It does not run
after every granular commit.

A reviewer failure begins another implementation/correction iteration. After
corrections are complete, mechanical verification must pass again before the
reviewer evaluates the new candidate.

## 12. Reviewer / Adversarial Gate

After the implementation loop is complete and mechanical verification passes,
the `reviewer` subagent must independently inspect the complete change from the
last known-good baseline to the current candidate state.

The reviewer runs once per completed development iteration, not once per commit.

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

`PASS` items should represent properties the reviewer actually verified.

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
```

or:

```text
REVIEW FAILED
```

`REVIEW PASSED` means no concrete blocking correctness or regression problem was
found.

`REVIEW FAILED` means at least one issue prevents the candidate from safely
becoming known-good.

If review fails:

1. do not move `known-good`;
2. return findings to the implementation loop;
3. correct root causes rather than blindly satisfying reviewer wording;
4. rerun mechanical verification;
5. run the reviewer again only after the corrective iteration is complete.

Only after:

```text
mechanical verification PASS
    AND
reviewer/adversarial verification PASS
```

may the candidate be promoted to known-good.

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
mechanical verification PASS
        +
reviewer/adversarial verification PASS
        +
no unresolved blocking findings
```

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
