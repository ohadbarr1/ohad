"""S10 Watch & Wake: web/public/data/watch.json, the build-to-build diff of what the answers and findings SAY, and the calendar of what
comes next. Built from the append-only ledger data/ledger/answers/<YYYY-MM-DD>.json (pipeline/snapshot_answers.py writes one per build
day) plus calendar.json, feed.json and nowcast.json. Deterministic given those files: nothing depends on today's date (the page computes
the days to go and drops what has passed).

A change is reported when an answer's answer changes, not when its data updates: two consecutive snapshots are compared per id.
  kind  answer    the corridor changed. sev "verdict": the verdict key (vk) changed, the answer took another branch; "figure": the
                  verdict held and the number in the corridor moved; "falsifier": the falsifier went from tripped back to holds
        tripped   the falsifier crossed its threshold since the previous snapshot (holds -> tripped)
        finding   a finding's corridor changed (sev verdict / figure as above; "top": it entered or left the leading findings)
        new       an id that the previous snapshot did not have (a new question or a new finding)
        gone      an id that the previous snapshot had and this one does not
  d = the date of the snapshot where the change was first seen, pd = the previous snapshot's date; from / to = {vk, corr, cs, cf, h,
  chg} of each side (null for new / gone); topic and cos so the browser can match its subscriptions (a question, a finding, a topic, a
  company). An answer whose signature h is unchanged is never reported.

upcoming = what the prep queue needs, each with its date, window and source:
  report     calendar.json: each company's next expected report (median lag of the same report, last three years), lo / hi window
  regmonth   the regulator's next month: expected from the pattern of the past regulator months in feed.json whose arrival day is known
             (dk fetched / pub): the median months after the month and day of month. Labelled an estimate (est) with the number of
             observations it rests on; without one, nowcast.json's PUB_DAY convention, labelled as such
  qend       quarter ends: the nowcast's live quarter and the next one (the quarter whose pre-report estimate starts)

python3 pipeline/build_watch.py           write web/public/data/watch.json
python3 pipeline/build_watch.py --check   rebuild in memory and compare; every ledger file valid (name = its date, shape); gate `watch`
                                          (the append-only check against git HEAD is gate `watch_ledger`, pipeline/gate.py)
Standard library only.
"""
import argparse
import datetime as dt
import json
import re
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import answer_core as A  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
LEDGER = ROOT / "data" / "ledger" / "answers"
OUT = A.DATA / "watch.json"
KEEP_DAYS = 400   # changes first seen within this many days of the latest snapshot
DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
KINDS = ("answer", "tripped", "finding", "new", "gone")


# ------------------------------------------------------------------------------------------------ the ledger
def load_ledger(ledger=LEDGER):
    """[(date, snapshot)] sorted by date, and the problems found (name, shape)"""
    snaps, bad = [], []
    for p in sorted(ledger.glob("*.json")) if ledger.exists() else []:
        try:
            s = json.loads(p.read_text(encoding="utf-8"))
        except ValueError as e:
            bad.append(f"{p.name}: not JSON ({e})")
            continue
        if not DATE.fullmatch(p.stem) or s.get("date") != p.stem:
            bad.append(f"{p.name}: file name and date {s.get('date')!r} differ")
            continue
        if not isinstance(s.get("answers"), dict) or not isinstance(s.get("findings"), dict):
            bad.append(f"{p.name}: no answers / findings maps")
            continue
        for k, e in list(s["answers"].items()) + list(s["findings"].items()):
            miss = [x for x in ("st", "vk", "corr", "chg_st", "cos") if x not in e]
            if miss:
                bad.append(f"{p.name}/{k}: no {miss[0]}")
                break
        snaps.append((p.stem, s))
    return snaps, bad


# ------------------------------------------------------------------------------------------------ the diff
def side(e):
    if e is None:
        return None
    return {"vk": e.get("vk"), "corr": e.get("corr"), "cs": e.get("cs"), "cf": e.get("cf"), "h": e.get("h"), "chg": e.get("chg_st")}


def _one(i, a, b, d, pd, finding):
    """the change of one id between snapshot entries a (before) and b (after), or None"""
    meta = b or a
    base = {"d": d, "pd": pd, "id": i, "topic": None if finding else meta.get("topic"), "cos": list(meta.get("cos") or []),
            "q": None if finding else meta.get("q"), "det": meta.get("det") if finding else None}
    if a is None:
        return {**base, "kind": "new", "sev": None, "from": None, "to": side(b)}
    if b is None:
        return {**base, "kind": "gone", "sev": None, "from": side(a), "to": None}
    if a.get("chg_st") != "tripped" and b.get("chg_st") == "tripped":
        return {**base, "kind": "tripped", "sev": "verdict" if a.get("vk") != b.get("vk") else None, "from": side(a), "to": side(b)}
    sev = None
    if a.get("vk") != b.get("vk") or a.get("st") != b.get("st"):
        sev = "verdict"
    elif a.get("chg_st") == "tripped" and b.get("chg_st") != "tripped":
        sev = "falsifier"
    elif a.get("corr") != b.get("corr"):
        sev = "figure"
    elif finding and bool(a.get("top")) != bool(b.get("top")):
        sev = "top"
    if not sev:
        return None
    return {**base, "kind": "finding" if finding else "answer", "sev": sev, "from": side(a), "to": side(b)}


def diff(prev, cur):
    """the changes from snapshot `prev` to snapshot `cur`, in a stable order (answers by id, then findings by id)"""
    out = []
    d, pd = cur["date"], prev["date"]
    for group, finding in (("answers", False), ("findings", True)):
        A_, B_ = prev.get(group, {}), cur.get(group, {})
        for i in sorted(set(A_) | set(B_)):
            c = _one(i, A_.get(i), B_.get(i), d, pd, finding)
            if c:
                out.append(c)
    return out


def changes(snaps):
    out = []
    for (_, a), (_, b) in zip(snaps, snaps[1:]):
        out += diff(a, b)
    if snaps:
        last = dt.date.fromisoformat(snaps[-1][0])
        cut = (last - dt.timedelta(days=KEEP_DAYS)).isoformat()
        out = [c for c in out if c["d"] >= cut]
    # newest first; within a day: verdict-level kinds first, then by id
    rank = {"tripped": 0, "answer": 1, "finding": 2, "new": 3, "gone": 4}
    sevr = {"verdict": 0, "falsifier": 1, "top": 2, "figure": 3, None: 0}
    return sorted(out, key=lambda c: (_neg(c["d"]), rank[c["kind"]], sevr[c["sev"]], c["id"]))


def _neg(d):
    return tuple(-int(x) for x in d.split("-"))


# ------------------------------------------------------------------------------------------------ upcoming
def plabel(p):
    """calendar period "2026Q3" -> "Q3'26", "2026FY" -> "FY'26", "2026H1" -> "H1'26" """
    m = re.fullmatch(r"(\d{4})(Q[1-4]|FY|H[12])", p or "")
    return f"{m.group(2)}'{m.group(1)[2:]}" if m else (p or "")


def _add_months(y, m, k):
    t = y * 12 + (m - 1) + k
    return t // 12, t % 12 + 1


def _clip_day(y, m, day):
    nxt = dt.date(*_add_months(y, m, 1), 1)
    return min(day, (nxt - dt.timedelta(days=1)).day)


def regmonth_next(feed, nowcast):
    """(latest regulator month {per, label, d, dk} or None, the next month's expected entry or None)"""
    ev = [e for e in (feed or {}).get("events", []) if e.get("t") == "regmonth" and re.fullmatch(r"\d{6}", str(e.get("per", "")))]
    if not ev:
        return None, None
    last = max(ev, key=lambda e: e["per"])
    latest = {"per": last["per"], "label": A.ym(int(last["per"])), "d": last.get("d"), "dk": last.get("dk")}
    obs = []
    for e in ev:
        if e.get("dk") in ("fetched", "pub") and DATE.fullmatch(e.get("d") or ""):
            y, m = int(e["per"][:4]), int(e["per"][4:])
            d = dt.date.fromisoformat(e["d"])
            obs.append(((d.year * 12 + d.month) - (y * 12 + m), d.day, e))
    y, m = _add_months(int(last["per"][:4]), int(last["per"][4:]), 1)
    nper = f"{y}{m:02d}"
    lab = A.ym(int(nper))
    if obs:
        off = int(statistics.median_low([o[0] for o in obs]))
        day = int(statistics.median_low([o[1] for o in obs]))
        ey, em = _add_months(y, m, off)
        exp = dt.date(ey, em, _clip_day(ey, em, day))
        days = [dt.date(*_add_months(y, m, o[0]), _clip_day(*_add_months(y, m, o[0]), o[1])) for o in obs]
        seen = "; ".join(f"{A.ym(int(o[2]['per']))} {'נקלט' if o[2]['dk'] == 'fetched' else 'פורסם'} ב-{A.dlab(o[2]['d'])}" for o in sorted(obs, key=lambda o: o[2]["per"]))
        src = (f"אומדן לפי {'חודש אחד' if len(obs) == 1 else f'{len(obs)} חודשים'} של הרשות {'שמועד הגעתו ידוע' if len(obs) == 1 else 'שמועד הגעתם ידוע'} (feed.json): {seen}. "
               f"יום הקליטה הוא חסם עליון למועד הפרסום")
        return latest, {"d": exp.isoformat(), "lo": min(days).isoformat(), "hi": max(days).isoformat(), "c": "market", "kind": "regmonth",
                        "per": nper, "what": f"נתוני רשות שוק ההון ל-{lab} (גמל-נט, פנסיה-נט, ביטוח-נט)", "src": src, "est": True, "n": len(obs)}
    pub = ((nowcast or {}).get("params") or {}).get("PUB_DAY")
    if not pub:
        return latest, None
    ey, em = _add_months(y, m, 2)
    exp = dt.date(ey, em, _clip_day(ey, em, int(pub)))
    return latest, {"d": exp.isoformat(), "lo": exp.isoformat(), "hi": exp.isoformat(), "c": "market", "kind": "regmonth", "per": nper,
                    "what": f"נתוני רשות שוק ההון ל-{lab} (גמל-נט, פנסיה-נט, ביטוח-נט)", "est": True, "n": 0,
                    "src": f"אומדן: אין חודש עם מועד הגעה ידוע ב-feed.json; לפי מוסכמת האומדן לפני הדוח (nowcast.json PUB_DAY = יום {pub} בחודש השני שאחרי)"}


def quarter_ends(nowcast):
    live = (((nowcast or {}).get("meta") or {}).get("live") or {}).get("q")
    m = re.fullmatch(r"Q([1-4])-(\d{4})", live or "")
    if not m:
        return []
    q, y = int(m.group(1)), int(m.group(2))
    out = []
    for k in (0, 1):
        qq, yy = (q + k - 1) % 4 + 1, y + (q + k - 1) // 4
        end = dt.date(yy, qq * 3, _clip_day(yy, qq * 3, 31))
        lab = f"Q{qq}'{str(yy)[2:]}"
        what = (f"סוף רבעון {lab}: הרבעון שהאומדן לפני הדוח מכסה עכשיו" if k == 0
                else f"סוף רבעון {lab}: מכאן נפתח האומדן לפני הדוח של {lab}")
        out.append({"d": end.isoformat(), "lo": end.isoformat(), "hi": end.isoformat(), "c": "market", "kind": "qend", "per": f"Q{qq}-{yy}",
                    "what": what, "src": f"nowcast.json: הרבעון החי {live.replace('-', ' ')}, שלב {((nowcast.get('meta') or {}).get('live') or {}).get('stage', '–')}",
                    "est": False})
    return out


def upcoming(cal, feed, nowcast):
    out = []
    basis = (cal or {}).get("basis", "")
    for c in (cal or {}).get("companies", []):
        n = c.get("next") or {}
        if not n.get("expected"):
            continue
        lags = n.get("lags") or []
        out.append({"d": n["expected"], "lo": n.get("lo") or n["expected"], "hi": n.get("hi") or n["expected"], "c": c["id"], "kind": "report",
                    "per": n.get("period"), "what": f"{'דוח שנתי' if str(n.get('period', '')).endswith('FY') else 'דוח'} {plabel(n.get('period'))}",
                    "src": f"calendar.json: {basis}" + (f" ({len(lags)} דוחות)" if lags else ""), "est": True, "n": len(lags)})
    latest, reg = regmonth_next(feed, nowcast)
    if reg:
        out.append(reg)
    out += quarter_ends(nowcast)
    return latest, sorted(out, key=lambda u: (u["d"], u["kind"], u["c"]))


# ------------------------------------------------------------------------------------------------ the file
def build(ledger=LEDGER):
    snaps, bad = load_ledger(ledger)
    read = lambda p: json.loads((A.DATA / p).read_text(encoding="utf-8")) if (A.DATA / p).exists() else None  # noqa: E731
    latest, up = upcoming(read("calendar.json"), read("feed.json"), read("nowcast.json"))
    ch = changes(snaps)
    out = {
        "v": 1,
        "asof": snaps[-1][0] if snaps else None,
        "snaps": [d for d, _ in snaps],
        "snapsrc": {d: s.get("src", "build") for d, s in snaps},
        "n": {k: sum(c["kind"] == k for c in ch) for k in KINDS},
        "changes": ch,
        "upcoming": up,
        "latest_regmonth": latest,
        "rule": "שינוי = מה שהתשובה אומרת השתנה בין שתי בניות עוקבות (מפתח הפסיקה או משפט המסדרון), לא עדכון נתונים שהשאיר אותה כפי שהיא",
    }
    return out, bad


def problems(w):
    out = []
    for c in w["changes"]:
        if c["kind"] not in KINDS:
            out.append(f"{c['id']}: kind {c['kind']}")
        if (c["from"] is None) != (c["kind"] == "new") or (c["to"] is None) != (c["kind"] == "gone"):
            out.append(f"{c['id']} {c['d']}: from / to do not fit kind {c['kind']}")
        for s in (c["from"], c["to"]):
            if s and s.get("corr") and A.FIRST_PERSON.search(s["corr"]):
                out.append(f"{c['id']}: first-person framing")
    out += A.banned(w)
    return out


def dump(o):
    return json.dumps(o, ensure_ascii=False, separators=(",", ":"))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args(argv)
    w, bad = build()
    bad += problems(w)
    head = (f"watch: {len(w['snaps'])} snapshots, {len(w['changes'])} changes "
            f"({', '.join(f'{k} {v}' for k, v in w['n'].items() if v) or 'none'}), {len(w['upcoming'])} upcoming")
    if a.check:
        if not OUT.exists():
            bad.append("watch.json missing")
        elif OUT.read_text(encoding="utf-8") != dump(w):
            bad.append("watch.json differs from a rebuild (pipeline/build_watch.py)")
        if not w["snaps"]:
            bad.append("the ledger data/ledger/answers has no snapshot")
        print(f"{head}, {len(bad)} problems" + (f"; {bad[0]}" if bad else ""))
        for b in bad[:30]:
            print("FAIL", b)
        return 1 if bad else 0
    if bad:
        for b in bad[:30]:
            print("FAIL", b)
        return 1
    OUT.write_text(dump(w), encoding="utf-8")
    print(head)
    return 0


if __name__ == "__main__":
    sys.exit(main())
