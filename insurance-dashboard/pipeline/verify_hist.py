"""Page check for the IFRS 4 history extractions: every value must be printed on its cited page.

python3 pipeline/verify_sop.py <company> <period>
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
comp, period = sys.argv[1], sys.argv[2]
d = json.loads((ROOT / "data" / "extracted_hist" / comp / f"{period}.json").read_text(encoding="utf-8"))
num = [f for f in d["facts"] if isinstance(f.get("value"), (int, float))]
missing = []
for f in num:
    page = ROOT / "data" / "work" / f"{comp}_{period}" / (f.get("doc") or "he") / f"p{int(f['page_he']):03d}.txt"
    txt = re.sub(r"[‎‏‪-‮⁦-⁩]", "", page.read_text(encoding="utf-8")) if page.exists() else ""
    a = abs(f["value"])
    forms = {f"{a:,.0f}", f"{a:,.1f}", f"{a:.1f}", f"{a:.2f}", f"{a * 1000:,.0f}", str(a).rstrip("0").rstrip(".") if "." in str(a) else str(a)}
    if not any(re.search(rf"(?<![\d.,]){re.escape(x)}(?![\d])", txt) for x in forms):
        missing.append((f["metric"][:50], f["segment"], f["value"], f.get("doc") or "he", f["page_he"]))
print(f"{comp} {period}: {len(num)} numeric facts, {len(num) - len(missing)} found on their cited page")
for m in missing[:40]:
    print("   NOT ON PAGE", m)
fam = {}
for f in d["facts"]:
    k = f["metric"].split(":")[0]
    fam[k] = fam.get(k, 0) + 1
print("   families:", fam, "| not_found:", len(d.get("not_found", [])))
