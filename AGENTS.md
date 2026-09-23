# Agent Instructions

All development work in this repository is governed by:

```text
docs/DEVELOPMENT_CONTRACT.md
```

Read and follow that contract before modifying the repository.

Canonical verification:

```bash
./scripts/verify.sh
```

Full verification when required:

```bash
./scripts/verify-full.sh
```

The Git tag:

```text
known-good
```

identifies the latest state that successfully completed both mechanical
verification and adversarial review.

Do not move `known-good` until a complete development iteration has passed both
gates.

Regression tests belong in:

```text
tests/regressions/
```

Do not stack patches on top of a suspected broken foundation. Follow the
regression investigation and recovery protocol defined in the development
contract.

## Delegated execution

Implementation is delegated to isolated workers; the orchestrator coordinates.
Operational mechanics:

```text
docs/orchestration.md      tasks, DAG, worktrees, background workers, integration
docs/iteration-profiles.md NORMAL and QUICKFIX lifecycles, TARGETED review
```

Normative invariants for delegated execution are in
`docs/DEVELOPMENT_CONTRACT.md` section 17. Runtime orchestration state under
`.orchestration/` and task worktrees under `.worktrees/` are ephemeral and
git-ignored; do not commit them.

## Project scope

The product scope for the current iteration is frozen in:

```text
docs/week-2-frozen-delivery-contract.md
```

The Week 1 contract (`docs/week-1-frozen-delivery-contract.md`, Frozen v1.10)
remains frozen and governs the scope it delivered.

Where product scope and the development contract disagree, the development
contract governs how work is verified and promoted; the current week's contract
governs what is in scope.
