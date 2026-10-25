"""What is new per company, dated, for the "since you last looked" marks (lane S2): web/public/data/since.json.

python3 pipeline/build_since.py      (standard library only; reads published files, writes one small JSON)

The site keeps, per company, the day the reader last opened it (lib/visits.ts, a stored key that sync carries). Every surface that
names the company (header, home scoreboard, watchlist, omnibox) compares that day with the events here and marks what is newer:
  f  a filing on MAYA (Hebrew; report, annual, deck, solvency report)    companies/<id>.docs.json
  r  a report that restated earlier periods (as Report Day counts them)   companies/<id>.json restated
  t  a management target first stated, or revised, in a filing or deck  targets.json
  m  a new month of the regulator's fund data for the company's group    market.json (meta.fetched: the day fox received it)
Events: [kind, ISO date, id, ...payload]; the id is stable, so an event seen on the day of a visit is not shown again.
  f: [ "f", date, "f:<rid>", type, period, rid, path, pages ]
  r: [ "r", date, "r:<rid>", season, rid, path, n, big ]       (big: changed by 2% or more of the figure first reported)
  t: [ "t", date, "t:<rid>:<metric>:<page>", label, entity, rid, pg, path, revised 0|1 ]
  m: [ "m", date, "m:<yyyymm>", yyyymm ]
Only the last 400 days are kept: a visit older than that shows the whole window, which says enough.
"""
import datetime as dt
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"
FILES = "https://mayafiles.tase.co.il/"
WINDOW = 400


def load(p):
    return json.loads((DATA / p).read_text(encoding="utf-8"))


def rel(url):
    return url[len(FILES):] if url and url.startswith(FILES) else url


def main():
    today = dt.date.today()
    start = (today - dt.timedelta(days=WINDOW)).isoformat()
    reg = load("companies/index.json")
    ids = [c["id"] for c in reg]
    ev = defaultdict(list)

    # filings: every Hebrew document of the company (the English translations repeat a filing already listed)
    for c in ids:
        p = DATA / "companies" / f"{c}.docs.json"
        if not p.exists():
            continue
        for d in json.loads(p.read_text(encoding="utf-8"))["docs"]:
            if d.get("en") or not d.get("date") or d["date"] < start:
                continue
            ev[c].append(["f", d["date"], f"f:{d['id']}", d["type"], d["period"], d["id"], rel(d["url"]), d.get("pages")])

    # restatements: one event per restating report, counted as Report Day counts them (companies/<id>.json `restated`: figures of earlier
    # periods that the report printed with a different value), dated by the report's publication
    def key_of(end):
        return f"{end[:4]}FY" if end.endswith("12-31") else f"{end[:4]}Q{['03-31', '06-30', '09-30'].index(end[5:]) + 1}"
    for c in ids:
        wb, dp = DATA / "companies" / f"{c}.json", DATA / "companies" / f"{c}.docs.json"
        if not wb.exists() or not dp.exists():
            continue
        reps = {}
        for d in json.loads(dp.read_text(encoding="utf-8"))["docs"]:
            if d["type"] in ("quarterly", "annual") and not d.get("en"):
                reps.setdefault(d["period"], d)
        agg = defaultdict(lambda: [0, 0])
        for r in json.loads(wb.read_text(encoding="utf-8")).get("restated") or []:
            agg[r[11]][0] += 1
            agg[r[11]][1] += int(r[5] == 0 or abs(r[8] - r[5]) / abs(r[5]) >= 0.02)
        for end, (n, big) in agg.items():
            season = key_of(end)
            doc = reps.get(season)
            if not doc or doc["date"] < start:
                continue
            ev[c].append(["r", doc["date"], f"r:{doc['id']}", season, doc["id"], rel(doc["url"]), n, big])

    # targets: the statement that first set a target, and each later revision of its value (deck rows carry dated revisions)
    tg = load("targets.json")
    seen_t = set()
    for t in tg["rows"]:
        stmts = []
        first = t.get("st0") or t.get("st1")
        if first and first[0]:
            stmts.append((first[0], first[1], first[2], 0))
        if t.get("src") == "pres" and t.get("hist"):
            for h in t["hist"][1:]:
                if isinstance(h[0], str) and len(h[0]) == 10:
                    stmts.append((h[0], h[4] if len(h) > 4 else None, h[5] if len(h) > 5 else None, 1))
        for date, rid, pg, revised in stmts:
            if date < start or rid is None:
                continue
            doc = tg["docs"].get(str(rid))
            eid = f"t:{rid}:{t['m']}:{pg}"
            if eid in seen_t:
                continue
            seen_t.add(eid)
            ev[t["c"]].append(["t", date, eid, t["l"], t.get("e") or "", rid, pg, doc[4] if doc else None, revised])

    # the regulator's month: the latest month carrying the group's figures, dated the day fox fetched it
    mk = load("market.json")
    fetched = mk["meta"].get("fetched")
    gi = {g: i for i, g in enumerate(mk["groups"])}
    ci = {k: i for i, k in enumerate(mk["cols"])}
    last = defaultdict(int)
    for r in mk["rows"]:
        if r[ci["assets"]]:
            last[r[ci["grp"]]] = max(last[r[ci["grp"]]], mk["periods"][r[ci["p"]]])
    for c in reg:
        g = gi.get(c.get("market_group") or "")
        if g is None or not last.get(g) or not fetched or fetched < start:
            continue
        ev[c["id"]].append(["m", fetched, f"m:{last[g]}", last[g]])

    out = {"v": 1, "built": today.isoformat(), "from": start, "files": FILES,
           "source": "MAYA (מסמכים, הצגות מחדש, יעדים) ורשות שוק ההון (חודש נתונים)",
           "co": {c: sorted(e, key=lambda x: (x[1], x[2]), reverse=True) for c, e in sorted(ev.items())}}
    (DATA / "since.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    kinds = defaultdict(int)
    for e in out["co"].values():
        for x in e:
            kinds[x[0]] += 1
    print(f"since.json: {len(out['co'])} companies, {sum(kinds.values())} events since {start}: {dict(kinds)}")


if __name__ == "__main__":
    main()
