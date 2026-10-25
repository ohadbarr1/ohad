"""ops/autopilot.toml -> one dict with defaults. Standard library only: tomllib where Python has it (3.11+), else a small reader for the
subset the file uses (tables, `key = value` with strings, numbers, booleans and one-line arrays, `#` comments). FOX_AUTOPILOT_TOML
points at another file (tests)."""
import ast
import copy
import os
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent  # insurance-dashboard
TOML = ROOT / "ops" / "autopilot.toml"

DEFAULTS = {
    "repo": {"path": str(ROOT), "branch": ""},
    "schedule": {"timezone": "Asia/Jerusalem", "days": ["sun", "mon", "tue", "wed", "thu", "fri"], "start": "07:00", "end": "22:00",
                 "window_days": 10, "in_window_minutes": 15, "outside_minutes": 60, "regulator_hours": 24},
    "discovery": {"regulator": True, "maya_scheduled": False, "maya_permission_ref": "", "maya_interval_seconds": 2.0},
    "notify": {"enabled": True, "reminders": True},
    "llm": {"enabled": False, "approved_by": "", "approved_on": "", "season": "", "season_budget_tokens": 1_000_000,
            "per_filing_tokens": 120_000, "per_run_tokens": 300_000, "per_filing_max_usd": 4.0, "max_turns": 40, "model": "",
            "claude_bin": "claude"},
}


def _value(raw):
    raw = raw.strip()
    if raw in ("true", "false"):
        return raw == "true"
    if raw.startswith(('"', "'")):
        return ast.literal_eval(raw)
    if raw.startswith("["):
        return ast.literal_eval(re.sub(r"\btrue\b", "True", re.sub(r"\bfalse\b", "False", raw)))
    return ast.literal_eval(raw.replace("_", ""))


def _strip_comment(line):
    out, q = [], None
    for ch in line:
        if q:
            q = None if ch == q else q
        elif ch in "\"'":
            q = ch
        elif ch == "#":
            break
        out.append(ch)
    return "".join(out).strip()


def parse_toml(text):
    try:
        import tomllib  # noqa: PLC0415  (3.11+)
        return tomllib.loads(text)
    except ImportError:
        pass
    data, cur = {}, None
    for n, line in enumerate(text.splitlines(), 1):
        line = _strip_comment(line)
        if not line:
            continue
        m = re.fullmatch(r"\[([A-Za-z0-9_.-]+)\]", line)
        if m:
            cur = data.setdefault(m.group(1), {})
            continue
        k, sep, v = line.partition("=")
        if not sep:
            raise ValueError(f"autopilot.toml line {n}: expected key = value")
        (cur if cur is not None else data)[k.strip()] = _value(v)
    return data


def load(path=None):
    p = Path(path or os.environ.get("FOX_AUTOPILOT_TOML") or TOML)
    cfg = copy.deepcopy(DEFAULTS)
    if p.exists():
        for sec, vals in parse_toml(p.read_text(encoding="utf-8")).items():
            if isinstance(vals, dict):
                cfg.setdefault(sec, {}).update(vals)
    cfg["_path"] = str(p)
    cfg["repo"]["path"] = str(Path(os.path.expanduser(cfg["repo"]["path"])))
    return cfg


def maya_scheduled(cfg):
    """The schedule may call MAYA only with both switches set (TASE's written permission on record)."""
    d = cfg.get("discovery", {})
    return bool(d.get("maya_scheduled")) and bool(str(d.get("maya_permission_ref") or "").strip())


def llm_on(cfg):
    llm = cfg.get("llm", {})
    return bool(llm.get("enabled")) and bool(str(llm.get("approved_by") or "").strip()) and int(llm.get("season_budget_tokens") or 0) > 0
