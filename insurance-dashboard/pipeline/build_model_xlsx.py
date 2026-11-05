"""Model-ready Excel per company: web/public/data/xlsx/<company>.xlsx (Wave 5, Pro depth).

One workbook per company fox covers (insurers and investment houses), built from the published JSON only; nothing is extracted here:
  P&L            the statement lines of the fact table (facts/<id>.json, stmt pl + oci, consolidated), the figure the site shows
  Balance sheet  the same for stmt bs (balances at quarter ends; the FY column is a formula on Q4)
  IFRS 17        CSM bridge, RA, insurance revenue, new business, onerous contracts, finance result, by segment (series/<id>.json)
                 and the resolved group CSM (csm/facts/<id>.json)
  Solvency       the solvency ratio, own funds, SCR and surplus from the statements (csm/capital.json, series/<id>.json) and the
                 Solvency II reports' SCR modules and tiers (csm/solvency.json)
  Savings        the managers' printed AUM, contributions, fees, expenses, profit (savings_econ.json) and the regulator join
                 (lens.json: AUM, organic flow, net transfers, shares, fee yield; data.gov.il)
  KPIs           headline XBRL figures (kpi.json, the printed figure where canon_kpi replaced the tag), segment KPIs (series), the
                 company-defined KPIs from the decks (adjusted.json), and ROE computed in the sheet as live formulas
  Sources        one row per value: sheet, cell (a link to it), key, label, period, value, kind, document, report id, page, the PDF at
                 the page, the MAYA report page, a second source where the value is derived, a note
Rows = metrics (English key + Hebrew label + unit + segment + standard), columns = Q1'23 ... Q2'26 with FY after each Q4; numbers
are numbers (NIS millions unless the unit column says otherwise; thousands printed in the reports are divided by 1,000). A derived
value (Q4 = FY − 9M) is written as the site computed it, in italics, with both source pages; a formula is a live Excel formula.

python3 pipeline/build_model_xlsx.py            build every workbook
python3 pipeline/build_model_xlsx.py --check    rebuild in memory and compare byte for byte, then open every file: every XML part
                                                parses, the seven sheets exist, every value cell has a Sources row and every Sources
                                                row a link (or a formula), each file < 1 MB (gate `model_xlsx`)
"""
import collections
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from xlsx_lib import Book, Cell, qsheet, read_book, ref, split_ref  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"
OUT = DATA / "xlsx"
MAX_BYTES = 1_000_000
SHEETS = ["P&L", "Balance sheet", "IFRS 17", "Solvency", "Savings", "KPIs", "Sources"]
MAYA = "https://maya.tase.co.il/he/reports/{}"
REG_DS = {"pen": ["pensia-net"], "gem": ["gemelnet"], "hish": ["gemelnet"], "ins": ["insurance"], "pg": ["pensia-net", "gemelnet"]}
REG_NAME = {"pensia-net": "פנסיה-נט", "gemelnet": "גמל-נט", "insurance": "ביטוח-נט"}

# ---------------------------------------------------------------- periods: Q1'23 ... Q2'26, FY after each Q4
FIRST, LAST = (2023, 1), (2026, 2)


def _periods():
    out = []
    for y in range(FIRST[0], LAST[0] + 1):
        for q in range(1, 5):
            if (y, q) < FIRST or (y, q) > LAST:
                continue
            out.append(f"{y}Q{q}")
            if q == 4:
                out.append(f"{y}FY")
    return out


PERIODS = _periods()
PCOL = {p: i for i, p in enumerate(PERIODS)}


def set_periods(first, last):
    """Move the period window: the sheet readers below read FIRST, LAST, PERIODS and PCOL at call time. The workbooks keep Q1'23 ...
    Q2'26; pipeline/build_tables.py reads the same layers over every period on file through these readers."""
    global FIRST, LAST, PERIODS, PCOL
    FIRST, LAST = first, last
    PERIODS = _periods()
    PCOL = {p: i for i, p in enumerate(PERIODS)}
NFIX = 5  # key, label, unit, segment, standard


def plabel(p):
    return f"FY'{p[2:4]}" if p.endswith("FY") else f"Q{p[5]}'{p[2:4]}"


def qkey(end):
    """a quarter-end date -> 2025Q2 (None for any other date)"""
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", end or "")
    if not m or (m.group(2), m.group(3)) not in (("03", "31"), ("06", "30"), ("09", "30"), ("12", "31")):
        return None
    return f"{m.group(1)}Q{int(m.group(2)) // 3}"


def dlabel(d):
    return f"{d[8:10]}.{d[5:7]}.{d[2:4]}" if d and len(d) >= 10 else (d or "")


# ---------------------------------------------------------------- labels (the site's own maps, read from the TS sources)
def dict_of(path, name):
    src = (ROOT / path).read_text(encoding="utf-8")
    block = src.split(name, 1)[1].split("};", 1)[0]
    return {m.group(1) or m.group(2): m.group(3) for m in re.finditer(r"(?:'([^']+)'|([A-Za-z0-9_+:.\-]+)):\s*'([^']*)'", block)}


METRIC_HE = {**dict_of("web/src/pages/CompanyIfrs.tsx", "const HE:"), **dict_of("web/src/lib/labels.ts", "export const METRIC_HE")}
SEGMENT_HE = dict_of("web/src/lib/labels.ts", "export const SEGMENT_HE")
SOLV_HE = {**dict_of("web/src/lib/solvency.ts", "export const LABEL"), "t1b": "רובד 1 בסיסי", "t1r": "רובד 1 נוסף", "t2": "רובד 2", "t3": "רובד 3",
           **{k: f"SCR · {v}" for k, v in [("m_market", "שוק"), ("m_counterparty", "צד נגדי"), ("m_life", "חיתום חיים"), ("m_health", "חיתום בריאות"),
                                           ("m_nonlife", "חיתום כללי"), ("m_intangible", "בלתי מוחשיים"), ("m_div", "השפעת פיזור"), ("m_operational", "תפעולי"),
                                           ("m_managers", "חברות מנהלות"), ("m_lac_dt", "ספיגת הפסדים, מס נדחה"), ("m_lac_tp", "ספיגת הפסדים, עתודות"),
                                           ("m_eq_tr", "הוראת מעבר, מניות")]}}
BASIS_HE = {"gross": "ברוטו", "net": "נטו", "reinsurance": "ביטוח משנה", "na": "", "pre_tax": "לפני מס", "after_tax": "לאחר מס"}
KPI = [  # key, Hebrew label, unit, instant (kpi.json; the differenced flows and the balances only)
    ("profit", "רווח נקי לבעלי המניות", "₪m", False), ("oci", "רווח כולל לבעלי המניות", "₪m", False), ("pretax", "רווח לפני מס", "₪m", False),
    ("revenue", "הכנסות (תג XBRL Revenue)", "₪m", False), ("cfo", "תזרים מפעילות שוטפת", "₪m", False), ("eps", "רווח בסיסי למניה", "₪", False),
    ("equity", "הון לבעלי המניות", "₪m", True), ("equity_all", "סך ההון", "₪m", True), ("nci", "זכויות שאינן מקנות שליטה", "₪m", True),
    ("assets", "סך הנכסים", "₪m", True), ("liabilities", "סך ההתחייבויות", "₪m", True)]
SAV_HE = {"aum": ("נכסים מנוהלים", "₪m"), "deposits": ("דמי גמולים", "₪m"), "fees": ("הכנסות מדמי ניהול", "₪m"), "expenses": ("הוצאות", "₪m"),
          "profit": ("רווח לפני מס", "₪m"), "margin": ("שיעור רווח (רווח ÷ הכנסות)", "%"), "exp_ratio": ("הוצאות ÷ הכנסות מדמי ניהול", "%"),
          "ga": ("הנהלה וכלליות", "₪m"), "ga_pct": ("הנהלה וכלליות ÷ הכנסות", "%"), "sm": ("שיווק ומכירה", "₪m"), "sm_pct": ("שיווק ומכירה ÷ הכנסות", "%")}
SAV_SEG = {"provident": "גמל", "pension": "פנסיה", "group": "קבוצה", "investment_contracts": "פוליסות חיסכון (חוזי השקעה)", "pension_provident": "פנסיה וגמל",
           "yelin_total": "סה״כ"}
SAV_AGG = {"combined": "מאוחד למגזר", "entity": "החברה המנהלת", "provident": "קופות גמל", "pension": "קרנות פנסיה", "investment_contracts": "חוזי השקעה"}
LENS_SEG = {"pen": "פנסיה", "gem": "גמל והשתלמות", "pg": "פנסיה וגמל", "hish": "קרנות השתלמות", "ins": "ביטוחי מנהלים ופוליסות חיסכון"}
LENS_M = [  # key, label, unit, getter, kind
    ("reg_aum_end", "נכסים לסוף הרבעון (רשות)", "₪m", lambda r: r["reg"].get("aE"), "regulator"),
    ("reg_aum_avg", "נכסים ממוצעים ברבעון (רשות, טרפז על ארבעה סופי חודש)", "₪m", lambda r: r["reg"].get("avg"), "regulator"),
    ("reg_organic", "צבירה אורגנית ברבעון (רשות)", "₪m", lambda r: r["reg"].get("org"), "regulator"),
    ("reg_transfers", "העברות נטו ברבעון (רשות)", "₪m", lambda r: r["reg"].get("tr"), "regulator"),
    ("aum_share", "נתח מנכסי השוק", "%", lambda r: r.get("aum_share"), "calc"),
    ("flow_share", "נתח מהצבירה נטו של השוק", "%", lambda r: r.get("flow_share"), "calc"),
    ("fee_yield_reg", "תשואת דמי ניהול על נכסי הרשות, שנתי", "%", lambda r: r.get("fy_reg"), "calc"),
    ("fee_yield_rep", "תשואת דמי ניהול על נכסים מדווחים, שנתי", "%", lambda r: r.get("fy_rep"), "calc"),
]
LENS_NOTE = {"reg_aum_end": "סכום מסלולי הקבוצה בחודש סוף הרבעון", "reg_aum_avg": "(A₀÷2 + A₁ + A₂ + A₃÷2) ÷ 3 על ארבעה סופי חודש, A₀ = סוף הרבעון הקודם",
             "reg_organic": "סכום מסלולי הקבוצה ברבעון", "reg_transfers": "סכום מסלולי הקבוצה ברבעון",
             "aum_share": "נכסי הקבוצה ÷ נכסי כל הקבוצות × 100, חודש סוף הרבעון", "flow_share": "(אורגני + העברות) של הקבוצה ÷ של השוק × 100",
             "fee_yield_reg": "הכנסות מדמי ניהול בדוח (רבעון) × 4 ÷ נכסים ממוצעים ברשות × 100", "fee_yield_rep": "הכנסות מדמי ניהול × 4 ÷ נכסים ממוצעים כפי שהודפסו × 100"}
IFRS17 = re.compile(r"^(csm|ra_|risk_adjustment|insurance_|rev_|loss_component|losses_on_onerous|new_business|one_time_premium|net_reinsurance|reins_)")
SOLV = re.compile(r"^(solvency_|own_funds|scr|mcr)")
STD = {"17": "IFRS 17", "4": "IFRS 4", "IFRS 17": "IFRS 17", "IFRS 4": "IFRS 4"}
UNIT_STYLE = {"₪m": "m", "₪": "nis", "%": "pct", "shares": "int", "x": "x"}


def load(rel):
    p = DATA / rel
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


class Ctx:
    """the shared registries: companies, documents (report id -> name, period, date, PDF)"""

    def __init__(self):
        self.reg = {c["id"]: c for c in load("companies/index.json")}
        docs = load("search/docs.json")
        self.docs = {r[0]: r for r in docs["docs"]}
        self.files = docs["files"]
        self.taxonomy = load("facts/taxonomy.json")["lines"]
        self.kpi = load("kpi.json")
        self.capital = load("csm/capital.json")["companies"]
        self.solv = load("csm/solvency.json")
        self.sav = load("savings_econ.json")
        self.lens = load("lens.json")
        self.adj = load("adjusted.json")

    def doc(self, rid, name):
        d = self.docs.get(rid)
        if not d:
            return f"{name} · דוח {rid}" if rid else name
        return f"{name} · {d[7]}" + (f", פורסם {dlabel(d[4])}" if d[4] else "")

    def pdf(self, rid):
        d = self.docs.get(rid)
        return self.files + d[8] if d and d[8] else None


def rid_of(url):
    m = re.search(r"P(\d{6,8})-", url or "")
    return int(m.group(1)) if m else None


def src(kind, doc="", rid=None, pg=None, url=None, note="", url2=None, pg2=None):
    return {"kind": kind, "doc": doc, "rid": rid, "pg": pg, "url": url, "note": note, "url2": url2, "pg2": pg2}


def printed(ctx, name, url, pg, note="", kind="printed"):
    rid = rid_of(url)
    return src(kind, ctx.doc(rid, name), rid, pg, url, note)


class Rows:
    """the rows of one data sheet: a band (section) or a metric row {id, key, label, unit, dim, std, cells{period: cell}, inst}"""

    def __init__(self):
        self.rows, self.by = [], {}

    def band(self, text):
        self.rows.append({"band": text})

    def get(self, rid, key, label, unit, dim="", std="", inst=False):
        if rid not in self.by:
            r = {"id": rid, "key": key, "label": label, "unit": unit, "dim": dim, "std": std, "cells": {}, "inst": inst}
            self.by[rid] = r
            self.rows.append(r)
        return self.by[rid]

    def put(self, rid, p, v, s, f=None):
        if p not in PCOL or v is None:
            return
        self.by[rid]["cells"][p] = {"v": v, "src": s, "f": f}

    def prune(self):
        keep, pend = [], None
        for r in self.rows:
            if "band" in r:
                pend = r
            elif r["cells"]:
                if pend:
                    keep.append(pend)
                    pend = None
                keep.append(r)
        self.rows = keep
        return self


# ---------------------------------------------------------------- the sheets
def statements(ctx, co, name, stmts, inst):
    """P&L (pl + oci) or Balance sheet (bs) from the fact table: consolidated lines, the current figure of each cell"""
    out = Rows()
    F = load(f"facts/{co}.json")
    if not F:
        return out
    L, R, V = F["lines"], F["rows"], F["vint"]
    der = {k: (op, a, b) for k, op, a, b in F["der"]}
    start, last_band = 0, None
    insurer = ctx.reg[co].get("kind") == "insurance_group"  # a fund house reports under IFRS without the insurance standard
    for i, lid in enumerate(L["id"]):
        n = L["n"][i]
        k0, start = start, start + n
        stmt = (ctx.taxonomy.get(lid) or [None, lid.split(".")[0]])[1]
        if L["ent"][i] != "F" or stmt not in stmts:
            continue
        sheet = F["sheets"][L["sh"][i]].replace("X.", "").replace("_", " ")
        band = f"{ {'pl': 'רווח והפסד', 'oci': 'רווח כולל', 'bs': 'מאזן'}[stmt]} · {sheet}"
        if band != last_band:
            out.band(band)
            last_band = band
        u = L["u"][i]
        unit, div = {"k": ("₪m", 1000), "m": ("₪m", 1), "nis": ("₪", 1), "pct": ("%", 1), "shares": ("shares", 1)}.get(u, (u, 1))
        rid = f"{lid}|{i}"
        out.get(rid, lid, L["label"][i], unit, (L["dim"][i] or ""), STD.get(L["std"][i], "") if insurer else "", inst=inst)
        for k in range(k0, k0 + n):
            f = R["f"][k]
            if not f & 16 or f & 64:
                continue
            t, e = F["periods"][R["p"][k]]
            p = (qkey(e) if t in ("I",) else None) if inst else (qkey(e) if t == "Q" else f"{e[:4]}FY" if t == "FY" else None)
            if not p:
                continue
            v = R["v"][k] / div if div != 1 else R["v"][k]
            t_ = R["t"][k]
            url = F["urls"][V["u"][t_]] if V["u"][t_] is not None else ctx.pdf(V["rid"][t_])
            if f & 1 and k in der:
                op, a, b = der[k]
                def row(x):
                    if isinstance(x, int):
                        return (F["urls"][V["u"][R["t"][x]]] if V["u"][R["t"][x]] is not None else None), R["pg"][x]
                    return (F["urls"][x[1]] if len(x) > 1 and x[1] is not None else None), None  # a figure outside the line: its report, no page
                ua, pa = row(a)
                ub, pb = row(b)
                s = src("derived", ctx.doc(rid_of(ua or url), name), rid_of(ua or url), pa, ua or url,
                        {"FY-9M": "נגזר: השנה פחות תשעה חודשים", "FY-H1": "נגזר: השנה פחות המחצית הראשונה"}[op] + ("; הנכוי: ערך שהודפס" if not isinstance(b, int) else ""), ub, pb)
            else:
                s = src("printed", ctx.doc(V["rid"][t_], name), V["rid"][t_], R["pg"][k], url,
                        "; ".join(x for x in ["הוצג מחדש: שונה מההדפסה הראשונה" if f & 8 else "", "מספר השוואה מדוח מאוחר" if f & 128 else ""] if x))
            out.put(rid, p, round(v, 6), s)
    return out.prune()


def series_rows(ctx, co, name, pick, out=None, band=None):
    S = load(f"series/{co}.json")
    out = out or Rows()
    if not S:
        return out
    if band:
        out.band(band)
    rows = sorted((r for r in S["rows"] if pick(r["m"])), key=lambda r: (r["g"], r["s"], r["m"], r["b"]))
    last = None
    for r in rows:
        if r["g"] != last:
            out.band(f"{band + ' · ' if band else ''}{SEGMENT_HE.get(r['g'], r['g'])}")
            last = r["g"]
        m = r["m"]
        base, _, extra = m.partition(":")
        unit = "%" if re.search(r"ratio|roe|_pct", m) else "₪m"
        label = METRIC_HE.get(m) or METRIC_HE.get(base) or base.replace("_", " ")
        if extra:
            label += f" · {extra}"
        seg = SEGMENT_HE.get(r["s"]) or (r["s"].split(":", 1)[1] if ":" in r["s"] else r["s"])
        dim = " · ".join(x for x in [seg, BASIS_HE.get(r["b"], r["b"])] if x)
        rid = f"s|{m}|{r['s']}|{r['b']}"
        out.get(rid, m, label, unit, dim, "", inst=r.get("w") == "i")
        for p, c in r["vals"].items():
            if p not in PCOL:
                continue
            note = "; ".join(x for x in ["נגזר: השנה פחות תשעה חודשים (עמוד השנתי)" if c.get("der") else "",
                                           "מספר השוואה מדוח מאוחר" if c.get("cmp") else "", f"מקור בעמוד: {c['src']}" if c.get("src") else ""] if x)
            s = printed(ctx, name, c["u"], c.get("pg"), note, "derived" if c.get("der") else "printed")
            sd = STD.get(c.get("std"), "")
            if sd and sd not in out.by[rid]["std"]:
                out.by[rid]["std"] = " / ".join(sorted(filter(None, [out.by[rid]["std"], sd]), key=lambda x: x.endswith("17")))
            out.put(rid, p, c["v"], s)
    return out


def ifrs17(ctx, co, name):
    out = series_rows(ctx, co, name, lambda m: bool(IFRS17.match(m)), band="IFRS 17")
    cf = load(f"csm/facts/{co}.json")
    if cf and cf.get("resolved"):
        urls = {f["period"]: f["url"] for f in cf["files"]}
        out.band("CSM לפי הבסיס שהחברה מציגה (csm_resolve)")
        out.get("csm_resolved", "csm_resolved", "CSM, יתרת סגירה, בבסיס שהדוח מציג", "₪m", "", "IFRS 17", inst=True)
        for d, x in cf["resolved"].items():
            v, basis, per = x[0], x[1], x[2]
            # the page: the closing-CSM fact(s) of that report and date that make up the value (one, or life + health)
            fs = [f for f in (cf["reports"].get(per) or []) if f.get("d") == d and f["m"] == "csm_closing" and f.get("pg")]
            one = [f for f in fs if abs(abs(f["v"]) - abs(v)) < 0.6]
            two = [(a, b) for i, a in enumerate(fs) for b in fs[i + 1:] if abs(abs(a["v"]) + abs(b["v"]) - abs(v)) < 0.6]
            if one:
                pgs = (one[0]["pg"], None)
            elif two:
                pgs = (two[0][0]["pg"], two[0][1]["pg"])
            else:
                continue  # no page for it: not published here
            s_ = printed(ctx, name, urls.get(per), pgs[0], f"בסיס: {basis}; מהדוח {plabel(per)}" + ("; סכום שני רכיבים (חיים ועוד בריאות)" if pgs[1] else ""))
            if pgs[1]:
                s_.update(url2=urls.get(per), pg2=pgs[1])
            out.put("csm_resolved", qkey(d), v, s_)
    return out.prune()


def solvency(ctx, co, name):
    out = Rows()
    cap = ctx.capital.get(co) or {}
    labels = {"sr_w": ("יחס כושר פירעון, עם הוראות מעבר", "%"), "sr_wo": ("יחס כושר פירעון, ללא הוראות מעבר", "%"), "of": ("הון עצמי כלכלי מוכר", "₪m"),
              "scr": ("הון נדרש (SCR)", "₪m"), "su": ("עודף הון", "₪m")}
    if any(k in cap for k in labels):
        out.band("כפי שהודפס בדוחות הכספיים (csm/capital.json)")
    for k, (lab, unit) in labels.items():
        for p, c in (cap.get(k) or {}).items():
            pk = f"{p[:4]}Q4" if p.endswith("FY") else p  # a balance: the year end goes to Q4, the FY column is a formula
            if pk not in PCOL:
                continue
            out.get(f"cap|{k}", k, lab, unit, "", "", inst=True)
            ent = SEGMENT_HE.get(c.get("s"), c.get("s") or "")
            out.put(f"cap|{k}", pk, c["v"], printed(ctx, name, c["u"], c.get("pg"), f"ישות: {ent}" if ent else ""))
    series_rows(ctx, co, name, lambda m: bool(SOLV.match(m)), out=out, band="מהדוחות הכספיים, לפי מגזר (series)")
    S = ctx.solv
    rows = S["companies"].get(co) or {}
    hit = [(d, x) for d, x in sorted(rows.items()) if qkey(d) in PCOL]
    if hit:
        out.band("דוחות כושר פירעון כלכלי (Solvency II), csm/solvency.json")
        for d, x in hit:
            for k, c in x.items():
                lab = SOLV_HE.get(k) or c.get("l") or k
                unit = "%" if k.startswith(("sr", "tg")) else "₪m"
                out.get(f"sol|{k}", k, lab, unit, "", "", inst=True)
                rep = S["reports"].get(str(c.get("r"))) or {}
                url = S["files"] + rep["f"] if rep.get("f") else None
                s = src("printed", f"{name} · דוח כושר פירעון כלכלי ליום {dlabel(d)}" + (f", פורסם {dlabel(rep['pub'])}" if rep.get("pub") else ""), c.get("r"), c.get("pg"), url,
                        f"שורה בדוח: {c['l']}" if c.get("l") else "")
                out.put(f"sol|{k}", qkey(d), c["v"], s)
    return out.prune()


def savings(ctx, co, name):
    out = Rows()
    sc = "more_gemel" if co == "more" else co
    pick = {}
    order = {f: i for i, f in enumerate(sorted({x["file"] for x in ctx.sav["rows"]}, key=lambda f: (f[:4], f[4:] != "FY", f)))}
    for r in ctx.sav["rows"]:
        if r["c"] != sc or r["m"] not in SAV_HE:
            continue
        if r["w"] == "instant":
            p = qkey(r["d"])
        elif r["w"] == "q":
            p = qkey(r["d"])
        elif r["w"] == "fy":
            p = f"{r['d'][:4]}FY" if r["d"][5:] == "12-31" else None
        else:
            continue
        if p not in PCOL:
            continue
        key = (r["m"], r["s"], r.get("a") or "", p)
        if key not in pick or order.get(r["file"], 0) > order.get(pick[key]["file"], 0):
            pick[key] = r
    if pick:
        out.band(f"כפי שהודפס בדוחות {'מור גמל ופנסיה' if sc == 'more_gemel' else name} (savings_econ.json)")
    for (m, s, a, p), r in sorted(pick.items(), key=lambda kv: (list(SAV_HE).index(kv[0][0]), kv[0][1], kv[0][2], PCOL[kv[0][3]])):
        lab, unit = SAV_HE[m]
        rid = f"sav|{m}|{s}|{a}"
        out.get(rid, m, lab, unit, " · ".join(x for x in [SAV_SEG.get(s, s), SAV_AGG.get(a, a)] if x), "", inst=r["w"] == "instant")
        note = f"שורה בדוח: {r['l']}" if r.get("l") else ""
        if r.get("der"):
            s_ = src("derived", ctx.doc(rid_of(r["url"]), name), rid_of(r["url"]), r.get("pg"), r["url"], "יחס שחושב משני נתונים שהודפסו; " + note, r.get("url2"), r.get("pg2"))
        else:
            s_ = printed(ctx, name, r["url"], r.get("pg"), note)
        out.put(rid, p, r["v"], s_)
    L = ctx.lens
    gs = [i for i, g in enumerate(L["groups"]) if g.get("id") == co]
    if gs:
        g = gs[0]
        lr = [r for r in L["rows"] if r["g"] == g]
        for seg in LENS_SEG:
            rs = [r for r in lr if r["s"] == seg]
            if not rs:
                continue
            out.band(f"צירוף נתוני הרשות (lens.json) · {LENS_SEG[seg]}")
            for key, lab, unit, get, kind in LENS_M:
                rid = f"lens|{seg}|{key}"
                out.get(rid, key, lab, unit, LENS_SEG[seg], "")
                for r in rs:
                    v = get(r)
                    if v is None:
                        continue
                    qq = re.match(r"Q(\d)-(\d{4})", r["q"])
                    p = f"{qq.group(2)}Q{qq.group(1)}"
                    ds = REG_DS[seg]
                    month = str(r["reg"].get("e") or "")
                    doc = f"רשות שוק ההון, {' + '.join(REG_NAME[x] for x in ds)} (data.gov.il), חודש {month[4:]}/{month[:4]}" if kind == "regulator" else \
                        f"חישוב fox (עדשת החיסכון) על נתוני הרשות{' והדוח' if key.startswith('fee') else ''}, {plabel(p)}"
                    out.put(rid, p, round(v, 6), src(kind, doc, None, None, f"https://data.gov.il/dataset/{ds[0]}", LENS_NOTE[key],
                                                      f"https://data.gov.il/dataset/{ds[1]}" if len(ds) > 1 else None))
    return out.prune()


def kpis(ctx, co, name):
    out = Rows()
    K = ctx.kpi["companies"].get(co)
    if K:
        out.band("נתוני מפתח: XBRL המצורף לדוח (kpi.json), הנתון המודפס כשהוחלף")
        canon = K.get("canon") or {}
        for key, lab, unit, inst in KPI:
            vals = K["values"].get(key)
            if not vals:
                continue
            rid = f"kpi|{key}"
            out.get(rid, key, lab, unit, "קבוצה", "", inst=inst)
            for i, p in enumerate(K["periods"]):
                v = vals[i]
                if v is None:
                    continue
                pk = f"{p[:4]}Q4" if inst and p.endswith("FY") else p
                if pk not in PCOL:
                    continue
                r_ = K["rid"][i]
                fx = (K.get("fix") or {}).get(p) or {}
                cn = (canon.get(key) or {}).get(p)
                if cn:  # [printed, tagged, report id, page]: the printed figure replaced the tag
                    s = src("printed", ctx.doc(cn[2], name), cn[2], cn[3], ctx.pdf(cn[2]), f"הנתון המודפס (התג ב-XBRL: {cn[1]:g})")
                elif key == "profit" and fx.get("profit", {}).get("t") == "printed" and fx["profit"].get("pg"):
                    s = src("printed", ctx.doc(fx["profit"]["rid"], name), fx["profit"]["rid"], fx["profit"]["pg"], ctx.pdf(fx["profit"]["rid"]), "הרבעון המודפס במקום תג מצטבר")
                else:
                    note = {"diff": "מצטבר בתג, הופרש לרבעון", "printed": "הנתון המודפס"}.get(fx.get("t"), "") if key in ("profit", "oci", "pretax", "revenue", "cfo", "eps") else ""
                    st = K["status"][i]
                    note = "; ".join(x for x in [note, "לא אומת מול הדוח" if st == "unverified" else ""] if x)
                    s = src("xbrl", ctx.doc(r_, name) + f" · XBRL ({ctx.kpi['concepts'].get(key, key)})", r_, None, MAYA.format(r_) if r_ else None, note, ctx.pdf(r_))
                out.put(rid, pk, round(v / 1000, 6) if unit == "₪m" else v, s)
        # Q4 of a flow = FY − Q1 − Q2 − Q3, a live formula over the cells (EPS is not additive: left empty)
        for key, lab, unit, inst in KPI:
            rid = f"kpi|{key}"
            if inst or key == "eps" or rid not in out.by:
                continue
            c = out.by[rid]["cells"]
            for y in range(FIRST[0], LAST[0] + 1):
                ps = [f"{y}FY", f"{y}Q1", f"{y}Q2", f"{y}Q3"]
                if f"{y}Q4" in PCOL and f"{y}Q4" not in c and all(p in c for p in ps):
                    v = c[ps[0]]["v"] - c[ps[1]]["v"] - c[ps[2]]["v"] - c[ps[3]]["v"]
                    out.put(rid, f"{y}Q4", round(v, 6), src("formula", "נוסחה בגיליון", note="Q4 = FY − Q1 − Q2 − Q3"), f=("{0}-{1}-{2}-{3}", [(rid, p) for p in ps]))
        # ROE: profit over average equity (opening and closing), annualised for a quarter; computed in the sheet
        if "kpi|profit" in out.by and "kpi|equity" in out.by:
            P, E = out.by["kpi|profit"]["cells"], out.by["kpi|equity"]["cells"]
            out.get("kpi|roe", "roe_calc", "תשואה להון (רווח ÷ הון ממוצע), שנתי", "%", "קבוצה · מחושב", "")
            for i, p in enumerate(PERIODS):
                if p.endswith("FY"):
                    y = int(p[:4])
                    a, b = f"{y}Q4", f"{y - 1}Q4"
                    mult = 1
                else:
                    a = p
                    q = int(p[5])
                    b = f"{p[:4]}Q{q - 1}" if q > 1 else f"{int(p[:4]) - 1}Q4"
                    mult = 4
                if p in P and a in E and b in E and E[a]["v"] + E[b]["v"] > 0:
                    v = P[p]["v"] * mult / ((E[a]["v"] + E[b]["v"]) / 2) * 100
                    out.put("kpi|roe", p, round(v, 6), src("formula", "נוסחה בגיליון", note=f"רווח נקי לבעלי המניות{' × 4' if mult == 4 else ''} ÷ ממוצע ההון לבעלי המניות בפתיחה ובסגירה × 100"),
                            f=("{0}*" + str(mult) + "/AVERAGE({1},{2})*100", [("kpi|profit", p), ("kpi|equity", a), ("kpi|equity", b)]))
    series_rows(ctx, co, name, lambda m: not IFRS17.match(m) and not SOLV.match(m), out=out, band="מדדים מהדוחות, לפי מגזר (series)")
    A = (ctx.adj["companies"] or {}).get(co) or {}
    if A:
        out.band("מדדים לפי הגדרת החברה, מהמצגות (adjusted.json); לא נתוני דוח")
        for m, s_ in A.items():
            rid = f"adj|{m}"
            out.get(rid, m, s_["l"] + " (הגדרת החברה)", "%" if s_["u"] == "pct" else "₪m", "קבוצה", "")
            for x in s_["pts"]:
                p = x["p"]
                if p not in PCOL:
                    continue
                d = ctx.adj["docs"].get(str(x["rid"]))
                url = ctx.adj["files"] + d[4] if d and d[4] else ctx.pdf(x["rid"])
                out.put(rid, p, x["v"], src("printed", ctx.doc(x["rid"], name), x["rid"], x.get("pg"), url,
                                            "; ".join(y for y in [s_.get("def") or "", "נקרא מתמונה או גרף" if x.get("i") else ""] if y)))
    return out.prune()


# ---------------------------------------------------------------- the workbook
WIDTHS = [26, 46, 7, 26, 8] + [10] * len(PERIODS)
SRC_HEAD = ["Sheet", "Cell", "Key", "Label (he)", "Segment", "Period", "Value", "Unit", "Kind", "Document", "Report id", "Page", "Source link",
            "MAYA report", "Second source", "Note"]
SRC_WIDTHS = [12, 8, 26, 40, 22, 8, 12, 6, 9, 48, 10, 6, 30, 30, 30, 50]
KIND_HE = {"printed": "printed", "derived": "derived", "xbrl": "xbrl", "regulator": "regulator", "calc": "calc", "formula": "formula"}


def pdf_at(url, pg):
    return f"{url}#page={pg}" if url and pg and url.endswith(".pdf") else url


def write_data(book, sheet, co_name, title, note, rows, sources):
    sh = book.sheet(sheet, widths=WIDTHS, freeze=(3, NFIX))
    sh.row([Cell(f"{co_name} · {title}", "title")])
    sh.row([Cell(note, "note")])
    sh.row([Cell(h, "head") for h in ["Key", "שורה", "Unit", "Segment / entity", "Standard"] + [plabel(p) for p in PERIODS]])
    if not rows:
        sh.row([Cell("אין נתונים לחברה זו בשכבה הזו", "note")])
        return sh
    pos = {}
    for i, r in enumerate(rows):
        if "id" in r:
            pos[r["id"]] = 3 + i
    for r in rows:
        if "band" in r:
            sh.row([Cell(r["band"], "band")] + [Cell("", "band") for _ in range(NFIX - 1 + len(PERIODS))])
            continue
        st = UNIT_STYLE.get(r["unit"], "m")
        cells = [Cell(r["key"]), Cell(r["label"]), Cell(r["unit"], "note"), Cell(r["dim"]), Cell(r["std"], "note")]
        line = [None] * len(PERIODS)
        ri = pos[r["id"]]
        for p, c in r["cells"].items():
            ci = NFIX + PCOL[p]
            if c["f"]:
                tpl, refs = c["f"]
                f = tpl.format(*[ref(pos[a], NFIX + PCOL[b]) for a, b in refs])
                line[PCOL[p]] = Cell(c["v"], f"{st}_i", f=f)
            else:
                f = None
                line[PCOL[p]] = Cell(c["v"], f"{st}_i" if c["src"]["kind"] in ("derived", "calc") else st)
            sources.append((sheet, ref(ri, ci), r, p, c, f))
        if r["inst"]:  # a balance: FY = Q4, a formula
            for y in range(FIRST[0], LAST[0] + 1):
                q4, fy = f"{y}Q4", f"{y}FY"
                if q4 in r["cells"] and fy in PCOL and fy not in r["cells"]:
                    c = {"v": r["cells"][q4]["v"], "src": src("formula", "נוסחה בגיליון", note="יתרה: FY = Q4")}
                    f = ref(ri, NFIX + PCOL[q4])
                    line[PCOL[fy]] = Cell(c["v"], f"{st}_i", f=f)
                    sources.append((sheet, ref(ri, NFIX + PCOL[fy]), r, fy, c, f))
        sh.row(cells + line)
    return sh


def write_sources(book, co_name, sources):
    sh = book.sheet("Sources", widths=SRC_WIDTHS, freeze=(3, 2))
    sh.row([Cell(f"{co_name} · Sources: one row per value", "title")])
    sh.row([Cell("Cell: a link to the value · Source link: the PDF at the page (MAYA), the regulator's dataset (data.gov.il) or the MAYA report "
                 "(XBRL) · Kind: printed = as printed on the page; derived = computed by fox from printed figures (both pages); xbrl = the tag "
                 "attached to the report; regulator = the CMA's open data; calc = a fox calculation (formula in Note); formula = a live formula in the sheet", "note")])
    sh.row([Cell(h, "head") for h in SRC_HEAD])
    for sheet, cref, r, p, c, f in sources:
        s = c["src"]
        link = pdf_at(s["url"], s["pg"])
        link2 = pdf_at(s["url2"], s["pg2"])
        note = s["note"] if not f else (s["note"] + (" · " if s["note"] else "") + "=" + f)
        sh.row([sheet, Cell(cref, "link", loc=f"{qsheet(sheet)}!{cref}"), r["key"], r["label"], r["dim"], plabel(p),
                Cell(c["v"], UNIT_STYLE.get(r["unit"], "m")), r["unit"], KIND_HE[s["kind"]], s["doc"], s["rid"],
                s["pg"], Cell(link or "", "link", link=link) if link else "", Cell(MAYA.format(s["rid"]), "link", link=MAYA.format(s["rid"])) if s["rid"] else "",
                Cell(link2, "link", link=link2) if link2 else "", note])
    return sh


NOTES = {
    "P&L": "₪ מיליונים (הדוחות מדפיסים באלפים ÷ 1,000) אלא אם עמודת Unit אומרת אחרת · מאוחד · הנתון שהאתר מציג (הדפסה אחרונה) · נטוי = נגזר · מקור כל ערך: גיליון Sources",
    "Balance sheet": "₪ מיליונים · מאוחד · יתרות לסוף הרבעון; עמודת FY = Q4 (נוסחה) · מקור כל ערך: גיליון Sources",
    "IFRS 17": "₪ מיליונים · גשר CSM, RA, הכנסות ביטוח, עסק חדש, חוזים מכבידים, לפי מגזר ובסיס (ברוטו / נטו / ביטוח משנה) · Q4 נגזר = שנה פחות 9 חודשים · מקור: Sources",
    "Solvency": "% ו-₪ מיליונים · יחס כושר פירעון, הון מוכר, SCR ועודף, לפי תאריך החישוב (העמודה = רבעון התאריך) · מקור: Sources",
    "Savings": "₪ מיליונים ו-% · כפי שהודפס בדוחות החברות המנהלות, ולצדו צירוף נתוני הרשות (גמל-נט, פנסיה-נט, ביטוח-נט) · מקור: Sources",
    "KPIs": "₪ מיליונים, ₪ למניה ו-% · XBRL של הדוח (הנתון המודפס כשהוחלף), מדדי מגזר, מדדים לפי הגדרת החברה (מסומנים) · נוסחאות חיות: Q4 ו-ROE · מקור: Sources",
}


def build(ctx, co):
    name = ctx.reg[co]["name_he"]
    book = Book(f"fox · {name} · model")
    sources = []
    write_data(book, "P&L", name, "רווח והפסד ורווח כולל", NOTES["P&L"], statements(ctx, co, name, ("pl", "oci"), False).rows, sources)
    write_data(book, "Balance sheet", name, "מאזן", NOTES["Balance sheet"], statements(ctx, co, name, ("bs",), True).rows, sources)
    write_data(book, "IFRS 17", name, "IFRS 17", NOTES["IFRS 17"], ifrs17(ctx, co, name).rows, sources)
    write_data(book, "Solvency", name, "כושר פירעון", NOTES["Solvency"], solvency(ctx, co, name).rows, sources)
    write_data(book, "Savings", name, "חיסכון ארוך טווח", NOTES["Savings"], savings(ctx, co, name).rows, sources)
    write_data(book, "KPIs", name, "נתוני מפתח", NOTES["KPIs"], kpis(ctx, co, name).rows, sources)
    write_sources(book, name, sources)
    ab = book.sheet("About", widths=[22, 110])
    for k, v in [("fox", f"{name}: model-ready workbook"), ("Site", f"https://fox-research-il.web.app/company/{co}"),
                 ("Built from", "the published JSON files of fox (web/public/data): facts, series, csm, savings_econ, lens, kpi, adjusted · pipeline/build_model_xlsx.py"),
                 ("Periods", f"{plabel(PERIODS[0])} … {plabel(PERIODS[-1])}, FY after each Q4"), ("Values", len(sources)),
                 ("Units", "₪m unless the Unit column says otherwise; the reports print ₪ thousands, divided here by 1,000"),
                 ("Terms", "Free. Cite fox and the primary source (the filing and page in the Sources sheet). Fundamentals only: no share prices."),
                 ("API", "https://fox-research-il.web.app/data/api")]:
        ab.row([Cell(k, "band"), Cell(v)])
    return book.bytes(), len(sources)


def companies(ctx):
    return [c["id"] for c in ctx.reg.values() if c.get("has_financials") and (DATA / "facts" / f"{c['id']}.json").exists()]


def check():
    ctx = Ctx()
    probs, n_vals, sizes = [], 0, {}
    cos = companies(ctx)
    on_disk = sorted(p.stem for p in OUT.glob("*.xlsx"))
    if on_disk != sorted(cos):
        probs.append(f"files {on_disk} != companies {sorted(cos)}")
    for co in cos:
        f = OUT / f"{co}.xlsx"
        if not f.exists():
            probs.append(f"{co}: missing")
            continue
        data = f.read_bytes()
        sizes[co] = len(data)
        if len(data) > MAX_BYTES:
            probs.append(f"{co}: {len(data)} bytes > {MAX_BYTES}")
        fresh, _ = build(ctx, co)
        if fresh != data:
            probs.append(f"{co}: stale (rebuild differs: run pipeline/build_model_xlsx.py)")
        try:
            wb = read_book(data)
        except Exception as e:  # noqa: BLE001  any parse error is a failure
            probs.append(f"{co}: does not open: {e}")
            continue
        names = [s[0] for s in wb["sheets"]]
        for s in SHEETS:
            if s not in names:
                probs.append(f"{co}: sheet {s} missing")
        sheets = {s[0]: s for s in wb["sheets"]}
        if "Sources" not in sheets:
            continue
        _, scells, slinks = sheets["Sources"]
        covered = {}
        rows = collections.defaultdict(dict)
        for r_, c in scells.items():
            ri, ci = split_ref(r_)
            if ri >= 3:
                rows[ri][ci] = c
        for ri, cs in rows.items():
            loc = slinks.get(ref(ri, 1))
            kind = (cs.get(8) or (None, ""))[1]
            if not loc or loc[0] != "loc":
                probs.append(f"{co}: Sources row {ri + 1} has no cell link")
                continue
            has_link = ref(ri, 12) in slinks and slinks[ref(ri, 12)][0] == "ext"
            if kind == "formula":
                ok = "=" in str((cs.get(15) or (None, ""))[1])
            elif kind == "derived":
                ok = has_link
            elif kind == "printed":
                ok = has_link and (cs.get(11) is not None or not str(slinks[ref(ri, 12)][1]).endswith(".pdf"))
            else:
                ok = has_link
            if not ok:
                probs.append(f"{co}: Sources row {ri + 1} ({kind}) lacks its link, page or formula")
            covered[loc[1]] = kind
        for s in SHEETS[:-1]:
            if s not in sheets:
                continue
            _, cells, _ = sheets[s]
            for r_, c in cells.items():
                ri, ci = split_ref(r_)
                if ri < 3 or ci < 5 or c[0] == "s":
                    continue
                n_vals += 1
                k = f"{qsheet(s)}!{r_}"
                if k not in covered:
                    probs.append(f"{co}: {s}!{r_} has a value and no source")
                elif c[0] == "f" and covered[k] != "formula":
                    probs.append(f"{co}: {s}!{r_} is a formula, its source says {covered[k]}")
    for p in probs[:20]:
        print("  " + p)
    big = max(sizes.items(), key=lambda kv: kv[1]) if sizes else ("-", 0)
    print(f"model_xlsx: {len(cos)} workbooks, {n_vals} value cells, every one sourced; largest {big[0]} {big[1] // 1024} KB; {len(probs)} problems")
    return 1 if probs else 0


def main():
    if "--check" in sys.argv:
        return check()
    ctx = Ctx()
    OUT.mkdir(parents=True, exist_ok=True)
    cos = companies(ctx)
    for old in OUT.glob("*.xlsx"):
        if old.stem not in cos:
            old.unlink()
    tot = 0
    for co in cos:
        data, n = build(ctx, co)
        (OUT / f"{co}.xlsx").write_bytes(data)
        tot += len(data)
        print(f"  {co:10} {n:6} values  {len(data) // 1024:5} KB")
    print(f"xlsx/: {len(cos)} workbooks, {tot // 1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
