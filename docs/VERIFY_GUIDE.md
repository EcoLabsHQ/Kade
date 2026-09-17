# Guide for implementing `scripts/verify.sh`

## Purpose

`scripts/verify.sh` is the canonical definition of whether the repository is
mechanically healthy.

Agents must not invent their own definition of "tests pass".

The command:

```bash
./scripts/verify.sh
```

must return:

```text
exit code 0     verification passed
non-zero        verification failed
```

## Principles

1. Fail fast on real verification failures.
2. Produce readable output identifying which gate failed.
3. Do not modify source code.
4. Do not automatically fix linting or formatting.
5. Do not commit anything.
6. Do not update the `known-good` tag.
7. Produce deterministic results whenever possible.
8. Be runnable by humans, agents, CI, and `git bisect run`.

## Suggested structure

Use:

```bash
#!/usr/bin/env bash
set -euo pipefail
```

Then execute the applicable repository checks in a stable order.

## Suggested gates

Adapt these to the actual stack.

### 1. Dependency/environment sanity

Verify required tooling exists.

Do not silently install or upgrade dependencies unless the repository explicitly
defines that behavior.

### 2. Static/type checking

Examples:

```bash
npm run typecheck
tsc --noEmit
mypy .
cargo check
```

### 3. Lint

Examples:

```bash
npm run lint
ruff check .
cargo clippy
```

### 4. Unit tests

Run the complete unit test suite.

### 5. Regression tests

Run tests specifically protecting previously discovered bugs.

Prefer keeping these identifiable, for example:

```text
tests/regressions/
```

### 6. Integration tests

Run them when they are reasonably fast and deterministic.

### 7. Build

Verify that production/build artifacts can be produced.

### 8. Optional E2E

If E2E tests are expensive, maintain two commands:

```bash
./scripts/verify.sh
./scripts/verify-full.sh
```

`verify.sh` should remain strong enough to establish local confidence.

`verify-full.sh` may additionally execute expensive E2E/system checks.

## Output

Prefer explicit sections:

```text
=== TYPECHECK ===
PASS
=== UNIT TESTS ===
PASS
=== REGRESSION TESTS ===
PASS
=== BUILD ===
PASS
========================
VERIFICATION PASSED
========================
```

On failure, the script should preserve the underlying command's non-zero exit
code.

## Important

The verification script determines mechanical correctness only.

Passing `verify.sh` does NOT automatically make a commit known-good.

Promotion requires:

```text
verify.sh PASS
    +
reviewer/adversarial PASS
```
