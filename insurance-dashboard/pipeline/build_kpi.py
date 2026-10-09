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

# What the reports themselves say, where a filing has been extracted: profit for the quarter and year to date.
truth = {}
for f in sorted((ROOT / "data" / "extracted").glob("*/*.json")):
    for x in json.loads(f.read_text(encoding="utf-8"))["facts"]:
        if x["metric"] == "profit_attributable" and x["segment"] == "group" and x["window"] in ("q", "ytd") and isinstance(x["value"], (int, float)):
            y, m = int(x["date"][:4]), int(x["date"][5:7])
            if m in (3, 6, 9):
                truth.setdefault((f.parent.name, f"{y}Q{m // 3}"), {})[x["window"]] = x["value"] * 1000

# And what the income statement of every Q2/Q3 report shows (pipeline/verify_kpi_window.py), where the reading closes arithmetically.
windows = json.loads((ROOT / "data" / "registry" / "kpi_windows.json").read_text(encoding="utf-8"))
# readings made by hand for the quarters the script could not settle (same shape, check = "manual")
hand = ROOT / "data" / "registry" / "kpi_windows_manual.json"
if hand.exists():
    for comp, per_ in json.loads(hand.read_text(encoding="utf-8")).items():
        if not comp.startswith("_"):
            windows.setdefault(comp, {}).update(per_)
for comp, per_ in windows.items():
    for p, h in per_.items():
        if h["check"] in ("arithmetic", "manual"):
            truth[(comp, p)] = {"q": h["q"], "ytd": h["ytd"]}  # same report as the tag; an extracted later report may carry a restated comparative

manual = json.loads((ROOT / "data" / "registry" / "kpi_verified.json").read_text(encoding="utf-8"))
site, notes = {}, []
for comp, per in out.items():
    order = sorted(per, key=lambda p: (per[p]["end"], p))
    status = {}
    for p in order:
        if p.endswith("FY"):
            status[p] = "fy"
            continue
        t, v = truth.get((comp, p)), per[p]["vals"].get("profit")
        near = lambda a, b: a is not None and b is not None and abs(a - b) <= max(1500, abs(b) * 0.002)
        if manual.get(comp, {}).get(p, {}).get("window") == "q" or (t and near(v, t.get("q"))):
            status[p] = "verified"
        elif t and near(v, t.get("ytd")):
            status[p] = "cumulative"  # the filer tagged year-to-date figures in a quarter context
        else:
            status[p] = "unverified"
    cumulative_filer = "cumulative" in status.values()
    for p in order:
        if status[p] == "cumulative":
            y, q = int(p[:4]), int(p[5])
            prior = [f"{y}Q{k}" for k in range(1, q)]
            ok = all(status.get(k) in ("verified", "corrected") or (k.endswith("Q1")) for k in prior)
            for key in FLOWS:
                cur = per[p]["vals"].get(key)
                prev = [per.get(k, {}).get("vals", {}).get(key) for k in prior]
                per[p]["vals"][key] = cur - sum(prev) if ok and cur is not None and all(x is not None for x in prev) else None
            if truth.get((comp, p), {}).get("q") is not None:  # the quarter's profit is printed: use it rather than a difference
                per[p]["vals"]["profit"] = truth[(comp, p)]["q"]
            status[p] = "corrected"
        elif status[p] == "unverified" and cumulative_filer and not p.endswith("Q1"):
            for key in FLOWS:  # cannot tell quarter from year to date without the report: leave a gap rather than a wrong number
                per[p]["vals"][key] = None
            status[p] = "withheld"
    if cumulative_filer:
        notes.append({"company": comp, "corrected": [p for p in order if status[p] == "corrected"], "withheld": [p for p in order if status[p] == "withheld"]})
    site[comp] = {"periods": order, "end": [per[p]["end"] for p in order], "status": [status[p] for p in order],
                  "values": {k: [per[p]["vals"].get(k) for p in order] for k in CONCEPTS}}
    print(comp, len(order), {s: list(status.values()).count(s) for s in set(status.values())})
(ROOT / "web" / "public" / "data" / "kpi.json").write_text(json.dumps(
    {"asof": str(date.today()), "source": "XBRL attached to periodic reports, MAYA", "notes": notes, "companies": site}), encoding="utf-8")
