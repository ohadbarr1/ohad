"""Headline figures per company and period for the site, from the XBRL facts.

python3 pipeline/build_kpi.py -> web/public/data/kpi.json
Money is NIS thousands, EPS is NIS. Flows are stored per quarter (Q1-Q3) and per full year (FY);
a filer that tags a cumulative interim period is differenced back to the single quarter.
"""
import json
from datetime import date
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
CONCEPTS = {
    "profit": "ProfitLossAttributableToOwnersOfParent", "oci": "ComprehensiveIncomeAttributableToOwnersOfParent",
    "pretax": "ProfitLossBeforeTax", "revenue": "Revenue", "cfo": "CashFlowsFromUsedInOperatingActivities",
    "eps": "BasicEarningsLossPerShare", "equity": "EquityAttributableToOwnersOfParent", "assets": "Assets",
}
FLOWS = {"profit", "oci", "pretax", "revenue", "cfo", "eps"}

con = duckdb.connect(str(ROOT / "data" / "warehouse.duckdb"), read_only=True)
rows = con.execute("""select company, report_id, doc_type, concept, start_date, end_date, value from xbrl_facts
    where context in ('Current_AsOf','Current_ForPeriod') order by company, report_id""").fetchall()
reports = {}
for comp, rid, dt, concept, start, end, val in rows:
    r = reports.setdefault((comp, rid), {"dt": dt, "facts": {}, "end": None})
    r["facts"][concept] = (start, end, val)
    if concept == "Assets":
        r["end"] = end
out = {}
for (comp, rid), r in sorted(reports.items()):
    end = r["end"]
    if end is None:
        continue
    q = 4 if r["dt"] == "annual" else (end.month // 3)
    period = f"{end.year}FY" if q == 4 else f"{end.year}Q{q}"
    vals, months = {}, {}
    for key, concept in CONCEPTS.items():
        f = r["facts"].get(concept)
        if not f:
            continue
        start, e, v = f
        vals[key] = v if key == "eps" else v / 1000
        if key in FLOWS and start:
            months[key] = round((e - start).days / 30.4)
    out.setdefault(comp, {})[period] = {"end": str(end), "rid": rid, "vals": vals, "months": months}  # later report id wins

site = {}
for comp, per in out.items():
    order = sorted(per, key=lambda p: (per[p]["end"], p))
    # undo cumulative interim tagging
    for p in order:
        if p.endswith("FY"):
            continue
        y, q = int(p[:4]), int(p[5])
        for key, m in per[p]["months"].items():
            if m > 4:
                prior = [per.get(f"{y}Q{k}", {}).get("vals", {}).get(key) for k in range(1, q)]
                if all(x is not None for x in prior):
                    per[p]["vals"][key] -= sum(prior)
                else:
                    per[p]["vals"].pop(key, None)
    site[comp] = {"periods": order, "end": [per[p]["end"] for p in order],
                  "values": {k: [per[p]["vals"].get(k) for p in order] for k in CONCEPTS}}
    print(comp, len(order), order[0], order[-1])
(ROOT / "web" / "public" / "data" / "kpi.json").write_text(json.dumps(
    {"asof": str(date.today()), "source": "XBRL attached to periodic reports, MAYA", "companies": site}), encoding="utf-8")
