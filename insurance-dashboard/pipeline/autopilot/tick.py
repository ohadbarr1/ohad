"""The scheduled entry point: launchd (ops/com.fox.autopilot.plist) runs this every 15 minutes; schedule.py decides whether the tick acts.

/usr/bin/python3 pipeline/autopilot/tick.py            # what launchd runs
/usr/bin/python3 pipeline/autopilot/tick.py --status   # heartbeat, last result, what the next tick would do; runs nothing
/usr/bin/python3 pipeline/autopilot/tick.py --force    # act now whatever the cadence (still permitted channels only)

A tick that acts runs run.run(apply=True, trigger="schedule") over the permitted channels: the data.gov.il probe when it is due (daily),
local pickup, and MAYA only when ops/autopilot.toml carries TASE's permission (conf.maya_scheduled). It also sends at most one reminder a
day per company whose report is due and not yet in fox, with the manual command. It never deploys, pushes or commits.

Skips (logged, exit 0): another tick still running (lock), a merge/rebase in progress or a held index.lock, the checkout on another
branch than [repo] branch. Local state (not in the repo): $FOX_AUTOPILOT_HOME or ~/.cache/fox/autopilot/state.json.
"""
import argparse
import datetime as dt
import fcntl
import json
import os
import subprocess
import sys
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import conf  # noqa: E402
import notify  # noqa: E402
import schedule as sch  # noqa: E402
from common import Paths, read_json, write_json  # noqa: E402

HOME = Path(os.environ.get("FOX_AUTOPILOT_HOME") or Path.home() / ".cache" / "fox" / "autopilot")


def state_path():
    return HOME / "state.json"


def load_state():
    return read_json(state_path(), {}) or {}


def save_state(st):
    write_json(state_path(), st, compact=False)


def git_out(root, *args):
    p = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, timeout=30)
    return p.stdout.strip() if p.returncode == 0 else None


def guard(root, cfg):
    """None when the checkout is safe to write into, else the reason to skip."""
    gd = git_out(root, "rev-parse", "--absolute-git-dir")
    if gd is None:
        return None  # not a git checkout (tests): nothing to protect
    g = Path(gd)
    for marker in ("MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD", "index.lock"):
        if (g / marker).exists():
            return f"git busy ({marker})"
    want = (cfg.get("repo") or {}).get("branch") or ""
    have = git_out(root, "rev-parse", "--abbrev-ref", "HEAD")
    if want and have != want:
        return f"on branch {have}, the autopilot runs on {want}"
    return None


def il_date(d):
    return f"{d[8:10]}.{d[5:7]}.{d[2:4]}"


def reminders(cfg, calendar, state, now, log=print):
    """One notification for the companies due today that were not reminded today; returns the ids reminded."""
    if not (cfg.get("notify") or {}).get("enabled") or not (cfg.get("notify") or {}).get("reminders"):
        return []
    sc = cfg["schedule"]
    if not (sch._hm(sc["start"]) <= now.time() < sch._hm(sc["end"])):
        return []
    today = now.date().isoformat()
    seen = state.setdefault("reminded", {})
    due = [d for d in sch.due(calendar, now.date(), int(sc["window_days"])) if seen.get(d["id"]) != today]
    if not due:
        return []
    names = ", ".join(f"{d['name']} {sch_period(d['period'])}{' (באיחור)' if d['late'] else ''}" for d in due[:4]) + (" ועוד" if len(due) > 4 else "")
    ids = ",".join(d["id"] for d in due)
    notify.show("fox · דוח צפוי ועדיין לא ב-fox", f"{names} · משיכה ידנית: python3 pipeline/autopilot/run.py --maya-once --companies {ids}",
                subtitle=f"צפוי מ-{il_date(min(d['expected'] for d in due))}")
    for d in due:
        seen[d["id"]] = today
    log(f"reminded: {ids}")
    return [d["id"] for d in due]


def sch_period(p):
    return "" if not p else f"FY'{p[2:4]}" if p.endswith("FY") else f"{p[4:]}'{p[2:4]}"


def tick(paths=None, cfg=None, now=None, force=False, log=print, runner=None, http=None, transport=None):
    """One tick. Returns the record kept in the local state (tests call this with a pinned clock and fakes)."""
    cfg = cfg or conf.load()
    paths = paths or Paths()
    calendar = read_json(paths.data / "calendar.json", {}) or {}
    st = load_state()
    nowil = sch.now_il(cfg, now)
    dec = sch.decide(cfg, calendar, st, nowil)
    rec = {"at": nowil.isoformat(timespec="seconds"), "decision": dec, "acted": False}
    why = guard(paths.root, cfg)
    if why:
        rec["skipped"] = why
        log(f"skip: {why}")
    elif not (dec["act"] or force):
        rec["skipped"] = f"cadence {dec['cadence']} min ({dec['why']})"
    else:
        import run as runmod  # noqa: PLC0415  (imports the pipeline modules only when a tick acts)
        maya = conf.maya_scheduled(cfg)
        tr = transport
        if maya and tr is None:
            from common import Live  # noqa: PLC0415
            tr = Live(interval=max(2.0, float(cfg["discovery"]["maya_interval_seconds"])), log=log)
        res = (runner or runmod.run)(paths, tr, apply=True, do_poll=maya, regulator=dec["regulator"], http=http, cfg=cfg,
                                     trigger="schedule", today=nowil.date(), log=log)
        rec.update(acted=True, landed=res.get("_landed", []), problems=res.get("_problems", []), written=res.get("_written"))
        st["last_run"] = rec["at"]
        reg = res.get("regulator") if dec["regulator"] else None
        if dec["regulator"] and reg and not reg.get("errors"):
            st["last_regulator"] = rec["at"]
    rec["reminded"] = reminders(cfg, calendar, st, nowil, log=log)
    st["last_tick"] = rec
    save_state(st)
    return rec


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--status", action="store_true", help="print the heartbeat and what the next tick would do")
    ap.add_argument("--force", action="store_true", help="act now regardless of the cadence")
    a = ap.parse_args(argv)
    HOME.mkdir(parents=True, exist_ok=True)
    cfg = conf.load()
    if a.status:
        paths = Paths()
        st = load_state()
        dec = sch.decide(cfg, read_json(paths.data / "calendar.json", {}) or {}, st)
        print(json.dumps({"state": st, "next_tick_would": dec, "config": cfg["_path"], "maya_scheduled": conf.maya_scheduled(cfg),
                          "llm": conf.llm_on(cfg)}, ensure_ascii=False, indent=1))
        return 0
    with open(HOME / "tick.lock", "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(f"{dt.datetime.now().isoformat(timespec='seconds')} skip: the previous tick is still running")
            return 0
        try:
            rec = tick(force=a.force)
            print(json.dumps({k: rec[k] for k in ("at", "acted", "skipped", "landed", "problems", "reminded") if k in rec}, ensure_ascii=False))
        except Exception as e:  # noqa: BLE001  a crash is logged and notified once, launchd keeps the schedule
            traceback.print_exc()
            st = load_state()
            msg = f"{type(e).__name__}: {str(e)[:120]}"
            if st.get("last_crash") != msg:
                notify.show("fox · הטייס האוטומטי נכשל", msg + " · ~/Library/Logs/fox-autopilot/tick.log")
            st["last_crash"] = msg
            save_state(st)
    return 0


if __name__ == "__main__":
    sys.exit(main())
