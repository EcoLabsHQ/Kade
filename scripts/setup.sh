#!/usr/bin/env bash
#
# One-command setup for a clean checkout (week-1 contract D1: "a clean checkout
# installs, builds, and starts using documented commands").
#
# Safe to re-run. Does not modify tracked source, does not commit, does not
# touch the known-good tag.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

step() { printf '\n=== %s ===\n' "$1"; }

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'missing required tooling: %s\n' "$1" >&2
    exit 1
  fi
}

step "Checking tooling"
require node
require npm
printf 'node %s\nnpm  %s\n' "$(node --version)" "$(npm --version)"

step "Installing workspace dependencies"
npm install

# Foundry is only required for packages/contracts. It is optional so that a
# frontend-only contributor can still set up the workspace.
if command -v forge >/dev/null 2>&1; then
  step "Installing Foundry dependencies"
  # Pinned for reproducibility. Versions are recorded in
  # packages/contracts/README.md. --no-git keeps these out of the repository's
  # git state; safe-smart-account is LGPL-3.0 and is deliberately not vendored.
  (
    cd packages/contracts
    forge install foundry-rs/forge-std@v1.16.2 --no-git
    forge install safe-global/safe-smart-account@v1.4.1 --no-git
  )
else
  printf '\nforge not found: skipping Solidity dependencies.\n'
  printf 'Install Foundry, then re-run this script or run `forge install` in packages/contracts.\n'
fi

step "Next steps"
cat <<'EOF'
1. Copy .env.example to .env.local and fill in the values supplied by the project.
   The app runs, and says so clearly, when Supabase is not configured.
2. Run the mechanical gate:      ./scripts/verify.sh
3. Run the app:                  npm run dev
4. Full verification:            ./scripts/verify-full.sh
EOF
