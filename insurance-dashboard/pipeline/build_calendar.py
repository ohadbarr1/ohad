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

# ---------------------------------------------------------------------------------------------------------------- calendar feeds (ICS)
# calendar.ics: the next report of every company (as before). cal/<company>.ics: that company's next four reports, each from the same
# median-lag rule (an estimate per slot, only where the company's own record has the slot). cal/reminders.ics: for savers, the regulator's
# next month (an estimate: the regulator publishes no schedule) and the annual statement every saver receives by 31 March.
SITE = "https://fox-research-il.web.app"
CAL = DATA / "cal"
stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def dmy(iso):
    return f"{iso[8:10]}.{iso[5:7]}.{iso[2:4]}"


def label(p):
    return f"FY'{p[2:4]}" if p.endswith("FY") else f"{p[4:]}'{p[2:4]}"


def esc(t):
    """RFC 5545 TEXT: backslash, semicolon, comma and newlines escaped"""
    return t.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def fold(line):
    """RFC 5545 3.1: content lines of at most 75 octets, continued with CRLF + one space; never inside a UTF-8 character"""
    out, cur = [], b""
    for ch in line:
        b = ch.encode("utf-8")
        if len(cur) + len(b) > (75 if not out else 74):
            out.append(cur.decode("utf-8"))
            cur = b""
        cur += b
    out.append(cur.decode("utf-8"))
    return "\r\n ".join(out)


def vcal(name, desc, events):
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//fox//filing calendar//HE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
             f"X-WR-CALNAME:{esc(name)}", f"X-WR-CALDESC:{esc(desc)}", "X-WR-TIMEZONE:Asia/Jerusalem", "REFRESH-INTERVAL;VALUE=DURATION:P1D",
             "X-PUBLISHED-TTL:P1D"]
    for ev in events:
        lines += ["BEGIN:VEVENT", f"UID:{ev['uid']}@fox-research-il.web.app", f"DTSTAMP:{stamp}", f"DTSTART;VALUE=DATE:{ev['d']:%Y%m%d}",
                  f"DTEND;VALUE=DATE:{ev['d'] + dt.timedelta(days=1):%Y%m%d}"]
        if ev.get("rrule"):
            lines.append(f"RRULE:{ev['rrule']}")
        lines += [f"SUMMARY:{esc(ev['summary'])}", f"DESCRIPTION:{esc(ev['desc'])}"]
        if ev.get("url"):
            lines.append(f"URL;VALUE=URI:{ev['url']}")
        lines += ["TRANSP:TRANSPARENT", "END:VEVENT"]
    lines.append("END:VCALENDAR")
    return "\r\n".join(fold(x) for x in lines) + "\r\n"


def report_event(it, n):
    d0 = dt.date.fromisoformat(n["expected"])
    return {"uid": f"fox-{it['id']}-{n['period']}", "d": d0, "summary": f"{it['name']} · דוח {label(n['period'])} (אומדן)",
            "desc": f"אומדן לפי {n['n']} השנים האחרונות: חציון הימים מסוף התקופה לפרסום במאיה, אותו דוח; חלון {dmy(n['lo'])} עד {dmy(n['hi'])}. "
                    f"לא מועד סטטוטורי. {SITE}/company/{it['id']}", "url": f"{SITE}/company/{it['id']}"}


def projected(comp, last_period, k=4):
    """the company's next k reports, each dated by the median lag of the same report in its last three years (skipped without one)"""
    hist = [(p, d) for (c, p), (d, _, _) in first.items() if c == comp]
    out, p = [], last_period
    for _ in range(k):
        p = following(p)
        slot, nend = p[4:], end_of(p)
        lags = [(d - end_of(q)).days for q, d in sorted(hist, key=lambda x: end_of(x[0])) if q[4:] == slot and int(q[:4]) >= nend.year - 3][-3:]
        if lags:
            med = int(statistics.median(lags))
            out.append({"period": p, "end": nend.isoformat(), "expected": (nend + dt.timedelta(days=med)).isoformat(),
                        "lo": (nend + dt.timedelta(days=min(lags))).isoformat(), "hi": (nend + dt.timedelta(days=max(lags))).isoformat(), "n": len(lags)})
    return out


def add_months(y, m, k):
    t = y * 12 + m - 1 + k
    return t // 12, t % 12 + 1


def regulator_month():
    """the regulator's next month: the lag of the latest month fox received (market.json meta: asof, fetched), repeated monthly.
    The regulator publishes no release calendar (fox-data probes data.gov.il three times a day): an estimate from one observation."""
    try:
        meta = json.loads((DATA / "market.json").read_text(encoding="utf-8"))["meta"]
        asof, got = int(meta["asof"]), dt.date.fromisoformat(meta["fetched"][:10])
    except (OSError, KeyError, ValueError):
        return None
    y, m = divmod(asof, 100)
    off = (got.year * 12 + got.month) - (y * 12 + m)
    ny, nm = add_months(y, m, 1)
    ey, em = add_months(ny, nm, off)
    d0 = dt.date(ey, em, min(got.day, 28))
    lab = lambda yy, mm: f"{mm:02d}/{str(yy)[2:]}"  # noqa: E731
    return {"uid": "fox-regmonth", "d": d0, "rrule": "FREQ=MONTHLY;COUNT=12",
            "summary": "fox · חודש חדש של הרשות (אומדן)",
            "desc": f"אומדן, לא מועד רשמי: רשות שוק ההון אינה מפרסמת לוח זמנים לגמל-נט, פנסיה-נט וביטוח-נט. החודש האחרון, {lab(y, m)}, נקלט ב-fox "
                    f"ב-{got:%d.%m.%y}; האומדן חוזר על אותו פער ({off} חודשים, יום {d0.day}) לכל חודש. fox בודקת את data.gov.il שלוש פעמים ביום, "
                    f"והחודש מופיע באתר ביום שהוא נקלט. {SITE}/feed?t=regmonth", "url": f"{SITE}/feed?t=regmonth", "est": True,
            "basis": {"asof": asof, "fetched": got.isoformat(), "lag_months": off, "day": d0.day}}


def annual_statement():
    """the annual statement to members: by the end of the first quarter (31 March), for the previous calendar year"""
    y = today.year if today <= dt.date(today.year, 3, 31) else today.year + 1
    return {"uid": "fox-annual-statement", "d": dt.date(y, 3, 31), "rrule": "FREQ=YEARLY",
            "summary": "הדוח השנתי מהקרן אמור להגיע עד היום",
            "desc": "קרן פנסיה, קופת גמל וקרן השתלמות שולחות לכל עמית דוח שנתי על השנה הקודמת עד תום הרבעון הראשון (31 במרץ). "
                    "מקור: כל זכות, 'דוחות רבעוניים ושנתיים של קרן הפנסיה' (kolzchut.org.il); חוזר רשות שוק ההון 'דוח שנתי ודוח רבעוני לעמיתים "
                    f"ולמבוטחים בגוף מוסדי'. לא הגיע? בקשו אותו מהגוף המנהל. לקריאת הדוח: {SITE}/my", "url": f"{SITE}/my"}


CAL.mkdir(parents=True, exist_ok=True)
for old in CAL.glob("*.ics"):
    old.unlink()
main_events = [report_event(it, it["next"]) for it in out if "expected" in it["next"]]
(DATA / "calendar.ics").write_text(vcal("fox · דיווחים צפויים", "הדוח הבא של כל חברה, אומדן מהרקורד שלה עצמה (לא מועד סטטוטורי)", main_events), encoding="utf-8")
for it in out:
    if it.get("inactive"):
        continue
    evs = [report_event(it, n) for n in projected(it["id"], it["last"]["period"])]
    if not evs:
        continue
    (CAL / f"{it['id']}.ics").write_text(vcal(f"fox · {it['name']}", f"הדוחות הבאים של {it['name']} במאיה, אומדן מהרקורד של החברה", evs), encoding="utf-8")
    it["ics"] = f"/data/cal/{it['id']}.ics"
rem = [x for x in (regulator_month(), annual_statement()) if x]
(CAL / "reminders.ics").write_text(vcal("fox · תזכורות לחוסך", "חודש חדש של נתוני הרשות (אומדן) והדוח השנתי מהקרן (עד 31 במרץ)", rem), encoding="utf-8")
cal = json.loads((DATA / "calendar.json").read_text(encoding="utf-8"))
cal["companies"] = out
cal["ics"] = {"all": "/data/calendar.ics", "reminders": "/data/cal/reminders.ics",
              "regmonth": next(({k: v for k, v in x.items() if k in ("basis",)} | {"d": x["d"].isoformat()} for x in rem if x["uid"] == "fox-regmonth"), None),
              "annual": {"d": annual_statement()["d"].isoformat(), "src": "https://www.kolzchut.org.il/he/דוחות_רבעוניים_ושנתיים_של_קרן_הפנסיה"}}
(DATA / "calendar.json").write_text(json.dumps(cal, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(len(out), "companies;", sum("expected" in x["next"] for x in out), "with an expected window;", sum(1 for x in out if x.get("ics")), "company calendars; next:",
      [(x["id"], x["next"]["period"], x["next"].get("expected")) for x in out[:5]])
