#!/bin/zsh
# Remove the fox autopilot launchd agent. ./ops/uninstall-autopilot.sh [--purge]  (--purge also deletes the local tick state and logs)
set -euo pipefail
LABEL=com.fox.autopilot
DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null && echo "unloaded $LABEL" || echo "$LABEL was not loaded"
[[ -f "$DEST" ]] && rm "$DEST" && echo "removed $DEST"
if [[ "${1:-}" == --purge ]]; then
  rm -rf "$HOME/.cache/fox/autopilot" "$HOME/Library/Logs/fox-autopilot"
  echo "purged ~/.cache/fox/autopilot and ~/Library/Logs/fox-autopilot"
fi
echo "the repo is untouched; web/public/data/autopilot/status.json keeps the last run"
