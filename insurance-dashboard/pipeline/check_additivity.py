"""Additivity of the statements workbooks: Q1 + Q2 = H1 and H1 + Q3 = 9M on every flow line of the income, comprehensive-income and
cash-flow sheets built from the reports (web/public/data/companies/<id>.json, sheets "X.").

python3 pipeline/check_additivity.py [--json] [--since 2024]
Only printed figures take part (derived cells, flag 1, and IFRS 4 figures copied into IFRS 17 lines, flag 2, are left out), and only
lines in NIS thousands (per-share figures, share counts and balances are not additive). A check fails when the sum misses the cumulative
figure by more than rounding: 1.5 units of the coarsest print (NIS 1.5 thousand, or NIS 1.5 million where a figure is printed in millions).
The IFRS 17 era is the IFRS 17 block of an insurer's sheet, periods from 2024. Fund houses (one standard) are reported separately.
"""
import collections
import json
import re
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "web" / "public" / "data" / "companies"
SHEETS = ("X.רווח_והפסד", "X.רווח_כולל", "X.תזרים_מזומנים")
# not flows: opening and closing balances (by caption or by the section caption above them), counts, ratios, per-share
NONFLOW = re.compile(r"לתחילת|לסוף|^יתרת|יתרה ל|מספר ה?מניות|משוקלל|למניה|שיעור|יחס |באחוזים|%|באלפים")


def run(since=2024):
    out = {}
    for f in sorted(DATA.glob("*.json")):
        if f.name.count(".") > 1 or f.stem == "index":
            continue
        d = json.loads(f.read_text(encoding="utf-8"))
        P = d["periods"]
        block, cur, hdr, skip = {}, collections.Counter(), {}, set()
        for i, m in enumerate(d["metrics"]):
            if m["header"] and not m.get("std"):
                hdr[m["sheet"]] = m["label"]
            elif NONFLOW.search(m["label"]) or NONFLOW.search(hdr.get(m["sheet"], "")):
                skip.add(i)
            if m.get("std"):
                hdr[m["sheet"]] = ""
                cur[m["sheet"]] += 1
                continue
            block[i] = "IFRS 17" if (m["sheet"] in SHEETS and cur[m["sheet"]] == 1 and any(x.get("std") for x in d["metrics"] if x["sheet"] == m["sheet"])) else ("IFRS 4" if cur[m["sheet"]] >= 2 else "one")
        vals = collections.defaultdict(dict)
        for x in d["facts"]:
            m = d["metrics"][x[0]]
            fl = x[5] if len(x) > 5 else 0
            if m["sheet"] not in SHEETS or m["header"] or m["unit"] != "k" or fl & 3 or x[0] in skip:
                continue
            p = P[x[1]]
            vals[x[0]][(p["type"], p["end"])] = x[2]
        res = {"IFRS 17": [0, 0], "IFRS 4": [0, 0], "one": [0, 0]}
        fails = []
        for mi, v in vals.items():
            years = {e[:4] for (_, e) in v}
            for y in sorted(years):
                if int(y) < since:
                    continue
                for parts, whole in (((("Q", f"{y}-03-31"), ("Q", f"{y}-06-30")), ("H", f"{y}-06-30")),
                                     ((("H", f"{y}-06-30"), ("Q", f"{y}-09-30")), ("9M", f"{y}-09-30"))):
                    if whole not in v or not all(p in v for p in parts):
                        continue
                    xs = [v[p] for p in parts] + [v[whole]]
                    step = 1000 if any(abs(a) >= 1000 and abs(a) % 1000 == 0 for a in xs) else 1
                    bad = abs(sum(xs[:-1]) - xs[-1]) > 1.5 * step + 1e-6
                    r = res[block.get(mi, "one")]
                    r[0] += 1
                    if bad:
                        r[1] += 1
                        fails.append([d["metrics"][mi]["sheet"], d["metrics"][mi]["label"], whole[0], whole[1], xs])
        out[f.stem] = {"checks": res, "fails": fails}
    return out


if __name__ == "__main__":
    since = int(sys.argv[sys.argv.index("--since") + 1]) if "--since" in sys.argv else 2024
    r = run(since)
    if "--json" in sys.argv:
        print(json.dumps(r, ensure_ascii=False))
        sys.exit(0)
    tot = collections.Counter()
    for comp, x in r.items():
        c = x["checks"]
        line = "  ".join(f"{k}: {b}/{n} ({b / n:.1%})" for k, (n, b) in c.items() if n)
        print(f"{comp:11} {line}")
        for k, (n, b) in c.items():
            tot[k + " n"] += n
            tot[k + " fail"] += b
    for k in ("IFRS 17", "one", "IFRS 4"):
        if tot[k + " n"]:
            print(f"total {k}: {tot[k + ' fail']}/{tot[k + ' n']} ({tot[k + ' fail'] / tot[k + ' n']:.1%})")
