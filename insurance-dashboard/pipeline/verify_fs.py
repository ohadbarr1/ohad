"""Page check for the full primary statements (spec v6): every value must be printed on its cited page.

python3 pipeline/verify_fs.py <company> <period>
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
comp, period = sys.argv[1], sys.argv[2]
d = json.loads((ROOT / "data" / "extracted_fs" / comp / f"{period}.json").read_text(encoding="utf-8"))
pages = {}


def text(n):
    if n not in pages:
        p = ROOT / "data" / "work" / f"{comp}_{period}" / (d.get("doc") or "he") / f"p{int(n):03d}.txt"
        pages[n] = re.sub(r"[‎‏‪-‮⁦-⁩]", "", p.read_text(encoding="utf-8")) if p.exists() else ""
    return pages[n]


total = missing = 0
for st in d["statements"]:
    cols = st["columns"]
    bad = []
    for r in st["rows"]:
        vals = r.get("values") or []
        if vals and len(vals) != len(cols):
            bad.append(("WRONG NUMBER OF VALUES", r["label"][:40], len(vals), len(cols)))
        for v in vals:
            if not isinstance(v, (int, float)):
                continue
            total += 1
            a = abs(v)
            forms = {f"{a:,.0f}", f"{a:,.1f}", f"{a:,.2f}", f"{a:.2f}", str(a).rstrip("0").rstrip(".") if "." in str(a) else str(a)}
            if not any(re.search(rf"(?<![\d.,]){re.escape(x)}(?![\d])", text(r["page"])) for x in forms):
                missing += 1
                bad.append(("NOT ON PAGE", r["label"][:40], v, r["page"]))
    n = sum(1 for r in st["rows"] if r.get("values"))
    print(f"{comp} {period} {st['statement']:8} {len(cols)} columns, {n} value rows, pages {st.get('pages')}")
    for b in bad[:25]:
        print("   ", *b)
    if st["statement"] == "balance":
        # the two printed grand totals must agree in every column
        lab = lambda r: re.sub(r"\s+", " ", re.sub(r"[\"'״׳]", "", r["label"])).strip()
        pre = r"^(סהכ|סך הכל|סך כל|סך)\s+(כל\s+)?(ה)?"
        tots = [r for r in st["rows"] if r.get("values") and re.search(pre + r"(נכסים|הון וה?התחייבויות|התחייבויות וה?הון)$", lab(r))]
        if len(tots) >= 2:
            a, b = tots[0]["values"], tots[-1]["values"]
            print("    balance totals agree" if a == b else f"    BALANCE TOTALS DIFFER {a} vs {b}")
        else:
            print("    balance totals not identified by label; check that total assets and total equity and liabilities are both recorded")
print(f"{comp} {period}: {total} values, {total - missing} found on their cited page; not_found: {len(d.get('not_found', []))}")
