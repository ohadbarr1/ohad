"""Check an extracted filing: every value on its cited Hebrew page, and reconciliation to independent figures.

python3 pipeline/verify_extraction.py <company> <period>
Independent figures: XBRL facts in the warehouse (equity, assets; profit windows) and data/registry/controls.json
(figures observed in EY InsurTool for the same period).
"""
import json
import sys
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
comp, period = sys.argv[1], sys.argv[2]
d = json.loads((ROOT / "data" / "extracted" / comp / f"{period}.json").read_text(encoding="utf-8"))
F = d["facts"]
end = f"{period[:4]}-{ {'Q1': '03-31', 'Q2': '06-30', 'Q3': '09-30', 'FY': '12-31'}[period[4:]] }"
num = [f for f in F if isinstance(f["value"], (int, float))]

missing = []
for f in num:
    page = ROOT / "data" / "work" / f"{comp}_{period}" / "he" / f"p{int(f['page_he']):03d}.txt"
    txt = page.read_text(encoding="utf-8") if page.exists() else ""
    a = abs(f["value"])
    forms = {f"{a:,.0f}", f"{a:,.1f}", f"{a:.1f}", f"{a:.2f}", f"{a * 1000:,.0f}", f"{a / 1000:.1f}", f"{a / 1000:.2f}", str(a).rstrip("0").rstrip(".")}
    if not any(x in txt for x in forms):
        missing.append(f)
print(f"{comp} {period}: {len(F)} facts, {len(d.get('not_found', []))} not found; on cited page: {len(num) - len(missing)}/{len(num)}")
for f in missing[:12]:
    print("   not on page:", f["metric"], f["segment"], f["window"], f["date"], f["value"], "p", f["page_he"])


def got(metric, segment, window, date=end):
    return sorted({f["value"] for f in num if f["metric"] == metric and (segment is None or f["segment"] == segment) and f["window"] == window and f["date"] == date})


try:
    con = duckdb.connect(str(ROOT / "data" / "warehouse.duckdb"), read_only=True)
    x = dict(con.execute("select concept, value/1e6 from xbrl_facts where company=? and period=? and context in ('Current_AsOf','Current_ForPeriod')", [comp, period]).fetchall())
except duckdb.IOException:  # warehouse busy: fall back to the exported headline file (same tagged values, NIS thousands)
    k = json.loads((ROOT / "web" / "public" / "data" / "kpi.json").read_text(encoding="utf-8"))["companies"][comp]
    i = k["periods"].index(period)
    x = {"EquityAttributableToOwnersOfParent": k["values"]["equity"][i] / 1000, "Assets": k["values"]["assets"][i] / 1000,
         "ProfitLossAttributableToOwnersOfParent": k["values"]["profit"][i] / 1000}
checks = [("equity vs XBRL", got("equity_attributable", "group", "instant"), x.get("EquityAttributableToOwnersOfParent")),
          ("assets vs XBRL", got("total_assets", "group", "instant"), x.get("Assets"))]
xp = x.get("ProfitLossAttributableToOwnersOfParent")
q, ytd = got("profit_attributable", "group", "q"), got("profit_attributable", "group", "ytd")
tag = "q" if any(abs(v - xp) < 1.5 for v in q) else "ytd" if any(abs(v - xp) < 1.5 for v in ytd) else "NEITHER"
print(f"   XBRL profit {xp:,.0f} matches the report's {tag} figure (report q={q}, ytd={ytd})")
ctrl = json.loads((ROOT / "data" / "registry" / "controls.json").read_text(encoding="utf-8")).get(comp, {}).get(period, [])
for name, metric, segment, window, exp in ctrl:
    checks.append((name + " vs InsurTool", got(metric, segment, window), exp))
bad = 0
for name, have, exp in checks:
    ok = exp is not None and any(abs(v - exp) <= max(0.6, abs(exp) * 0.0006) for v in have)
    bad += not ok
    print("   OK " if ok else "   ?? ", name, "expected", exp, "extracted", have[:6])
print(f"   controls passed: {len(checks) - bad}/{len(checks)}")
