#!/bin/bash
# Fork-only desktop update pipeline, run by the desktop app's fork updater
# (apps/desktop/src/updates/ForkUpdates.ts) inside a dedicated worktree of the fork.
# Merges pingdotgg/t3code into origin/main, lets a headless Claude agent resolve
# conflicts only when needed, verifies, builds the macOS zip, and pushes.
#
#   scripts/fork-update.sh <version> <arch> <output-dir> <log-file>
#
# stdout carries only protocol lines for the app; everything else goes to <log-file>:
#   ::progress <0-100> <stage>   ::error <message>   ::done <zip path>
set -uo pipefail

TYPECHECK_DIRS=(apps/web apps/desktop apps/server apps/mobile packages/shared packages/client-runtime packages/contracts packages/ssh)

main() {
  local version="$1" arch="$2" out_dir="$3" log_file="$4"
  local worktree
  worktree="$(cd "$(dirname "$0")/.." && pwd)"
  mkdir -p "$out_dir" "$(dirname "$log_file")"
  exec 3>&1 >>"$log_file" 2>&1

  # Apps launched from Finder get a bare PATH, and rustup has no shims on this Mac.
  local rust_bin
  rust_bin="$(ls -d "$HOME"/.rustup/toolchains/stable-*/bin 2>/dev/null | head -1)"
  export PATH="$worktree/node_modules/.bin:${rust_bin:+$rust_bin:}$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

  progress() { printf '::progress %s %s\n' "$1" "$2" >&3; echo "== $2"; }
  fail() { echo "FAILED: $1"; printf '::error %s\n' "$1" >&3; exit 1; }

  [ "$(uname -s)" = Darwin ] || fail "fork updates only build on macOS"
  cd "$worktree" || fail "missing worktree $worktree"
  echo "== fork update to $version ($(date))"

  progress 2 "Fetching upstream"
  git fetch -q origin --prune && git fetch -q upstream --tags || fail "git fetch failed"
  # This worktree belongs to the updater: drop whatever an earlier failed run left behind.
  git merge --abort >/dev/null 2>&1
  git reset -q --hard origin/main && git clean -fdq

  progress 5 "Merging upstream"
  local needs_agent=""
  if git merge -q --no-edit -m "Merge upstream/main into main" upstream/main; then
    install_deps || fail "vp i failed after a clean merge"
    commit_lockfile
    typecheck 10 || needs_agent="The merge commit already exists and merged cleanly, but typecheck fails (run it to see the errors)."
  else
    needs_agent="A merge of upstream/main is in progress with $(git diff --name-only --diff-filter=U | wc -l | tr -d ' ') conflicted files (see git status)."
  fi

  if [ -n "$needs_agent" ]; then
    progress 12 "Resolving conflicts with Claude"
    run_agent "$needs_agent" || fail "the merge agent could not finish: $(tail -1 "$out_dir/agent.out" | cut -c1-200)"
  fi

  # Trust nothing the agent said; check the result directly.
  [ -z "$(git diff --name-only --diff-filter=U)" ] || fail "unmerged paths remain"
  git merge-base --is-ancestor upstream/main HEAD || fail "the fork does not contain upstream/main"
  ! git grep -qE '^(<<<<<<< HEAD|>>>>>>> upstream/main)' -- . || fail "conflict markers remain"
  progress 42 "Installing dependencies"
  install_deps || fail "vp i failed"
  commit_lockfile
  typecheck 45 || fail "typecheck fails after the merge"

  # T3 Connect's public Clerk/relay config comes from the gitignored .env; without it the build hides sign-in.
  local main_env
  main_env="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/.env"
  [ -e .env ] || { [ -f "$main_env" ] && ln -s "$main_env" .env; }
  grep -q '^T3CODE_CLERK_PUBLISHABLE_KEY=.' .env 2>/dev/null || fail "no .env with T3CODE_CLERK_PUBLISHABLE_KEY; T3 Connect would be disabled"

  progress 60 "Building the desktop app"
  rm -f "$out_dir"/T3-Code-*
  node scripts/build-desktop-artifact.ts --platform mac --target zip --arch "$arch" \
    --build-version "$version" --output-dir "$out_dir" 2>&1 | while IFS= read -r line; do
    echo "$line"
    case "$line" in
      *"Applied nightly web client branding"*) progress 72 "Staging the app" ;;
      *"Installing staged production dependencies"*) progress 80 "Installing app dependencies" ;;
      *"Building mac/zip"*) progress 86 "Packaging" ;;
    esac
  done
  local zip="$out_dir/T3-Code-$version-$arch.zip"
  [ -f "$zip" ] || fail "the desktop build failed"

  progress 97 "Pushing to the fork"
  # Fast-forward only: if origin/main moved meanwhile, the build still installs.
  git push -q origin HEAD:main || echo "push rejected; origin/main moved during the update"

  printf '::done %s\n' "$zip" >&3
}

install_deps() { vp i; }

commit_lockfile() {
  if [ -n "$(git status --porcelain)" ]; then
    git add -A && git commit -q -m "chore: refresh lockfile after upstream sync"
  fi
}

typecheck() {
  local percent="$1" dir failed=0
  for dir in "${TYPECHECK_DIRS[@]}"; do
    progress "$percent" "Typechecking $dir"
    percent=$((percent + 1))
    (cd "$dir" && tsc --noEmit -p .) || failed=1
  done
  return "$failed"
}

run_agent() {
  local state="$1" notes prompt
  notes="$HOME/.claude/projects/-Users-cn-Developer-Git-clone-t3code/memory/fork-sync-workflow.md"
  prompt="$(sed -e "s|{{STATE}}|$state|" -e "s|{{NOTES}}|$notes|g" scripts/fork-update-merge-prompt.md)"
  claude -p "$prompt" --model opus --permission-mode acceptEdits \
    --allowedTools Bash Read Edit Write Glob Grep --add-dir "$(dirname "$notes")" \
    --output-format text >"$out_dir/agent.out" 2>&1
  cat "$out_dir/agent.out"
  [[ "$(tail -1 "$out_dir/agent.out")" == SYNC_OK* ]]
}

# Everything runs from inside main(): `git reset` rewrites this file mid-run, and bash
# reads scripts lazily, so nothing may be read from disk after this line starts.
main "$@"; exit $?
