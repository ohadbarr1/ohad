"""Merge the hand-maintained company registry with the company data files that exist.

python3 pipeline/build_company_index.py  -> web/public/data/companies/index.json
A company has financials when web/public/data/companies/<id>.json exists (made by extract_company_workbook.py).
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REG = json.loads((ROOT / "data" / "registry" / "companies.json").read_text(encoding="utf-8"))
OUT_DIR = ROOT / "web" / "public" / "data" / "companies"

out = []
for c in REG:
    f = OUT_DIR / f"{c['id']}.json"
    filings = []
    if f.exists():
        d = json.loads(f.read_text(encoding="utf-8"))
        last = max((p for p in d["periods"] if p["type"] in ("H", "FY", "Q")), key=lambda p: (p["end"], p["months"]))
        y, m = last["end"][:4], int(last["end"][5:7])
        label = f"H{1 if m <= 6 else 2} {y}" if last["type"] == "H" else (f"FY {y}" if last["type"] == "FY" else f"Q{(m - 1) // 3 + 1} {y}")
        for s in d["sources"]:
            filings.append({"period": label, "end": last["end"], "entity": s["entity"], "name": s["name"], "doc": s["doc"], "url": s["url"], "pages": s["pages"]})
    docs_f, price_f = OUT_DIR / f"{c['id']}.docs.json", OUT_DIR / f"{c['id']}.price.json"
    docs = len(json.loads(docs_f.read_text(encoding="utf-8"))["docs"]) if docs_f.exists() else 0
    out.append({**c, "has_financials": f.exists(), "filings": filings, "docs": docs, "has_price": price_f.exists()})
(OUT_DIR / "index.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"{len(out)} companies, {sum(1 for c in out if c['has_financials'])} with financials -> {OUT_DIR / 'index.json'}")
