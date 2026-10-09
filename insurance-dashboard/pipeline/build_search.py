"""Per-filing page text for in-site search: data/work/<company>_<period>/<doc>/pNNN.txt -> web/public/data/search/<company>_<period>.json

One file per extracted filing, loaded on demand. Bidi control marks are dropped and whitespace collapsed; page numbers stay 1-based PDF pages.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "public" / "data" / "search"
OUT.mkdir(parents=True, exist_ok=True)
ifrs = json.loads((ROOT / "web" / "public" / "data" / "ifrs.json").read_text(encoding="utf-8"))
index = []
for f in ifrs["files"]:
    base = ROOT / "data" / "work" / f"{f['company']}_{f['period']}"
    d = next((x for x in (base / f"he_{f['report_id']}", base / "he") if x.exists()), None)
    if not d or not f["url"]:
        continue
    pages = [re.sub(r"\s+", " ", re.sub(r"[‎‏‪-‮⁦-⁩]", "", p.read_text(encoding="utf-8"))).strip() for p in sorted(d.glob("p*.txt"))]
    name = f"{f['company']}_{f['period']}.json"
    (OUT / name).write_text(json.dumps({"url": f["url"], "pages": pages}, ensure_ascii=False), encoding="utf-8")
    index.append({"company": f["company"], "period": f["period"], "pages": len(pages), "kb": round((OUT / name).stat().st_size / 1024)})
(OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")
print(len(index), "filings,", sum(x["pages"] for x in index), "pages,", sum(x["kb"] for x in index) // 1024, "MB")
