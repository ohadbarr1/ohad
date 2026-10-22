"""One value per figure: where the statements printed a headline figure that the XBRL tag gives slightly differently (a rounding,
e.g. Clal Q2'26 basic EPS printed 7.63 against 7.64 tagged), the site shows the printed figure, with its page, and names the tag value.

Reads web/public/data/kpi.json and web/public/data/lines.json (build_kpi.py and build_workbook.py first); writes kpi.json back with
companies.<id>.canon = { key: { period: [printed, tagged, report id, page] } }. Larger differences are left alone: they are not a
rounding, and the KPI fixes in build_kpi.py handle the known tagging errors.
"""
import json
import re
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "web" / "public" / "data"
kpi = json.loads((DATA / "kpi.json").read_text(encoding="utf-8"))
lines = json.loads((DATA / "lines.json").read_text(encoding="utf-8"))
END = {"Q1": "03-31", "Q2": "06-30", "Q3": "09-30", "FY": "12-31"}
# kpi key -> (cross-company line, kind of period, scale, rounding tolerance). Both files keep amounts in NIS thousands; a figure printed
# in NIS millions rounds by up to 500 thousand, so the tolerance is NIS 1.5m or 0.15%; per-share figures round at the second decimal.
MAP = {"eps": ("eps", "flow", 1, lambda v: 0.015), "equity": ("equity_attr", "inst", 1, lambda v: max(1500, abs(v) * 0.0015)),
       "assets": ("total_assets", "inst", 1, lambda v: max(1500, abs(v) * 0.0015))}
periods = [tuple(p) for p in lines["periods"]]
rid_of = lambda u: int(m.group(1)) if u and (m := re.search(r"P(\d+)-\d+\.pdf", u)) else None
n = 0
for comp, c in kpi["companies"].items():
    canon = {}
    for key, (role, kind, scale, tol) in MAP.items():
        printed = lines["data"].get(role, {}).get(comp)
        if not printed or key not in c["values"]:
            continue
        cells = {periods[pi]: (v, pg, u) for pi, v, pg, u, *_ in printed["cells"]}
        for i, p in enumerate(c["periods"]):
            x = c["values"][key][i]
            end = f"{p[:4]}-{END[p[4:]]}"
            hit = cells.get(("FY" if p.endswith("FY") else "Q", end)) if kind == "flow" else cells.get(("I", end))
            if x is None or not hit:
                continue
            v = hit[0] / scale
            if abs(v - x) > 1e-9 and abs(v - x) <= tol(v):
                canon.setdefault(key, {})[p] = [round(v, 4), x, rid_of(lines["urls"][hit[2]] if hit[2] is not None else None), hit[1]]
                n += 1
    if canon:
        c["canon"] = canon
    else:
        c.pop("canon", None)
(DATA / "kpi.json").write_text(json.dumps(kpi, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(n, "headline figures now shown as printed (tag within rounding):", {k: sum(len(v) for v in c.get("canon", {}).values()) for k, c in kpi["companies"].items() if c.get("canon")})
