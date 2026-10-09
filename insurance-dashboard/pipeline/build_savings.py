"""Savings economics (pension / provident managing-company profitability) for the site.

.venv/bin/python pipeline/build_savings.py -> web/public/data/savings_econ.json
Input: data/extracted_savings/<company>/<period>.json, filtered by data/work/savings_verified.json (run verify_savings.py first):
facts not printed on their page are dropped, corrected pages are applied.

Rows are printed figures in NIS millions (expense lines as positive amounts), one per company x period x activity x metric,
each with its page and filing URL. Rows with `der` are ratios computed here from two printed rows of the same segment
(percent); nothing else is computed: no sums across segments, no annualisation.
"""
import csv
import json
import re
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from verify_savings import fid  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
FILES = "https://mayafiles.tase.co.il/"
SRC = ROOT / "data" / "extracted_savings"

# printed segment -> activity. `entity` = the whole reporting company (fund houses), not one activity.
SEG = {"pension": ["pension"], "provident": ["provident"], "pension_provident": ["combined"], "investment_contracts": ["investment_contracts"]}
ENTITY = {("altshuler", "group"): ["entity"], ("analyst", "group"): ["entity"], ("yelin", "yelin_total"): ["entity"],
          ("more_gemel", "group"): ["entity", "combined"]}  # More Gemel manages only provident and pension funds
# raw metric -> (metric, preference rank, extra flags)
MET = {
    "management_fees": ("fees", 0, {}),
    "selling_and_marketing_expenses": ("sm", 0, {}),
    "general_and_administrative_expenses": ("ga", 0, {}),
    "total_expenses": ("expenses", 0, {}),
    "other_operating_expenses": ("expenses", 1, {"ns": 1}),
    "other_expenses": ("expenses", 1, {"ns": 1}),
    "profit_before_tax": ("profit", 0, {"kind": "pbt"}),
    "comprehensive_income_before_tax": ("profit", 1, {"kind": "cibt"}),
    "operating_profit": ("profit", 2, {"kind": "op"}),
    "aum": ("aum", 0, {}),
    "deposits": ("deposits", 0, {}),
}
POSITIVE = {"sm", "ga", "expenses"}
DERIVED = [("margin", "profit"), ("exp_ratio", "expenses"), ("sm_pct", "sm"), ("ga_pct", "ga")]
# Disclosure limits established when the reports were read (shown as chips).
LIMITS = {
    "harel": ["no_split"], "phoenix": ["no_split"], "migdal": ["no_split"], "clal": ["no_split"], "menora": ["no_split"],
    "ayalon": ["no_split", "no_pension"], "hachshara": ["no_split", "ic_main"],
    "meitav": ["combined_only"], "analyst": ["entity_costs"], "yelin": ["entity_costs"],
}


def period_key(w, d):
    y, m = d[:4], int(d[5:7])
    if d[5:] not in ("03-31", "06-30", "09-30", "12-31"):
        return None
    if w == "fy" or (w == "ytd" and m == 12):
        return f"{y}FY"
    if w == "ytd":
        return {3: f"{y}Q1", 6: f"{y}H1", 9: f"{y}9M"}.get(m)
    if w == "q":
        return f"{y}Q{m // 3}"
    return None


def canonical(comp, f):
    m = MET.get(f["metric"])
    if not m:
        return None
    name, rank, flags = m
    label = str(f.get("label") or "")
    if f["metric"] == "other_expenses" and "תפעוליות אחרות" not in label:
        return None  # a single cost item (payroll, fund operation), not the activity's expense line
    if name == "deposits" and "נטו" in label:
        return None  # net of withdrawals: a different measure
    if comp == "analyst" and name == "ga":
        name = "expenses"  # the income-statement line is G&A together with selling and marketing
    if any(f.get(k) for k in ("product", "fund", "holder_status")) or f.get("sub_segment") not in (None, "", "total"):
        return None  # one fund or product inside the activity
    if f.get("source") == "chart":
        return None
    return name, rank, flags


pdf = {int(r["report_id"]): r["url"] for r in csv.DictReader(open(ROOT / "data" / "registry" / "documents.csv", encoding="utf-8")) if r["file_type"] == "pdf1"}
vpath = ROOT / "data" / "work" / "savings_verified.json"
verified = json.loads(vpath.read_text(encoding="utf-8")) if vpath.exists() else None
if verified is None:
    sys.exit("run pipeline/verify_savings.py first")

best, tally, files = {}, {}, []
for path in sorted(SRC.glob("*/*.json")):
    comp, period = path.parent.name, path.stem
    d = json.loads(path.read_text(encoding="utf-8"))
    ver = verified.get(comp, {}).get(period, {"moved": [], "dropped": []})
    dropped = {x["id"] for x in ver["dropped"]}
    moved = {x["id"]: x["to"] for x in ver["moved"]}
    t = tally.setdefault(comp, {"facts": 0, "kept": 0, "moved": 0, "dropped": 0})
    t["facts"] += len(d["facts"]); t["dropped"] += len(dropped); t["moved"] += len(moved); t["kept"] += len(d["facts"]) - len(dropped)
    own_end = f"{period[:4]}-{ {'Q1': '03-31', 'Q2': '06-30', 'Q3': '09-30', 'FY': '12-31'}[period[4:]] }"
    files.append({"company": comp, "period": period, "report_id": d.get("report_id_he"), "url": FILES + pdf[d["report_id_he"]] if d.get("report_id_he") in pdf else None})
    for i, f in enumerate(d["facts"]):
        if fid(f) in dropped:
            continue
        c = canonical(comp, f)
        if not c:
            continue
        name, rank, flags = c
        acts = ENTITY.get((comp, f["segment"])) or SEG.get(f["segment"])
        if not acts:
            continue
        rid = int(m.group(1)) if (m := re.search(r"(\d{6,})", str(f.get("doc") or ""))) else d.get("report_id_he")
        url = FILES + pdf[rid] if rid in pdf else None
        v = abs(f["value"]) if name in POSITIVE else f["value"]
        row = {"c": comp, "m": name, "v": round(v, 3), "w": f["window"], "d": f["date"], "pg": moved.get(fid(f), f.get("page_he")), "url": url,
               "l": " ".join(str(f.get("label") or "").split())[:90], "s": f["segment"], "rm": f["metric"], "file": period, **flags}
        if f.get("source") and f["source"] != "table":
            row["src"] = f["source"]
        pks = [period_key(f["window"], f["date"])] if f["window"] != "instant" else [f"{f['date'][:4]}{s}" for s in {"12-31": ("FY", "Q4"), "06-30": ("H1", "Q2"), "03-31": ("Q1",), "09-30": ("9M", "Q3")}.get(f["date"][5:], ())]
        for a in acts:
            for pk in pks:
                if not pk:
                    continue
                r = {**row, "a": a, "pk": pk}
                if a == "combined" and (comp, f["segment"]) in ENTITY:
                    r["ent"] = 1
                if a == "entity":
                    r["ent"] = 1
                # one row per cell: preferred printed line, a table before running text, the filing whose own period it is, first printed
                score = (rank, 0 if f.get("source") == "table" else 1, 0 if f["date"] == own_end else 1, period, i)
                key = (comp, pk, a, name)
                if key not in best or score < best[key][0]:
                    best[key] = (score, r)

rows = [r for _, r in best.values()]
by = {(r["c"], r["pk"], r["a"], r["m"]): r for r in rows}
for (c, pk, a, m), fees in list(by.items()):
    if m != "fees" or fees["v"] <= 0:
        continue
    for name, num in DERIVED:
        n = by.get((c, pk, a, num))
        if not n or n["s"] != fees["s"] or n["w"] != fees["w"]:
            continue  # numerator and denominator must be the same printed segment and window
        r = {"c": c, "pk": pk, "a": a, "m": name, "v": round(100 * n["v"] / fees["v"], 2), "w": n["w"], "d": n["d"], "pg": n["pg"], "url": n["url"],
             "pg2": fees["pg"], "url2": fees["url"], "l": f"{n['l']} / {fees['l']}", "s": n["s"], "rm": f"{n['rm']}/{fees['rm']}", "file": n["file"], "der": 1}
        for k in ("kind", "ns", "ent"):
            if n.get(k):
                r[k] = n[k]
        rows.append(r)

# periods worth a selector entry: fee income printed by at least two companies
cnt = {}
for r in rows:
    if r["m"] == "fees":
        cnt.setdefault(r["pk"], set()).add(r["c"])
keep = {pk for pk, cs in cnt.items() if len(cs) >= 2}
rows = sorted((r for r in rows if r["pk"] in keep), key=lambda r: (r["pk"], r["a"], r["m"], r["c"]))
END = {"FY": "12-31", "Q4": "12-31", "H1": "06-30", "Q2": "06-30", "Q1": "03-31", "9M": "09-30", "Q3": "09-30"}
periods = sorted(({"k": pk, "end": f"{pk[:4]}-{END[pk[4:]]}", "w": "fy" if pk.endswith("FY") else "ytd" if pk[4:] in ("H1", "9M") else "q"} for pk in keep),
                 key=lambda p: (p["end"], p["w"] != "q"), reverse=True)
companies = sorted({r["c"] for r in rows} | set(tally))
out = {"unit": "NIS millions; ratios in percent", "periods": periods, "companies": companies, "limits": {c: LIMITS.get(c, []) for c in companies},
       "verify": tally, "files": files, "rows": rows}
(ROOT / "web" / "public" / "data" / "savings_econ.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
print(len(rows), "rows;", sum(1 for r in rows if r.get("der")), "derived;", sum(1 for r in rows if not r["url"]), "without a source link; periods:", [p["k"] for p in periods])
for pk in [p["k"] for p in periods][:4]:
    for a in ("pension", "provident", "combined", "entity", "investment_contracts"):
        ms = {}
        for r in rows:
            if r["pk"] == pk and r["a"] == a:
                ms.setdefault(r["m"], []).append(r["c"])
        print(f"  {pk} {a:21}", ", ".join(f"{m} {len(v)}" for m, v in sorted(ms.items())))
