#!/bin/zsh
# Install the fox autopilot as a per-user launchd agent on this Mac (docs/AUTOPILOT.md).
#   ./ops/install-autopilot.sh            render the template for THIS checkout, run the tests and one status check, load the agent
#   ./ops/install-autopilot.sh --print    print the rendered plist and stop (nothing installed)
#   ./ops/install-autopilot.sh --kick     after installing, run one tick now (launchctl kickstart) and show the log
# Undo: ./ops/uninstall-autopilot.sh. What runs: pipeline/autopilot/tick.py every quarter hour; the cadence and every switch live in
# ops/autopilot.toml. Nothing it runs deploys, pushes or commits; MAYA is never called on a schedule without TASE's written permission.
set -euo pipefail
REPO="${0:A:h:h}"                      # insurance-dashboard/ of the checkout this script sits in
LABEL=com.fox.autopilot
DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGDIR="$HOME/Library/Logs/fox-autopilot"
PRINT=0; KICK=0
for a in "$@"; do
  case "$a" in
    --print) PRINT=1 ;;
    --kick) KICK=1 ;;
    *) echo "unknown option: $a (usage: install-autopilot.sh [--print] [--kick])"; exit 2 ;;
  esac
done

render() { sed -e "s|__REPO__|$REPO|g" -e "s|__HOME__|$HOME|g" "$REPO/ops/$LABEL.plist"; }
if (( PRINT )); then render; exit 0; fi

[[ "$(uname)" == Darwin ]] || { echo "launchd agents are macOS only"; exit 1; }
[[ -x /usr/bin/python3 ]] || { echo "/usr/bin/python3 not found (xcode-select --install)"; exit 1; }
[[ "$REPO" == */Library/CloudStorage/* ]] && { echo "refusing: this checkout is on the synced drive ($REPO); install from the local working copy (~/code/ohad)"; exit 1; }

# the checkout must be the one ops/autopilot.toml names
CONF_REPO=$(/usr/bin/python3 -c "import sys; sys.path.insert(0, '$REPO/pipeline/autopilot'); import conf; print(conf.load('$REPO/ops/autopilot.toml')['repo']['path'])")
if [[ "${CONF_REPO:A}" != "${REPO:A}" ]]; then
  echo "ops/autopilot.toml [repo] path = $CONF_REPO, but this script sits in $REPO."
  echo "Edit the toml (and commit it) or run the script from that checkout."; exit 1
fi

echo "== autopilot tests (fixtures, no network)"
( cd "$REPO" && FOX_NO_NOTIFY=1 /usr/bin/python3 -m unittest discover -s pipeline/autopilot/tests ) || { echo "tests failed: not installing"; exit 1; }

echo "== what the next tick would do"
( cd "$REPO" && /usr/bin/python3 pipeline/autopilot/tick.py --status | /usr/bin/python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d['next_tick_would'], ensure_ascii=False)); print('maya_scheduled:', d['maya_scheduled'], '· llm:', d['llm'])" )

mkdir -p "$LOGDIR" "$HOME/Library/LaunchAgents" "$HOME/.cache/fox/autopilot"
TMP=$(mktemp -t fox-autopilot-plist)
render > "$TMP"
plutil -lint "$TMP" >/dev/null
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true   # replace an older copy
mv "$TMP" "$DEST"
chmod 644 "$DEST"
launchctl bootstrap "gui/$(id -u)" "$DEST"
launchctl enable "gui/$(id -u)/$LABEL"
echo "== installed $DEST"
launchctl print "gui/$(id -u)/$LABEL" | grep -E "state|path|last exit" || true
echo "log: $LOGDIR/tick.log · state: ~/.cache/fox/autopilot/state.json · status: /usr/bin/python3 $REPO/pipeline/autopilot/tick.py --status"
echo "First run note: macOS may ask whether python3 may access the Google Drive folder (data/raw is a symlink there). Allow it, or the"
echo "regulator fetch will fail with 'Operation not permitted' in the log (System Settings > Privacy & Security > Files and Folders)."
if (( KICK )); then
  launchctl kickstart -k "gui/$(id -u)/$LABEL"
  sleep 20
  tail -n 30 "$LOGDIR/tick.log" || true
fi
