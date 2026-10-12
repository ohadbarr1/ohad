"""Guards on the built workbooks (web/public/data/companies/<id>.json). Exit code 1 on any failure: run before a deploy.

python3 pipeline/check_workbook.py
Checks, on the sheets built from the reports (codes starting "X."):
  - per-share lines are in NIS: every value within ±500, and not all of them below 0.01
  - no line without a label
  - within one accounting standard, no two differently named lines of a sheet that print identical figures in three or more
    common periods (a renamed line left as two)
"""
import collections
import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "web" / "public" / "data" / "companies"
fail = 0
for f in sorted(DATA.glob("*.json")):
    if f.name.count(".") > 1 or f.stem == "index":
        continue
    d = json.loads(f.read_text(encoding="utf-8"))
    P = d["periods"]
    by = collections.defaultdict(dict)
    own = collections.defaultdict(dict)  # without the IFRS 4 figures copied into IFRS 17 lines (flag 2): those repeat by design
    for x in d["facts"]:
        by[x[0]][(P[x[1]]["type"], P[x[1]]["end"])] = x[2]
        if not (len(x) > 5 and x[5] and x[5] & 2):
            own[x[0]][(P[x[1]]["type"], P[x[1]]["end"])] = x[2]
    probs = []
    rows = [(i, m) for i, m in enumerate(d["metrics"]) if m["sheet"].startswith("X.") and not m["header"]]
    for i, m in rows:
        vals = list(by[i].values())
        if not m["label"].strip():
            probs.append(f"no label: {m['sheet']} row {i}")
        if m["unit"] == "nis" and vals and (max(abs(v) for v in vals) > 500 or max(abs(v) for v in vals) < 0.01):
            probs.append(f"per-share out of range: {m['sheet']} · {m['label'][:40]} · max {max(abs(v) for v in vals):,.2f}")
    sheets, std, seen_std = collections.defaultdict(list), {}, collections.Counter()
    for i, m in enumerate(d["metrics"]):
        if m.get("std"):
            seen_std[m["sheet"]] += 1
        std[i] = seen_std[m["sheet"]]
    for i, m in rows:
        if not m.get("total") and m["unit"] != "nis" and m["sheet"] in ("X.רווח_והפסד", "X.מאזן"):
            sheets[(m["sheet"], std[i])].append(i)
    for (sheet, _), ids in sheets.items():
        for n, a in enumerate(ids):
            for b in ids[n + 1:]:
                if d["metrics"][a]["label"].strip() == d["metrics"][b]["label"].strip():
                    continue  # the same caption twice is a line that the statement repeats (attribution rows), not a rename
                both = [p for p in own[a] if p in own[b]]
                if len(both) >= 3 and all(abs(own[a][p] - own[b][p]) < 0.6 for p in both) and any(abs(own[a][p]) > 0.6 for p in both):
                    probs.append(f"same figures twice: {sheet} · {d['metrics'][a]['label'][:30]} / {d['metrics'][b]['label'][:30]} · {len(both)} periods")
    print(f"{f.stem}: {len(rows)} lines, {len(probs)} problems")
    for p in probs[:12]:
        print("   ", p)
    fail += len(probs)
sys.exit(1 if fail else 0)
