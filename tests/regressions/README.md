# Regression Tests

Each test here protects a behavior that previously broke. A regression test
documents, through executable behavior:

```text
this failed before;
this must continue working.
```

Naming: `issue-<n>-<short-slug>.<ext>` when tied to a tracked issue, otherwise a
descriptive slug.

Guidelines:

- One regression per test.
- Assert on the specific behavior that regressed, not on incidental details.
- Must fail before the fix and pass after it.
- If useful for `git bisect run`, expose a focused executable wrapper under
  `scripts/regression/` and document it in `scripts/regression/README.md`.

`./scripts/verify.sh` runs these when the stack defines a `test:regressions`
script (or a matching Foundry path). Until then, this directory is a placeholder
and no regression coverage exists.
