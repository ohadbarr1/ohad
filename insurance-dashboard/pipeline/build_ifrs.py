"""Extracted report facts for the site, with a standard segment and a link to the source page.

python3 pipeline/build_ifrs.py -> web/public/data/ifrs.json
Values stay as extracted (NIS millions, sign as printed). `seg` is the standard bucket; `segment` keeps the printed name.
"""
import json
import re
from datetime import date, timedelta
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
FILES = "https://mayafiles.tase.co.il/"


def std_segment(s):
    t = s.lower().replace("_", " ")
    if t in ("group", "total", "consolidated"):
        return "group"
    if re.search(r"life and health|life health", t):
        return "life_health"
    if re.search(r"investment (contract|polic)", t):
        return "investment_contracts"
    if re.search(r"^(life|long-term savings|lts)", t):
        return "life"
    if t.startswith("health"):
        return "health"
    if re.search(r"^(pc|p&c|general|non-life|motor|compulsory)", t):
        return "pc"
    if re.search(r"pension|provident|gemel|asset management|wealth|financial services", t):
        return "savings"
    if re.search(r"insurance$|insurance |subsidiary", t):
        return "insurer"
    return "other"


def opening_date(d, w):
    """Balance date an opening balance belongs to: the day before the window starts."""
    y, m, day = (int(x) for x in d.split("-"))
    if w == "instant":
        return str(date(y, m, day) - timedelta(days=1)) if day == 1 else d
    if w == "q":
        start = date(y, m - 2, 1)
    else:  # ytd, fy
        start = date(y, 1, 1)
    return str(start - timedelta(days=1))


try:
    con = duckdb.connect(str(ROOT / "data" / "warehouse.duckdb"), read_only=True)
    pdf = dict(con.execute("select report_id, min(url) from documents where file_type='pdf1' group by 1").fetchall())
except duckdb.IOException:  # warehouse busy: the exported registry has the same links
    import csv
    pdf = {int(r["report_id"]): r["url"] for r in csv.DictReader(open(ROOT / "data" / "registry" / "documents.csv", encoding="utf-8")) if r["file_type"] == "pdf1"}
out, files = [], []
for f in sorted((ROOT / "data" / "extracted").glob("*/*.json")):
    d = json.loads(f.read_text(encoding="utf-8"))
    comp, period = f.parent.name, f.stem
    url = pdf.get(d.get("report_id_he"))
    files.append({"company": comp, "period": period, "report_id": d.get("report_id_he"), "url": FILES + url if url else None, "facts": len(d["facts"])})
    for x in d["facts"]:
        v = x.get("value")
        if not isinstance(v, (int, float)):
            continue
        if x["metric"].endswith("_opening"):
            x = {**x, "date": opening_date(x["date"], x["window"]), "window": "instant"}
        row = {"c": comp, "p": period, "m": x["metric"], "s": x["segment"], "g": std_segment(str(x["segment"])), "b": x.get("basis") or "na",
               "w": x["window"], "d": x["date"], "v": round(v, 3), "pg": x.get("page_he"), "l": " ".join(str(x.get("label") or "").split())[:90]}
        for k_in, k_out in (("source", "src"), ("model", "model"), ("transition", "tr"), ("bucket", "bk"), ("effect_on", "fx")):
            if x.get(k_in) and x[k_in] != "table":
                row[k_out] = x[k_in]
        if x.get("note"):
            row["n"] = " ".join(str(x["note"]).split())[:160]
        out.append(row)
(ROOT / "web" / "public" / "data" / "ifrs.json").write_text(json.dumps({"unit": "NIS millions", "files": files, "facts": out}, ensure_ascii=False), encoding="utf-8")
print(len(out), "facts from", len(files), "filings;", sum(1 for x in files if x["url"]), "with a source link")
