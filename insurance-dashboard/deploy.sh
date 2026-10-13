#!/bin/zsh
# Build and deploy the site from a local folder outside the synced drive.
# The data files are copied in parallel (reads from the synced folder can take seconds each), the app is bundled without them,
# and nothing is deployed unless the assembled site is complete.
set -euo pipefail
ROOT="${0:A:h}"
OUT="${TMPDIR:-/tmp}/fox-dist"
export PATH="$HOME/.nvm/versions/node/v20.20.0/bin:$PATH"
cd "$ROOT/web"
npx tsc --noEmit
rm -rf "$OUT" "$OUT-app"; mkdir -p "$OUT"
(cd public && find . -type d | while read d; do mkdir -p "$OUT/$d"; done && find . -type f ! -name ".*" -print0 | xargs -0 -P 32 -I{} cp "{}" "$OUT/{}")
NOPUBLIC=1 npx vite build --outDir "$OUT-app" --emptyOutDir | tail -1
cp -R "$OUT-app/." "$OUT/"
want=$(find public -type f ! -name ".*" | wc -l | tr -d ' ')
have=$(find "$OUT/data" "$OUT"/*.svg -type f | wc -l | tr -d ' ')
[[ -s "$OUT/index.html" && -n "$(ls "$OUT/assets"/index-*.js 2>/dev/null)" && "$have" -ge "$want" ]] || { echo "incomplete build ($have of $want data files): not deploying"; exit 1; }
firebase deploy --only hosting --public "$OUT" | grep -E "found|Deploy complete|rror"
curl -s -o /dev/null -w "live: %{http_code}\n" https://fox-research-il.web.app/
