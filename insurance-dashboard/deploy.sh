#!/bin/zsh
# Build and deploy the site from a local folder outside the synced drive.
# Nothing is deployed unless: the commit is verified (deploy gate, below), the data gate passes (pipeline/gate.py), the code typechecks,
# the assembled site is complete, and every route renders without sideways scroll at 390 px, without ISO dates and with its own title
# (web/scripts/route-check.mjs).
# Deploy gate (docs/PIPELINE.md): no uncommitted tracked change (and no untracked file under web/src or web/public) when it starts;
# HEAD is on origin and NOT behind it (an older checkout would put older data back over what CI or another machine published); the
# latest fox-ci run for HEAD succeeded (or, for a data commit built by .github/workflows/fox-data.yml, its commit status
# "fox-ci (fox-data)" is success: fox-ci ran there through workflow_call). --force-unverified skips the gate, loudly. The data files the
# build steps regenerate are committed (fixed message) before the app is built and deployed, so the live site is exactly a commit.
# --ci (fox-data.yml only): HEAD must equal $FOX_CI_SHA, the commit the workflow's fox-ci job verified, clean and at the tip of
# origin/$FOX_DEPLOY_BRANCH. The DAG and gate are not rerun (the workflow ran them on this commit and fox-ci reran the gate), nothing is
# committed, so live = that commit byte for byte; firebase deploys with the service account in GOOGLE_APPLICATION_CREDENTIALS.
# usage: ./deploy.sh [--check-only] [--force-unverified] [--ci]
# The data files are copied in parallel (reads from the synced folder can take seconds each) and the app is bundled without them.
set -euo pipefail
ROOT="${0:A:h}"
OUT="${TMPDIR:-/tmp}/fox-dist"
export PATH="$HOME/.nvm/versions/node/v20.20.0/bin:$PATH"
PY=/usr/bin/python3  # the .venv on the synced drive takes minutes to import; the gate needs the standard library only
CHECK_ONLY=0; FORCE=0; CI_MODE=0
for a in "$@"; do
  case "$a" in
    --check-only) CHECK_ONLY=1 ;;
    --force-unverified) FORCE=1 ;;
    --ci) CI_MODE=1 ;;
    *) echo "unknown option: $a (usage: ./deploy.sh [--check-only] [--force-unverified] [--ci])"; exit 2 ;;
  esac
done
(( CI_MODE && FORCE )) && { echo "--ci and --force-unverified do not mix"; exit 2; }
DATA_MSG="Deploy: commit the data files the deploy build regenerated"

cd "$ROOT"
# --- deploy gate: only a pushed, CI-green, clean commit goes live ---
gate_fail() { echo "deploy gate: $1"; echo "not deploying (./deploy.sh --check-only runs the checks without deploying; --force-unverified overrides the gate)"; exit 1; }
HEAD_SHA=$(git rev-parse HEAD)
PRE_UNTRACKED=$(git ls-files --others --exclude-standard -- .)
PRE_DIRTY=$(git status --porcelain --untracked-files=no -- .)
# the branch HEAD is compared with: its upstream, else origin/<current branch> ($FOX_DEPLOY_BRANCH in --ci)
BRANCH=${FOX_DEPLOY_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}
behind() {  # commits on origin's copy of the branch that HEAD lacks ("" when origin has no such branch)
  local up; up=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null) || up="origin/$BRANCH"
  git rev-parse --verify --quiet "$up" >/dev/null || return 0
  echo "$(git rev-list --count "HEAD..$up") $up"
}
if (( CI_MODE )); then
  [[ -n "${FOX_CI_SHA:-}" && -n "${FOX_DEPLOY_BRANCH:-}" ]] || gate_fail "--ci needs FOX_CI_SHA and FOX_DEPLOY_BRANCH (set by .github/workflows/fox-data.yml)"
  [[ "$HEAD_SHA" == "$FOX_CI_SHA" ]] || gate_fail "--ci: HEAD ${HEAD_SHA:0:8} is not the fox-ci verified commit ${FOX_CI_SHA:0:8}"
  [[ -z "$PRE_DIRTY" ]] || gate_fail "--ci: uncommitted changes to tracked files:
$PRE_DIRTY"
  git fetch --quiet origin "$FOX_DEPLOY_BRANCH" || gate_fail "--ci: cannot fetch origin/$FOX_DEPLOY_BRANCH"
  [[ "$(git rev-parse FETCH_HEAD)" == "$HEAD_SHA" ]] || gate_fail "--ci: origin/$FOX_DEPLOY_BRANCH is $(git rev-parse --short FETCH_HEAD), not ${HEAD_SHA:0:8} (push the verified commit first; a newer one is deployed by whoever pushed it)"
  echo "deploy gate (--ci): HEAD ${HEAD_SHA:0:8} = the fox-ci verified commit = origin/$FOX_DEPLOY_BRANCH, clean"
elif (( CHECK_ONLY )); then
  echo "deploy gate: skipped (--check-only deploys nothing)"
elif (( FORCE )); then
  git fetch --quiet origin 2>/dev/null && read -r nb up <<< "$(behind)" && (( ${nb:-0} > 0 )) \
    && echo "WARNING: HEAD is $nb commit(s) behind $up: this deploy may put older data or code back over the live site"
  print -P "%F{red}%B"
  echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
  echo "!!  --force-unverified: DEPLOYING WITHOUT THE DEPLOY GATE."
  echo "!!  HEAD ${HEAD_SHA:0:8} may be dirty, unpushed, or red in CI. The live site may not match any verified commit."
  echo "!!  Use only to restore service; push and get fox-ci green right after."
  echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
  print -P "%f%b"
  sleep 3
else
  dirty=$(git status --porcelain --untracked-files=no -- .)
  [[ -z "$dirty" ]] || gate_fail "uncommitted changes to tracked files (commit or stash them first):
$dirty"
  stray=$(git ls-files --others --exclude-standard -- web/src web/public)
  [[ -z "$stray" ]] || gate_fail "untracked files that would be built or deployed (commit or remove them):
$stray"
  git fetch --quiet origin || gate_fail "cannot reach origin to check that HEAD is pushed"
  [[ -n "$(git branch -r --contains "$HEAD_SHA" 2>/dev/null)" ]] || gate_fail "HEAD ${HEAD_SHA:0:8} is not on origin (git push first, then wait for fox-ci)"
  read -r nb up <<< "$(behind)"
  (( ${nb:-0} == 0 )) || gate_fail "HEAD ${HEAD_SHA:0:8} is $nb commit(s) behind $up (CI or another machine published newer data: git pull --ff-only first)"
  command -v gh >/dev/null || gate_fail "gh (GitHub CLI) not found: cannot read the fox-ci result for HEAD"
  run=$(gh run list --commit "$HEAD_SHA" --workflow fox-ci --limit 1 --event push --json databaseId,status,conclusion --jq '.[0] // empty | "\(.databaseId) \(.status) \(.conclusion)"' 2>/dev/null) \
    || gate_fail "gh could not list the fox-ci runs (gh auth status?)"
  if [[ -z "$run" ]]; then
    # a data commit of .github/workflows/fox-data.yml: fox-ci ran on it through workflow_call, recorded as a commit status
    cs=$(gh api "repos/{owner}/{repo}/commits/$HEAD_SHA/status" --jq '[.statuses[] | select(.context == "fox-ci (fox-data)")][0].state // empty' 2>/dev/null || true)
    [[ "$cs" == success ]] || gate_fail "no fox-ci run for HEAD ${HEAD_SHA:0:8} yet (pushed just now? wait for it: gh run list --workflow fox-ci)"
    run="fox-data success success"
  fi
  read -r run_id run_status run_conclusion <<< "$run"
  [[ "$run_status" == completed || "$run_status" == success ]] || gate_fail "fox-ci run $run_id for HEAD ${HEAD_SHA:0:8} is $run_status (gh run watch $run_id)"
  [[ "$run_conclusion" == success ]] || gate_fail "fox-ci run $run_id for HEAD ${HEAD_SHA:0:8} concluded '$run_conclusion' (gh run view $run_id --log-failed)"
  echo "deploy gate: HEAD ${HEAD_SHA:0:8} is clean, on origin, not behind it, fox-ci ${run_id/fox-data/(via fox-data)} green"
fi

cd "$ROOT"
# on any exit that leaves no data commit (--check-only, a failed check, a failed deploy), put back the tracked files the build steps
# regenerated, so the next run still passes the clean-tree gate; only when the tree was clean to begin with (never touch the owner's edits)
SRV=""
cleanup() {
  [[ -n "$SRV" ]] && kill "$SRV" 2>/dev/null
  [[ -n "$PRE_DIRTY" ]] && return 0
  local regen; regen=("${(@f)$(cd "$ROOT" && git diff --name-only HEAD -- .)}")
  if [[ -n "${regen[1]:-}" ]]; then
    (cd "$(git -C "$ROOT" rev-parse --show-toplevel)" && git restore --quiet --staged --worktree --source=HEAD -- "${regen[@]}") && echo "restored ${#regen} regenerated tracked file(s) to HEAD (nothing was committed)"
  fi
  local fresh; fresh=$(comm -13 <(print -r -- "$PRE_UNTRACKED" | sort) <(cd "$ROOT" && git ls-files --others --exclude-standard -- . | sort))
  [[ -z "$fresh" ]] || echo "note: the build left new untracked files (not removed):\n$fresh"
  return 0
}
trap cleanup EXIT
# the build steps deploy has always run, through the pipeline graph (pipeline/dag.py, docs/PIPELINE.md): web index, calendar, KPI canon,
# peers registry (follows the canon), home slice of the regulator file, /data coverage. In dependency order; a step whose inputs, code and
# outputs are unchanged since its last run here is skipped (calendar and coverage rerun every day). Upstream builders are not run here
# (--no-deps); the DAG names any that are stale. `python3 pipeline/dag.py --dry-run` shows the plan.
if (( CI_MODE )); then
  echo "--ci: the DAG and the gate ran on ${HEAD_SHA:0:8} in the workflow (and fox-ci reran the gate): not rerun, so live = the commit"
else
  "$PY" pipeline/dag.py --only deploy --no-deps || { echo "pipeline step failed: not deploying"; exit 1; }
  "$PY" pipeline/gate.py || { echo "data gate failed: not deploying"; exit 1; }
fi

# the files the build steps regenerated (tracked changes, and new files that were not lying around before) go into one commit, so the
# bundle's commit stamp and the deployed data are both that commit. --check-only leaves them in the working tree.
DATA_COMMIT=""
if (( CI_MODE )); then
  :  # nothing was regenerated
elif (( ! CHECK_ONLY )) && [[ -n "$PRE_DIRTY" ]]; then
  echo "data commit: skipped: the tree was dirty before the build (--force-unverified), so live will not match a commit"
elif (( ! CHECK_ONLY )); then
  git add -u -- .
  # S10: the answer-snapshot ledger is committed even when its file was already lying around (left by a --check-only run the same day),
  # so the committed watch.json always rebuilds from committed snapshots (gate `watch`)
  git add -- data/ledger/answers
  comm -13 <(print -r -- "$PRE_UNTRACKED" | sort) <(git ls-files --others --exclude-standard -- . | sort) | while read -r f; do [[ -n "$f" ]] && git add -- "$f"; done
  if ! git diff --cached --quiet; then
    git commit --quiet -m "$DATA_MSG" -m "Built by deploy.sh on top of ${HEAD_SHA:0:8} (fox-ci verified unless --force-unverified)."
    DATA_COMMIT=$(git rev-parse HEAD)
    echo "data commit: ${DATA_COMMIT:0:8} \"$DATA_MSG\" ($(git show --stat --format= HEAD | tail -1 | sed 's/^ *//'))"
  else
    echo "data commit: none (the build steps changed no file)"
  fi
fi

cd "$ROOT/web"
npx tsc --noEmit
rm -rf "$OUT" "$OUT-app"; mkdir -p "$OUT"
(cd public && find . -type d | while read d; do mkdir -p "$OUT/$d"; done && find . -type f ! -name ".*" -print0 | xargs -0 -P 32 -I{} cp "{}" "$OUT/{}")
NOPUBLIC=1 npx vite build --outDir "$OUT-app" --emptyOutDir | tail -1
cp -R "$OUT-app/." "$OUT/"
want=$(find public -type f ! -name ".*" | wc -l | tr -d ' ')
have=$(find "$OUT" -type f ! -path "$OUT/assets/*" ! -name index.html ! -name ".*" | wc -l | tr -d ' ')  # everything copied from public/: data, icons, manifest, service worker
[[ -s "$OUT/index.html" && -n "$(ls "$OUT/assets"/index-*.js 2>/dev/null)" && "$have" -ge "$want" ]] || { echo "incomplete build ($have of $want data files): not deploying"; exit 1; }
# D2 SEO: a copy of the shell with its own head for every saver entry point (funds/<k>.html, served by cleanUrls) and sitemap.xml
node scripts/prerender-seo.mjs "$OUT" || { echo "prerender failed: not deploying"; exit 1; }

# the assembled site, served locally, checked route by route before anything is uploaded
node scripts/serve.mjs "$OUT" 4173 >/dev/null 2>&1 & SRV=$!
sleep 1
node --experimental-websocket scripts/route-check.mjs http://127.0.0.1:4173 2>/dev/null || { echo "route check failed: not deploying"; exit 1; }

(( CHECK_ONLY )) && { echo "checks passed; --check-only: not deploying"; exit 0; }
if (( CI_MODE )); then
  firebase deploy --only hosting --public "$OUT" --project fox-research-il --non-interactive -m "fox-data ${HEAD_SHA:0:8}"
else
  firebase deploy --only hosting --public "$OUT" -m "deploy.sh $(git rev-parse --short HEAD)" | grep -E "found|Deploy complete|rror"
fi
curl -s -o /dev/null -w "live: %{http_code}\n" https://fox-research-il.web.app/
echo "live = commit $(git rev-parse --short HEAD)${DATA_COMMIT:+ (data commit on top of ${HEAD_SHA:0:8}: git push it, so origin matches live)}"
