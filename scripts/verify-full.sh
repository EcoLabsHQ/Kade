#!/usr/bin/env bash
#
# Full verification: canonical verification plus expensive integration/E2E/
# system checks. Use to close an important iteration or in CI.
#
#   exit 0       verification passed
#   non-zero     verification failed
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FAILED=0

section() { printf '\n=== %s ===\n' "$1"; }
pass() { printf 'PASS\n'; }
fail() { printf 'FAIL\n'; FAILED=1; }

have() { command -v "$1" >/dev/null 2>&1; }

has_npm_script() {
  [ -f package.json ] || return 1
  node -e "const p=require('./package.json');process.exit(p.scripts&&p.scripts['$1']?0:1)" 2>/dev/null
}

run() {
  local label="$1"; shift
  section "$label"
  if "$@"; then pass; else fail; fi
}

# 1. Fast canonical gate first; abort early if it fails.
section "VERIFY (fast)"
if "$ROOT/scripts/verify.sh"; then
  pass
else
  fail
  printf '\nFull verification aborted: ./scripts/verify.sh failed.\n'
  exit 1
fi

# 2. Expensive gates, only when configured.
if [ -f package.json ]; then
  has_npm_script "test:integration" && run "INTEGRATION TESTS" npm run --silent test:integration
  has_npm_script "test:e2e"         && run "E2E TESTS"         npm run --silent test:e2e
  has_npm_script "test:system"      && run "SYSTEM TESTS"      npm run --silent test:system
fi

if [ -f foundry.toml ] && have forge; then
  run "FORGE TEST (full)" forge test -vvv
elif [ -f packages/contracts/foundry.toml ] && have forge; then
  section "FORGE TEST (full)"
  if (cd packages/contracts && forge test -vvv); then pass; else fail; fi
fi

# 3. Supabase RLS tests (D2 evidence).
#
# These need a live Supabase database, so they cannot run in the fast gate. They
# are skipped LOUDLY rather than silently: a green run here must never be read as
# a verified RLS claim when no database was present.
section "SUPABASE RLS TESTS"
DB_URL="${SUPABASE_DB_URL:-${DATABASE_URL:-}}"
if [ -z "$DB_URL" ]; then
  printf 'SKIP: neither SUPABASE_DB_URL nor DATABASE_URL is set.\n'
  printf 'RLS IS NOT VERIFIED BY THIS RUN.\n'
  printf 'Start a Supabase database (supabase start) and re-run, or use: supabase test db\n'
elif ! have psql; then
  printf 'SKIP: psql not found, so the pgTAP suite cannot run.\n'
  printf 'RLS IS NOT VERIFIED BY THIS RUN.\n'
elif [ ! -d supabase/tests ]; then
  printf 'SKIP: supabase/tests does not exist.\n'
else
  for test_file in supabase/tests/*.test.sql; do
    [ -e "$test_file" ] || continue
    RAN=$((RAN + 1))
    section "RLS: $(basename "$test_file")"
    if psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$test_file"; then
      pass
    else
      fail
    fi
  done
fi

printf '\n'
if [ "$FAILED" -ne 0 ]; then
  printf '========================\n'
  printf 'FULL VERIFICATION FAILED\n'
  printf '========================\n'
  exit 1
fi

printf '========================\n'
printf 'FULL VERIFICATION PASSED\n'
printf '========================\n'
exit 0
