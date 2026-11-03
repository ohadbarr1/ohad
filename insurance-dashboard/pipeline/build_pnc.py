"""P&C ratios by line of business, every insurer: web/public/data/pnc.json (page /industry/pnc).

Input : data/extracted_pnc/<company>/<period>.json (pipeline/extract_pnc.py: the IFRS 17 general-insurance note, per main portfolio group,
        every row on its printed page, already footed), data/registry/documents.csv (report id -> PDF url, publication date)
Output: web/public/data/pnc.json

Per line (סך ביטוח כללי, רכב חובה, רכב רכוש, אחר) and period (Q2'26, Q1'26, Q2'25, Q1'25, H1'26, H1'25, FY'25, LTM to Q2'26):
    loss ratio      = (claims and other insurance-service expenses incurred + changes for past service) ÷ insurance revenue
    expense ratio   = (insurance-service expenses − the two claims rows) ÷ insurance revenue      (acquisition amortisation, onerous losses, other)
    combined, gross = insurance-service expenses ÷ insurance revenue                                (loss + expense)
    combined, net   = (insurance-service expenses − reinsurance income) ÷ (insurance revenue − reinsurance expense)
    ceded           = reinsurance expense ÷ insurance revenue
    reinsurance     = reinsurance income − reinsurance expense (NIS m; negative = a cost to the insurer)
Derived periods: Q1 = H1 − Q2 (both printed in the Q2 report), LTM = FY'25 + H1'26 − H1'25. Expense rows are stored expense-positive.
The note groups property, liability and the other lines as one "אחר" column: the split into רכוש ואחר / חבויות is "לא מדווח בפילוח".
Health has no by-line table in the interim report (segment total only): "לא מדווח בפילוח".

python3 pipeline/build_pnc.py            build
python3 pipeline/build_pnc.py --check    rebuild in memory and compare with the file; verify the identities and that every ratio re-derives
"""
import csv
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "extracted_pnc"
OUT = ROOT / "web" / "public" / "data" / "pnc.json"
FILES = "https://mayafiles.tase.co.il/"
INSURERS = ["phoenix", "harel", "migdal", "clal", "menora", "ayalon", "hachshara"]
NAMES = {"phoenix": "הפניקס", "harel": "הראל", "migdal": "מגדל", "clal": "כלל", "menora": "מנורה", "ayalon": "איילון", "hachshara": "הכשרה"}
LINES = [("pc", "סך ביטוח כללי"), ("pc:רכב חובה", "רכב חובה"), ("pc:רכב רכוש", "רכב רכוש"), ("pc:אחר", "אחר (רכוש, חבויות ויתר הענפים)")]
GAPS = [("pc:רכוש ואחר", "רכוש ואחר"), ("pc:חבויות", "חבויות"), ("health:קצר טווח", "בריאות קצר טווח"), ("health:ארוך טווח", "בריאות ארוך טווח")]
GAP_WHY = {"pc:רכוש ואחר": "לא מדווח בפילוח: הביאור מאחד רכוש, חבויות ויתר הענפים בעמודת \"אחר\"",
           "pc:חבויות": "לא מדווח בפילוח: הביאור מאחד רכוש, חבויות ויתר הענפים בעמודת \"אחר\"",
           "health:קצר טווח": "לא מדווח בפילוח: בדוח הרבעוני אין טבלת בריאות לפי ענף (מגזר הבריאות מוצג כסכום אחד)",
           "health:ארוך טווח": "לא מדווח בפילוח: בדוח הרבעוני אין טבלת בריאות לפי ענף (מגזר הבריאות מוצג כסכום אחד)"}
METRICS = ["rev", "ise", "isr_gross", "rx", "ri", "rnet", "isr", "cl", "past"]
BASE = {("ytd", "2026-06-30"): "h126", ("ytd", "2025-06-30"): "h125", ("q", "2026-06-30"): "q226", ("q", "2025-06-30"): "q225", ("fy", "2025-12-31"): "fy25"}
# period -> [(sign, base window)]
PERIODS = [("q226", "Q2'26", [(1, "q226")]), ("q126", "Q1'26", [(1, "h126"), (-1, "q226")]), ("q225", "Q2'25", [(1, "q225")]),
           ("q125", "Q1'25", [(1, "h125"), (-1, "q225")]), ("h126", "H1'26", [(1, "h126")]), ("h125", "H1'25", [(1, "h125")]),
           ("fy25", "FY'25", [(1, "fy25")]), ("ltm", "LTM Q2'26", [(1, "fy25"), (1, "h126"), (-1, "h125")])]
TOL = 1.5   # NIS m (the identities on the printed unit)


def docs():
    out = {}
    with open(ROOT / "data" / "registry" / "documents.csv", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["file_type"].startswith("pdf"):
                out.setdefault(int(r["report_id"]), {"f": r["url"], "pub": r["publish_date"][:10], "t": r["title"][:80]})
    return out


def r6(v):
    return None if v is None else round(v, 6)


def ratios(x):
    """x: metric -> value for one line and period (NIS m, expenses positive); the ratios as fractions (None where the denominator is not positive)"""
    rev = x.get("rev")
    if not rev or rev <= 0:
        return {}
    out = {}
    if None not in (x.get("cl"), x.get("past")):
        out["lr"] = (x["cl"] + x["past"]) / rev
        if x.get("ise") is not None:
            out["er"] = (x["ise"] - x["cl"] - x["past"]) / rev
    if x.get("ise") is not None:
        out["cr"] = x["ise"] / rev
    if None not in (x.get("ise"), x.get("ri"), x.get("rx")) and rev - x["rx"] > 0:
        out["crn"] = (x["ise"] - x["ri"]) / (rev - x["rx"])
    if x.get("rx") is not None:
        out["ces"] = x["rx"] / rev
    return {k: r6(v) for k, v in out.items()}


def build():
    reg = docs()
    reps, cos = {}, {}
    for c in INSURERS:
        files = sorted((SRC / c).glob("*.json"))
        if not files:
            continue
        d = json.loads(files[-1].read_text(encoding="utf-8"))
        rid = d["report_id_he"]
        reps[c] = {"rid": rid, "f": reg.get(rid, {}).get("f"), "pub": reg.get(rid, {}).get("pub"), "period": d["period"], "unit": d["unit"], "note": d.get("source_note", "")}
        base = {}   # line -> window -> metric -> [v, pg]
        for x in d["facts"]:
            w = BASE.get((x["window"], x["date"]))
            m = x["metric"][4:]
            if not w or m not in METRICS:
                continue
            base.setdefault(x["segment"], {}).setdefault(w, {})[m] = [r6(x["value"]), x["page_he"]]
        lines = {}
        for seg, _ in LINES:
            B = base.get(seg)
            if not B:
                continue
            per = {}
            for pk, _, parts in PERIODS:
                if any(w not in B for _, w in parts):
                    continue
                vals = {}
                for m in METRICS:
                    if all(m in B[w] for _, w in parts):
                        vals[m] = r6(math.fsum(s * B[w][m][0] for s, w in parts))
                per[pk] = {"x": vals, "r": ratios(vals)}
            lines[seg] = {"base": B, "per": per}
        cos[c] = {"name": NAMES[c], "lines": lines}
    return {"meta": {"v": 1, "built": max((r["pub"] or "" for r in reps.values()), default=""),
                     "source": "ביאור מגזר ביטוח כללי (IFRS 17), מידע נוסף לפי קבוצות תיקים עיקריות, בדוח הרבעוני של כל חברה; כל שורה בעמוד שלה",
                     "files": FILES, "periods": [[k, he, parts] for k, he, parts in PERIODS], "lines": [list(x) for x in LINES],
                     "gaps": [[k, he, GAP_WHY[k]] for k, he in GAPS],
                     "defs": {"lr": "(תביעות והוצאות שירותי ביטוח אחרות שהתהוו + שינויים לשירותי עבר) ÷ הכנסות משירותי ביטוח",
                              "er": "(הוצאות שירותי ביטוח − שתי שורות התביעות) ÷ הכנסות משירותי ביטוח",
                              "cr": "הוצאות שירותי ביטוח ÷ הכנסות משירותי ביטוח",
                              "crn": "(הוצאות שירותי ביטוח − הכנסות מביטוח משנה) ÷ (הכנסות משירותי ביטוח − הוצאות מביטוח משנה)",
                              "ces": "הוצאות מביטוח משנה ÷ הכנסות משירותי ביטוח",
                              "rr": "הכנסות מביטוח משנה − הוצאות מביטוח משנה"}},
            "reports": reps, "cos": cos}


def verify(d):
    bad, n = [], 0
    for c, co in d["cos"].items():
        rep = d["reports"][c]
        if not rep.get("f") or not rep.get("pub"):
            bad.append((c, "report without a file or publication date"))
        for seg, L in co["lines"].items():
            for w, B in L["base"].items():
                for m, (v, pg) in B.items():
                    n += 1
                    if not isinstance(v, (int, float)) or not math.isfinite(v) or not pg:
                        bad.append((c, seg, w, m, "value or page missing"))
                if {"rev", "ise", "isr_gross"} <= B.keys() and abs(B["rev"][0] - B["ise"][0] - B["isr_gross"][0]) > TOL:
                    bad.append((c, seg, w, "revenue − expenses ≠ result before reinsurance"))
                if {"ri", "rx", "rnet"} <= B.keys() and abs(B["ri"][0] - B["rx"][0] - B["rnet"][0]) > TOL:
                    bad.append((c, seg, w, "reinsurance income − expense ≠ net"))
                if {"isr_gross", "rnet", "isr"} <= B.keys() and abs(B["isr_gross"][0] + B["rnet"][0] - B["isr"][0]) > TOL:
                    bad.append((c, seg, w, "result before reinsurance + net ≠ result"))
            for pk, P in L["per"].items():
                n += 1
                if ratios(P["x"]) != P["r"]:
                    bad.append((c, seg, pk, "ratios do not re-derive"))
                r = P["r"]
                if "lr" in r and "er" in r and "cr" in r and abs(r["lr"] + r["er"] - r["cr"]) > 5e-6:
                    bad.append((c, seg, pk, "loss + expense ≠ combined"))
        if "pc" in co["lines"]:
            tot = co["lines"]["pc"]["base"]
            for w, B in tot.items():
                for m, (v, _) in B.items():
                    parts = [co["lines"].get(s, {}).get("base", {}).get(w, {}).get(m) for s, _ in LINES[1:]]
                    if None not in parts and abs(sum(p[0] for p in parts) - v) > 2 * TOL:
                        bad.append((c, w, m, "lines do not add to the total"))
    return bad, n


def dumps(d):
    return json.dumps(d, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    d = build()
    bad, n = verify(d)
    if "--check" in sys.argv:
        same = OUT.exists() and json.loads(OUT.read_text(encoding="utf-8")) == json.loads(dumps(d))
        print(f"pnc: {len(d['cos'])} insurers, {n} cells and ratios; {'rebuild matches' if same else 'DIFFERS from pnc.json'}; {len(bad)} misses")
        for b in bad[:20]:
            print("  ", b)
        sys.exit(0 if same and not bad else 1)
    if bad:
        print("misses:", *bad[:30], sep="\n  ")
        sys.exit(1)
    OUT.write_text(dumps(d), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {OUT.stat().st_size:,} bytes; {len(d['cos'])} insurers, {n} cells and ratios")
    for c, co in d["cos"].items():
        r = co["lines"]["pc"]["per"].get("ltm", {}).get("r", {})
        print(f"  {c:10s} LTM  LR {r.get('lr', 0) * 100:5.1f}%  ER {r.get('er', 0) * 100:5.1f}%  CR {r.get('cr', 0) * 100:5.1f}%  CR net {r.get('crn', 0) * 100:5.1f}%  ceded {r.get('ces', 0) * 100:5.1f}%")
