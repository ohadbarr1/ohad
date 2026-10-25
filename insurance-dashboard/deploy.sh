#!/bin/zsh
# Build and deploy the site from a local folder outside the synced drive.
# Nothing is deployed unless: the commit is verified (deploy gate, below), the data gate passes (pipeline/gate.py), the code typechecks,
# the assembled site is complete, and every route renders without sideways scroll at 390 px, without ISO dates and with its own title
# (web/scripts/route-check.mjs).
# Deploy gate (docs/PIPELINE.md): no uncommitted tracked change (and no untracked file under web/src or web/public) when it starts;
# HEAD is on origin; the latest fox-ci run for HEAD succeeded. --force-unverified skips the gate, loudly. The data files the build
# steps regenerate are committed (fixed message) before the app is built and deployed, so the live site is exactly a commit.
# usage: ./deploy.sh [--check-only] [--force-unverified]
# The data files are copied in parallel (reads from the synced folder can take seconds each) and the app is bundled without them.
set -euo pipefail
ROOT="${0:A:h}"
OUT="${TMPDIR:-/tmp}/fox-dist"
export PATH="$HOME/.nvm/versions/node/v20.20.0/bin:$PATH"
PY=/usr/bin/python3  # the .venv on the synced drive takes minutes to import; the gate needs the standard library only
CHECK_ONLY=0; FORCE=0
for a in "$@"; do
  case "$a" in
    --check-only) CHECK_ONLY=1 ;;
    --force-unverified) FORCE=1 ;;
    *) echo "unknown option: $a (usage: ./deploy.sh [--check-only] [--force-unverified])"; exit 2 ;;
  esac
done
DATA_MSG="Deploy: commit the data files the deploy build regenerated"

cd "$ROOT"
# --- deploy gate: only a pushed, CI-green, clean commit goes live ---
gate_fail() { echo "deploy gate: $1"; echo "not deploying (./deploy.sh --check-only runs the checks without deploying; --force-unverified overrides the gate)"; exit 1; }
HEAD_SHA=$(git rev-parse HEAD)
PRE_UNTRACKED=$(git ls-files --others --exclude-standard -- .)
PRE_DIRTY=$(git status --porcelain --untracked-files=no -- .)
if (( CHECK_ONLY )); then
  echo "deploy gate: skipped (--check-only deploys nothing)"
elif (( FORCE )); then
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
  command -v gh >/dev/null || gate_fail "gh (GitHub CLI) not found: cannot read the fox-ci result for HEAD"
  run=$(gh run list --commit "$HEAD_SHA" --workflow fox-ci --limit 1 --json databaseId,status,conclusion --jq '.[0] | "\(.databaseId) \(.status) \(.conclusion)"' 2>/dev/null) \
    || gate_fail "gh could not list the fox-ci runs (gh auth status?)"
  [[ -n "$run" ]] || gate_fail "no fox-ci run for HEAD ${HEAD_SHA:0:8} yet (pushed just now? wait for it: gh run list --workflow fox-ci)"
  read -r run_id run_status run_conclusion <<< "$run"
  [[ "$run_status" == completed ]] || gate_fail "fox-ci run $run_id for HEAD ${HEAD_SHA:0:8} is $run_status (gh run watch $run_id)"
  [[ "$run_conclusion" == success ]] || gate_fail "fox-ci run $run_id for HEAD ${HEAD_SHA:0:8} concluded '$run_conclusion' (gh run view $run_id --log-failed)"
  echo "deploy gate: HEAD ${HEAD_SHA:0:8} is clean, on origin, fox-ci run $run_id green"
fi

cd "$ROOT"
# the build steps deploy has always run, through the pipeline graph (pipeline/dag.py, docs/PIPELINE.md): web index, calendar, KPI canon,
# peers registry (follows the canon), home slice of the regulator file, /data coverage. In dependency order; a step whose inputs, code and
# outputs are unchanged since its last run here is skipped (calendar and coverage rerun every day). Upstream builders are not run here
# (--no-deps); the DAG names any that are stale. `python3 pipeline/dag.py --dry-run` shows the plan.
"$PY" pipeline/dag.py --only deploy --no-deps || { echo "pipeline step failed: not deploying"; exit 1; }
"$PY" pipeline/gate.py || { echo "data gate failed: not deploying"; exit 1; }

# the files the build steps regenerated (tracked changes, and new files that were not lying around before) go into one commit, so the
# bundle's commit stamp and the deployed data are both that commit. --check-only leaves them in the working tree.
DATA_COMMIT=""
if (( ! CHECK_ONLY )) && [[ -n "$PRE_DIRTY" ]]; then
  echo "data commit: skipped: the tree was dirty before the build (--force-unverified), so live will not match a commit"
elif (( ! CHECK_ONLY )); then
  git add -u -- .
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

# the assembled site, served locally, checked route by route before anything is uploaded
node scripts/serve.mjs "$OUT" 4173 >/dev/null 2>&1 & SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
sleep 1
node --experimental-websocket scripts/route-check.mjs http://127.0.0.1:4173 2>/dev/null || { echo "route check failed: not deploying"; exit 1; }

(( CHECK_ONLY )) && { echo "checks passed; --check-only: not deploying"; exit 0; }
firebase deploy --only hosting --public "$OUT" | grep -E "found|Deploy complete|rror"
curl -s -o /dev/null -w "live: %{http_code}\n" https://fox-research-il.web.app/
echo "live = commit $(git rev-parse --short HEAD)${DATA_COMMIT:+ (data commit on top of ${HEAD_SHA:0:8}: git push it, so origin matches live)}"
