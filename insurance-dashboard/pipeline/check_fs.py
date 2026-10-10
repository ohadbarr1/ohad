"""Summary check of the full-statement extractions (spec v6), per company.

python3 pipeline/check_fs.py [company ...]
For every file: values on their cited page (via verify_fs.py) and whether the balance totals agree.
Across files: every cell that two reports print for the same line and period, and how many of them differ. A high share of
differences in one report points at columns assigned to the wrong period.
"""
import collections
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FS = ROOT / "data" / "extracted_fs"
src = (ROOT / "pipeline" / "build_workbook.py").read_text(encoding="utf-8")
ns = {}
exec(src[src.index("def norm(t):"):src.index("\n\n\ndef statements")], {"re": re}, ns)
norm = ns["norm"]
for comp in sys.argv[1:] or sorted(p.name for p in FS.iterdir() if p.is_dir()):
    files = sorted((FS / comp).glob("*.json"))
    vals = found = 0
    bad = []
    for f in files:
        out = subprocess.run([sys.executable, str(ROOT / "pipeline" / "verify_fs.py"), comp, f.stem], capture_output=True, text=True).stdout
        m = re.search(r"(\d+) values, (\d+) found", out)
        if not m:
            bad.append(f"{f.stem}: verifier failed")
            continue
        vals += int(m.group(1)); found += int(m.group(2))
        if "BALANCE TOTALS DIFFER" in out:
            bad.append(f"{f.stem}: balance totals differ")
        elif "balance totals agree" not in out:
            bad.append(f"{f.stem}: balance totals not identified")
        if int(m.group(1)) != int(m.group(2)):
            bad.append(f"{f.stem}: {int(m.group(1)) - int(m.group(2))} values not on page")
    seen = collections.defaultdict(list)
    for f in files:
        d = json.loads(f.read_text(encoding="utf-8"))
        mult = 1000 if re.search(r"million|מיליוני", str(d.get("unit") or "")) else 1  # everything compared in NIS thousands
        for st in d["statements"]:
            section, occ = "", collections.Counter()
            for r in st["rows"]:
                lab = norm(r["label"])
                if r.get("header"):
                    section = lab
                occ[(section, lab)] += 1
                for c, v in zip(st["columns"], r.get("values") or []):
                    if isinstance(v, (int, float)):
                        seen[(st["statement"], d.get("standard"), section, lab, occ[(section, lab)], c["window"], c["date"])].append((f.stem, v * mult, mult))
    multi = {k: v for k, v in seen.items() if len({x[0] for x in v}) > 1}
    # a company that moved from thousands to millions reprints old periods rounded: equal within the rounding of the coarser unit
    diff = {k: v for k, v in multi.items() if max(x[1] for x in v) - min(x[1] for x in v) > (0.6 * max(x[2] for x in v) if max(x[2] for x in v) > 1 else 1.5)}
    per = collections.Counter(x[0] for v in diff.values() for x in v)
    print(f"{comp}: {len(files)} files, {found}/{vals} values on page, {len(multi) - len(diff)}/{len(multi)} shared cells agree" + (f"; most differences in {per.most_common(3)}" if diff else ""))
    for b in bad:
        print("   ", b)
