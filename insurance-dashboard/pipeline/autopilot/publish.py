"""Opt-in auto-publish from the owner's Mac: ops/autopilot.toml [deploy] auto = true (default false; conf.deploy_on).

GitHub Actions (.github/workflows/fox-data.yml) is the main path. With this switch on, the Mac can publish a regulator month too, and the
two never fight: whoever pushes first wins, the other sees origin ahead and skips.

  preflight  (every acting tick, before the run)  git fetch; when origin is ahead and the tree is clean with no local commits: pull --ff-only
             (so a month CI already published is not fetched and rebuilt again here). Records whether the tree was clean.
  land       (after the run)  only when a regulator month landed and the gate passed, on a tree that was clean before the tick:
             fetch again; origin ahead (CI first) -> put back what the run regenerated, pull --ff-only, skip; local commits that are not on
             origin -> skip (it never pushes the owner's own work); else commit the data, push, and record a pending deploy.
  advance    (every tick)  a pending deploy waits for fox-ci on the pushed commit (gh run list); green -> ./deploy.sh (which re-checks
             everything: clean, on origin, not behind, fox-ci green, DAG, gate, build, route check); red, timed out, or the checkout or
             origin moved past it -> dropped, with a notification.

Every outcome is a macOS notification and a record in the tick state (st["deploy"]). git, gh and deploy.sh are injectable (tests).
"""
import datetime as dt
import os
import subprocess
from pathlib import Path

import conf
import notify


def _git(root, *args, timeout=120):
    try:
        p = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout.strip(), p.stderr.strip()
    except Exception as e:  # noqa: BLE001
        return 1, "", str(e)


def _gh_ci(root, sha):
    """(status, conclusion) of the latest fox-ci push run for sha, or None (no run yet, or gh failed)."""
    try:
        p = subprocess.run(["gh", "run", "list", "--commit", sha, "--workflow", "fox-ci", "--event", "push", "--limit", "1",
                            "--json", "status,conclusion", "--jq", '.[0] // empty | "\\(.status) \\(.conclusion)"'],
                           cwd=root, capture_output=True, text=True, timeout=60)
    except Exception:  # noqa: BLE001
        return None
    if p.returncode != 0 or not p.stdout.strip():
        return None
    st, _, concl = p.stdout.strip().partition(" ")
    return st, concl


def _deploy(root, timeout):
    """./deploy.sh in the checkout; (exit code, last lines of its output)."""
    try:
        p = subprocess.run(["./deploy.sh"], cwd=root, capture_output=True, text=True, timeout=timeout)
        out = (p.stdout + p.stderr).strip().splitlines()
        return p.returncode, " | ".join(x.strip() for x in out[-4:])[:400]
    except subprocess.TimeoutExpired:
        return 124, f"./deploy.sh still running after {timeout // 60} min: stopped"
    except Exception as e:  # noqa: BLE001
        return 1, str(e)[:300]


class Ops:
    """The side effects, swappable in tests."""

    def __init__(self, git=_git, gh_ci=_gh_ci, deploy=_deploy, show=notify.show, log=print):
        self.git, self.gh_ci, self.deploy, self.show, self.log = git, gh_ci, deploy, show, log


def _cfg(cfg):
    d = cfg.get("deploy") or {}
    return (cfg.get("repo") or {}).get("branch"), d.get("remote") or "origin", d


def _lines(s):
    return [x for x in (s or "").splitlines() if x.strip()]


def _counts(root, ops, remote, branch):
    """(ahead, behind) of HEAD against remote/branch after a fetch; None when origin cannot be read."""
    rc, _, err = ops.git(root, "fetch", "--quiet", remote, branch)
    if rc != 0:
        return None
    rc, out, _ = ops.git(root, "rev-list", "--left-right", "--count", f"HEAD...{remote}/{branch}")
    if rc != 0:
        return None
    a, b = out.split()
    return int(a), int(b)


def _record(st, **kw):
    d = st.setdefault("deploy", {})
    d["last"] = {**kw}
    return d["last"]


def preflight(root, cfg, ops=None, st=None):
    """Before an acting tick. Returns {clean, untracked, counts, pulled}."""
    ops = ops or Ops()
    branch, remote, _ = _cfg(cfg)
    _, dirty, _ = ops.git(root, "status", "--porcelain", "--untracked-files=no", "--", ".")
    _, untracked, _ = ops.git(root, "ls-files", "--others", "--exclude-standard", "--", ".")
    pre = {"clean": not dirty, "untracked": _lines(untracked), "counts": _counts(root, ops, remote, branch), "pulled": 0}
    if pre["counts"] and pre["counts"][1] > 0 and pre["counts"][0] == 0 and pre["clean"]:
        rc, _, err = ops.git(root, "pull", "--ff-only", "--quiet", remote, branch)
        if rc == 0:
            pre["pulled"] = pre["counts"][1]
            pre["counts"] = (0, 0)
            ops.log(f"publish: pulled {pre['pulled']} commit(s) from {remote}/{branch} before the run")
        else:
            ops.log(f"publish: pull --ff-only failed: {err[:200]}")
    return pre


def regulator_landed(res):
    """The new months of a run whose regulator fetch ran and succeeded (labels like 09/26), else []."""
    ok = any(s.get("step") == "regulator-fetch" and s.get("ok") and not s.get("planned") for s in res.get("steps") or [])
    reg = res.get("regulator") or {}
    if not ok or not reg.get("new"):
        return []
    import regulator as rg  # noqa: PLC0415
    return sorted({rg.month_label(d["upstream"]) for d in reg.get("datasets", []) if d.get("new") and d.get("upstream")})


def _put_back(root, ops, pre):
    """Undo what the run regenerated in a tree that was clean before it: tracked changes back to HEAD, new files removed."""
    _, changed, _ = ops.git(root, "diff", "--name-only", "--relative", "HEAD", "--", ".")
    files = _lines(changed)
    if files:
        ops.git(root, "restore", "--staged", "--worktree", "--source=HEAD", "--", *files)
    _, now_untracked, _ = ops.git(root, "ls-files", "--others", "--exclude-standard", "--", ".")
    for f in set(_lines(now_untracked)) - set(pre.get("untracked") or []):
        try:
            os.remove(Path(root) / f)  # the run's own output, minutes old; origin carries the published copy
        except OSError:
            pass
    return len(files)


def land(root, cfg, res, pre, st, now=None, ops=None):
    """After the run. Returns the record of what happened (also kept in st["deploy"]["last"]), or None when there is nothing to publish."""
    ops = ops or Ops()
    now = (now or dt.datetime.now()).isoformat(timespec="seconds")
    months = regulator_landed(res)
    if not months:
        return None
    label = ", ".join(months)
    branch, remote, _ = _cfg(cfg)
    gate = res.get("gate") or {}
    if not pre.get("clean"):
        ops.show("fox · פרסום אוטומטי דולג", f"{label}: היו שינויים לא שמורים לפני הריצה; לפרסום ידני: commit, push, ./deploy.sh")
        return _record(st, at=now, months=months, result="skipped", why="the tree had uncommitted changes before the tick")
    if not gate.get("ok") or res.get("_problems"):
        return _record(st, at=now, months=months, result="skipped", why="gate did not pass" if not gate.get("ok") else "run problems")
    counts = _counts(root, ops, remote, branch)
    if counts is None:
        ops.show("fox · פרסום אוטומטי נכשל", f"{label}: אין גישה ל-{remote}; הנתונים נשארו בתיקייה, לפרסום ידני")
        return _record(st, at=now, months=months, result="failed", why=f"cannot fetch {remote}/{branch}")
    ahead, behind = counts
    if behind > 0:
        n = _put_back(root, ops, pre)
        rc, _, err = ops.git(root, "pull", "--ff-only", "--quiet", remote, branch)
        ops.show("fox · CI הקדים", f"{label} כבר ב-{remote}; עודכן מקומית" + ("" if rc == 0 else " (pull נכשל: בדיקה ידנית)") + ", ללא פרסום מה-Mac")
        return _record(st, at=now, months=months, result="ci-first", why=f"{remote}/{branch} was {behind} commit(s) ahead",
                       restored=n, pulled=rc == 0)
    if ahead > 0:
        ops.show("fox · פרסום אוטומטי דולג", f"{label}: יש {ahead} commit מקומיים שלא נדחפו; לא נדחף דבר. לפרסום ידני: push, ./deploy.sh")
        return _record(st, at=now, months=months, result="skipped", why=f"{ahead} local commit(s) not on {remote}")
    ops.git(root, "add", "-u", "--", ".")
    _, now_untracked, _ = ops.git(root, "ls-files", "--others", "--exclude-standard", "--", ".")
    new = sorted(set(_lines(now_untracked)) - set(pre.get("untracked") or []))
    if new:
        ops.git(root, "add", "--", *new)
    rc, _, _ = ops.git(root, "diff", "--cached", "--quiet")
    if rc == 0:
        return _record(st, at=now, months=months, result="nothing", why="the run changed no tracked file")
    msg = f"data: regulator {label} (gemel-net, pensia-net, bituach-net), autopilot on the Mac"
    rc, _, err = ops.git(root, "commit", "--quiet", "-m", msg, "-m", "Built and gated by pipeline/autopilot (ops/autopilot.toml [deploy] auto).")
    if rc != 0:
        ops.show("fox · פרסום אוטומטי נכשל", f"{label}: commit נכשל: {err[:80]}")
        return _record(st, at=now, months=months, result="failed", why="commit failed: " + err[:200])
    _, sha, _ = ops.git(root, "rev-parse", "HEAD")
    rc, _, err = ops.git(root, "push", "--quiet", remote, f"HEAD:refs/heads/{branch}")
    if rc != 0:
        c = _counts(root, ops, remote, branch)
        if c and c[1] > 0:  # CI pushed in between: drop our commit (the tree was clean before it), take theirs
            ops.git(root, "reset", "--quiet", "--keep", f"{remote}/{branch}")
            ops.show("fox · CI הקדים", f"{label} נדחף ל-{remote} רגע לפני; עודכן מקומית, ללא פרסום מה-Mac")
            return _record(st, at=now, months=months, result="ci-first", why="push rejected: origin moved", sha=sha)
        ops.show("fox · פרסום אוטומטי נכשל", f"{label}: push נכשל ({err[:60]}); ה-commit נשאר מקומי, לדחיפה ידנית")
        return _record(st, at=now, months=months, result="failed", why="push failed: " + err[:200], sha=sha)
    st.setdefault("deploy", {})["pending"] = {"sha": sha, "branch": branch, "months": months, "since": now}
    ops.show("fox · נדחף, ממתין ל-CI", f"{label}: commit {sha[:8]} ב-{remote}; פרסום אוטומטי אחרי ש-fox-ci ירוק")
    return _record(st, at=now, months=months, result="pushed", sha=sha)


def advance(root, cfg, st, now=None, ops=None):
    """Every tick: move a pending deploy on. Returns the record when something was decided, else None (still waiting / nothing pending)."""
    ops = ops or Ops()
    pend = (st.get("deploy") or {}).get("pending")
    if not pend:
        return None
    now_dt = now or dt.datetime.now()
    nows = now_dt.isoformat(timespec="seconds")
    branch, remote, d = _cfg(cfg)
    label, sha = ", ".join(pend.get("months") or []), pend["sha"]

    def drop(result, why, title=None, body=None):
        st["deploy"].pop("pending", None)
        if title:
            ops.show(title, body or why)
        return _record(st, at=nows, months=pend.get("months"), result=result, why=why, sha=sha)
    _, head, _ = ops.git(root, "rev-parse", "HEAD")
    if head != sha:
        return drop("dropped", f"the checkout moved off {sha[:8]}", "fox · פרסום אוטומטי בוטל", f"{label}: התיקייה זזה מ-{sha[:8]}; לפרסום ידני: ./deploy.sh")
    c = _counts(root, ops, remote, branch)
    if c and c[1] > 0:
        return drop("dropped", f"{remote}/{branch} moved past {sha[:8]} (a newer commit: its publisher deploys it)",
                    "fox · פרסום אוטומטי בוטל", f"{label}: {remote} התקדם מעבר ל-{sha[:8]}; הגרסה החדשה מתפרסמת על ידי מי שדחף אותה")
    ci = ops.gh_ci(root, sha)
    try:
        age = (now_dt - dt.datetime.fromisoformat(pend["since"])).total_seconds() / 60
    except (KeyError, ValueError, TypeError):
        age = 0
    if not ci or ci[0] != "completed":
        if age > float(d.get("ci_wait_minutes") or 120):
            return drop("failed", f"fox-ci on {sha[:8]} not finished after {int(age)} min", "fox · פרסום אוטומטי נכשל",
                        f"{label}: fox-ci על {sha[:8]} לא הסתיים אחרי {int(age)} דקות; gh run list --workflow fox-ci")
        ops.log(f"publish: waiting for fox-ci on {sha[:8]} ({ci[0] if ci else 'no run yet'}, {int(age)} min)")
        return None
    if ci[1] != "success":
        return drop("failed", f"fox-ci on {sha[:8]} concluded {ci[1]}", "fox · פרסום אוטומטי נכשל",
                    f"{label}: fox-ci על {sha[:8]} נכשל ({ci[1]}); gh run view --log-failed")
    rc, tail = ops.deploy(root, int(float(d.get("deploy_timeout_minutes") or 30) * 60))
    if rc != 0:
        return drop("failed", f"./deploy.sh exit {rc}: {tail}", "fox · פרסום אוטומטי נכשל", f"{label}: ./deploy.sh נכשל: {tail[-120:]}")
    _, head2, _ = ops.git(root, "rev-parse", "HEAD")
    pushed = None
    if head2 != sha:  # deploy.sh committed the files its build steps regenerated: push it so origin matches live
        prc, _, _ = ops.git(root, "push", "--quiet", remote, f"HEAD:refs/heads/{branch}")
        pushed = prc == 0
    ops.show("fox · עלה לאתר", f"{label} באתר (commit {head2[:8]})" + ("" if pushed in (None, True) else " · דחיפת commit הנתונים נכשלה: git push"))
    st["deploy"].pop("pending", None)
    return _record(st, at=nows, months=pend.get("months"), result="deployed", sha=head2, data_commit_pushed=pushed)


def on(cfg):
    return conf.deploy_on(cfg)
