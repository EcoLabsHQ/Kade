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
script. The suite is collected by `vitest.regressions.config.ts`, which matches
both `*.test.ts` and `*.test.tsx`, and the gate reports the number of files it
collected so an empty suite is visible rather than silently green.

Current coverage:

| Test | Protects |
|---|---|
| `open-redirect.test.ts` | The post-auth open redirect fixed on 17 September 2026: a `next` value of `/\evil.com` passed a string-prefix check and resolved off-origin. |
