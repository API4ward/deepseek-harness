#!/usr/bin/env bash
# Create a sync/upstream-<date> branch from origin/master and merge an upstream DHS ref into it.
# Usage: alfredgo/scripts/sync-upstream.sh [upstream-ref]   (default: upstream/master)
# Environment: UPSTREAM_REPO (owner/name of upstream DHS), UPSTREAM_URL (overrides the derived URL).
# The script never pushes; it leaves the merge result or the conflicts for review.
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

upstream_repo=${UPSTREAM_REPO:-deepseek-harness/deepseek-harness}
upstream_url=${UPSTREAM_URL:-https://github.com/${upstream_repo}.git}
ref=${1:-upstream/master}
branch="sync/upstream-$(date +%Y-%m-%d)"

if ! git remote get-url upstream >/dev/null 2>&1; then
  echo "Adding remote 'upstream' -> ${upstream_url}"
  git remote add upstream "$upstream_url"
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is not clean; commit or stash first." >&2
  exit 1
fi

git fetch origin master
git fetch upstream --tags

if git show-ref --verify --quiet "refs/heads/${branch}"; then
  echo "Branch ${branch} already exists; delete or rename it first." >&2
  exit 1
fi

git config rerere.enabled true
git switch -c "$branch" origin/master

behind=$(git rev-list --count "HEAD..${ref}")
echo "Merging ${ref} (${behind} upstream commits not yet in origin/master) into ${branch}"

if git merge --no-ff --no-edit -m "chore(sync): merge upstream ${ref} into AlfredGo" "$ref"; then
  echo "Merge succeeded without conflicts."
else
  echo
  echo "Conflicts to resolve:"
  while IFS= read -r file; do
    if grep -Fq "| \`${file}\` |" alfredgo/PATCHES.md 2>/dev/null; then
      echo "  [AlfredGo patch] ${file}   -> re-apply the change recorded in alfredgo/PATCHES.md"
    else
      echo "  [not in ledger]  ${file}   -> take the upstream version unless the ledger is incomplete"
    fi
  done < <(git diff --name-only --diff-filter=U)
  echo
  echo "After resolving: git add <files> && git commit --no-edit"
fi

echo
echo "Next: pnpm install && pnpm run typecheck && pnpm run build, run the AlfredGo acceptance checks,"
echo "then: git push -u origin ${branch} and open a PR into master (merge with a merge commit, never squash)."
