"""Document acquisition from MAYA (TASE disclosure site) into data/warehouse.duckdb.

Usage:
  python3 pipeline/fetch_maya.py list [company ...]                 # refresh report lists -> documents table
  python3 pipeline/fetch_maya.py download --from 2024-01-01 [company ...]   # fetch classified PDFs
  python3 pipeline/fetch_maya.py status

Lists come from the site's JSON API; files from mayafiles.tase.co.il.
PDFs land in data/sources/pdf/<company>/<period>/<report_id>_<doc_type>.pdf (not committed).
"""
import argparse
import hashlib
import json
import re
import sys
import time
import urllib.request
from datetime import date
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "data" / "warehouse.duckdb"
PDF = ROOT / "data" / "sources" / "pdf"
REGISTRY = ROOT / "data" / "registry" / "companies.json"
API = "https://maya.tase.co.il/api/v1"
FILES = "https://mayafiles.tase.co.il/"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36"
HEADERS = {
    "User-Agent": UA,
    "accept": "application/json",
    "content-type": "application/json",
    "origin": "https://maya.tase.co.il",
    "referer": "https://maya.tase.co.il/",
    "accept-language": "he-IL,he;q=0.9",
}
FINANCIAL_FAMILY = 100  # MAYA event family "דוחות כספיים"
START = "2019-01-01"
PAGE = 30
PAUSE = 2.0

# doc_type rules, first match wins. Titles are free text typed by the filer.
RULES = [
    ("solvency", r"דו\"?ו?ח (בדבר )?יחס כושר|^יחס כושר פי?רעון|יחס כושר פי?רעון כלכלי (ליום|של|\d)|solvency (ratio )?report"),
    ("presentation", r"מצגת|presentation"),
    ("annual", r"דו\"?ח תקופתי|דו\"?ח שנתי|periodic report|annual report"),
    ("quarterly", r"דו\"?ח רבעון|דו\"?ח רבעוני|דו\"?ח חצי שנתי|interim report|report for q[1-4]|quarterly report|financial[_ ]stat\w+[_ ]q[1-4]|q[1-4][ /]*20\d\d financial report|20\d\d q[1-4] financial report|financial report 20\d\d q[1-4]"),
    ("subsidiary", r"דוחות כספיים של|דו\"?ח כספי של|דו\"?ח חב'? בת"),
    ("liabilities", r"מצבת התחייבו"),
    ("embedded_value", r"ערך גלום|embedded value"),
]
SKIP = (r"מועד (צפוי ל)?פרסום|publication dat|דחיית|לדחות|זימון|notice regarding|will publish|תפרסם|"
        r"מדיניות|כלל סף|סף לחלוקת|שיחת ועידה|conference call|investors call|אישר את|תובענה|יצוגית|ייצוגית")
MONTHS = {"march": 1, "june": 2, "september": 3, "december": 4}


def http(url, body=None, binary=False, retries=6):
    """One request. A 403 is the site's rate limiter: wait a minute and try again."""
    data = json.dumps(body).encode() if body is not None else None
    headers = {"User-Agent": UA, "referer": "https://maya.tase.co.il/"} if binary else HEADERS
    for i in range(retries):
        try:
            req = urllib.request.Request(url, data=data, headers=headers)
            with urllib.request.urlopen(req, timeout=180) as r:
                raw = r.read()
            return raw if binary else json.loads(raw)
        except Exception as e:  # noqa: BLE001
            if i == retries - 1:
                raise
            wait = 60 * (i + 1) if "403" in str(e) else 5 * (i + 1)
            print(f"retry in {wait}s", url[-40:], e, file=sys.stderr, flush=True)
            time.sleep(wait)


def classify(title):
    t = title.lower()
    if re.search(SKIP, t):
        return None
    for name, pat in RULES:
        if re.search(pat, t):
            # English translations call interim reports "Periodic Report for Q1"
            return "quarterly" if name == "annual" and re.search(r"for q[1-4]", t) else name
    return None


def period_of(title, publish, doc_type):
    """Reporting period as YYYYQn / YYYYFY. Read from the title; fall back to the publish date."""
    t = title.lower()
    y = re.search(r"(20[12]\d)", t)
    y4 = int(y.group(1)) if y else None
    q = None
    m = re.search(r"רבעון\s*(?:ה)?-?\s*([1-4])|q([1-4])|([1-4])\s*q\b", t)
    if m:
        q = int(next(g for g in m.groups() if g))
    elif re.search(r"ראשון|first quarter", t):
        q = 1
    elif re.search(r"שני|חצי שנתי|second quarter|half", t):
        q = 2
    elif re.search(r"שלישי|third quarter", t):
        q = 3
    md = re.search(r"\b(3[01])[./](0?3|0?6|0?9|12)[./](20)?([12]\d)\b", t)
    if md:
        q = {3: 1, 6: 2, 9: 3, 12: 4}[int(md.group(2))]
        y4 = 2000 + int(md.group(4))
    me = re.search(r"(march|june|september|december) 3[01],? (20[12]\d)", t)
    if me:
        q, y4 = MONTHS[me.group(1)], int(me.group(2))
    if doc_type == "annual" and not q:
        q = 4
    py, pm = int(publish[:4]), int(publish[5:7])
    if q is None:  # infer from the filing window
        q = 4 if pm <= 4 else 1 if pm <= 6 else 2 if pm <= 9 else 3
        y4 = y4 or (py - 1 if q == 4 else py)
    if y4 is None:
        y4 = py - 1 if (q == 4 and pm <= 6) else py
    return f"{y4}FY" if q == 4 else f"{y4}Q{q}"


def connect():
    DB.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(DB))
    con.execute(
        """create table if not exists documents (
            report_id bigint, company varchar, maya_company_id integer, title varchar,
            publish_date timestamp, form_id varchar, financial_family boolean,
            doc_type varchar, period varchar, file_type varchar, file_name varchar,
            size_kb integer, url varchar, local_path varchar, sha256 varchar,
            bytes bigint, downloaded_at timestamp,
            primary key (report_id, url))"""
    )
    return con


def companies(only):
    reg = json.loads(REGISTRY.read_text(encoding="utf-8"))
    out = [(c["id"], c["maya_id"]) for c in reg if c.get("maya_id")]
    return [c for c in out if not only or c[0] in only]


def list_window(cid, start, end, family=None):
    rows, offset = [], 0
    while True:
        body = {"companyId": cid, "fromDate": start, "toDate": end,
                "isPriority": False, "isTradeHalt": False, "offset": offset}
        if family:
            body["eventsFamilyIds"] = [family]
        page = http(f"{API}/reports/companies", body)
        rows += page
        if len(page) < PAGE:
            return rows
        offset += PAGE
        time.sleep(PAUSE)


def list_reports(cid, family=None):
    """The API rejects deep offsets, so walk half-year windows and dedupe."""
    seen, today = {}, date.today()
    for y in range(int(START[:4]), today.year + 1):
        for a, b in ((f"{y}-01-01", f"{y}-06-30"), (f"{y}-07-01", f"{y}-12-31")):
            if a > today.isoformat():
                break
            for r in list_window(cid, a, min(b, today.isoformat()), family):
                seen[r["id"]] = r
            time.sleep(PAUSE)
    return list(seen.values())


def cmd_list(only):
    con = connect()
    for name, cid in companies(only):
        fin = list_reports(cid, FINANCIAL_FAMILY)
        fin_ids = {r["id"] for r in fin}
        allr = list_reports(cid)
        n = 0
        for r in allr:
            dt = classify(r["title"])
            per = period_of(r["title"], r["publishDate"], dt) if dt else None
            for a in r.get("attachments") or []:
                con.execute(
                    """insert into documents (report_id, company, maya_company_id, title, publish_date, form_id,
                        financial_family, doc_type, period, file_type, file_name, size_kb, url)
                       values (?,?,?,?,?,?,?,?,?,?,?,?,?)
                       on conflict (report_id, url) do update set title=excluded.title,
                        financial_family=excluded.financial_family, doc_type=excluded.doc_type, period=excluded.period""",
                    [r["id"], name, cid, r["title"], r["publishDate"], r.get("formId"), r["id"] in fin_ids,
                     dt, per, a["fileType"], a.get("fileName"), a.get("fileSize"), a["url"]],
                )
                n += 1
        print(f"{name}: {len(allr)} reports, {len(fin)} financial, {n} files")
    con.close()


def cmd_download(only, since, types):
    con = connect()
    q = """select report_id, company, period, doc_type, url from documents
           where doc_type is not null and file_type like 'pdf%' and local_path is null
             and publish_date >= ? and doc_type in ({}) {}
           order by company, publish_date""".format(
        ",".join("?" * len(types)), "and company in ({})".format(",".join("?" * len(only))) if only else "")
    todo = con.execute(q, [since, *types, *only]).fetchall()
    print(len(todo), "files to fetch")
    for i, (rid, comp, per, dt, url) in enumerate(todo, 1):
        try:
            raw = http(FILES + url, binary=True)
        except Exception as e:  # noqa: BLE001
            print("failed:", url, e, file=sys.stderr, flush=True)
            continue
        if raw[:4] != b"%PDF":
            print("not a pdf:", url, file=sys.stderr)
            continue
        part = re.search(r"-(\d+)\.pdf$", url)
        dest = PDF / comp / per / f"{rid}_{dt}{'_' + part.group(1) if part and part.group(1) != '00' else ''}.pdf"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(raw)
        con.execute(
            "update documents set local_path=?, sha256=?, bytes=?, downloaded_at=now() where report_id=? and url=?",
            [str(dest.relative_to(ROOT)), hashlib.sha256(raw).hexdigest(), len(raw), rid, url])
        if i % 20 == 0:
            print(f"  {i}/{len(todo)}", flush=True)
        time.sleep(PAUSE)
    con.close()


def cmd_status():
    con = connect()
    for row in con.execute(
        """select company, count(distinct report_id) reports,
                  count(*) filter (where doc_type is not null and file_type like 'pdf%') wanted,
                  count(local_path) have, round(sum(bytes)/1e6) mb
           from documents group by 1 order by 1""").fetchall():
        print(*row, sep="\t")
    con.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["list", "download", "status"])
    ap.add_argument("companies", nargs="*")
    ap.add_argument("--from", dest="since", default="2024-01-01")
    ap.add_argument("--types", default="annual,quarterly,presentation,solvency")
    a = ap.parse_args()
    if a.cmd == "list":
        cmd_list(a.companies)
    elif a.cmd == "download":
        cmd_download(a.companies, a.since, a.types.split(","))
    else:
        cmd_status()
