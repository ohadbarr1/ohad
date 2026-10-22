"""Filing calendar: for each company, its last periodic report and the expected window of the next one.

The window is an estimate from the company's own record: for the same report (Q1, Q2, Q3 or the annual report) in the last three
years, the days from period end to publication on MAYA; the expected date is the median, the window runs from the earliest to the
latest of those. Nothing here is a statutory deadline. Writes web/public/data/calendar.json and web/public/data/calendar.ics.
Run after the document registry (data/registry/documents.csv) is refreshed.
"""
import csv
import datetime as dt
import json
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"
END = {"Q1": (3, 31), "Q2": (6, 30), "Q3": (9, 30), "FY": (12, 31)}
NEXT = {"Q1": "Q2", "Q2": "Q3", "Q3": "FY", "FY": "Q1"}

def end_of(period):
    y, s = int(period[:4]), period[4:]
    m, d = END[s]
    return dt.date(y, m, d)

def following(period):
    y, s = int(period[:4]), period[4:]
    n = NEXT[s]
    return f"{y + 1 if s == 'FY' else y}{n}"

registry = json.loads((ROOT / "data" / "registry" / "companies.json").read_text(encoding="utf-8"))
names = {c["id"]: c["name_he"] for c in (registry if isinstance(registry, list) else registry.get("companies", []))}
first = {}
for r in csv.DictReader(open(ROOT / "data" / "registry" / "documents.csv", encoding="utf-8")):
    if r["doc_type"] not in ("quarterly", "annual") or r["period"][4:] not in END:
        continue
    day = dt.date.fromisoformat(r["publish_date"][:10])
    k = (r["company"], r["period"])
    if k not in first or day < first[k][0]:
        first[k] = (day, r["doc_type"], int(r["report_id"]))  # the first publication of the period's report (Hebrew or English)

today = dt.date.today()
out = []
for comp in sorted({c for c, _ in first}):
    hist = sorted(((p, d, t, rid) for (c, p), (d, t, rid) in first.items() if c == comp), key=lambda x: end_of(x[0]))
    if not hist:
        continue
    last = hist[-1]
    nxt = following(last[0])
    slot, nend = nxt[4:], end_of(nxt)
    lags = [(d - end_of(p)).days for p, d, _, _ in hist if p[4:] == slot and int(p[:4]) >= nend.year - 3][-3:]
    item = {"id": comp, "name": names.get(comp, comp),
            "last": {"period": last[0], "date": last[1].isoformat(), "type": last[2], "rid": last[3]},
            "next": {"period": nxt, "end": nend.isoformat()}}
    if lags:
        med = int(statistics.median(lags))
        item["next"].update({"expected": (nend + dt.timedelta(days=med)).isoformat(), "lo": (nend + dt.timedelta(days=min(lags))).isoformat(),
                             "hi": (nend + dt.timedelta(days=max(lags))).isoformat(), "n": len(lags), "lags": lags})
    # a company with no periodic report for a year has stopped filing here (IDI's last report on MAYA is Q3'19): no expected date
    if (today - last[1]).days > 365:
        item["inactive"] = True
        for k in ("expected", "lo", "hi"):
            item["next"].pop(k, None)
    item["history"] = [{"period": p, "date": d.isoformat(), "lag": (d - end_of(p)).days} for p, d, _, _ in hist[-12:]]
    out.append(item)
out.sort(key=lambda x: x["next"].get("expected", "9999"))
(DATA / "calendar.json").write_text(json.dumps({"built": today.isoformat(), "basis": "חציון הימים מסוף התקופה לפרסום, אותו דוח, שלוש השנים האחרונות", "companies": out}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

# the same estimates as a calendar feed: one all-day event per company, marked as an estimate
def dmy(iso):
    return f"{iso[8:10]}.{iso[5:7]}.{iso[2:4]}"
def label(p):
    return f"FY'{p[2:4]}" if p.endswith("FY") else f"{p[4:]}'{p[2:4]}"
lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//fox//filing calendar//HE", "CALSCALE:GREGORIAN", "X-WR-CALNAME:fox · דיווחים צפויים"]
stamp = dt.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
for it in out:
    n = it["next"]
    if "expected" not in n:
        continue
    d0 = dt.date.fromisoformat(n["expected"])
    lines += ["BEGIN:VEVENT", f"UID:fox-{it['id']}-{n['period']}@fox-research-il.web.app", f"DTSTAMP:{stamp}",
              f"DTSTART;VALUE=DATE:{d0:%Y%m%d}", f"DTEND;VALUE=DATE:{d0 + dt.timedelta(days=1):%Y%m%d}",
              f"SUMMARY:{it['name']} · דוח {label(n['period'])} (אומדן)",
              f"DESCRIPTION:אומדן לפי {n['n']} השנים האחרונות; חלון {dmy(n['lo'])} עד {dmy(n['hi'])}. לא מועד סטטוטורי.", "TRANSP:TRANSPARENT", "END:VEVENT"]
lines.append("END:VCALENDAR")
(DATA / "calendar.ics").write_text("\r\n".join(lines) + "\r\n", encoding="utf-8")
print(len(out), "companies;", sum("expected" in x["next"] for x in out), "with an expected window; next:", [(x["id"], x["next"]["period"], x["next"].get("expected")) for x in out[:5]])
