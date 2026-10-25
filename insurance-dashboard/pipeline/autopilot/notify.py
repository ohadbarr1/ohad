"""macOS notifications for the owner (osascript `display notification`). Local only: nothing leaves the Mac.

FOX_NO_NOTIFY=1 (tests, CI) or a non-macOS host records the message instead of showing it; every message is also returned to the caller
so status.json and the tick log carry the same text.
"""
import os
import platform
import subprocess

SENT = []  # what this process would have shown (tests read it)


def _esc(s):
    return str(s).replace("\\", "\\\\").replace('"', '\\"')


def show(title, body, subtitle=None):
    msg = {"title": title, "subtitle": subtitle, "body": body}
    SENT.append(msg)
    if os.environ.get("FOX_NO_NOTIFY") or platform.system() != "Darwin":
        return msg | {"shown": False}
    script = f'display notification "{_esc(body)}" with title "{_esc(title)}"' + (f' subtitle "{_esc(subtitle)}"' if subtitle else "")
    try:
        subprocess.run(["osascript", "-e", script], timeout=15, capture_output=True, check=False)
        return msg | {"shown": True}
    except Exception:  # noqa: BLE001  a notification is never worth failing a run
        return msg | {"shown": False}
