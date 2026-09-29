#!/usr/bin/env bash
#
# Opt-in, network-dependent proof that the resident Safe address is the same on
# Ethereum mainnet and Sepolia, derived through the real Safe SDK against real
# RPCs.
#
# This is deliberately NOT run by ./scripts/verify.sh: it needs network access
# and real RPC endpoints, so it cannot be part of the offline canonical gate.
# Run it by hand when the chain-independent-Safe requirement is in question:
#
#   scripts/safe-chain-parity/run.sh
#
# It loads RPC endpoints from apps/web/.env.local when present (without
# overriding variables already exported), then runs the proof. It exits non-zero
# if the predicted addresses differ or if an RPC endpoint is missing.
#
# See apps/web/tests/proofs/safe-address-chain-parity.proof.ts for what is
# asserted and scripts/safe-chain-parity/README.md for details.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT/apps/web"

# Load the app's local environment (RPC endpoints live there) when present.
# `set -a` exports everything the file defines. The file is the app's local
# source of truth for these endpoints; to run without a `.env.local`, export
# ETHEREUM_RPC_URL and SEPOLIA_RPC_URL explicitly (the checks below enforce it).
if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.local
  set +a
fi

: "${ETHEREUM_RPC_URL:?ETHEREUM_RPC_URL is not set (provide apps/web/.env.local or export it)}"
: "${SEPOLIA_RPC_URL:?SEPOLIA_RPC_URL is not set (provide apps/web/.env.local or export it)}"

exec npx vitest run --config "$ROOT/scripts/safe-chain-parity/vitest.config.ts"
