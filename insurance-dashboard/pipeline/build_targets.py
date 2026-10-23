"""Management targets and company-defined (adjusted) KPIs: web/public/data/targets.json + web/public/data/adjusted.json

Input : web/public/data/ifrs_<period>.json (facts whose metric starts with target_, build_ifrs.py) + ifrs.json (report files)
        data/extracted_pres/<company>/<period>.json (investor decks, extraction spec v9: target_*, target_status, adj_*, core_profit)
        web/public/data/search/docs.json (the document registry: report id -> type, period, date)
        web/public/data/csm/capital.json (the actuals: profit, comprehensive income, equity, dividends, solvency ratio, build_csm.py)
Nothing is extracted here and nothing is inferred: a target is listed only as a filing printed it, with its page.
Report targets: the same target (company, metric, entity, date, value) printed by several reports is one row (the latest print, with the
count of prints); a value that changed keeps every value (`hist`). Deck targets: one row per company, topic, entity and horizon; a target
repeated in deck after deck keeps its first and last statement (date, deck, slide) and every revision of its value (`hist`).
Actual vs target (`act`): only where the site carries the actual (group profit, comprehensive income, ROE computed from them and equity,
the main insurer's solvency ratio, dividends paid / profit) for the target's year, with the formula and inputs; `st` = met / missed only
when that year is reported, else open. Payout is shown beside the policy but never judged (cash paid in a year vs a policy on the year's profit).
adjusted.json: adj_* / core_profit per company and period, each labelled as the company defines it, never mixed with statement figures.

python3 pipeline/build_targets.py
"""
import collections
import datetime as dt
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"
REPORTS = ["2025Q1", "2025Q2", "2025Q3", "2025FY", "2026Q1", "2026Q2"]


def dict_of(path, name):
    src = (ROOT / path).read_text(encoding="utf-8")
    block = src.split(name, 1)[1].split("};", 1)[0]
    return {m.group(1) or m.group(2): m.group(3) for m in re.finditer(r"(?:'([^']+)'|([A-Za-z0-9_+:.\-]+)):\s*'([^']*)'", block)}


METRIC_HE = {**dict_of("web/src/pages/CompanyIfrs.tsx", "const HE:"), **dict_of("web/src/lib/labels.ts", "export const METRIC_HE")}
ENTITY = [  # the reporting entity of a target, in Hebrew (the extraction names it in either language)
    (r"shomera", "שומרה ביטוח"), (r"credit_cards|^max$", "מקס (כרטיסי אשראי)"), (r"wesure", "ווישור"),
    (r"insur|^insurer", "חברת הביטוח"), (r"^group$", "הקבוצה"), (r"^life$", "חיים וחיסכון"),
]


def entity(s, g):
    m = re.match(r"insurer:(.+)", s)
    if m and re.search(r"[א-ת]", m.group(1)):
        return m.group(1)
    for pat, he in ENTITY:
        if re.search(pat, s, re.I) or re.search(pat, g, re.I):
            return he
    return ""


def topic(m):
    if re.search(r"payout|dividend_payout|buyback", m):
        return "payout"
    if re.search(r"solvency|threshold|capital|cet1|excess", m):
        return "capital"
    return "strategy"


def unit(m):
    return "pct" if re.search(r"ratio|payout|roe|threshold|cet1|_pct", m) and not re.search(r"excess|surplus", m) else "m"


def report_rows():
    files = {(x["company"], x["period"]): x for x in json.loads((DATA / "ifrs.json").read_text(encoding="utf-8"))["files"]}
    reg = json.loads((DATA / "search" / "docs.json").read_text(encoding="utf-8"))
    docs = {r[0]: r for r in reg["docs"]}
    by = collections.defaultdict(list)
    for p in REPORTS:
        f = DATA / f"ifrs_{p}.json"
        if not f.exists():
            continue
        for x in json.loads(f.read_text(encoding="utf-8")):
            if not x["m"].startswith("target"):
                continue
            url = x.get("u") or (files.get((x["c"], p)) or {}).get("url")
            rid = int(re.search(r"P(\d{6,8})-", url).group(1)) if url and re.search(r"P(\d{6,8})-", url) else None
            ent = entity(x["s"], x["g"])
            by[(x["c"], x["m"], ent, x["d"])].append((REPORTS.index(p), p, x["v"], rid, x["pg"], x["l"] if re.search(r"[א-ת]", x["l"]) else ""))
    rows = []
    for (co, m, ent, d), prints in by.items():
        prints.sort()
        last = prints[-1]
        hist, prev = [], None
        for _, p, v, rid, pg, _q in prints:
            if v != prev:
                hist.append([p, v, rid, pg])
                prev = v
        rows.append({"c": co, "m": m, "l": METRIC_HE.get(m, ""), "e": ent, "t": topic(m), "u": unit(m), "d": d, "v": last[2], "r": last[1],
                     "doc": last[3], "pg": last[4], "q": last[5], "n": len(prints), "hist": hist if len(hist) > 1 else None,
                     "src": "pres" if last[3] in docs and docs[last[3]][2] == "presentation" else "report"})
    missing = [r["m"] for r in rows if not r["l"]]
    if missing:
        raise SystemExit(f"targets without a Hebrew label (add to web/src/lib/labels.ts METRIC_HE): {sorted(set(missing))}")
    for r in rows:  # the shape deck rows share: horizon, range, first and last statement
        h = int(r["d"][:4]) if int(r["d"][:4]) > int(r["r"][:4]) else None
        r.update({"h": h, "b": "na", "seg": "group" if r["e"] in ("הקבוצה", "") else "other", "lo": None, "hi": None, "st0": None, "st1": [(docs.get(r["doc"]) or [None] * 5)[4] or r["d"], r["doc"], r["pg"]]})
    return rows, reg, docs


# ---------------------------------------------------------------- investor decks (extraction spec v9)
PRES = ROOT / "data" / "extracted_pres"
TARGET_HE = {
    "target_roe": "יעד תשואה להון", "target_core_roe": "יעד תשואה להון מפעילות ליבה", "target_profit": "יעד רווח", "target_net_income": "יעד רווח נקי",
    "target_profit_prior": "יעד רווח (נוסח קודם)", "target_comprehensive_income": "יעד רווח כולל", "target_core_profit": "יעד רווח ליבה", "target_core_income": "יעד רווח ליבה",
    "target_core_profit_potential_additional": "פוטנציאל רווח ליבה נוסף", "target_adj_profit_after_tax": "יעד רווח מותאם לאחר מס", "target_adj_profit_before_tax": "יעד רווח מותאם לפני מס",
    "target_adj_profit_before_tax_core": "יעד רווח מותאם לפני מס, ליבה", "target_adj_profit_before_tax_other": "יעד רווח מותאם לפני מס, אחר",
    "target_adj_profit_growth_pct": "יעד צמיחה ברווח המותאם", "target_underwriting_profit": "יעד רווח חיתומי", "target_ebitda": "יעד EBITDA", "target_adj_ebitda": "יעד EBITDA מותאם",
    "target_adj_ebitda_non_insurance": "יעד EBITDA מותאם, פעילות שאינה ביטוח", "target_revenue": "יעד הכנסות", "target_management_fees": "יעד דמי ניהול",
    "target_premiums": "יעד פרמיות, דמי גמולים ותקבולים", "target_premiums_and_contributions": "יעד פרמיות ודמי גמולים", "target_premiums_and_contributions_growth_cagr": "יעד צמיחה שנתית בפרמיות ודמי גמולים",
    "target_aum": "יעד נכסים מנוהלים", "target_aum_growth_cagr": "יעד צמיחה שנתית בנכסים מנוהלים", "target_customers": "יעד מספר לקוחות", "target_equity": "יעד הון עצמי",
    "target_comprehensive_equity": "יעד הון כולל", "target_solvency_ratio": "יעד יחס כושר פירעון", "target_solvency_ratio_annual_step": "יעד שיפור שנתי ביחס כושר הפירעון",
    "target_dividend_payout": "מדיניות חלוקה, % מהרווח", "target_dividend_distribution": "יעד חלוקת דיבידנד", "target_dividend_with_buyback": "יעד חלוקה כולל רכישה עצמית",
    "target_total_payout": "יעד חלוקה כוללת",
}
PRES_ENTITY = {"group": "הקבוצה", "phoenix_group": "הקבוצה", "clal_group": "הקבוצה", "more_group": "הקבוצה", "menora_holdings": "הקבוצה", "clal_holdings": "הקבוצה",
               "shomera_insurance": "שומרה ביטוח", "asset_management": "ניהול נכסים", "insurance": "ביטוח", "services": "שירותים", "max": "מקס (כרטיסי אשראי)",
               "more_gemel": "מור גמל", "pension": "פנסיה", "hedge_funds": "קרנות גידור"}
GROUPISH = {"group", "phoenix_group", "clal_group", "more_group", "menora_holdings", "clal_holdings"}


def pres_entity(seg):
    return PRES_ENTITY.get(seg) or ("חברת הביטוח" if seg.endswith("_insurance") else seg)


def pres_unit(m, note):
    if re.search(r"^\s*(percent|%)|\bpercent\b", note, re.I) or re.search(r"roe|ratio|payout|_pct|cagr|growth|step", m):
        return "pct"
    if re.search(r"NIS m\b|NIS millions|NIS mn", note, re.I):
        return "m"
    if re.search(r"customers|לקוחות", note + m, re.I):
        return "n"
    return "x"


def decks():
    """every deck JSON once: (company, period, report id, deck date, facts)"""
    out = []
    for f in sorted(PRES.glob("*/*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        if d.get("facts"):
            out.append((d["company"], d["period"], d.get("report_id"), (d.get("pres_date") or "")[:10], d["facts"]))
    return out


def deck_rows(docs):
    stmts = collections.defaultdict(list)
    status = collections.defaultdict(list)
    for c, per, rid, pdate, facts in decks():
        when = pdate or (docs.get(rid) or [None] * 5)[4] or ""
        for x in facts:
            m = x["metric"]
            if not m.startswith("target_"):
                continue
            img = 1 if x.get("source") in ("image", "chart") else 0
            if m == "target_status":
                status[c].append([when, x.get("target_status_text") or x.get("label", "")[:160], rid, x.get("page_he"), x["segment"]])
                continue
            if x.get("value") is None and x.get("value_low") is None and x.get("value_high") is None:
                continue
            h = x.get("horizon")
            key = (c, m, "group" if x["segment"] in GROUPISH else x["segment"], h)
            stmts[key].append({"b": x.get("basis") or "na", "seg": x["segment"], "d": when, "rid": rid, "pg": x.get("page_he"), "v": x.get("value"), "lo": x.get("value_low"), "hi": x.get("value_high"),
                               "q": x.get("label", "")[:220], "n": x.get("note", ""), "img": img})
    rows = []
    for (c, m, seg, h), ss in stmts.items():
        ss.sort(key=lambda y: (y["d"], y["rid"] or 0))
        b = ss[-1]["b"]
        hist, prev = [], None
        for y in ss:
            val = (y["v"], y["lo"], y["hi"])
            if val != prev:
                hist.append([y["d"], y["v"], y["lo"], y["hi"], y["rid"], y["pg"]])
                prev = val
        a, z = ss[0], ss[-1]
        rows.append({"c": c, "m": m, "l": TARGET_HE.get(m) or METRIC_HE.get(m) or "יעד", "e": pres_entity(seg), "seg": seg, "t": topic(m), "u": pres_unit(m, z["n"]),
                     "h": h, "b": b, "d": f"{h}-12-31" if h else z["d"], "v": z["v"], "lo": z["lo"], "hi": z["hi"], "r": None, "doc": z["rid"], "pg": z["pg"], "q": z["q"],
                     "n": len(ss), "hist": hist if len(hist) > 1 else None, "src": "pres", "st0": [a["d"], a["rid"], a["pg"]], "st1": [z["d"], z["rid"], z["pg"]],
                     **({"img": 1} if z["img"] else {}), "nt": z["n"][:240]})
    return rows, status


# ---------------------------------------------------------------- actual vs target, from the site's own capital file
def actuals(rows):
    cap = json.loads((DATA / "csm" / "capital.json").read_text(encoding="utf-8"))["companies"]
    this_year = dt.date.today().year

    def pt(c, k, y):
        return (cap.get(c, {}).get(k) or {}).get(f"{y}FY")

    def inp(label, x, y):
        return [label, x["v"], x.get("u"), x.get("pg"), f"FY'{str(y)[2:]}", x.get("solv")]

    n = collections.Counter()
    for r in rows:
        c, m = r["c"], r["m"]
        if c not in cap:
            r["st"] = "open"
            continue
        group = r["seg"] in GROUPISH
        insurer = r["e"] == "חברת הביטוח" or group
        txt = f"{r.get('q', '')} {r.get('nt', '')}"
        # the target's own year when it is reported; otherwise the latest reported year, shown as progress and never judged
        fys = sorted({int(p[:4]) for p in (cap[c].get("profit_attributable") or {}) if p.endswith("FY")}, reverse=True)
        years = [r["h"]] if r["h"] in fys else [y for y in fys if not r["h"] or y < r["h"]][:1]
        act = None
        for y in years:
            if m in ("target_roe",) and group:
                ci = re.search(r"כולל|comprehensive", txt, re.I)
                num, e1, e0 = pt(c, "comprehensive_income_attributable" if ci else "profit_attributable", y), pt(c, "equity_attributable", y), pt(c, "equity_attributable", y - 1)
                if num and e1 and e0:
                    v = num["v"] / ((e1["v"] + e0["v"]) / 2) * 100
                    act = {"k": "roe", "v": round(v, 1), "y": y, "f": f"{'רווח כולל' if ci else 'רווח נקי'} לבעלי המניות ÷ ממוצע ההון לבעלי המניות בתחילת השנה ובסופה × 100",
                           "in": [inp("רווח כולל לבעלי המניות" if ci else "רווח נקי לבעלי המניות", num, y), inp("הון לבעלי המניות, סוף שנה", e1, y), inp("הון לבעלי המניות, תחילת שנה", e0, y - 1)]}
            elif m in ("target_comprehensive_income", "target_profit", "target_net_income") and group and r["b"] != "pre_tax":
                k = "comprehensive_income_attributable" if m == "target_comprehensive_income" else "profit_attributable"
                x = pt(c, k, y)
                if x:
                    act = {"k": "ci" if m == "target_comprehensive_income" else "profit", "v": x["v"], "y": y, "f": "כפי שהודפס בדוח הכספי",
                           "in": [inp("רווח כולל לבעלי המניות" if k.startswith("comp") else "רווח נקי לבעלי המניות", x, y)]}
            elif m.startswith("target_solvency_ratio") and "step" not in m and insurer and r["u"] == "pct":
                wo = re.search(r"ללא הוראות|without", txt, re.I)
                x = pt(c, "sr_wo" if wo else "sr_w", y)
                if x:
                    act = {"k": "sr", "v": x["v"], "y": y, "f": f"יחס כושר פירעון של חברת הביטוח העיקרית, {'ללא' if wo else 'עם'} הוראות מעבר, כפי שהודפס",
                           "in": [inp("יחס כושר פירעון", x, y)]}
            elif m.startswith("target_dividend_payout") and group:
                dv, pr = pt(c, "dividend_paid", y), pt(c, "profit_attributable", y)
                if dv and pr and pr["v"] > 0:
                    act = {"k": "payout", "v": round(abs(dv["v"]) / pr["v"] * 100, 1), "y": y, "f": "דיבידנד ששולם בשנה ÷ רווח נקי לבעלי המניות באותה שנה × 100 (מזומן; לא מדיניות)",
                           "in": [inp("דיבידנד ששולם", {**dv, "v": abs(dv["v"])}, y), inp("רווח נקי לבעלי המניות", pr, y)], "ref": 1}
        if not act:
            r["st"] = "open"
            continue
        if act["y"] != r["h"]:
            act["prog"] = 1
        r["act"] = act
        n[act["k"]] += 1
        goal = r["lo"] if r["lo"] is not None else r["v"]
        if r["h"] and act["y"] == r["h"] and r["h"] < this_year and not act.get("ref") and goal is not None:
            r["st"] = "met" if act["v"] >= goal else "missed"
        else:
            r["st"] = "open"
    return n


# ---------------------------------------------------------------- adjusted / core KPIs (adjusted.json)
ADJ_HE = {"core_profit": "רווח ליבה", "adj_roe_core": "תשואה להון מפעילות ליבה", "adj_core_roe": "תשואה להון מפעילות ליבה", "adj_core_profit_before_tax": "רווח מעסקי ליבה לפני מס",
          "adj_core_profit_after_tax": "רווחי ליבה לאחר מס", "adj_core_profit": "רווח ליבה", "adj_core_profit_pre_tax": "רווח ליבה לפני מס", "adj_profit_before_tax": "רווח מותאם לפני מס",
          "adj_profit_after_tax": "רווח מותאם לאחר מס", "adj_profit_before_tax_continuing_products": "רווח מותאם לפני מס, מוצרים ממשיכים", "adj_profit_before_tax_run_off": "רווח מותאם לפני מס, Run-off",
          "adj_roe": "תשואה להון מותאמת", "adj_ebitda": "EBITDA מותאם", "adj_excess_financial_margin": "מרווח פיננסי עודף", "adj_comprehensive_income_before_special_provision": "רווח כולל לפני ההפרשה המיוחדת",
          "adj_roe_excl_special_provision": "תשואה להון ללא ההפרשה המיוחדת"}
# the company's own definition, in Hebrew, from the deck footnote the extraction recorded (the verbatim slide row travels with every point)
DEF_HE = {
    ("phoenix", "core_profit"): "רווח ליבה כהגדרת הפניקס: ללא רווח שאינו תפעולי (תשואות שוק ההון מעל או מתחת ל-3% ריאלי, השפעות ריבית, אירועים מיוחדים), לפי הערת השקף",
    ("phoenix", "adj_roe_core"): "תשואה להון מפעילות ליבה כהגדרת הפניקס: רווח הליבה (ללא פעילות שאינה תפעולית) ביחס להון",
    ("phoenix", "adj_core_roe"): "תשואה להון מפעילות ליבה כהגדרת הפניקס: רווח הליבה (ללא פעילות שאינה תפעולית) ביחס להון",
    ("clal", "adj_core_profit_before_tax"): "רווח מעסקי ליבה לפני מס, כהגדרתו בדוח הדירקטוריון של כלל",
    ("clal", "adj_excess_financial_margin"): "מרווח פיננסי עודף: הפער בין התשואה בפועל לתשואה המנורמלת שבבסיס רווח הליבה, כפי שהוצג בגשר של כלל",
    ("menora", "adj_profit_before_tax"): "רווח מותאם לפני מס כהגדרת מנורה: תשואה נורמטיבית ריאלית של 4% בשנה ועוד 2.5% אינפלציה על נכסי ההשקעה בפתיחה, בנטרול השפעות עקום הריבית על ההתחייבויות וללא אירועים מיוחדים",
    ("menora", "adj_roe"): "תשואה להון מותאמת כהגדרת מנורה: הרווח המותאם לאחר מס ÷ ההון בתחילת השנה (השקף אינו מציין אם בחישוב שנתי)",
    ("harel", "adj_core_profit_after_tax"): "רווחי ליבה לאחר מס, כפי שהוצגו במצגת הראל",
    ("meitav", "adj_ebitda"): "EBITDA מנוטרלת, 12 חודשים אחרונים, כהגדרתה בדוח הדירקטוריון של מיטב",
    ("ibi", "adj_ebitda"): "EBITDA כפי שהוצגה במצגת החברה", ("more", "adj_ebitda"): "EBITDA כפי שהוצגה במצגת החברה",
    ("ibi", "adj_roe"): "תשואה להון כפי שהודפסה בשקף הסקירה; בסיס המיצוע לא צוין",
}


def period_of(d, w):
    q = {"03-31": "Q1", "06-30": "Q2", "09-30": "Q3", "12-31": "Q4"}.get(d[5:10])
    if not q:
        return None
    if w == "fy":
        return f"{d[:4]}FY" if q == "Q4" else None
    if w == "q":
        return f"{d[:4]}{q}"
    if w == "ytd":
        return {"Q1": f"{d[:4]}Q1", "Q2": f"{d[:4]}H1", "Q3": f"{d[:4]}9M", "Q4": f"{d[:4]}FY"}[q]
    return None


def adjusted():
    cells = {}
    for c, per, rid, pdate, facts in decks():
        for x in facts:
            m = x["metric"]
            if m not in ADJ_HE or x.get("value") is None or x["segment"] not in GROUPISH:
                continue
            p = period_of((x.get("date") or "")[:10], x.get("window"))
            if not p:
                continue
            own = per[:4] == p[:4]
            rank = (own, pdate, rid or 0)
            k = (c, m, p)
            if k not in cells or rank > cells[k][0]:
                cells[k] = (rank, {"p": p, "v": x["value"], "rid": rid, "pg": x.get("page_he"), "l": x.get("label", "")[:120], "dd": pdate, **({"i": 1} if x.get("source") in ("image", "chart") else {})})
    out = collections.defaultdict(dict)
    for (c, m, p), (_, cell) in cells.items():
        s = out[c].setdefault(m, {"l": ADJ_HE[m], "u": "pct" if "roe" in m else "m", "def": DEF_HE.get((c, m), ""), "pts": []})
        s["pts"].append(cell)
    for c in out:
        for s in out[c].values():
            s["pts"].sort(key=lambda y: (y["p"][:4], {"Q1": 1, "Q2": 2, "H1": 2.5, "Q3": 3, "9M": 3.5, "Q4": 4, "FY": 5}.get(y["p"][4:], 9)))
    return {c: v for c, v in sorted(out.items())}


def main():
    rows, reg, docs = report_rows()
    prows, status = deck_rows(docs)
    rows += prows
    n_act = actuals(rows)
    rows.sort(key=lambda r: (r["c"], r["t"], r["m"], r["e"], r["h"] or 0, r["d"]))
    used = sorted({r["doc"] for r in rows if r["doc"]} | {h[2] for r in rows if r["src"] == "report" for h in (r["hist"] or []) if h[2]}
                  | {h[4] for r in rows if r["src"] == "pres" for h in (r["hist"] or []) if h[4]} | {r["st0"][1] for r in rows if r["st0"] and r["st0"][1]}
                  | {s[2] for v in status.values() for s in v if s[2]})
    out = {"v": 2, "built": dt.date.today().isoformat(), "source": "דוחות כספיים, דוחות דירקטוריון ומצגות משקיעים של החברות, MAYA: יעדים כפי שהודפסו",
           "files": reg["files"], "docs": {str(i): [docs[i][1], docs[i][2], docs[i][3], docs[i][4], docs[i][8]] for i in used if i in docs},
           "status": {c: sorted(v) for c, v in status.items()}, "rows": rows}
    (DATA / "targets.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    adj = adjusted()
    (DATA / "adjusted.json").write_text(json.dumps({"built": dt.date.today().isoformat(), "source": "מצגות משקיעים של החברות, MAYA: מדדים לפי הגדרת החברה, כפי שהודפסו",
                                                    "files": reg["files"], "docs": {str(i): [docs[i][1], docs[i][2], docs[i][3], docs[i][4], docs[i][8]] for i in sorted({p["rid"] for c in adj.values() for s in c.values() for p in s["pts"] if p["rid"]}) if i in docs},
                                                    "companies": adj}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    st = collections.Counter(r.get("st") for r in rows)
    print(f"targets.json: {len(rows)} targets ({sum(1 for r in rows if r['src'] == 'pres')} from decks, {sum(r['n'] for r in rows)} prints, {sum(1 for r in rows if r['hist'])} revised), "
          f"actuals {dict(n_act)}, status {dict(st)}, {(DATA / 'targets.json').stat().st_size // 1024} KB; "
          f"adjusted.json: {sum(len(v) for v in adj.values())} series, {sum(len(s['pts']) for v in adj.values() for s in v.values())} points, {(DATA / 'adjusted.json').stat().st_size // 1024} KB; "
          f"unlabelled {sorted({r['m'] for r in rows if r['l'] == 'יעד'})}; missing docs {len([i for i in used if i not in docs])}")


if __name__ == "__main__":
    main()
