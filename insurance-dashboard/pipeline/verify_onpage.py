"""Every numeric value of an extraction file printed on its cited PDF page (stdlib + pdftotext).

python3 pipeline/verify_onpage.py data/extracted_solvency/harel/2025FY.json [more files...]
Reads `report_id` from the file, finds the PDF via data/registry/documents.csv, extracts the cited page with pdftotext and looks for the
number in the common print forms (thousands separators, one or two decimals, NIS thousands vs millions, percent). Prints misses; exit 1 if any.
"""
import csv
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = {}
for r in csv.DictReader(open(ROOT / "data/registry/documents.csv", encoding="utf-8")):
    if r["local_path"] and r["file_type"].startswith("pdf"):
        DOCS.setdefault(int(r["report_id"]), r["local_path"])
_cache = {}


def page_text(pdf, pg):
    k = (pdf, pg)
    if k not in _cache:
        out = subprocess.run(["pdftotext", "-layout", "-f", str(pg), "-l", str(pg), str(ROOT / pdf), "-"], capture_output=True, text=True)
        _cache[k] = re.sub(r"[‎‏‪-‮]", "", out.stdout)
    return _cache[k]


def forms(v):
    a = abs(v)
    out = {f"{a:,.0f}", f"{a:,.1f}", f"{a:,.2f}", f"{a:.0f}", f"{a:.1f}", f"{a:.2f}", f"{a * 1000:,.0f}", f"{a / 1000:,.1f}", f"{a / 1000:,.2f}"}
    s = str(a)
    out.add(s.rstrip("0").rstrip(".") if "." in s else s)
    return {x for x in out if x not in ("0", "0.0", "0.00")}


bad = 0
for fn in sys.argv[1:]:
    d = json.loads(Path(fn).read_text(encoding="utf-8"))
    pdf = DOCS.get(int(d["report_id"]))
    miss, n = [], 0
    for f in d["facts"]:
        for key in ("value", "value_low", "value_high"):
            v = f.get(key)
            if not isinstance(v, (int, float)) or f.get("source") == "chart":
                continue
            n += 1
            pg = f.get("page_he")
            txt = page_text(pdf, int(pg)) if pdf and pg else ""
            if not any(x in txt for x in forms(v)):
                miss.append(f"{f['metric']}={v} p{pg}")
    bad += bool(miss)
    print(f"{'ok  ' if not miss else 'MISS'} {fn}: {n - len(miss)}/{n} on page" + (" · " + " · ".join(miss[:8]) if miss else ""))
sys.exit(1 if bad else 0)
