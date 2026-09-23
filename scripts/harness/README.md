# Harness helpers

Orchestrator-owned tooling for delegated development. These helpers implement
the mechanics described in `docs/orchestration.md`; the normative invariants are
in `docs/DEVELOPMENT_CONTRACT.md` section 17.

## `worktree.sh`

```text
worktree.sh create <task-id> [base-ref]   create branch task/<id> + worktree
worktree.sh list                          list worktrees
worktree.sh path <task-id>                print the worktree path
worktree.sh base <task-id>                print the worktree's base/HEAD sha
worktree.sh status                        dirty/unmerged summary per worktree
worktree.sh remove <task-id> [--force]    remove a safely disposable worktree
```

`create` defaults `base-ref` to `known-good` when it exists, otherwise `HEAD`.
A dependent task should pass the integrated dependency commit explicitly.

`remove` is non-destructive by default: it refuses to delete a worktree with
uncommitted changes or a branch with commits not reachable from a trusted ref.
Use `--force` only when the work is deliberately discarded.

Worktrees live under `.worktrees/`, which is git-ignored. This is the Git
fallback below OpenCode-native worktrees.
