"""Extracted report facts for the site, with a standard segment and a link to the source page.

python3 pipeline/build_ifrs.py -> web/public/data/ifrs.json
Values stay as extracted (NIS millions, sign as printed). `seg` is the standard bucket; `segment` keeps the printed name.
"""
import json
import re
from datetime import date, timedelta
from pathlib import Path

import duckdb

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from bridge import solve  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
FILES = "https://mayafiles.tase.co.il/"


def std_segment(s):
    t = s.lower().replace("_", " ")
    if t in ("group", "total", "consolidated"):
        return "group"
    if re.search(r"life and health|life health", t):
        return "life_health"
    if re.search(r"investment (contract|polic)", t):
        return "investment_contracts"
    if re.search(r"^(life|long-term savings|lts)", t):
        return "life"
    if t.startswith("health"):
        return "health"
    if re.search(r"^(pc|p&c|general|non-life|motor|compulsory)", t):
        return "pc"
    if re.search(r"pension|provident|gemel|asset management|wealth|financial services", t):
        return "savings"
    if re.search(r"insurance$|insurance |subsidiary", t):
        return "insurer"
    return "other"


def opening_date(d, w):
    """Balance date an opening balance belongs to: the day before the window starts."""
    y, m, day = (int(x) for x in d.split("-"))
    if w == "instant":
        return str(date(y, m, day) - timedelta(days=1)) if day == 1 else d
    if w == "q":
        start = date(y, m - 2, 1)
    else:  # ytd, fy
        start = date(y, 1, 1)
    return str(start - timedelta(days=1))


try:
    con = duckdb.connect(str(ROOT / "data" / "warehouse.duckdb"), read_only=True)
    pdf = dict(con.execute("select report_id, min(url) from documents where file_type='pdf1' group by 1").fetchall())
except duckdb.IOException:  # warehouse busy: the exported registry has the same links
    import csv
    pdf = {int(r["report_id"]): r["url"] for r in csv.DictReader(open(ROOT / "data" / "registry" / "documents.csv", encoding="utf-8")) if r["file_type"] == "pdf1"}
out, files = [], []
MANIFEST = json.loads((ROOT / "data" / "work" / "manifest_quarters.json").read_text(encoding="utf-8")) if (ROOT / "data" / "work" / "manifest_quarters.json").exists() else {}
PRES = json.loads((ROOT / "data" / "registry" / "presentations.json").read_text(encoding="utf-8"))
for f in sorted((ROOT / "data" / "extracted").glob("*/*.json")):
    d = json.loads(f.read_text(encoding="utf-8"))
    comp, period = f.parent.name, f.stem
    url = pdf.get(d.get("report_id_he"))
    files.append({"company": comp, "period": period, "report_id": d.get("report_id_he"), "url": FILES + url if url else None, "facts": len(d["facts"])})
    for x in d["facts"]:
        v = x.get("value")
        if not isinstance(v, (int, float)):
            continue
        if x["metric"].endswith("_opening"):
            x = {**x, "date": opening_date(x["date"], x["window"]), "window": "instant"}
        row = {"c": comp, "p": period, "m": x["metric"], "s": x["segment"], "g": std_segment(str(x["segment"])), "b": x.get("basis") or "na",
               "w": x["window"], "d": x["date"], "v": round(v, 3), "pg": x.get("page_he"), "l": " ".join(str(x.get("label") or "").split())[:90]}
        for k_in, k_out in (("source", "src"), ("model", "model"), ("transition", "tr"), ("bucket", "bk"), ("effect_on", "fx")):
            if x.get(k_in) and x[k_in] != "table":
                row[k_out] = x[k_in]
        if x.get("doc") == "pres":  # the page number refers to the investor presentation, not the report
            pu = pdf.get(PRES.get(f"{comp}_{period}"))
            row["u"], row["src"] = (FILES + pu if pu else None), row.get("src", "pres")
        elif x.get("doc") == "en":  # cited on the English translation because the Hebrew page is an image
            eu = pdf.get((MANIFEST.get(f"{comp}_{period}", {}).get("en") or {}).get("report_id"))
            row["u"] = FILES + eu if eu else None
        if x.get("note"):
            row["n"] = " ".join(str(x["note"]).split())[:160]
        out.append(row)
# Savings policies without a risk component are investment contracts under IFRS 9 and carry no CSM. Where a filer prints a column for
# them in a CSM table (Phoenix: embedded-value future profit, "not included in the CSM as defined"), the rows are renamed so they never
# enter a CSM comparison, and the totals of that same table are flagged as including them.
for r in out:
    if r["g"] == "investment_contracts" and r["m"].startswith("csm_"):
        r["m"] = "future_profit_" + r["m"][4:]
for r in [x for x in out if x["m"].startswith("future_profit_")]:
    # the group total printed in the same table includes this column: take it out, keep what was printed in v0, and say so (cl = cleaned)
    for x in out:
        if (x["c"], x["p"], x["pg"], x.get("u"), x["g"], x["w"], x["d"], x["b"]) == (r["c"], r["p"], r["pg"], r.get("u"), "group", r["w"], r["d"], r["b"]) and x["m"] == "csm_" + r["m"][14:] and "cl" not in x:
            x["v0"], x["v"], x["cl"] = x["v"], round(x["v"] - r["v"], 3), 1
for r in [x for x in out if x["m"].startswith("future_profit_")]:
    # movement rows of that table with no savings-policy counterpart cannot be cleaned: flag them as still including it
    for x in out:
        if (x["c"], x["p"], x["pg"], x.get("u"), x["g"]) == (r["c"], r["p"], r["pg"], r.get("u"), "group") and x["m"].startswith("csm_") and "cl" not in x:
            x["inc"] = 1
# Bridge-consistent signs: `dv` is the movement as a change in the CSM balance (and balances as positive numbers),
# set only where opening + movements = closing can be made to hold in exactly one way.
groups = {}
for r in out:
    if r["m"].startswith("csm_") and r["m"] != "csm_expected_release" and not r["m"].startswith(("csm_subtotal", "csm_other:Balance")) and "tr" not in r and "model" not in r:
        groups.setdefault((r["c"], r["p"], r["s"], r["b"]), []).append(r)
closed = 0
rejected = []
for (comp, period, seg, basis), rows in groups.items():
    for o in [r for r in rows if r["m"] == "csm_opening"]:
        for c in [r for r in rows if r["m"] == "csm_closing" and r["d"] > o["d"]]:
            for w in ("q", "ytd", "fy"):
                mv = [r for r in rows if r["w"] == w and r["d"] == c["d"] and r["m"] not in ("csm_opening", "csm_closing")]
                if not mv or opening_date(c["d"], w) != o["d"]:
                    continue
                signs, how = solve(o["v"], c["v"], [r["v"] for r in mv])
                if not signs:
                    continue
                flip = -1 if (o["v"] < 0 and c["v"] < 0) else 1  # liabilities printed as negatives
                if how != "as printed":
                    # a sign search can close by coincidence when a row is missing: require the release row, and economically possible signs
                    dv = {r["m"]: flip * sg * r["v"] for r, sg in zip(mv, signs)}
                    if "csm_release" not in dv or dv["csm_release"] > 0 or dv.get("csm_interest_accretion", 0) < 0 or dv.get("csm_new_business", 0) < 0:
                        rejected.append((comp, period, seg, basis, w))
                        continue
                o["dv"], c["dv"] = flip * o["v"], flip * c["v"]
                for r, sg in zip(mv, signs):
                    r["dv"] = round(flip * sg * r["v"], 3)
                    if how != "as printed" or flip == -1:
                        r["sn"] = 1
                closed += 1
print(closed, "CSM bridges close;", len(rejected), "sign-normalised fits rejected as implausible:", rejected)
DATA = ROOT / "web" / "public" / "data"
for period in sorted({f["period"] for f in files}):
    rows = [{k: v for k, v in r.items() if k != "p"} for r in out if r["p"] == period]
    (DATA / f"ifrs_{period}.json").write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
(DATA / "ifrs.json").write_text(json.dumps({"unit": "NIS millions", "files": files}, ensure_ascii=False), encoding="utf-8")
print(len(out), "facts from", len(files), "filings;", sum(1 for x in files if x["url"]), "with a source link")
