#!/bin/zsh
# A working copy of fox on the local disk, so typecheck and build take seconds instead of minutes.
# The repository is cloned from GitHub; the folders git does not track (page texts, raw regulator files, PDFs, XBRL)
# stay on Drive and are linked in. Nothing on Drive is moved or deleted. Usage: scripts/local-clone.sh [target, default ~/code/ohad]
set -euo pipefail
SRC="${0:A:h:h:h}"            # .../ohad (the Drive copy of the repository)
DST="${1:-$HOME/code/ohad}"
export PATH="$HOME/.nvm/versions/node/v20.20.0/bin:$PATH"
[[ -e "$DST" ]] && { echo "$DST exists: not touching it"; exit 1; }
mkdir -p "${DST:h}"
# clone from GitHub (seconds); cloning from the Drive copy stalls on Drive's on-demand file streaming
git clone --branch "$(git -C "$SRC" branch --show-current)" "$(git -C "$SRC" remote get-url origin)" "$DST"
git -C "$DST" remote add drive "$SRC"   # commits made on Drive since the last push: git fetch drive
for d in data/raw data/work data/sources/pdf data/sources/xbrl; do
  [[ -d "$SRC/insurance-dashboard/$d" ]] && { mkdir -p "$DST/insurance-dashboard/${d:h}"; ln -s "$SRC/insurance-dashboard/$d" "$DST/insurance-dashboard/$d"; }
done
cd "$DST/insurance-dashboard"
python3 -m venv .venv && .venv/bin/pip install -q -r pipeline/requirements.txt
(cd web && npm ci --no-audit --no-fund)
(cd web && time npx tsc --noEmit) && echo "local copy ready: $DST (remote 'drive' = the Drive copy, 'origin' = GitHub)"
