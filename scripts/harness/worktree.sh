#!/usr/bin/env bash
#
# Orchestrator-owned task worktrees.
#
#   1 delegated implementation task = 1 branch = 1 worktree
#
# Git worktrees are the fallback below OpenCode-native worktrees
# (docs/orchestration.md section 6). This helper is non-destructive: removal
# refuses to discard uncommitted work or unintegrated commits unless --force is
# given explicitly.
#
# Usage:
#   worktree.sh create <task-id> [base-ref]   create branch task/<id> + worktree
#   worktree.sh list                          list worktrees
#   worktree.sh path <task-id>                print the worktree path
#   worktree.sh base <task-id>                print the worktree's base/HEAD sha
#   worktree.sh status                        dirty/unmerged summary per worktree
#   worktree.sh remove <task-id> [--force]    remove a safely disposable worktree
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

TREES_DIR=".worktrees"

die() { printf 'error: %s\n' "$1" >&2; exit 1; }
info() { printf '%s\n' "$1"; }

valid_id() {
  case "$1" in
    ''|*[!A-Za-z0-9._-]*) return 1 ;;
    *) return 0 ;;
  esac
}

branch_for() { printf 'task/%s' "$1"; }
path_for() { printf '%s/%s' "$TREES_DIR" "$1"; }

cmd_create() {
  local id="${1:-}" base="${2:-}"
  [ -n "$id" ] || die "create requires a task id"
  valid_id "$id" || die "invalid task id: $id (use [A-Za-z0-9._-])"

  local branch path
  branch="$(branch_for "$id")"
  path="$(path_for "$id")"

  if [ -z "$base" ]; then
    if git rev-parse --verify -q known-good >/dev/null; then
      base="known-good"
    else
      base="HEAD"
    fi
  fi
  git rev-parse --verify -q "$base^{commit}" >/dev/null \
    || die "base ref not found: $base"

  git show-ref --verify -q "refs/heads/$branch" \
    && die "branch already exists: $branch"
  [ -e "$path" ] && die "path already exists: $path"

  mkdir -p "$TREES_DIR"
  git worktree add -b "$branch" "$path" "$base" >/dev/null

  local base_sha
  base_sha="$(git -C "$path" rev-parse HEAD)"
  info "created"
  info "task_id:   $id"
  info "branch:    $branch"
  info "worktree:  $path"
  info "base:      $base"
  info "base_sha:  $base_sha"
}

cmd_list() { git worktree list; }

cmd_path() {
  local id="${1:-}"
  [ -n "$id" ] || die "path requires a task id"
  valid_id "$id" || die "invalid task id: $id"
  info "$(path_for "$id")"
}

cmd_base() {
  local id="${1:-}"
  [ -n "$id" ] || die "base requires a task id"
  valid_id "$id" || die "invalid task id: $id"
  local path
  path="$(path_for "$id")"
  [ -d "$path" ] || die "no worktree for task: $id"
  git -C "$path" rev-parse HEAD
}

# Is the task branch's tip already reachable from a trusted ref?
is_integrated() {
  local branch="$1" ref
  for ref in known-good HEAD main origin/main; do
    if git rev-parse --verify -q "$ref" >/dev/null 2>&1; then
      if git merge-base --is-ancestor "$branch" "$ref" 2>/dev/null; then
        return 0
      fi
    fi
  done
  return 1
}

cmd_status() {
  local found=0
  while IFS= read -r line; do
    case "$line" in
      "$ROOT/$TREES_DIR"/*)
        found=1
        local path branch dirty integrated
        path="${line%% *}"
        # `git worktree list` prints "<path> <sha> [branch]"
        branch="$(printf '%s\n' "$line" | sed -n 's/.*\[\(.*\)\].*/\1/p')"
        dirty="clean"
        if [ -n "$(git -C "$path" status --porcelain 2>/dev/null)" ]; then
          dirty="dirty"
        fi
        integrated="integrated"
        if [ -n "$branch" ] && ! is_integrated "$branch"; then
          integrated="unmerged"
        fi
        info "$(basename "$path"): $dirty, $integrated"
        ;;
    esac
  done < <(git worktree list)
  [ "$found" -eq 1 ] || info "no task worktrees under $TREES_DIR"
}

cmd_remove() {
  local id="${1:-}" force="${2:-}"
  [ -n "$id" ] || die "remove requires a task id"
  valid_id "$id" || die "invalid task id: $id"
  local branch path
  branch="$(branch_for "$id")"
  path="$(path_for "$id")"
  [ -d "$path" ] || die "no worktree for task: $id"

  if [ "$force" != "--force" ]; then
    if [ -n "$(git -C "$path" status --porcelain 2>/dev/null)" ]; then
      die "worktree $path has uncommitted work; commit it or pass --force"
    fi
    if git show-ref --verify -q "refs/heads/$branch" && ! is_integrated "$branch"; then
      die "branch $branch has unintegrated commits; integrate it or pass --force"
    fi
  fi

  git worktree remove "$path" --force >/dev/null
  if git show-ref --verify -q "refs/heads/$branch"; then
    git branch -D "$branch" >/dev/null
  fi
  info "removed worktree and branch for task: $id"
}

main() {
  local cmd="${1:-}"
  shift || true
  case "$cmd" in
    create) cmd_create "$@" ;;
    list)   cmd_list "$@" ;;
    path)   cmd_path "$@" ;;
    base)   cmd_base "$@" ;;
    status) cmd_status "$@" ;;
    remove) cmd_remove "$@" ;;
    ''|-h|--help|help)
      sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
      ;;
    *) die "unknown command: $cmd" ;;
  esac
}

main "$@"
