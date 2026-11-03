"""W11 · the cover-price file: what the disability and survivors cover of each new comprehensive pension fund costs a month, per ₪1,000
of insured salary, for a standard member at ages 30, 40 and 50 (man, woman), priced with the fund's own bylaws tables. Standard
library only.

python3 pipeline/build_covers.py            -> web/public/data/funds/covers.json
python3 pipeline/build_covers.py --check    rebuild in memory: equal to the file, byte for byte, and every rule below holds (gate `covers`)

Inputs (committed): data/regulation/covers_src.json (the register: the tables, their pages, the standard member),
data/regulation/covers_tables.json (the cells pipeline/extract_covers.py read from the PDFs, a manual step), data/regulation/coef_src.json
(the PDFs' URL, edition and retrieval date), web/public/data/funds.json (which groups run a comprehensive pension fund).

The price, as the bylaws' premium clause (סעיף 38 of the uniform bylaws) states it, for salary S = ₪1,000, no accumulated balance:
  disability  = (S × 75% + S × 18.5% × 94%) × the disability factor (with double disability, cover to 67, the member's sex and age) ÷ 1,000
  survivors   = sum at risk × the death rate (sex, age, birth year) ÷ 100,000, where
                sum at risk = S × 60% × the widow's factor (age, birth year) + S × 40% × the orphans' factor (age; spouse cover not waived)
                (Migdal prints one factor for the 60/40 split: sum at risk = S × that factor)
The birth year is the table column nearest to (year − age). A cell the fund does not print, or a table excluded at extraction, leaves
the part null with the reason; nothing is filled by analogy between funds. The claims adjustment (approval × 30-day share, annex B3)
is applied in the browser (web/src/lib/coverPrice.ts) from funds/decision.json.

Rules (--check):
  source     every fund's source has an https URL, an edition, a retrieval date and the PDF's sha256
  pages      every table carries its pages and the quoted heading
  numbers    every price is finite and > 0; disability + survivors = total within 0.001
  spread     every standard cell (disability factor, widow's / combined factor, death rate) lies within ±25% of the median of the
             funds that print it (a wider gap is a column read in the wrong place)
  coverage   every company group with a פנסיה מקיפה track in funds.json has a coverage row, 'table' or 'missing'
"""
import json
import math
import statistics
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "regulation" / "covers_src.json"
TABLES = ROOT / "data" / "regulation" / "covers_tables.json"
COEF_SRC = ROOT / "data" / "regulation" / "coef_src.json"
FUNDS = ROOT / "web" / "public" / "data" / "funds.json"
OUT = ROOT / "web" / "public" / "data" / "funds" / "covers.json"
V = 1
PROD = "פנסיה מקיפה"
SEX_HE = {"m": "גבר", "f": "אישה"}
METHOD = ("עלות חודשית של הכיסוי לנכות ולשאירים בקרן פנסיה מקיפה, לכל ₪1,000 שכר מבוטח, לפי הטבלאות שהקרן מפרסמת בנספחי התקנון שלה "
          "וסעיף דמי הביטוח בתקנון (סעיף 38 בתקנון האחיד). נכות: (קצבת נכות 75% מהשכר + 94% מדמי גמולים של 18.5% מהשכר, שחרור מתשלום) × מקדם "
          "עלות הנכות (כולל נכות כפולה, כיסוי עד גיל 67, לפי מין וגיל) ÷ 1,000. שאירים: הסכום בסיכון × תעריף המוות (מין, גיל, שנת לידה) ÷ 100,000, "
          "כשהסכום בסיכון = 60% מהשכר × מקדם האלמן/ה + 40% מהשכר × מקדם היתומים (מגדל: מקדם אחד לחלוקה 60/40), פחות היתרה הצבורה; כאן בלי יתרה, "
          "כך שזה המחיר לחבר חדש והוא יורד ככל שהיתרה גדלה. שנת הלידה: עמודת הטבלה הקרובה לשנה פחות הגיל. אותו סכום מבוטח לכל הקרנות, כך "
          "שההבדל בין קרנות בא מהטבלאות בלבד. בטבלאות של רוב הקרנות אותן הנחות של הממונה, ולכן המחירים קרובים; זה תיאור, לא דירוג. המחיר בפועל "
          "של לקוח תלוי בשכר, במסלול שבחר, ביתרה ובגיל ההצטרפות, ומופיע בדוח השנתי שלו.")


def r3(x):
    return None if x is None else round(x + 0.0, 3)


def nearest(years, target, row):
    """the printed column nearest to the target birth year, among the cells printed in the row"""
    have = [(abs(y - target), -y, i) for i, y in enumerate(years) if row[i] is not None]
    if not have:
        return None, None
    _, _, i = min(have)
    return years[i], row[i]


def cell(tab, age):
    if tab is None or age not in tab["ages"]:
        return None
    return tab["v"][tab["ages"].index(age)]


def build():
    reg = json.loads(SRC.read_text(encoding="utf-8"))
    tabs = json.loads(TABLES.read_text(encoding="utf-8"))["funds"]
    coef = {s["id"]: s for s in json.loads(COEF_SRC.read_text(encoding="utf-8"))["sources"]}
    funds = json.loads(FUNDS.read_text(encoding="utf-8"))
    st = reg["standard"]
    S = 1000.0
    dis_amount = S * st["disability_pct"] / 100 + S * st["contrib_pct"] / 100 * st["waiver_pct"] / 100
    w_sh, o_sh = st["widow_share"] / 100 * st["survivors_pct"] / 100, st["orphan_share"] / 100 * st["survivors_pct"] / 100
    errs, out_funds, coverage = [], {}, []
    for f in reg["funds"]:
        s, t = coef[f["src"]], tabs.get(f["id"])
        if t is None:
            errs.append(f"{f['id']}: not in covers_tables.json (run pipeline/extract_covers.py)")
            continue
        by = {(x["kind"], x["sex"]): x for x in t["tables"]}
        excl = {(x["kind"], x["sex"]): x for x in t["excluded"]}
        cells = []
        for sex in ("m", "f"):
            for age in st["ages"]:
                target = st["year"] - age
                row = {"sex": sex, "age": age}
                # disability
                dt = by.get(("dis", sex))
                dv = cell(dt, age)
                if dv is None:
                    row["dis"] = None
                    row["dis_why"] = excl[("dis", sex)]["why"] if ("dis", sex) in excl else "הקרן אינה מדפיסה את התא"
                else:
                    row["dis"] = {"f": dv, "pg": dt["pages"], "cost": r3(dis_amount * dv / 1000)}
                # survivors
                mt = by.get(("mort", sex))
                comb, wt, ot = by.get(("comb", sex)), by.get(("wid", sex)), by.get(("orph", sex))
                why = None
                if mt is None:
                    why = excl[("mort", sex)]["why"] if ("mort", sex) in excl else "אין בתקנון טבלת תעריף מוות שנקראה"
                elif comb is None and wt is None:
                    why = excl[("wid", sex)]["why"] if ("wid", sex) in excl else "אין בתקנון טבלת מקדמי סכום בסיכון לאלמן/ה שנקראה"
                elif comb is None and ot is None:
                    why = "אין בתקנון טבלת מקדמי סכום בסיכון ליתומים שנקראה"
                surv = None
                if why is None:
                    if comb is not None:
                        y, cv = nearest(comb["years"], target, cell(comb, age))
                        sar = None if cv is None else S * st["survivors_pct"] / 100 * cv
                        parts = {"comb": cv, "pg_c": comb["pages"]}
                    else:
                        y, wv = nearest(wt["years"], target, cell(wt, age))
                        ov = cell(ot, age)
                        sar = None if wv is None or ov is None else S * w_sh * wv + S * o_sh * ov
                        parts = {"w": wv, "o": ov, "pg_w": wt["pages"], "pg_o": ot["pages"]}
                    my, mv = nearest(mt["years"], target, cell(mt, age))
                    if sar is None or mv is None:
                        why = "הקרן אינה מדפיסה את התא לגיל ולשנת הלידה"
                    else:
                        surv = {**parts, "by": y, **({"by_m": my} if my != y else {}), "m": mv, "pg_m": mt["pages"], "sar": round(sar, 1), "cost": r3(sar * mv / 100000)}
                row["surv"] = surv
                if surv is None:
                    row["surv_why"] = why
                row["total"] = r3(row["dis"]["cost"] + surv["cost"]) if row["dis"] and surv else None
                cells.append(row)
        src = {k: s[k] for k in ("title", "edition", "url", "retrieved", "kind", "publisher", "fund", "page_url", "official_url", "official_edition", "note") if s.get(k)}
        src["sha256"] = t["sha256"]
        out_funds[f["id"]] = {
            "grp": s["grp"], "src": src,
            "tables": [{k: x[k] for k in ("kind", "sex", "pages", "quote", "col", "years", "note") if x.get(k) is not None} for x in t["tables"]],
            "excluded": t["excluded"], "cells": cells,
        }
    # coverage: every group with a comprehensive pension track
    grps = sorted({x["grp"] for x in funds["funds"] if x.get("prod") == PROD and not x.get("gone")})
    have = {v["grp"]: k for k, v in out_funds.items()}
    for g in grps:
        if g in have:
            fs = out_funds[have[g]]
            n = sum(1 for c in fs["cells"] if c["total"] is not None)
            coverage.append({"grp": g, "id": have[g], "status": "table", "cells": n, "of": len(fs["cells"])})
        else:
            coverage.append({"grp": g, "status": "missing", "reason": "תקנון הקרן המקיפה לא נקרא"})
    doc = {"v": V, "asof": reg["retrieved"], "method": METHOD, "standard": {k: st[k] for k in st if k != "note"}, "standard_note": st["note"],
           "dis_amount": round(dis_amount, 2), "funds": dict(sorted(out_funds.items())), "coverage": coverage}
    errs += check(doc, grps)
    return doc, errs


def check(doc, grps):
    errs = []
    for fid, f in doc["funds"].items():
        s = f["src"]
        if not str(s.get("url", "")).startswith("https://") or not s.get("edition") or not s.get("retrieved") or len(s.get("sha256", "")) != 64:
            errs.append(f"source: {fid} lacks an https URL, edition, retrieval date or sha256")
        for t in f["tables"]:
            if not t.get("pages") or not t.get("quote"):
                errs.append(f"pages: {fid} {t['kind']}/{t['sex']} without pages or quote")
        for c in f["cells"]:
            for part in ("dis", "surv"):
                v = c[part]
                if v is not None and not (isinstance(v["cost"], float) and math.isfinite(v["cost"]) and v["cost"] > 0):
                    errs.append(f"numbers: {fid} {c['sex']}{c['age']} {part} cost {v['cost']}")
            if c["total"] is not None and abs(c["total"] - c["dis"]["cost"] - c["surv"]["cost"]) > 0.0015:
                errs.append(f"numbers: {fid} {c['sex']}{c['age']} total ≠ parts")
    # spread across funds, per standard cell
    keys = {}
    for fid, f in doc["funds"].items():
        for c in f["cells"]:
            k = (c["sex"], c["age"])
            if c["dis"]:
                keys.setdefault(("dis",) + k, []).append((fid, c["dis"]["f"]))
            if c["surv"]:
                keys.setdefault(("mort",) + k, []).append((fid, c["surv"]["m"]))
                if c["surv"].get("w") is not None:
                    keys.setdefault(("wid",) + k, []).append((fid, c["surv"]["w"]))
    for k, vs in keys.items():
        med = statistics.median(v for _, v in vs)
        for fid, v in vs:
            if abs(v / med - 1) > 0.25:
                errs.append(f"spread: {fid} {k}: {v} against the median {med}")
    have = {c["grp"] for c in doc["coverage"]}
    for g in grps:
        if g not in have:
            errs.append(f"coverage: {g} has no row")
    return errs


def main():
    doc, errs = build()
    text = json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n"
    nf = len(doc["funds"])
    nt = sum(len(f["tables"]) for f in doc["funds"].values())
    nc = sum(1 for f in doc["funds"].values() for c in f["cells"] if c["total"] is not None)
    line = f"covers: {nf} funds, {nt} tables, {nc} priced cells, {sum(1 for c in doc['coverage'] if c['status'] == 'missing')} coverage gaps"
    if "--check" in sys.argv:
        if not OUT.exists() or OUT.read_text(encoding="utf-8") != text:
            errs.append(f"{OUT.relative_to(ROOT)} differs from a rebuild (run python3 pipeline/build_covers.py)")
        print(line)
        if errs:
            print("\n".join(errs))
            sys.exit(1)
        return
    if errs:
        print(line + "\n" + "\n".join(errs))
        sys.exit(1)
    OUT.write_text(text, encoding="utf-8")
    print(line + f" -> {OUT.relative_to(ROOT)} ({len(text) // 1024} KB)")


if __name__ == "__main__":
    main()
