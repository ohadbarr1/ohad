#!/bin/zsh
# Build and deploy the site from a local folder outside the synced drive.
# Nothing is deployed unless: the data gate passes (pipeline/gate.py), the code typechecks, the assembled site is complete,
# and every route renders without sideways scroll at 390 px, without ISO dates and with its own title (web/scripts/route-check.mjs).
# The data files are copied in parallel (reads from the synced folder can take seconds each) and the app is bundled without them.
set -euo pipefail
ROOT="${0:A:h}"
OUT="${TMPDIR:-/tmp}/fox-dist"
export PATH="$HOME/.nvm/versions/node/v20.20.0/bin:$PATH"
PY=/usr/bin/python3  # the .venv on the synced drive takes minutes to import; the gate needs the standard library only

cd "$ROOT"
"$PY" pipeline/build_web_index.py
"$PY" pipeline/build_calendar.py
"$PY" pipeline/gate.py || { echo "data gate failed: not deploying"; exit 1; }

cd "$ROOT/web"
npx tsc --noEmit
rm -rf "$OUT" "$OUT-app"; mkdir -p "$OUT"
(cd public && find . -type d | while read d; do mkdir -p "$OUT/$d"; done && find . -type f ! -name ".*" -print0 | xargs -0 -P 32 -I{} cp "{}" "$OUT/{}")
NOPUBLIC=1 npx vite build --outDir "$OUT-app" --emptyOutDir | tail -1
cp -R "$OUT-app/." "$OUT/"
want=$(find public -type f ! -name ".*" | wc -l | tr -d ' ')
have=$(find "$OUT/data" "$OUT"/*.svg -type f | wc -l | tr -d ' ')
[[ -s "$OUT/index.html" && -n "$(ls "$OUT/assets"/index-*.js 2>/dev/null)" && "$have" -ge "$want" ]] || { echo "incomplete build ($have of $want data files): not deploying"; exit 1; }

# the assembled site, served locally, checked route by route before anything is uploaded
node scripts/serve.mjs "$OUT" 4173 >/dev/null 2>&1 & SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
sleep 1
node --experimental-websocket scripts/route-check.mjs http://127.0.0.1:4173 2>/dev/null || { echo "route check failed: not deploying"; exit 1; }

[[ "${1:-}" == "--check-only" ]] && { echo "checks passed; --check-only: not deploying"; exit 0; }
firebase deploy --only hosting --public "$OUT" | grep -E "found|Deploy complete|rror"
curl -s -o /dev/null -w "live: %{http_code}\n" https://fox-research-il.web.app/
