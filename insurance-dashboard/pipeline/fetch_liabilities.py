"""Liabilities schedules (MAYA form ת126, "מצבת התחייבויות לפי מועדי פירעון") of the 17 groups and their bond-issuing subsidiaries.

Usage:
  python3 pipeline/fetch_liabilities.py probe                 # print MAYA's entities for each group name (how ISSUERS was built)
  python3 pipeline/fetch_liabilities.py list [--since 2023-01-01] [issuer ...]
  python3 pipeline/fetch_liabilities.py download [issuer ...] # the htm forms + today's securities list (par by series)
  python3 pipeline/fetch_liabilities.py all                   # list + download
  python3 pipeline/fetch_liabilities.py status

What MAYA provides (probed 23.10.26):
  * Form ת126 is a structured htm form (windows-1255) filed every quarter by every reporting corporation with debt. It is
    always published as `rhtm/.../H<id>.htm`; no XLS/XML attachment exists and no PDF is needed. Tables א–י"א: public bonds,
    private bonds and non-bank credit, bank credit in Israel and abroad, the solo summary (ה), off-balance exposure (ו, ז),
    consolidated subsidiaries that are not reporting corporations (ח), and intra-group balances (ט, י, י"א); rows are the
    repayment year (1, 2, 3, 4, 5+; older forms 1..5, 6+), columns the linkage/currency of principal (CPI-linked NIS,
    unlinked NIS, EUR, USD, two free currency columns, other) plus gross interest and the row total. NIS thousands.
  * The form has no bond series. The series come from the company's securities list (`/api/v1/companies/<id>/securities/file`,
    CSV: name, type, security no., ISIN, par issued and paid up). It is a snapshot of today, so it is stored per retrieval date.
    Its market-value column is dropped (fundamentals only).
  * Report lists: `POST /api/v1/reports/companies` with `eventsFamilyIds=[100]` (financial reports) returns ת126 filings with
    `formId == "ת126"`; one page per half-year window for every issuer here.

Raw cache (data/raw/maya_liabilities/, small files only): lists/<maya_id>/<from>_<to>.json (closed windows are never refetched),
htm/<report_id>.htm.gz, securities/<maya_id>_<yyyy-mm-dd>.csv, manifest.json. Polite: ≤ 2 requests per second, a User-Agent
naming fox, resume from cache. A 403 is MAYA's rate limiter: back off, never evade.
"""
import argparse
import csv
import gzip
import io
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "maya_liabilities"
REGISTRY = ROOT / "data" / "registry" / "companies.json"
DOCS = ROOT / "data" / "registry" / "documents.csv"
API = "https://maya.tase.co.il/api/v1"
FILES = "https://mayafiles.tase.co.il/"
UA = "fox-research-il/1.0 (+https://fox-research-il.web.app; fundamentals research) Mozilla/5.0"
HEADERS = {"User-Agent": UA, "accept": "application/json", "content-type": "application/json",
           "origin": "https://maya.tase.co.il", "referer": "https://maya.tase.co.il/", "accept-language": "he-IL,he;q=0.9"}
FINANCIAL_FAMILY = 100
PAUSE = 1.0  # seconds between requests (MAYA rate-limits faster listing with 403s)
SINCE = "2023-01-01"  # ~3 years of quarter ends: FY'22 (filed 03/23) to the latest

# Issuers beyond the registry's listed companies: the groups' bond-issuing subsidiaries (MAYA ids from `probe`).
# role: parent = the listed group (registry), capital = capital-raising subsidiary (subordinated notes lent on to the insurer),
#       sub = another reporting subsidiary with its own debt.
EXTRA = [
    {"maya_id": 1527, "group": "phoenix", "role": "capital", "name": "הפניקס גיוסי הון (2009)"},
    {"maya_id": 1510, "group": "phoenix", "role": "sub", "name": "הפניקס גמא"},
    {"maya_id": 1367, "group": "harel", "role": "capital", "name": "הראל ביטוח מימון והנפקות"},
    {"maya_id": 1175, "group": "harel", "role": "sub", "name": "הראל חברה לביטוח"},
    {"maya_id": 1597, "group": "migdal", "role": "capital", "name": "מגדל ביטוח גיוס הון"},
    {"maya_id": 1324, "group": "clal", "role": "capital", "name": "כלל ביטוח גיוסי הון"},
    # Max files no ת126 (its liabilities ladder is only in its PDF reports); listed for its bond series. Max belongs to Clal from the first balance date at which Clal's consolidated balance sheet carries its
    # credit-card receivables (31.3.23, per Clal's own comparative columns); its earlier schedules are not Clal's.
    {"maya_id": 1763, "group": "clal", "role": "sub", "name": "מקס איט פיננסים", "from": "2023-03-31"},
    {"maya_id": 1431, "group": "menora", "role": "capital", "name": "מנורה מבטחים גיוס הון"},
    {"maya_id": 1777, "group": "ayalon", "role": "capital", "name": "איילון ביטוח הנפקות וגיוסי הון"},
]
# Left out on purpose: tradable-deposit issuers (הראל פיקדון סחיר 1781, הראל ריביות ופיקדונות 2457, אי.בי.אי פיקדונות 2467,
# אי.בי.אי ריביות ופקדונות 2580): their notes are backed one-for-one by bank deposits and are not the group's funding.
PROBE_TERMS = ["הפניקס", "הראל", "מגדל", "כלל", "מנורה", "איילון", "ביטוח ישיר", "הכשרה", "מיטב", "אלטשולר", "מור", "אנליסט",
               "ילין", "אי.בי.אי"]


def issuers(only=()):
    reg = json.loads(REGISTRY.read_text(encoding="utf-8"))
    out = [{"maya_id": c["maya_id"], "group": c["id"], "role": "parent", "name": c["name_he"]} for c in reg if c.get("maya_id")]
    out += EXTRA
    return [x for x in out if not only or x["group"] in only or str(x["maya_id"]) in only]


def http(url, body=None, binary=False, retries=5):
    data = json.dumps(body).encode() if body is not None else None
    headers = HEADERS if not binary else {"User-Agent": UA, "referer": "https://maya.tase.co.il/", "origin": "https://maya.tase.co.il",
                                          **({"content-type": "application/json"} if body is not None else {})}
    for i in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers), timeout=120) as r:
                raw = r.read()
            time.sleep(PAUSE)
            return raw if binary else json.loads(raw)
        except Exception as e:  # noqa: BLE001
            if i == retries - 1:
                raise
            wait = 60 * (i + 1) if "403" in str(e) else 5 * (i + 1)
            print(f"  retry in {wait}s: {url[-50:]} {e}", file=sys.stderr, flush=True)
            time.sleep(wait)


def windows(since):
    today = date.today() - timedelta(days=1)  # the server clock can trail local time
    y0 = int(since[:4])
    for y in range(y0, today.year + 1):
        for a, b in ((f"{y}-01-01", f"{y}-06-30"), (f"{y}-07-01", f"{y}-12-31")):
            if b < since or a > today.isoformat():
                continue
            yield max(a, since), min(b, today.isoformat()), b < (today - timedelta(days=7)).isoformat()


def list_window(cid, a, b, closed):
    cache = RAW / "lists" / str(cid) / f"{a}_{b}.json"
    if closed and cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    rows, offset = [], 0
    while True:
        page = http(f"{API}/reports/companies", {"companyId": cid, "fromDate": a, "toDate": b, "isPriority": False,
                                                  "isTradeHalt": False, "offset": offset, "eventsFamilyIds": [FINANCIAL_FAMILY]})
        rows += page
        if len(page) < 30:
            break
        offset += 30
    keep = [{"id": r["id"], "title": r["title"], "publishDate": r["publishDate"], "formId": r.get("formId"),
             "attachments": [{"fileType": x["fileType"], "url": x["url"], "fileSize": x.get("fileSize")} for x in r.get("attachments") or []]}
            for r in rows]
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(keep, ensure_ascii=False), encoding="utf-8")
    return keep


LIAB = re.compile(r"מצבת התחייבו")


def period_end(title, publish):
    """Balance date of the schedule from its title ("ליום 30.6.26"); else the quarter end before the filing."""
    m = re.search(r"(3[01])[./](0?3|0?6|0?9|12)[./](20)?(\d\d)\b", title)
    if m:
        mo = int(m.group(2))
        return f"20{m.group(4)}-{mo:02d}-{'31' if mo in (3, 12) else '30'}"
    y, mo = int(publish[:4]), int(publish[5:7])
    q = (mo - 1) // 3  # quarter of filing; the schedule is of the quarter before
    y, q = (y - 1, 4) if q == 0 else (y, q)
    end = {1: "03-31", 2: "06-30", 3: "09-30", 4: "12-31"}[q]
    return f"{y}-{end}"


def cmd_list(only, since):
    man = load_manifest()
    have = {r["report_id"] for r in man["reports"]}
    for iss in issuers(only):
        n = 0
        for a, b, closed in windows(since):
            for r in list_window(iss["maya_id"], a, b, closed):
                if r.get("formId") != "ת126" and not LIAB.search(r["title"]):
                    continue
                htm = next((x["url"] for x in r["attachments"] if x["fileType"] == "htm"), None)
                pdf = next((x["url"] for x in r["attachments"] if x["fileType"].startswith("pdf")), None)
                row = {"report_id": r["id"], "maya_id": iss["maya_id"], "group": iss["group"], "role": iss["role"], "issuer": iss["name"],
                       "title": r["title"].strip(), "form": r.get("formId"), "publish": r["publishDate"][:19],
                       "end": period_end(r["title"], r["publishDate"]), "htm": htm, "pdf": pdf,
                       "corrected": bool(re.search(r"תיקון", r["title"]))}
                if r["id"] in have:
                    man["reports"] = [row if x["report_id"] == r["id"] else x for x in man["reports"]]
                else:
                    man["reports"].append(row)
                    have.add(r["id"])
                n += 1
        print(f"{iss['group']:<11} {iss['maya_id']:>5} {iss['role']:<8} {iss['name']}: {n} schedules", flush=True)
    man["listed"] = date.today().isoformat()
    man["since"] = since
    save_manifest(man)


def load_manifest():
    p = RAW / "manifest.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {"source": "MAYA, form ת126", "reports": [], "securities": {}}


def save_manifest(man):
    man["reports"].sort(key=lambda r: (r["group"], r["maya_id"], r["end"], r["publish"]))
    RAW.mkdir(parents=True, exist_ok=True)
    (RAW / "manifest.json").write_text(json.dumps(man, ensure_ascii=False, indent=1), encoding="utf-8")


def cmd_download(only):
    man = load_manifest()
    todo = [r for r in man["reports"] if r["htm"] and (not only or r["group"] in only or str(r["maya_id"]) in only)
            and not (RAW / "htm" / f"{r['report_id']}.htm.gz").exists()]
    print(f"{len(todo)} forms to fetch", flush=True)
    for i, r in enumerate(todo, 1):
        raw = http(FILES + r["htm"], binary=True)
        if b"<html" not in raw[:3000].lower():
            print("  not an htm form:", r["htm"], file=sys.stderr)
            continue
        dest = RAW / "htm" / f"{r['report_id']}.htm.gz"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(gzip.compress(raw, 9))
        if i % 25 == 0:
            print(f"  {i}/{len(todo)}", flush=True)
    no_htm = [r["report_id"] for r in man["reports"] if not r["htm"]]
    if no_htm:
        print(f"{len(no_htm)} schedules without an htm form (PDF only): {no_htm[:10]}", flush=True)
    # securities lists: today's par outstanding by bond series, one snapshot per issuer per day
    today = date.today().isoformat()
    for iss in issuers(only):
        dest = RAW / "securities" / f"{iss['maya_id']}_{today}.csv"
        if dest.exists():
            continue
        try:
            raw = http(f"{API}/companies/{iss['maya_id']}/securities/file", body={}, binary=True)
        except Exception as e:  # noqa: BLE001
            print("  securities list failed:", iss["maya_id"], e, file=sys.stderr)
            continue
        text = raw.decode("utf-8-sig", errors="replace")
        rows = list(csv.reader(io.StringIO(text)))
        if not rows or "סוג" not in ",".join(rows[0]):
            continue
        head = rows[0]
        drop = [i for i, h in enumerate(head) if "שווי שוק" in h]  # fundamentals only: no market values are stored
        out = io.StringIO()
        w = csv.writer(out)
        for row in rows:
            w.writerow([c for i, c in enumerate(row) if i not in drop])
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(out.getvalue(), encoding="utf-8")
        man["securities"][str(iss["maya_id"])] = today
    save_manifest(man)


def cmd_probe():
    for term in PROBE_TERMS:
        d = http(f"{API}/companies/autocomplete?" + urllib.parse.urlencode({"search": term, "take": 30}))
        print("==", term)
        for x in d:
            print(f"   {x['type']:<12} {x['key']:>5}  {x['value']}")


def cmd_status():
    man = load_manifest()
    reg = {}
    for r in csv.DictReader(open(DOCS, encoding="utf-8")):
        if r["doc_type"] == "liabilities" and r["file_type"] == "htm":
            reg[int(r["report_id"])] = r["company"]
    by = {}
    for r in man["reports"]:
        k = (r["group"], r["maya_id"], r["role"], r["issuer"])
        got = (RAW / "htm" / f"{r['report_id']}.htm.gz").exists()
        b = by.setdefault(k, [0, 0, None, None])
        b[0] += 1
        b[1] += got
        b[2] = min(b[2] or r["end"], r["end"])
        b[3] = max(b[3] or r["end"], r["end"])
    for (g, mid, role, name), (n, got, a, z) in sorted(by.items()):
        print(f"{g:<11} {mid:>5} {role:<8} {n:>3} listed {got:>3} cached  {a} … {z}  {name}")
    mine = {r["report_id"] for r in man["reports"]}
    since = man.get("since", SINCE)
    print(f"registry documents.csv: {len(reg)} schedules; {len([k for k in reg if k in mine])} also listed here "
          f"(the registry goes back to 2019; this fetcher keeps the window from {since})")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["probe", "list", "download", "all", "status"])
    ap.add_argument("only", nargs="*", help="group ids (phoenix) or MAYA ids (1527)")
    ap.add_argument("--since", default=SINCE)
    a = ap.parse_args()
    if a.cmd == "probe":
        cmd_probe()
    if a.cmd in ("list", "all"):
        cmd_list(a.only, a.since)
    if a.cmd in ("download", "all"):
        cmd_download(a.only)
    if a.cmd == "status":
        cmd_status()
