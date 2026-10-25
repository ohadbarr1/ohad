"""Season-aware cadence. launchd wakes the job every 15 minutes (ops/com.fox.autopilot.plist); this module decides whether that tick acts.

  inside a filing window, on a filing day, 07:00-22:00 Israel time  -> every tick (15 min)
  any other time                                                      -> at most hourly
  data.gov.il regulator probe                                         -> at most once a day (regulator_hours)

A filing window is built from web/public/data/calendar.json: each active company's expected date of its next report, widened by its own
lo/hi range and by window_days on both sides; overlapping windows merge (the Q3'26 season: 10.11-10.12.26). All pure functions over
(now, config, calendar, state) so the tests pin any clock.
"""
import datetime as dt

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover  (3.9+ has it)
    ZoneInfo = None

DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]  # datetime.weekday() order
SLACK = dt.timedelta(minutes=2)  # launchd fires on the quarter hour; a run that took a minute must not push the next tick out


def tz(cfg):
    name = cfg["schedule"].get("timezone") or "Asia/Jerusalem"
    return ZoneInfo(name) if ZoneInfo else dt.timezone(dt.timedelta(hours=2))


def now_il(cfg, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=tz(cfg))
    return now.astimezone(tz(cfg))


def _d(s):
    return dt.date.fromisoformat(s[:10]) if s else None


def _hm(s):
    h, m = s.split(":")
    return dt.time(int(h), int(m))


def windows(calendar, window_days=10):
    """Merged filing windows [{start, end, companies, periods}] from calendar.json, sorted by start."""
    spans = []
    for c in (calendar or {}).get("companies", []):
        nx = c.get("next") or {}
        if c.get("inactive") or not nx.get("expected"):
            continue
        dates = [d for d in (_d(nx.get("lo")), _d(nx["expected"]), _d(nx.get("hi"))) if d]
        spans.append((min(dates) - dt.timedelta(days=window_days), max(dates) + dt.timedelta(days=window_days), c["id"], nx.get("period")))
    spans.sort()
    out = []
    for s, e, cid, per in spans:
        if out and s <= out[-1]["end"] + dt.timedelta(days=1):
            w = out[-1]
            w["end"] = max(w["end"], e)
            w["companies"].append(cid)
            if per and per not in w["periods"]:
                w["periods"].append(per)
        else:
            out.append({"start": s, "end": e, "companies": [cid], "periods": [per] if per else []})
    return out


def window_on(day, wins):
    return next((w for w in wins if w["start"] <= day <= w["end"]), None)


def cadence(cfg, now, wins):
    """(minutes, why) for the moment `now` (Israel time)."""
    sc = cfg["schedule"]
    day_ok = DAYS[now.weekday()] in [d.lower()[:3] for d in sc.get("days", [])]
    hours_ok = _hm(sc["start"]) <= now.time() < _hm(sc["end"])
    w = window_on(now.date(), wins)
    if w and day_ok and hours_ok:
        return int(sc["in_window_minutes"]), "window"
    return int(sc["outside_minutes"]), ("window-off-hours" if w else "season-off")


def _since(state, key, now):
    t = (state or {}).get(key)
    return None if not t else now - dt.datetime.fromisoformat(t)


def decide(cfg, calendar, state, now=None):
    """What this tick does: {act, cadence, why, regulator, window}. state: the local tick state (tick.py), ISO times."""
    now = now_il(cfg, now)
    wins = windows(calendar, int(cfg["schedule"]["window_days"]))
    minutes, why = cadence(cfg, now, wins)
    last = _since(state, "last_run", now)
    act = last is None or last >= dt.timedelta(minutes=minutes) - SLACK
    reg_last = _since(state, "last_regulator", now)
    regulator = bool(cfg["discovery"].get("regulator")) and (reg_last is None or reg_last >= dt.timedelta(hours=float(cfg["schedule"]["regulator_hours"])) - dt.timedelta(minutes=30))
    w = window_on(now.date(), wins)
    return {"act": act or regulator, "cadence": minutes, "why": why, "regulator": regulator, "now": now.isoformat(timespec="seconds"),
            "window": {"start": w["start"].isoformat(), "end": w["end"].isoformat()} if w else None}


def due(calendar, today, window_days=10):
    """Companies whose next report is due (expected date reached) and not yet in fox, up to window_days past their latest date."""
    out = []
    for c in (calendar or {}).get("companies", []):
        nx = c.get("next") or {}
        if c.get("inactive") or not nx.get("expected"):
            continue
        exp, hi = _d(nx["expected"]), _d(nx.get("hi")) or _d(nx["expected"])
        if exp <= today <= max(hi, exp) + dt.timedelta(days=window_days):
            out.append({"id": c["id"], "name": c.get("name", c["id"]), "period": nx.get("period"), "expected": nx["expected"],
                        "late": today > max(hi, exp)})
    return out


def summary(cfg, calendar, today=None):
    """The schedule as /data/autopilot shows it (deterministic for a given day: status.json only changes when the plan does)."""
    today = today or now_il(cfg).date()
    sc = cfg["schedule"]
    wins = windows(calendar, int(sc["window_days"]))
    cur = window_on(today, wins)
    nxt = next((w for w in wins if w["start"] > today), None)
    fmt = lambda w: w and {"start": w["start"].isoformat(), "end": w["end"].isoformat(), "companies": len(w["companies"]),  # noqa: E731
                           "periods": w["periods"]}
    return {"timezone": sc["timezone"], "days": sc["days"], "hours": [sc["start"], sc["end"]], "in_window_minutes": sc["in_window_minutes"],
            "outside_minutes": sc["outside_minutes"], "regulator_hours": sc["regulator_hours"], "window_days": sc["window_days"],
            "now": "window" if cur else "season-off", "current": fmt(cur), "next": fmt(nxt), "due": due(calendar, today, int(sc["window_days"]))}
