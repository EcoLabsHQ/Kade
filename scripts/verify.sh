#!/usr/bin/env bash
#
# Canonical mechanical verification for this repository.
#
#   exit 0       verification passed
#   non-zero     verification failed
#
# See docs/VERIFY_GUIDE.md. This script never modifies source code, never fixes
# lint/format, never commits, and never moves the known-good tag.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FAILED=0
RAN=0

section() { printf '\n=== %s ===\n' "$1"; }
pass() { printf 'PASS\n'; }
fail() { printf 'FAIL\n'; FAILED=1; }

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
if [ -f foundry.toml ]; then
  if have forge; then
    printf 'forge: %s\n' "$(command -v forge)"
  else
    printf 'missing required tooling: forge\n'
    ENV_OK=0
  fi
fi
if [ "$ENV_OK" -eq 1 ]; then pass; else fail; fi

# ---------------------------------------------------------------------------
# 2-7. Stack gates (only when the stack exists)
# ---------------------------------------------------------------------------
if [ -f package.json ]; then
  has_npm_script typecheck && run "TYPECHECK" npm run --silent typecheck
  has_npm_script lint      && run "LINT"      npm run --silent lint
  has_npm_script test      && run "UNIT TESTS" npm run --silent test
  has_npm_script "test:regressions" && run "REGRESSION TESTS" npm run --silent test:regressions
  has_npm_script build     && run "BUILD"     npm run --silent build
fi

if [ -f foundry.toml ]; then
  have forge && run "FORGE BUILD" forge build
  have forge && run "FORGE TEST"  forge test
  if have forge && [ -d tests/regressions ] && [ -n "$(ls -A tests/regressions 2>/dev/null)" ]; then
    run "FORGE REGRESSION TESTS" forge test --match-path 'tests/regressions/*'
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
