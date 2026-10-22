"""What the site extracted from each filed page, for the document reader's side panel.

python3 pipeline/build_pagefacts.py -> web/public/data/search/facts/<report_id>.json
  {"rid": 1731047, "n": 812, "labels": [...], "pages": {"52": [[label index, value, unit, ptype, pend, src, a, b], ...], ...}}
  src "fs": a = company, b = "sheet|metric index" (statement line); "ifrs": a = company, b = report period; "lts": a = company
Read from the site's own data files (so the panel shows exactly what the pages show):
  companies/<id>.json   statement lines of the company workbooks (src "fs"; unit k = NIS thousands, pct, nis)
  ifrs/<id>/<p>.json     IFRS 17 / solvency disclosures (src "ifrs"; NIS millions)
  savings_econ.json      pension and provident managing-company profitability (src "lts"; NIS millions, der rows %)
  lts_prov/<id>.json     long-term-savings figures with their report page (src "lts")
A figure's document is the MAYA report number in its PDF address (…/P<report_id>-00.pdf); figures of files outside MAYA are skipped.
"""
import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"
OUT = DATA / "search" / "facts"
RID = re.compile(r"P(\d{6,8})-\d+\.pdf", re.I)
YTD = {"03-31": "Q", "06-30": "H", "09-30": "9M", "12-31": "FY"}


def rid(url):
    m = RID.search(url or "")
    return int(m.group(1)) if m else None


def load(p):
    return json.loads(p.read_text(encoding="utf-8"))


facts = defaultdict(lambda: defaultdict(list))   # rid -> page -> rows
seen = defaultdict(set)


def add(r, pg, row):
    if not r or not pg:
        return
    key = (int(pg), row[0], row[1], row[3], row[4])
    if key in seen[r]:
        return
    seen[r].add(key)
    facts[r][int(pg)].append(row)


# company workbooks: [metric, period, value, page, url index, flags]
for f in sorted((DATA / "companies").glob("*.json")):
    if f.name.count(".") > 1 or f.name == "index.json":
        continue
    d = load(f)
    if "facts" not in d:
        continue
    co = d["company"]
    sheets = {s["code"]: s["title"] for s in d["sheets"]}
    urls = d.get("urls") or []
    for x in d["facts"]:
        mi, pi, v, pg = x[0], x[1], x[2], x[3]
        ui = x[4] if len(x) > 4 else None
        flags = x[5] if len(x) > 5 else 0
        if pg is None or ui is None or ui >= len(urls) or v is None or flags & 1:
            continue  # a derived figure (Q4 = FY - 9M) is not printed on the page it points to
        m, p = d["metrics"][mi], d["periods"][pi]
        if m.get("header"):
            continue
        label = m["label"] + (f" · {m['dim']}" if m.get("dim") else "")
        add(rid(urls[ui]), pg, [label, v, m["unit"], p["type"], p["end"], "fs", co, f"{m['sheet']}|{mi}"])

# IFRS 17 and solvency disclosures
ifrs = load(DATA / "ifrs.json")
furl = {(x["company"], x["period"]): x["url"] for x in ifrs["files"]}
for f in sorted((DATA / "ifrs").glob("*/*.json")):
    co, per = f.parent.name, f.stem
    for x in load(f):
        url = x.get("u") if x.get("u") is not None else furl.get((co, per))
        w, dd = x.get("w"), x.get("d", "")
        ptype = "Q" if w == "q" else YTD.get(dd[5:], "Q") if w == "ytd" else "FY" if w == "fy" else "I"
        label = x.get("l") or x.get("m")
        add(rid(url), x.get("pg"), [label, x.get("dv", x["v"]), "m", ptype, dd, "ifrs", co, per])

# managing-company profitability
se = load(DATA / "savings_econ.json")
for x in se["rows"]:
    w, dd = x.get("w"), x.get("d", "")
    ptype = "Q" if w == "q" else YTD.get(dd[5:], "Q") if w == "ytd" else "FY" if w == "fy" else "I"
    unit = "pct" if x.get("der") else "m"
    for u, pg in ((x.get("url"), x.get("pg")), (x.get("url2"), x.get("pg2"))):
        add(rid(u), pg, [x.get("l") or x["m"], x["v"], unit, ptype, dd, "lts", x["c"], ""])

# long-term-savings figures: [period key, page, label, value, unit, date, window]
UNIT = {"NIS thousand": "k", "מיליוני ש\"ח": "m", "%": "pct"}
for f in sorted((DATA / "lts_prov").glob("*.json")):
    d = load(f)
    urls = d.get("urls") or {}
    for pk, pg, label, v, unit, dd, w in d.get("parts", []):
        ptype = "Q" if w == "q" else YTD.get((dd or "")[5:], "Q") if w == "ytd" else "FY" if w == "fy" else "I"
        add(rid(urls.get(pk)), pg, [label, v, UNIT.get(unit, unit), ptype, dd, "lts", f.stem, ""])

OUT.mkdir(parents=True, exist_ok=True)
for old in OUT.glob("*.json"):
    old.unlink()
total = 0
for r, pages in facts.items():
    n = sum(len(v) for v in pages.values())
    total += n
    labels, li = [], {}
    rows = {}
    for k, v in sorted(pages.items()):
        rows[str(k)] = [[li.setdefault(x[0], len(li)), *x[1:]] for x in v]
    labels = list(li)
    (OUT / f"{r}.json").write_text(json.dumps({"rid": r, "n": n, "labels": labels, "pages": rows},
                                              ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(len(facts), "documents,", total, "figures,", sum(f.stat().st_size for f in OUT.glob("*.json")) // 1024, "KB")
