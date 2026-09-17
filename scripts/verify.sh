#!/usr/bin/env bash
#
# Canonical mechanical verification for this repository.
#
#   exit 0       verification passed
#   non-zero     verification failed
#
# See docs/VERIFY_GUIDE.md and docs/DEVELOPMENT_CONTRACT.md section 10.
# This script never modifies source code, never fixes lint/format, never
# commits, and never moves the known-good tag.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FAILED=0
RAN=0

section() { printf '\n=== %s ===\n' "$1"; }
pass() { printf 'PASS\n'; }
fail() { printf 'FAIL\n'; FAILED=1; }
note() { printf '%s\n' "$1"; }

have() { command -v "$1" >/dev/null 2>&1; }

# has_npm_script <name> -> 0 when package.json defines scripts.<name>
has_npm_script() {
  [ -f package.json ] || return 1
  node -e "const p=require('./package.json');process.exit(p.scripts&&p.scripts['$1']?0:1)" 2>/dev/null
}

# run <label> <command...>
run() {
  local label="$1"; shift
  section "$label"
  RAN=$((RAN + 1))
  if "$@"; then
    pass
  else
    fail
  fi
}

# run_in <dir> <label> <command...>
run_in() {
  local dir="$1"; shift
  local label="$1"; shift
  section "$label"
  RAN=$((RAN + 1))
  if (cd "$dir" && "$@"); then
    pass
  else
    fail
  fi
}

# ---------------------------------------------------------------------------
# 1. Dependency / environment sanity
# ---------------------------------------------------------------------------
section "ENVIRONMENT"
ENV_OK=1
if [ -f package.json ]; then
  for bin in node npm; do
    if have "$bin"; then
      printf '%s: %s\n' "$bin" "$(command -v "$bin")"
    else
      printf 'missing required tooling: %s\n' "$bin"
      ENV_OK=0
    fi
  done
fi

# Foundry may live at the repository root or in packages/contracts.
FOUNDRY_DIR=""
if [ -f foundry.toml ]; then
  FOUNDRY_DIR="."
elif [ -f packages/contracts/foundry.toml ]; then
  FOUNDRY_DIR="packages/contracts"
fi

if [ -n "$FOUNDRY_DIR" ]; then
  if have forge; then
    printf 'forge: %s (project: %s)\n' "$(command -v forge)" "$FOUNDRY_DIR"
  else
    printf 'missing required tooling: forge\n'
    ENV_OK=0
  fi
fi

if [ "$ENV_OK" -eq 1 ]; then pass; else fail; fi

# ---------------------------------------------------------------------------
# 2. JavaScript / TypeScript gates (only when the stack exists)
# ---------------------------------------------------------------------------
if [ -f package.json ]; then
  has_npm_script typecheck        && run "TYPECHECK"         npm run --silent typecheck
  has_npm_script lint             && run "LINT"              npm run --silent lint
  has_npm_script test             && run "UNIT TESTS"        npm run --silent test
  has_npm_script "test:acceptance" && run "ACCEPTANCE TESTS" npm run --silent test:acceptance

  if has_npm_script "test:regressions"; then
    section "REGRESSION TESTS"
    RAN=$((RAN + 1))
    REG_COUNT=$(find tests/regressions -name '*.test.ts' -o -name '*.test.tsx' 2>/dev/null | wc -l | tr -d ' ')
    if npm run --silent test:regressions; then
      pass
      if [ "$REG_COUNT" -eq 0 ]; then
        note "WARNING: the regression suite is empty (0 test files)."
        note "That is expected only before the first reproducible bug is fixed;"
        note "an empty suite proves nothing about past regressions."
      else
        printf 'regression test files: %s\n' "$REG_COUNT"
      fi
    else
      fail
    fi
  fi

  has_npm_script build            && run "BUILD"             npm run --silent build
fi

# ---------------------------------------------------------------------------
# 3. Solidity gates (only when the stack exists)
# ---------------------------------------------------------------------------
if [ -n "$FOUNDRY_DIR" ] && have forge; then
  run_in "$FOUNDRY_DIR" "FORGE BUILD" forge build
  run_in "$FOUNDRY_DIR" "FORGE TEST"  forge test
  if [ -d "$FOUNDRY_DIR/test/regressions" ] && [ -n "$(ls -A "$FOUNDRY_DIR/test/regressions" 2>/dev/null)" ]; then
    run_in "$FOUNDRY_DIR" "FORGE REGRESSION TESTS" forge test --match-path 'test/regressions/*'
  fi
fi

# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------
printf '\n'
if [ "$FAILED" -ne 0 ]; then
  printf '========================\n'
  printf 'VERIFICATION FAILED\n'
  printf '========================\n'
  exit 1
fi

if [ "$RAN" -eq 0 ]; then
  printf '========================================================\n'
  printf 'WARNING: NO VERIFICATION TARGETS CONFIGURED\n'
  printf '========================================================\n'
  printf 'No package.json or foundry.toml checks were found, so this\n'
  printf 'run proved nothing. Wire the real gates before trusting it.\n'
  printf 'Set VERIFY_STRICT=1 to fail instead of passing vacuously.\n'
  printf '========================================================\n'
  if [ "${VERIFY_STRICT:-0}" = "1" ]; then
    exit 1
  fi
  exit 0
fi

printf '========================\n'
printf 'VERIFICATION PASSED\n'
printf '========================\n'
exit 0
