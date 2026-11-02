"""W6 · the conversion-coefficient file: the annuity coefficients (מקדם המרה לקצבה) each new comprehensive pension fund prints in its
bylaws, by sex, retirement age, birth year and annuity option, with the page each table was read on. Standard library only.

python3 pipeline/build_coef.py            -> web/public/data/funds/coef.json
python3 pipeline/build_coef.py --check    rebuild in memory: equal to the file, byte for byte, and every rule below holds (gate `coef`)

Inputs (committed): data/regulation/coef_src.json (hand-curated register: URL, edition, retrieval date, appendix pages, the fallback
assumption, the National Insurance old-age pension, the replacement-rate benchmark), data/regulation/coef_tables.json (the cells
read from the PDFs by pipeline/extract_coef.py, a manual step), web/public/data/funds.json (which company groups run pension funds).

Published: retirement ages 60–70 and birth years from 1950 (a saver born earlier is past 70). A table the extractor excluded (a
printed table that is not monotone) stays out and is listed under the fund's `excluded` with the reason; a group with no bylaws read
is in `coverage` with status 'missing' and the reason; nothing is filled by analogy between funds.

Rules (--check):
  source      every fund's source has an https URL, an edition, a retrieval date and the PDF's sha256
  pages       every table has at least one page and a quoted heading; its pages lie inside the appendix range of the register
  range       every cell lies in [145, 260]
  shape       in every table the coefficient falls with the retirement age (each birth-year column) and never falls with the birth
              year (each row); ages are 60..70 contiguous; the no-survivors tables never price a woman below a man
  coverage    every company group with a פנסיה מקיפה or פנסיה כללית track in funds.json has a coverage row, 'table' or 'missing'
  numbers     no NaN / infinity anywhere
"""
import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "regulation" / "coef_src.json"
TABLES = ROOT / "data" / "regulation" / "coef_tables.json"
FUNDS = ROOT / "web" / "public" / "data" / "funds.json"
OUT = ROOT / "web" / "public" / "data" / "funds" / "coef.json"
V = 1
AGES = list(range(60, 71))
YEAR_FROM = 1950
LO, HI = 145.0, 260.0
PRODS = ("פנסיה מקיפה", "פנסיה כללית")
METHOD = ("מקדמי ההמרה לקצבת זקנה כפי שכל קרן פנסיה מקיפה חדשה מפרסמת בנספח לתקנון שלה: קצבה חודשית = היתרה הצבורה בפרישה ÷ המקדם. "
          "הטאים נקראו משכבת הטקסט של קובץ התקנון (pdftotext, לפי מיקום המילים בעמוד) ונבדקו: המקדם יורד עם גיל הפרישה בכל עמודת שנת לידה "
          "ואינו יורד עם שנת הלידה בכל שורה; טבלה שנכשלה בבדיקה אינה מפורסמת ומצוינת עם הסיבה. כל הקרנות מציינות שהטבלאות מחושבות לפי דמי ניהול "
          "של 0.3% מהצבירה, וטבלאות בן/בת זוג לפי הפרש גיל של 3 שנים; המקדם בפועל נקבע בפרישה לפי התקנון שבתוקף אז ולפי בחירת מסלול הקצבה. "
          "תקנוני הקרנות הכלליות לא נקראו; מסלול של פנסיה כללית מוצג לפי הנחה.")


def opt_key(surv, guar):
    return f"s{surv}_g{guar}"


def opt_label(surv, guar):
    s = "ללא קצבת שאירים" if surv == 0 else "עם קצבה לבן/בת זוג (השיעור לפי התקנון)" if surv == "x" else f"קצבה לבן/בת זוג {surv}%"
    g = "בלי הבטחת תשלומים" if guar == 0 else "הבטחת תשלומים עד גיל 87" if guar == "to87" else f"הבטחת תשלומים {guar} חודשים"
    return f"{s}, {g}"


def build():
    reg = json.loads(SRC.read_text(encoding="utf-8"))
    tabs = json.loads(TABLES.read_text(encoding="utf-8"))
    funds = json.loads(FUNDS.read_text(encoding="utf-8"))
    errs = []
    srcs = {s["grp"]: s for s in reg["sources"]}
    # which groups run pension funds, and the managing company's name per product
    mgr = {}
    for f in funds["funds"]:
        if f["prod"] in PRODS:
            mgr.setdefault(f["grp"], {}).setdefault(f["prod"], f["mgr"])
    options, out_funds, coverage = {}, {}, []
    for grp, s in srcs.items():
        t = tabs["funds"].get(grp)
        if not t:
            errs.append(f"{grp}: in the register but not extracted")
            continue
        if not str(s.get("url", "")).startswith("https://") or not s.get("retrieved") or not s.get("edition"):
            errs.append(f"source {s['id']}: https url, edition and retrieval date are required")
        a, b = s["pages"]
        tables = []
        for tb in t["tables"]:
            k = opt_key(tb["survivors"], tb["guarantee"])
            options.setdefault(k, {"survivors": tb["survivors"], "guarantee": tb["guarantee"], "label": opt_label(tb["survivors"], tb["guarantee"])})
            if not tb["pages"] or not tb.get("quote"):
                errs.append(f"{grp} {k} {tb['sex']}: a page and a quoted heading are required")
            if any(not a <= p <= b for p in tb["pages"]):
                errs.append(f"{grp} {k} {tb['sex']}: pages {tb['pages']} outside the appendix range {a}-{b}")
            cols = [j for j, y in enumerate(tb["years"]) if y >= YEAR_FROM]
            years = [tb["years"][j] for j in cols]
            rows = []
            for age in AGES:
                if age not in tb["ages"]:
                    continue
                r = tb["v"][tb["ages"].index(age)]
                rows.append((age, [r[j] for j in cols]))
            if not rows:
                continue  # a table that starts above 70 (guarantee to age 87)
            ages = [age for age, _ in rows]
            if ages != list(range(ages[0], ages[-1] + 1)) or (ages[0] != 60 and tb["guarantee"] != "to87"):
                errs.append(f"{grp} {k} {tb['sex']}: ages {ages[0]}..{ages[-1]} not contiguous from 60")  # a guarantee to age 87 starts at 68
            v = [r for _, r in rows]
            for j, y in enumerate(years):
                col = [(age, v[i][j]) for i, age in enumerate(ages) if v[i][j] is not None]
                for (a1, x1), (a2, x2) in zip(col, col[1:]):
                    if not x2 < x1:
                        errs.append(f"{grp} {k} {tb['sex']} born {y}: {x1} at {a1} then {x2} at {a2}")
            for i, age in enumerate(ages):
                row = [(years[j], x) for j, x in enumerate(v[i]) if x is not None]
                for (y1, x1), (y2, x2) in zip(row, row[1:]):
                    if x2 < x1 - 1e-9:
                        errs.append(f"{grp} {k} {tb['sex']} age {age}: {x1} ({y1}) then {x2} ({y2})")
                for y, x in row:
                    if not LO <= x <= HI:
                        errs.append(f"{grp} {k} {tb['sex']} age {age} born {y}: {x} outside [{LO}, {HI}]")
            rec = {"opt": k, "sex": tb["sex"], "pages": tb["pages"], "quote": tb["quote"], "years": years, "ages": ages, "v": v}
            if tb.get("sex_by_order"):
                rec["sex_by_order"] = True
            tables.append(rec)
        # the no-survivors tables: a woman's coefficient is never below a man's
        by = {(x["opt"], x["sex"]): x for x in tables}
        for (k, sx), m in by.items():
            if sx == "m" and options[k]["survivors"] == 0 and (k, "f") in by:
                f = by[(k, "f")]
                for i, age in enumerate(m["ages"]):
                    if age in f["ages"]:
                        for j, y in enumerate(m["years"]):
                            if y in f["years"] and m["v"][i][j] is not None and f["v"][f["ages"].index(age)][f["years"].index(y)] is not None \
                                    and f["v"][f["ages"].index(age)][f["years"].index(y)] < m["v"][i][j]:
                                errs.append(f"{grp} {k} age {age} born {y}: women below men")
        src = {k: s[k] for k in ("id", "kind", "publisher", "fund", "title", "edition", "url", "page_url", "official_url", "official_edition", "retrieved", "appendix", "note") if k in s}
        src["sha256"] = t["sha256"]
        src["pages"] = list(s["pages"])
        out_funds[grp] = {"src": src, "tables": tables, "excluded": [{"opt": e["key"].rsplit("_", 1)[0] if e["key"].count("_") == 2 else e["key"], "sex": e["key"].rsplit("_", 1)[1] if e["key"].count("_") == 2 else None,
                                                                      "pages": e["pages"], "why": e["why"][0], "n": e["n"]} for e in t.get("excluded", [])]}
        for prod in PRODS:
            if prod in mgr.get(grp, {}):
                if prod == "פנסיה מקיפה":
                    coverage.append({"grp": grp, "prod": prod, "mgr": mgr[grp][prod], "status": "table", "n": len(tables), "pages": list(s["pages"]), "edition": s["edition"], "method": "text",
                                     "options": sorted({x["opt"] for x in tables})})
                else:
                    coverage.append({"grp": grp, "prod": prod, "mgr": mgr[grp][prod], "status": "missing", "reason": "תקנון הקרן הכללית לא נקרא; הטבלה שנקראה היא של הקרן המקיפה של אותה חברה"})
    for grp, prods in sorted(mgr.items()):
        if grp not in srcs:
            for prod in prods:
                m = next((x for x in reg.get("missing", []) if x.get("grp") == grp), None)
                coverage.append({"grp": grp, "prod": prod, "mgr": prods[prod], "status": "missing", "reason": m["reason"] if m else "תקנון הקרן לא אותר או לא נקרא"})
    covered = {(c["grp"], c["prod"]) for c in coverage}
    for grp, prods in mgr.items():
        for prod in prods:
            if (grp, prod) not in covered:
                errs.append(f"coverage: {grp} / {prod} has no row")
    doc = {"v": V, "asof": reg["retrieved"], "method": METHOD, "basis_note": reg["basis_note"], "src": "data/regulation/coef_src.json",
           "ages": AGES, "year_from": YEAR_FROM, "options": dict(sorted(options.items())), "funds": dict(sorted(out_funds.items())), "coverage": coverage,
           "missing": reg.get("missing", []), "assumption": reg["assumption"], "btl": reg["btl"], "target": reg["target"]}

    def finite(x, path="/"):
        if isinstance(x, float) and not math.isfinite(x):
            errs.append(f"{path}: not finite")
        elif isinstance(x, dict):
            for k, y in x.items():
                finite(y, f"{path}{k}/")
        elif isinstance(x, list):
            for i, y in enumerate(x):
                finite(y, f"{path}{i}/")
    finite(doc)
    return json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n", doc, errs


def main():
    text, doc, errs = build()
    nf = len(doc["funds"])
    nt = sum(len(f["tables"]) for f in doc["funds"].values())
    nc = sum(sum(1 for r in t["v"] for v in r if v is not None) for f in doc["funds"].values() for t in f["tables"])
    line = f"coef: {nf} funds, {nt} tables, {nc} cells, {sum(1 for c in doc['coverage'] if c['status'] == 'missing')} coverage gaps"
    if "--check" in sys.argv:
        same = OUT.exists() and OUT.read_text(encoding="utf-8") == text
        if not same:
            errs.append("web/public/data/funds/coef.json differs from a rebuild (run python3 pipeline/build_coef.py)")
        print(f"{line}; {len(errs)} failures")
        for e in errs[:20]:
            print("FAIL", e)
        return 1 if errs else 0
    if errs:
        for e in errs[:20]:
            print("FAIL", e)
        return 1
    OUT.write_text(text, encoding="utf-8")
    print(f"{line} -> {OUT.relative_to(ROOT)} ({len(text.encode()) // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
