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


# ---------------------------------------------------------------- actual vs target: the management-credibility ledger
# Every target whose horizon has passed is scored against the actual printed for the same definition its wording names; where the site
# does not carry that actual, or the definition differs (core vs reported, segment vs group, pre- vs after-tax, a basis the wording leaves
# open and the result depends on), the status is "nc" (not comparable) with the reason. Never forced.
# st: met (≥ the target, or ≥ the top of a range) · partial (inside a range, below its top) · missed (below the target or the range)
#     · open (horizon not reached, or not yet reported) · nc (not comparable, `why`) · policy (a standing policy with no horizon: never scored)
CORE = re.compile(r"core|ליבה", re.I)
QTR = re.compile(r"\bQ([1-4])\s*[-/]?\s*(?:20)?(\d{2})\b|\b(?:20)?(\d{2})\s*[-/]?\s*Q([1-4])\b", re.I)


def deck_index():
    """non-target figures the decks print (extraction spec v9): (company, metric, segment, year, window) -> (value, report id, page, label)"""
    idx = {}
    for c, per, rid, pdate, facts in decks():
        for x in facts:
            m, d = x["metric"], (x.get("date") or "")[:10]
            if m.startswith("target_") or x.get("value") is None or not d:
                continue
            idx.setdefault((c, m, x["segment"], d[:4], x.get("window")), (x["value"], rid, x.get("page_he"), (x.get("label") or "")[:120]))
    return idx


def actuals(rows, docs=None, files=""):
    docs = docs or {}
    dk = deck_index()
    cap = json.loads((DATA / "csm" / "capital.json").read_text(encoding="utf-8"))["companies"]
    adj_f = json.loads((DATA / "adjusted.json").read_text(encoding="utf-8")) if (DATA / "adjusted.json").exists() else {"companies": {}, "docs": {}, "files": ""}
    adj = adj_f["companies"]
    today = dt.date.today()

    def pt(c, k, y):
        return (cap.get(c, {}).get(k) or {}).get(f"{y}FY")

    def inp(label, x, y):
        return [label, x["v"], x.get("u"), x.get("pg"), f"FY'{str(y)[2:]}", x.get("solv")]

    def adj_pt(c, keys, y):
        """a company-defined KPI for the year from the decks (adjusted.json), with its deck and page"""
        for k in keys:
            s = (adj.get(c) or {}).get(k)
            x = next((q for q in (s or {}).get("pts", []) if q["p"] == f"{y}FY"), None)
            if x:
                d = adj_f["docs"].get(str(x["rid"]))
                return k, s, x, (adj_f["files"] + d[4]) if d and d[4] else None
        return None

    def reported(c, y):
        return bool(pt(c, "profit_attributable", y) or pt(c, "equity_attributable", y))

    def actual(r, y):
        """(act, None) or (None, reason) for one target and year"""
        c, m = r["c"], r["m"]
        group = r["seg"] in GROUPISH or r["e"] == "הקבוצה"
        txt = f"{r.get('q', '')} {r.get('nt', '')} {m}"
        if m in ("target_roe", "target_core_roe"):
            if CORE.search(txt):
                a = adj_pt(c, ["adj_core_roe", "adj_roe_core"], y)
                if not a:
                    return None, "תשואה להון מפעילות ליבה (הגדרת החברה) לשנת היעד לא נמצאה במצגות שנקלטו"
                k, srs, x, url = a
                return {"k": "roe", "v": x["v"], "y": y, "f": f"{srs['l']}, לפי הגדרת החברה, כפי שהוצגה במצגת", "in": [[srs["l"] + " (הגדרת החברה)", x["v"], url, x["pg"], f"FY'{str(y)[2:]}", None]], "def": "core"}, None
            if not group or c not in cap:
                return None, "תשואה להון של ישות שאינה הקבוצה לא נקלטה"
            ci = re.search(r"כולל|comprehensive", txt, re.I)
            num, e1, e0 = pt(c, "comprehensive_income_attributable" if ci else "profit_attributable", y), pt(c, "equity_attributable", y), pt(c, "equity_attributable", y - 1)
            if not (num and e1 and e0):
                return None, "רכיבי התשואה להון לשנת היעד לא נקלטו"
            v = num["v"] / ((e1["v"] + e0["v"]) / 2) * 100
            return {"k": "roe", "v": round(v, 1), "y": y, "f": f"{'רווח כולל' if ci else 'רווח נקי'} לבעלי המניות ÷ ממוצע ההון לבעלי המניות בתחילת השנה ובסופה × 100",
                    "in": [inp("רווח כולל לבעלי המניות" if ci else "רווח נקי לבעלי המניות", num, y), inp("הון לבעלי המניות, סוף שנה", e1, y), inp("הון לבעלי המניות, תחילת שנה", e0, y - 1)]}, None
        if m in ("target_core_profit", "target_core_income"):
            if not group:
                return None, f"יעד למגזר ({r['e']}); רווח הליבה של המגזר לא נקלט"
            a = adj_pt(c, ["core_profit", "adj_core_profit_after_tax", "adj_core_profit"], y)
            if not a:
                return None, "רווח ליבה (הגדרת החברה) לשנת היעד לא נמצא במצגות שנקלטו"
            k, srs, x, url = a
            return {"k": "core", "v": x["v"], "y": y, "f": f"{srs['l']}, לפי הגדרת החברה, כפי שהוצג במצגת", "in": [[srs["l"] + " (הגדרת החברה)", x["v"], url, x["pg"], f"FY'{str(y)[2:]}", None]], "def": "core"}, None
        if m in ("target_comprehensive_income", "target_profit", "target_net_income"):
            if not group and r["b"] == "pre_tax":
                # the subsidiary's pre-tax profit as the decks print it: scored only on the same definition
                alias = {"more": ["more", "more_gemel"], "more_gemel": ["more_gemel", "more"]}.get(c, [c])
                hit = lambda mm: next((dk[k] for cc in alias for k in [(cc, mm, r["seg"], str(y), "fy")] if k in dk), None)
                x = hit("profit_before_tax")
                if x:
                    d = docs.get(x[1])
                    return {"k": "profit", "v": x[0], "y": y, "f": "רווח לפני מס של החברה הבת, כפי שהוצג במצגת", "in": [["רווח לפני מס", x[0], (files + d[8]) if d else None, x[2], f"FY'{str(y)[2:]}", None]]}, None
                a = hit("adj_profit_before_tax")
                if a:
                    return None, f"בפועל הוצג רק רווח מתואם לפני מס: {a[0]:g} (מצגת {a[1]}, עמ׳ {a[2]}); היעד ברווח לפני מס, הגדרה אחרת"
            if not group:
                return None, f"יעד לחברה בת או למגזר ({r['e']}); הרווח שלה לא נקלט"
            if r["b"] == "pre_tax":
                return None, "יעד לפני מס; באתר הרווח לאחר מס"
            if CORE.search(txt):
                return None, "יעד לרווח מנוטרל (ליבה); לא הרווח המדווח"
            if c not in cap:
                return None, "הדוחות הכספיים של החברה לשנת היעד לא נקלטו"
            k = "comprehensive_income_attributable" if m == "target_comprehensive_income" else "profit_attributable"
            x = pt(c, k, y)
            if not x:
                return None, "הרווח לשנת היעד לא נקלט"
            return {"k": "ci" if k.startswith("comp") else "profit", "v": x["v"], "y": y, "f": "כפי שהודפס בדוח הכספי",
                    "in": [inp("רווח כולל לבעלי המניות" if k.startswith("comp") else "רווח נקי לבעלי המניות", x, y)]}, None
        if m == "target_equity":
            x = pt(c, "equity_attributable", y) if group else None
            if not x:
                return None, "ההון לסוף שנת היעד לא נקלט"
            return {"k": "equity", "v": x["v"], "y": y, "f": "הון לבעלי המניות לסוף השנה, כפי שהודפס", "in": [inp("הון לבעלי המניות, סוף שנה", x, y)]}, None
        if m == "target_customers":
            nc_ = next((v for k, v in dk.items() if k[0] == c and k[1] == "kpi_new_customers" and k[3] == str(y)), None)
            return None, "מספר הלקוחות הכולל לא הודפס" + (f"; הודפס רק מספר הלקוחות החדשים בשנה ({nc_[0]:,.0f}, מצגת {nc_[1]}, עמ׳ {nc_[2]})" if nc_ else "")
        if m.startswith("target_solvency_ratio") and "step" not in m and r["u"] == "pct":
            if r["e"] not in ("חברת הביטוח", "הקבוצה", ""):
                return None, f"יעד ל{r['e']}; יחס כושר הפירעון שלה לא נקלט"
            wo, wi = re.search(r"ללא הוראות|without", txt, re.I), re.search(r"(?<!ללא )הוראות המעבר|with_transitional|taking into account", txt, re.I)
            bases = ["wo"] if wo else ["w"] if wi else ["w", "wo"]
            xs = [(b, pt(c, f"sr_{b}", y)) for b in bases]
            xs = [(b, x) for b, x in xs if x]
            if not xs:
                return None, "יחס כושר הפירעון לשנת היעד לא נקלט"
            if len(bases) == 2:
                if len(xs) < 2:
                    return None, "הבסיס (עם או בלי הוראות מעבר) לא צוין, ונקלט רק אחד מהיחסים"
                goal = r["hi"] if r["hi"] is not None else r["lo"] if r["lo"] is not None else r["v"]
                if (xs[0][1]["v"] >= goal) != (xs[1][1]["v"] >= goal):
                    return None, "הבסיס (עם או בלי הוראות מעבר) לא צוין, והתוצאה תלויה בו"
                lo = min(xs, key=lambda q: q[1]["v"])  # the result holds on both: the lower ratio is shown
                return {"k": "sr", "v": lo[1]["v"], "y": y, "f": "יחס כושר פירעון של חברת הביטוח, כפי שהודפס; הבסיס לא צוין ביעד, והתוצאה זהה עם ובלי הוראות מעבר (מוצג הנמוך)",
                        "in": [inp(f"יחס כושר פירעון, {'ללא' if b == 'wo' else 'עם'} הוראות מעבר", x, y) for b, x in xs]}, None
            b, x = xs[0]
            return {"k": "sr", "v": x["v"], "y": y, "f": f"יחס כושר פירעון של חברת הביטוח, {'ללא' if b == 'wo' else 'עם'} הוראות מעבר, כפי שהודפס",
                    "in": [inp("יחס כושר פירעון", x, y)]}, None
        if "step" in m:
            return None, "יעד לקצב שינוי שנתי, לא לרמה"
        if m.endswith("_prior"):
            return None, "נוסח קודם של היעד, שעודכן אחר כך (היעד המעודכן בשורה נפרדת)"
        what = {"target_revenue": "ההכנסות", "target_ebitda": "ה-EBITDA", "target_adj_ebitda": "ה-EBITDA המותאם", "target_aum": "הנכסים המנוהלים", "target_customers": "מספר הלקוחות",
                "target_premiums": "הפרמיות", "target_premiums_and_contributions": "הפרמיות ודמי הגמולים", "target_management_fees": "דמי הניהול"}.get(m, "המדד")
        return None, f"{what} בפועל, באותה הגדרה ולאותה תקופה, לא נקלטו באתר"

    n = collections.Counter()
    for r in rows:
        c, m = r["c"], r["m"]
        r["rev"] = len(r["hist"]) - 1 if r.get("hist") else 0
        q = QTR.search(r.get("q") or "")
        qy = (2000 + int(q.group(2) or q.group(3)), int(q.group(1) or q.group(4))) if q else None
        if qy and r["h"] and qy[0] != r["h"]:
            qy = None
        if not r["h"]:
            r["st"] = "policy"
            # a standing policy: the latest reported year beside it, never judged
            fys = sorted({int(p[:4]) for p in (cap.get(c, {}).get("profit_attributable") or {}) if p.endswith("FY")}, reverse=True)
            if m.startswith("target_dividend_payout") and (r["seg"] in GROUPISH or r["e"] == "הקבוצה") and fys:
                y = fys[0]
                dv, pr = pt(c, "dividend_paid", y), pt(c, "profit_attributable", y)
                if dv and pr and pr["v"] > 0:
                    r["act"] = {"k": "payout", "v": round(abs(dv["v"]) / pr["v"] * 100, 1), "y": y, "f": "דיבידנד ששולם בשנה ÷ רווח נקי לבעלי המניות באותה שנה × 100 (מזומן; לא מדיניות)",
                                "in": [inp("דיבידנד ששולם", {**dv, "v": abs(dv["v"])}, y), inp("רווח נקי לבעלי המניות", pr, y)], "ref": 1, "prog": 1}
            continue
        if m.startswith("target_dividend") or m.startswith("target_total_payout") or "buyback" in m:
            r["st"], r["why"] = ("nc", "מדיניות חלוקה מול מזומן ששולם: לא נמדד") if r["h"] < today.year else ("open", None)
            continue
        passed = (r["h"] < today.year) if not qy else (dt.date(qy[0], 3 * qy[1], 1) < today.replace(day=1))
        if not passed:
            r["st"] = "open"
            # progress: the latest reported year, shown beside the target and never judged
            fys = sorted({int(p[:4]) for p in (cap.get(c, {}).get("profit_attributable") or {}) if p.endswith("FY")}, reverse=True)
            prev = [y for y in fys if y < r["h"]][:1]
            if prev:
                a, _ = actual(r, prev[0])
                if a:
                    a["prog"] = 1
                    r["act"] = a
            continue
        if qy:
            r["st"], r["why"] = "nc", f"יעד רבעוני (Q{qy[1]}'{str(qy[0])[2:]}); התוצאה הרבעונית באותה הגדרה לא נקלטה"
            continue
        a, why = actual(r, r["h"])
        if not a:
            r["st"], r["why"] = ("nc", why) if c not in cap or reported(c, r["h"]) or "הגדרת" in why or "בסיס" in why or "מגזר" in why or "בת" in why or "לפני מס" in why or "קצב" in why or "באתר" in why else ("open", "שנת היעד טרם דווחה")
            continue
        r["act"] = a
        n[a["k"]] += 1
        lo, hi, v = r["lo"], r["hi"], r["v"]
        x = a["v"]
        if lo is not None and hi is not None:
            r["st"] = "met" if x >= hi else "partial" if x >= lo else "missed"
        else:
            goal = v if v is not None else lo
            if goal is None:  # "up to" a ceiling: met when at or below it
                r["st"] = "met" if x <= hi else "missed"
            else:
                r["st"] = "met" if x >= goal else "missed"
    return n


def credibility(rows):
    """hit rate per company and per year the targets were set (no free source states the CEO tenures, so the era is the year of the first statement)"""
    scored = [r for r in rows if r["st"] in ("met", "partial", "missed")]

    def agg(xs):
        c = collections.Counter(r["st"] for r in xs)
        n = c["met"] + c["partial"] + c["missed"]
        return {"n": n, "met": c["met"], "partial": c["partial"], "missed": c["missed"], "nc": c["nc"], "open": c["open"],
                "hit": round((c["met"] + c["partial"]) / n * 100, 1) if n else None}

    by_co = collections.defaultdict(list)
    for r in rows:
        if r["st"] != "policy":
            by_co[r["c"]].append(r)
    out = {}
    for co, xs in sorted(by_co.items()):
        eras = collections.defaultdict(list)
        for r in xs:
            eras[int(((r.get("st0") or r.get("st1") or [r["d"]])[0] or r["d"])[:4])].append(r)
        out[co] = {**agg(xs), "eras": {str(y): agg(v) for y, v in sorted(eras.items())}}
    return {"era": "year", "rule": "hit = (met + partial) ÷ scored; partial = inside a range below its top; nc and open are not scored", "all": agg([r for r in rows if r["st"] != "policy"]),
            "companies": out, "scored": len(scored)}


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
    adj = adjusted()
    (DATA / "adjusted.json").write_text(json.dumps({"built": dt.date.today().isoformat(), "source": "מצגות משקיעים של החברות, MAYA: מדדים לפי הגדרת החברה, כפי שהודפסו",
                                                    "files": reg["files"], "docs": {str(i): [docs[i][1], docs[i][2], docs[i][3], docs[i][4], docs[i][8]] for i in sorted({p["rid"] for c in adj.values() for s in c.values() for p in s["pts"] if p["rid"]}) if i in docs},
                                                    "companies": adj}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    prows, status = deck_rows(docs)
    rows += prows
    n_act = actuals(rows, docs, reg["files"])
    rows.sort(key=lambda r: (r["c"], r["t"], r["m"], r["e"], r["h"] or 0, r["d"]))
    used = sorted({r["doc"] for r in rows if r["doc"]} | {h[2] for r in rows if r["src"] == "report" for h in (r["hist"] or []) if h[2]}
                  | {h[4] for r in rows if r["src"] == "pres" for h in (r["hist"] or []) if h[4]} | {r["st0"][1] for r in rows if r["st0"] and r["st0"][1]}
                  | {s[2] for v in status.values() for s in v if s[2]})
    out = {"v": 3, "built": dt.date.today().isoformat(), "source": "דוחות כספיים, דוחות דירקטוריון ומצגות משקיעים של החברות, MAYA: יעדים כפי שהודפסו",
           "files": reg["files"], "docs": {str(i): [docs[i][1], docs[i][2], docs[i][3], docs[i][4], docs[i][8]] for i in used if i in docs},
           "status": {c: sorted(v) for c, v in status.items()}, "cred": credibility(rows), "rows": rows}
    (DATA / "targets.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    st = collections.Counter(r.get("st") for r in rows)
    print(f"targets.json: {len(rows)} targets ({sum(1 for r in rows if r['src'] == 'pres')} from decks, {sum(r['n'] for r in rows)} prints, {sum(1 for r in rows if r['hist'])} revised), "
          f"actuals {dict(n_act)}, status {dict(st)}, {(DATA / 'targets.json').stat().st_size // 1024} KB; "
          f"adjusted.json: {sum(len(v) for v in adj.values())} series, {sum(len(s['pts']) for v in adj.values() for s in v.values())} points, {(DATA / 'adjusted.json').stat().st_size // 1024} KB; "
          f"unlabelled {sorted({r['m'] for r in rows if r['l'] == 'יעד'})}; missing docs {len([i for i in used if i not in docs])}")


if __name__ == "__main__":
    main()
