#!/usr/bin/env bash
#
# Reproducible RLS verification (D2 evidence).
#
# Applies the Supabase shim, every migration and the seed to a disposable
# PostgreSQL, then runs the pgTAP suites. This is what turns the RLS claim from
# an assertion into executable evidence that anyone can regenerate.
#
# Usage:
#   ./scripts/db/rls-check.sh                          # spins up a Docker container
#   DATABASE_URL=postgresql://... ./scripts/db/rls-check.sh   # use an existing database
#
# Not part of scripts/verify.sh: it needs Docker or a live database, so it
# belongs to full verification. scripts/verify-full.sh runs the same suites when
# a database is already available; this script is how you create one.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

CONTAINER="kade-rls-check"
IMAGE="${KADE_RLS_PG_IMAGE:-postgres:16}"
DB_NAME="kadetest"

log() { printf '\n=== %s ===\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

DB_URL="${DATABASE_URL:-${SUPABASE_DB_URL:-}}"
if [ -n "$DB_URL" ]; then
  MODE="external"
  have psql || { printf 'DATABASE_URL is set but psql is not on PATH.\n' >&2; exit 2; }
else
  MODE="docker"
  have docker || {
    printf 'Set DATABASE_URL, or install Docker so this script can create one.\n' >&2
    exit 2
  }
fi

cleanup() {
  if [ "$MODE" = "docker" ]; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# sql <path-relative-to-repo>
sql() {
  local rel="$1"
  if [ "$MODE" = "docker" ]; then
    docker exec -i "$CONTAINER" psql -U postgres -d "$DB_NAME" -v ON_ERROR_STOP=1 -q -f "/repo/$rel"
  else
    psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$rel"
  fi
}

# sql_cmd <sql>
sql_cmd() {
  local cmd="$1"
  if [ "$MODE" = "docker" ]; then
    docker exec -i "$CONTAINER" psql -U postgres -d "$DB_NAME" -v ON_ERROR_STOP=1 -q -c "$cmd"
  else
    psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c "$cmd"
  fi
}

if [ "$MODE" = "docker" ]; then
  log "Starting $IMAGE"
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  # The repository is mounted read-only so the container can read the SQL without
  # this script ever writing to the working tree.
  docker run -d --name "$CONTAINER" \
    -v "$ROOT":/repo:ro -w /repo \
    -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB="$DB_NAME" \
    "$IMAGE" >/dev/null

  printf 'waiting for postgres'
  for _ in $(seq 1 60); do
    if docker exec "$CONTAINER" pg_isready -U postgres -q 2>/dev/null; then break; fi
    printf '.'; sleep 1
  done
  printf '\n'

  log "Installing pgTAP"
  docker exec "$CONTAINER" bash -c \
    'apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq postgresql-16-pgtap >/dev/null 2>&1'
fi

log "Applying the Supabase shim"
sql "supabase/tests/support/supabase-shim.sql"

if [ "$MODE" = "docker" ]; then
  sql_cmd "create extension if not exists pgtap with schema extensions;"
fi

log "Applying migrations"
for migration in supabase/migrations/*.sql; do
  printf '  %s\n' "$(basename "$migration")"
  sql "$migration"
done

log "Applying the seed"
sql "supabase/seed.sql"

log "Running the pgTAP suites"
FAILED=0
COUNT=0
for test_file in supabase/tests/*.test.sql; do
  [ -e "$test_file" ] || continue
  COUNT=$((COUNT + 1))
  printf '\n--- %s ---\n' "$(basename "$test_file")"

  if [ "$MODE" = "docker" ]; then
    output=$(docker exec -i "$CONTAINER" psql -U postgres -d "$DB_NAME" \
      -v ON_ERROR_STOP=1 -q -f "/repo/$test_file" 2>&1) || true
  else
    output=$(psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$test_file" 2>&1) || true
  fi

  printf '%s\n' "$output" | grep -E '^[[:space:]]*(not ok|ok [0-9]+)' | sed 's/^/  /' || true

  # pgTAP does not fail psql by default, so never trust the exit code alone.
  if printf '%s\n' "$output" | grep -qE '^[[:space:]]*not ok'; then
    printf '  FAILED\n'
    FAILED=1
  else
    printf '  PASSED\n'
  fi
done

printf '\n'
if [ "$FAILED" -ne 0 ]; then
  printf 'RLS VERIFICATION FAILED\n'
  exit 1
fi
printf 'RLS VERIFICATION PASSED (%s suites)\n' "$COUNT"
