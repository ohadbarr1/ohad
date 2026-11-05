"""fox inside Excel (lane P4): stable, versioned long tables under web/public/data/tables/v1/, for Power Query and any other client.

Every row is one figure fox already publishes, with its provenance; nothing is extracted or estimated here. Seven tables:

  kpi        company x period: the Report Day lines (XBRL headline figures as kpi.json carries them, the printed figure where canon_kpi
             replaced the tag; insurance revenue and insurance service result from the statements), segment KPIs (series), company-defined
             KPIs from the decks (adjusted.json). Q4 of a flow = FY - Q1 - Q2 - Q3 (derived, marked).
  ifrs17     company x segment x basis x period: the standardised IFRS 17 lines (series/<id>.json): CSM roll-forward, RA, insurance
             revenue, new business, onerous contracts, finance result; plus the group CSM in the basis the report prints (csm/facts).
  solvency   company x period: the ratio, own funds, SCR and surplus as printed in the statements (csm/capital.json, series) and the
             Solvency II reports' lines, modules and tiers (csm/solvency.json).
  pnc        insurer x line of business x period: the IFRS 17 general-insurance note (pnc.json): printed lines, the derived periods
             (Q1 = H1 - Q2, LTM) and the loss, expense and combined ratios (fox calculations, formula in the note column).
  savings_q  manager x segment x quarter: printed AUM, contributions, fees, expenses, profit (savings_econ.json) and the regulator join
             (lens.json: AUM, organic flow, net transfers, shares, fee yield).
  savings_m  manager group x product x month (from 01/2022): the regulator's monthly files summed per group (market.json): AUM,
             deposits, withdrawals, net transfers, net flow, the asset-weighted management fee and gross return, track count.
  funds_m    track x month, the last 12 months on file, open tracks (funds.json, funds/<k>.json): gross return as published, net return
             (fox estimate: gross less fee / 12), management fee on assets, AUM.

Columns (v1; a column never changes meaning, new columns are only appended): see COLUMNS. Files per table: <t>.csv (UTF-8 with BOM,
CRLF, so Excel reads Hebrew) and <t>.json ({"columns": [...], "rows": [[...]]}). Beside them: manifest.json (tables, row counts,
sha256, last-changed), changes.json (a dated log of rows added / changed / removed per table since the previous build, kept for the
last LOG_KEEP builds that changed anything), changes.csv (the same log as rows), pq/<t>.pq (a ready Power Query M script per table)
and fox_powerquery.xlsx (all queries in one workbook: pipeline/pq_kit.py).

python3 pipeline/build_tables.py           build (the log gains an entry only when a value changed)
python3 pipeline/build_tables.py --check   rebuild in memory: every table equals its file, the manifest's counts and hashes match,
                                           every row carries a source, keys are unique (gate `tables`)
Standard library only; deterministic (sorted rows, math.fsum, fixed zip times in the kit). FOX_TODAY=YYYY-MM-DD overrides the log date.
"""
import csv
import datetime as dt
import hashlib
import io
import json
import math
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_model_xlsx as M  # noqa: E402
import pq_kit  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"
VERSION = "v1"
OUT = DATA / "tables" / VERSION
SITE = "https://fox-research-il.web.app"
BASE = f"{SITE}/data/tables/{VERSION}/"
LOG_KEEP = 40          # builds kept in changes.json
LOG_ROWS = 400         # rows listed per table per build (the counts are always complete)
FUNDS_MONTHS = 12      # funds_m: the last N months on file (the full history: funds/<k>.json)
SAVINGS_FROM = 202201  # savings_m: from this month (the full history: market.json)

COLUMNS = [  # id, type, Hebrew, English
    ("entity_id", "text", "מזהה ישות", "fox id of the company, manager group or track"),
    ("entity_name", "text", "שם הישות", "Hebrew name"),
    ("dim_id", "text", "מזהה חתך", "the slice inside the entity: segment|basis, line of business, product, ... ('group' = the whole entity)"),
    ("dim_label", "text", "חתך", "the slice in Hebrew"),
    ("metric_id", "text", "מזהה מדד", "stable metric id (the same id across companies)"),
    ("metric_label", "text", "מדד", "Hebrew label"),
    ("period", "text", "תקופה (מכונה)", "2026Q2 · 2025FY · 2026H1 · LTM2026Q2 · 2026-09 (month)"),
    ("period_label", "text", "תקופה", "Q2'26 · FY'25 · H1'26 · LTM Q2'26 · 09/26"),
    ("period_end", "date", "סוף התקופה", "YYYY-MM-DD"),
    ("value", "number", "ערך", "the figure, in `unit`"),
    ("unit", "text", "יחידה", "₪m (NIS millions) · % · ₪ · count"),
    ("kind", "text", "סוג", "printed · derived · xbrl · regulator · calc · estimate"),
    ("standard", "text", "תקן", "IFRS 17 / IFRS 4 where the line depends on it"),
    ("source_id", "text", "מזהה מקור", "maya:<report id> or data.gov.il:<dataset>"),
    ("source_page", "integer", "עמוד", "page in the source PDF"),
    ("source_url", "text", "קישור למקור", "the PDF at the page, the MAYA report or the regulator's dataset"),
    ("source_name", "text", "שם המקור", "the document in Hebrew"),
    ("as_of", "date", "נכון ל", "publication date of the source (MAYA) or the date fox read the regulator's file"),
    ("note", "text", "הערה", "derivation, formula, second page, verification status"),
    ("version", "text", "גרסת סכמה", "v1"),
]
COLS = [c[0] for c in COLUMNS]
KEY = ("entity_id", "dim_id", "metric_id", "period")
KI = [COLS.index(k) for k in KEY]
VI = COLS.index("value")

TABLES = [  # id, Hebrew title, English title, grain
    ("kpi", "נתוני מפתח לפי חברה ותקופה", "Headline KPIs by company and period", "company × metric × period (quarter, FY)"),
    ("ifrs17", "IFRS 17: שורות אחידות וגשר CSM", "IFRS 17 standardised lines and CSM roll-forward", "insurer × segment|basis × metric × period"),
    ("solvency", "כושר פירעון", "Solvency (statements and Solvency II reports)", "insurer × source × metric × date"),
    ("pnc", "ביטוח כללי: שורות ויחסים לפי ענף", "P&C lines and ratios by line of business", "insurer × line × metric × period"),
    ("savings_q", "חיסכון ארוך טווח: רבעוני", "Long-term savings, quarterly (reports and regulator join)", "manager × segment × metric × quarter"),
    ("savings_m", "חיסכון ארוך טווח: חודשי לפי קבוצה ומוצר", "Long-term savings, monthly by group and product (regulator)", "group × product × metric × month, from 01/22"),
    ("funds_m", "מסלולים: חודשי", "Tracks, monthly (regulator)", "track × metric × month, last 12 months"),
]
GRAIN_HE = {"kpi": "חברה × מדד × תקופה (רבעון, שנה)", "ifrs17": "מבטחת × מגזר ובסיס × מדד × תקופה", "solvency": "מבטחת × מקור × מדד × תאריך",
            "pnc": "מבטחת × ענף × מדד × תקופה", "savings_q": "מנהל × מגזר × מדד × רבעון", "savings_m": "קבוצה × מוצר × מדד × חודש, מ-01/22",
            "funds_m": "מסלול × מדד × חודש, 12 החודשים האחרונים"}
REG_PKG = {"gemel": "gemelnet", "pensia": "pensia-net", "pension": "pensia-net", "insurance": "insurance"}
REG_HE = {"gemelnet": "גמל-נט", "pensia-net": "פנסיה-נט", "insurance": "ביטוח-נט"}
QE = {1: "03-31", 2: "06-30", 3: "09-30", 4: "12-31"}


# ---------------------------------------------------------------- periods
def pend(p):
    """machine period -> its last day (YYYY-MM-DD)"""
    m = re.fullmatch(r"(?:LTM)?(\d{4})Q(\d)", p)
    if m:
        return f"{m.group(1)}-{QE[int(m.group(2))]}"
    m = re.fullmatch(r"(\d{4})(FY|H1|H2)", p)
    if m:
        return f"{m.group(1)}-{'06-30' if m.group(2) == 'H1' else '12-31'}"
    m = re.fullmatch(r"(\d{4})-(\d{2})", p)
    if m:
        y, mo = int(m.group(1)), int(m.group(2))
        nxt = dt.date(y + mo // 12, mo % 12 + 1, 1)
        return (nxt - dt.timedelta(days=1)).isoformat()
    raise ValueError(p)


def plab(p):
    m = re.fullmatch(r"LTM(\d{4})Q(\d)", p)
    if m:
        return f"LTM Q{m.group(2)}'{m.group(1)[2:]}"
    m = re.fullmatch(r"(\d{4})(H1|H2)", p)
    if m:
        return f"{m.group(2)}'{m.group(1)[2:]}"
    m = re.fullmatch(r"(\d{4})-(\d{2})", p)
    if m:
        return f"{m.group(2)}/{m.group(1)[2:]}"
    return M.plabel(p)


def psort(p):
    """sort key: chronological, a cumulative or annual column after the quarter it ends with"""
    e = pend(p)
    rank = 0 if re.fullmatch(r"\d{4}-\d{2}", p) else 1 if "Q" in p and not p.startswith("LTM") else 2 if "H" in p else 3 if p.endswith("FY") else 4
    return (e, rank, p)


def num(v):
    """a value as stored: a float rounded to 6 decimals (int-valued floats stay floats in JSON, written without .0 in CSV)"""
    return None if v is None else round(float(v), 6)


# ---------------------------------------------------------------- context
class Ctx(M.Ctx):
    def __init__(self):
        super().__init__()
        self.market = M.load("market.json")
        self.fetched = (self.market or {}).get("meta", {}).get("fetched", "")

    def as_of(self, rid):
        d = self.docs.get(rid) if rid else None
        if d and d[4]:
            return d[4]
        rep = (self.solv.get("reports") or {}).get(str(rid)) if rid else None
        return (rep or {}).get("pub", "") or ""

    def name(self, co):
        return (self.reg.get(co) or {}).get("name_he", co)


def row(ctx, co, dim_id, dim_label, metric_id, label, p, v, unit, s, std=""):
    """one table row from a model-builder cell source {kind, doc, rid, pg, url, note, url2, pg2}"""
    kind = {"formula": "derived"}.get(s["kind"], s["kind"])
    note = s.get("note") or ""
    if s.get("url2"):
        note = "; ".join(x for x in [note, f"מקור נוסף: {M.pdf_at(s['url2'], s.get('pg2'))}"] if x)
    url = M.pdf_at(s.get("url"), s.get("pg"))
    rid = s.get("rid")
    if rid:
        sid = f"maya:{rid}"
    elif s.get("url") and "data.gov.il/dataset/" in s["url"]:
        sid = "data.gov.il:" + s["url"].rsplit("/", 1)[-1]
    else:
        sid = ""
    as_of = ctx.as_of(rid) if rid else (ctx.fetched if sid.startswith("data.gov.il") else "")
    return [co, ctx.name(co), dim_id, dim_label, metric_id, label, p, plab(p), pend(p), num(v), unit, kind, std or "", sid,
            s.get("pg") if isinstance(s.get("pg"), int) else None, url or "", s.get("doc") or "", as_of, note, VERSION]


def dim_of(rid):
    """the slice id from the model builder's row id"""
    parts = rid.split("|")
    if parts[0] == "s":
        return f"{parts[2]}|{parts[3]}"
    if parts[0] == "kpi":
        return "xbrl"
    if parts[0] == "adj":
        return "company_def"
    if parts[0] == "cap":
        return "statements"
    if parts[0] == "sol":
        return "solvency_report"
    if parts[0] == "sav":
        return "|".join(x for x in parts[2:] if x) or "group"
    if parts[0] == "lens":
        return f"regulator|{parts[1]}"
    if rid == "csm_resolved":
        return "group|resolved"
    return "group"


def from_rows(ctx, co, rows, skip=()):
    """flatten the model builder's Rows into table rows; a live formula (Q4 = FY - 9M) becomes a derived value recomputed with fsum"""
    out = []
    for r in rows.rows:
        if "band" in r or r["id"] in skip:
            continue
        dim = dim_of(r["id"])
        for p, c in r["cells"].items():
            s, v = c["src"], c["v"]
            if c.get("f"):
                tpl, refs = c["f"]
                if not tpl.startswith("{0}-{1}-{2}-{3}"):
                    continue  # only the Q4 derivation is carried; other formulas (ROE) are the model's job
                vals = [rows.by[a]["cells"][b]["v"] for a, b in refs]
                v = math.fsum([vals[0], -vals[1], -vals[2], -vals[3]])
                src_fy = rows.by[refs[0][0]]["cells"][refs[0][1]]["src"]
                s = dict(src_fy, kind="derived", note="נגזר: Q4 = FY − Q1 − Q2 − Q3 (עמודי שלושת הרבעונים בשורות שלהם)")
            out.append(row(ctx, co, dim, r["dim"], r["key"], r["label"], p, v, r["unit"], s, r.get("std", "")))
    return out


# ---------------------------------------------------------------- the tables
ROLE_IFRS17 = ("insurance_revenue", "insurance_service_result")  # the two Report Day lines that live in the IFRS 17 series


def t_kpi(ctx, cos):
    out = []
    for co in cos:
        name = ctx.name(co)
        out += from_rows(ctx, co, M.kpis(ctx, co, name), skip=("kpi|roe",))
        role = M.series_rows(ctx, co, name, lambda m: m in ROLE_IFRS17)
        out += [r for r in from_rows(ctx, co, role) if r[2].startswith("group|")]
    return out


def t_ifrs17(ctx, cos):
    return [r for co in cos for r in from_rows(ctx, co, M.ifrs17(ctx, co, ctx.name(co)))]


def t_solvency(ctx, cos):
    return [r for co in cos for r in from_rows(ctx, co, M.solvency(ctx, co, ctx.name(co)))]


def t_savings_q(ctx, cos):
    return [r for co in cos for r in from_rows(ctx, co, M.savings(ctx, co, ctx.name(co)))]


PNC_P = {"q": "Q", "h": "H", "fy": "FY"}


def pnc_period(pk, last):
    if pk == "ltm":
        return f"LTM{last}"
    m = re.fullmatch(r"(q|h|fy)(\d)?(\d{2})", pk)
    k, n, yy = m.group(1), m.group(2), m.group(3)
    y = f"20{yy}"
    return f"{y}Q{n}" if k == "q" else f"{y}H{n}" if k == "h" else f"{y}FY"


def t_pnc(ctx):
    F = M.load("pnc.json")
    if not F:
        return []
    m_he = M.dict_of("web/src/lib/pnc.ts", "export const M_HE")
    r_he = M.dict_of("web/src/lib/pnc.ts", "export const R_HE")
    lines = dict(F["meta"]["lines"])
    periods = {p[0]: p for p in F["meta"]["periods"]}
    out = []
    for co, c in F["cos"].items():
        rep = F["reports"][co]
        last = rep["period"]
        url = F["meta"]["files"] + rep["f"]
        doc = f"{c['name']} · דוח רבעוני {M.plabel(last)}, ביאור מגזר ביטוח כללי (IFRS 17)"
        unit_note = "הודפס באלפי ש\"ח, כאן במיליונים" if "thousands" in rep["unit"] else ""
        for ln, L in c["lines"].items():
            lab = lines.get(ln, ln)
            for pk, P in L["per"].items():
                parts = periods[pk][2]
                p = pnc_period(pk, last)
                for m, v in P["x"].items():
                    if len(parts) == 1:  # printed in that window
                        cell = L["base"][parts[0][1]][m]
                        s = M.src("printed", doc, rep["rid"], cell[1], url, "; ".join(x for x in ["שורות הוצאה בסימן חיובי", unit_note] if x))
                    else:  # derived from printed windows
                        pg = sorted({L["base"][w][m][1] for _, w in parts})
                        f = "".join(f"{(' + ' if sg > 0 else ' − ') if i else ('−' if sg < 0 else '')}{periods[w][1]}" for i, (sg, w) in enumerate(parts))
                        s = M.src("derived", doc, rep["rid"], pg[0], url, f"נגזר: {f}" + (f"; עמודים {', '.join(map(str, pg))}" if len(pg) > 1 else ""))
                    out.append(row(ctx, co, ln, lab, m, m_he.get(m, m), p, v, "₪m", s, "IFRS 17"))
                for k, v in P["r"].items():
                    s = M.src("calc", doc, rep["rid"], None, url, f"{F['meta']['defs'][k]} (חישוב fox משורות הביאור; הגדרת החברה עשויה להיות שונה)")
                    out.append(row(ctx, co, ln, lab, f"ratio_{k}", r_he.get(k, k), p, v * 100, "%", s, "IFRS 17"))
    return out


def group_ids(ctx):
    ids = {c["name_he"]: c["id"] for c in ctx.reg.values()}
    for g in (ctx.lens or {}).get("groups", []):
        if g.get("id"):
            ids[g["name"]] = g["id"]
    ids.setdefault("קרנות ענפיות ואחרות", "sectoral_other")
    return ids


SAV_M = [  # id, label, unit, kind
    ("aum", "נכסים מנוהלים לסוף החודש", "₪m", "regulator"),
    ("deposits", "הפקדות בחודש", "₪m", "regulator"),
    ("withdrawals", "משיכות בחודש", "₪m", "regulator"),
    ("transfers_net", "העברות נטו בחודש", "₪m", "regulator"),
    ("net_flow", "צבירה נטו בחודש (הפקדות − משיכות + העברות)", "₪m", "calc"),
    ("fee_rate", "דמי ניהול מהצבירה, ממוצע משוקלל נכסים, שנתי", "%", "calc"),
    ("return_gross", "תשואה חודשית ברוטו, ממוצע משוקלל בנכסי החודש הקודם", "%", "calc"),
    ("tracks", "מספר מסלולים שדיווחו", "count", "regulator"),
]
SAV_NOTE = {"net_flow": "הפקדות − משיכות + העברות נטו, סכום המסלולים שדיווחו תזרים",
            "fee_rate": "Σ(נכסים × דמי ניהול) ÷ Σ נכסים של מסלולי הקבוצה במוצר (AVG_ANNUAL_MANAGEMENT_FEE)",
            "return_gross": "Σ(נכסי החודש הקודם × תשואה חודשית) ÷ Σ נכסי החודש הקודם (MONTHLY_YIELD, לפני דמי ניהול)",
            "deposits": "סכום מסלולי הקבוצה שדיווחו תזרים", "withdrawals": "סכום מסלולי הקבוצה שדיווחו תזרים",
            "transfers_net": "סכום מסלולי הקבוצה שדיווחו תזרים (INTERNAL_TRANSFERS)"}


def t_savings_m(ctx):
    mk = ctx.market
    if not mk:
        return []
    ids = group_ids(ctx)
    C = {c: i for i, c in enumerate(mk["cols"])}
    prods, groups, periods = mk["products"], mk["groups"], mk["periods"]
    fam_pkg = {p["key"]: REG_PKG[p["family"]] for p in prods}
    out = []
    for r in mk["rows"]:
        ym = periods[r[C["p"]]]
        if ym < SAVINGS_FROM:
            continue
        pr, g = prods[r[C["prod"]]], groups[r[C["grp"]]]
        gid = ids.get(g, g)
        pkg = fam_pkg[pr["key"]]
        p = f"{ym // 100}-{ym % 100:02d}"
        flows = r[C["flow_assets"]] > 0
        vals = {"aum": r[C["assets"]], "tracks": r[C["n"]]}
        if flows:
            vals.update(deposits=r[C["dep"]], withdrawals=r[C["wd"]], transfers_net=r[C["tr"]],
                        net_flow=math.fsum([r[C["dep"]], -r[C["wd"]], r[C["tr"]]]))
        if r[C["fee_den"]] > 0:
            vals["fee_rate"] = r[C["fee_num"]] / r[C["fee_den"]]
        if r[C["y_den"]] > 0:
            vals["return_gross"] = r[C["y_num"]] / r[C["y_den"]]
        for key, lab, unit, kind in SAV_M:
            if key not in vals:
                continue
            s = M.src(kind, REG_HE[pkg], None, None, f"https://data.gov.il/dataset/{pkg}", "")
            r_ = row(ctx, gid, pr["key"], pr["label"], key, lab, p, vals[key], unit, s)
            r_[1] = g
            out.append(r_)
    return out


FUND_M = [  # id, file key, label, unit, kind, definition (manifest)
    ("return_gross", "y", "תשואה ברוטו", "%", "regulator", "תשואה חודשית כפי שפורסמה, לפני דמי ניהול (MONTHLY_YIELD)"),
    ("return_net", "yn", "תשואה נטו (אומדן)", "%", "estimate", "אומדן fox: התשואה ברוטו פחות שיעור דמי הניהול מהצבירה ÷ 12; שיעור ממוצע של המסלול, לא של חוסך מסוים"),
    ("fee_rate", "fee", "דמי ניהול מהצבירה", "%", "regulator", "שיעור שנתי ממוצע של המסלול (AVG_ANNUAL_MANAGEMENT_FEE)"),
    ("aum", "a", "נכסים", "₪m", "regulator", "נכסי המסלול לסוף החודש (TOTAL_ASSETS)"),
]


DEFS = {"savings_m": dict(SAV_NOTE, aum="סכום נכסי מסלולי הקבוצה במוצר לסוף החודש (TOTAL_ASSETS)", tracks="מספר המסלולים שדיווחו נכסים בחודש"),
        "funds_m": {x[0]: x[5] for x in FUND_M}, "savings_q": dict(M.LENS_NOTE)}


def t_funds_m(ctx):
    F = M.load("funds.json")
    if not F:
        return []
    ids = group_ids(ctx)
    asof = F["asof"]
    y, m = divmod(asof, 100)
    first = (y * 12 + m - 1) - (FUNDS_MONTHS - 1)
    first = (first // 12) * 100 + first % 12 + 1
    out = []
    for f in F["funds"]:
        d = M.load(f"funds/{f['k']}.json")
        if not d:
            continue
        pkg = REG_PKG[f["fam"]]
        gid = ids.get(f["grp"], f["grp"])
        dim_id = f"{gid}|{f['fam']}"
        dim_lab = f"{f['grp']} · {f['prod']} · {f['track']}"
        for i, ym in enumerate(d["p"]):
            if ym < first or ym > asof:
                continue
            p = f"{ym // 100}-{ym % 100:02d}"
            for key, fk, lab, unit, kind, note in FUND_M:
                arr = d.get(fk)
                if not arr or i >= len(arr) or arr[i] is None:
                    continue
                s = M.src(kind, REG_HE[pkg], None, None, f"https://data.gov.il/dataset/{pkg}", "")
                r_ = row(ctx, f["k"], dim_id, dim_lab, key, lab, p, arr[i], unit, s)
                r_[1] = f["name"]
                out.append(r_)
    return out


def companies(ctx):
    """every company with a fact table (the model workbooks' list) and every company kpi.json carries"""
    cos = set(M.companies(ctx)) | {c for c in ctx.kpi["companies"] if c in ctx.reg}
    return sorted(cos)


def last_quarter(ctx):
    ps = [p for c in ctx.kpi["companies"].values() for p in c["periods"]]
    q = max(p if "Q" in p else f"{p[:4]}Q4" for p in ps)
    return int(q[:4]), int(q[5])


def build_all():
    ctx = Ctx()
    M.set_periods((2018, 1), last_quarter(ctx))
    cos = companies(ctx)
    fins = M.companies(ctx)
    T = {
        "kpi": t_kpi(ctx, cos),
        "ifrs17": t_ifrs17(ctx, fins),
        "solvency": t_solvency(ctx, fins),
        "pnc": t_pnc(ctx),
        "savings_q": t_savings_q(ctx, fins),
        "savings_m": t_savings_m(ctx),
        "funds_m": t_funds_m(ctx),
    }
    for t, rows in T.items():
        rows.sort(key=lambda r: (r[0], r[2], r[4], psort(r[6])))
    return T


# ---------------------------------------------------------------- files
def csv_bytes(rows, cols=COLS):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(cols)
    for r in rows:
        w.writerow(["" if x is None else (fmt_num(x) if isinstance(x, float) else x) for x in r])
    return ("﻿" + buf.getvalue()).encode("utf-8")


def fmt_num(x):
    return str(int(x)) if x.is_integer() and abs(x) < 1e15 else repr(x)


def json_bytes(t, rows):
    doc = {"v": 1, "table": t, "version": VERSION, "columns": COLS, "rows": rows}
    return (json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def sha(b):
    return hashlib.sha256(b).hexdigest()


def keyed(rows):
    return {tuple(r[i] for i in KI): r for r in rows}


def problems(T):
    probs = []
    for t, rows in T.items():
        if len(keyed(rows)) != len(rows):
            probs.append(f"{t}: duplicate keys ({len(rows) - len(keyed(rows))})")
        for r in rows:
            if len(r) != len(COLS):
                probs.append(f"{t}: a row with {len(r)} columns")
                break
            if r[VI] is None or not isinstance(r[VI], float) or r[VI] != r[VI]:
                probs.append(f"{t}: {r[:7]} has no number")
                break
            if not r[COLS.index("source_url")] or not r[COLS.index("source_name")]:
                probs.append(f"{t}: {r[:7]} has no source")
                break
            if r[COLS.index("kind")] == "printed" and "#page=" not in r[COLS.index("source_url")] and not r[COLS.index("source_url")].endswith(".pdf"):
                probs.append(f"{t}: {r[:7]} printed without its PDF")
                break
    return probs


def diff(old_rows, new_rows):
    """rows added / changed (value) / removed, by key"""
    a, b = keyed(old_rows), keyed(new_rows)
    added = [k for k in b if k not in a]
    removed = [k for k in a if k not in b]
    changed = [k for k in b if k in a and a[k][VI] != b[k][VI]]
    return a, b, added, changed, removed


def today():
    return os.environ.get("FOX_TODAY") or dt.date.today().isoformat()


def log_entry(t, old_rows, new_rows):
    a, b, added, changed, removed = diff(old_rows, new_rows)
    if not (added or changed or removed):
        return None
    listed = []
    for kind, keys, src in (("changed", changed, b), ("added", added, b), ("removed", removed, a)):
        for k in sorted(keys, key=lambda k: (k[0], k[1], k[2], psort(k[3])))[: max(0, LOG_ROWS - len(listed))]:
            r = src[k]
            listed.append([kind, r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], a[k][VI] if k in a else None, b[k][VI] if k in b else None, r[10]])
    return {"added": len(added), "changed": len(changed), "removed": len(removed), "listed": len(listed), "rows": listed}


LOG_COLS = ["change", "entity_id", "entity_name", "dim_id", "dim_label", "metric_id", "metric_label", "period", "period_label", "old_value", "new_value", "unit"]
CH_COLS = ["build_date", "table"] + LOG_COLS


def read_json(p):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def render(T, prev_log, prev_manifest, first_build):
    """every output file as {relative path: bytes}; the log gains an entry when a table's values changed since the files on disk"""
    files, entry = {}, {}
    for t, rows in T.items():
        files[f"{t}.csv"] = csv_bytes(rows)
        files[f"{t}.json"] = json_bytes(t, rows)
    day = today()
    log = list((prev_log or {}).get("builds", []))
    for t, rows in T.items():
        old = read_json(OUT / f"{t}.json")
        if old is None:
            if not first_build:
                entry[t] = {"added": len(rows), "changed": 0, "removed": 0, "listed": 0, "rows": [], "new_table": True}
            continue
        e = log_entry(t, [list(r) for r in old["rows"]], rows)
        if e:
            entry[t] = e
    if first_build:
        log = [{"date": day, "kind": "initial", "tables": {t: {"added": len(rows), "changed": 0, "removed": 0, "listed": 0, "rows": []} for t, rows in T.items()}}]
    elif entry:
        log.insert(0, {"date": day, "kind": "update", "tables": entry})
    log = log[:LOG_KEEP]
    changed_on = {}
    for b in reversed(log):
        for t in b["tables"]:
            changed_on[t] = b["date"]
    prev_tables = {x["id"]: x for x in (prev_manifest or {}).get("tables", [])}
    files["changes.json"] = (json.dumps({"v": 1, "version": VERSION, "columns": LOG_COLS, "keep": LOG_KEEP, "rows_per_table": LOG_ROWS, "builds": log},
                                        ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    ch_rows = [[b["date"], t] + r for b in log for t, e in sorted(b["tables"].items()) for r in e["rows"]]
    files["changes.csv"] = csv_bytes(ch_rows, CH_COLS)
    tabs = []
    for t, he, en, grain in TABLES:
        rows = T[t]
        ps = sorted({r[6] for r in rows}, key=psort)
        mets = {}
        for r in rows:
            x = mets.setdefault(r[4], {"id": r[4], "he": r[5], "unit": r[10], "kinds": set()})
            x["kinds"].add(r[11])
        dd = DEFS.get(t, {})
        metrics = [dict(x, kinds=sorted(x["kinds"]), **({"def": dd[x["id"]]} if x["id"] in dd else {})) for _, x in sorted(mets.items())]
        tabs.append({"id": t, "he": he, "en": en, "grain": grain, "grain_he": GRAIN_HE[t], "rows": len(rows), "entities": len({r[0] for r in rows}),
                     "metrics": len({r[4] for r in rows}), "first": ps[0] if ps else None, "last": ps[-1] if ps else None,
                     "first_label": plab(ps[0]) if ps else None, "last_label": plab(ps[-1]) if ps else None,
                     "changed": changed_on.get(t) or (prev_tables.get(t) or {}).get("changed") or day,
                     "csv": f"{t}.csv", "json": f"{t}.json", "pq": f"pq/{t}.pq", "csv_bytes": len(files[f"{t}.csv"]), "json_bytes": len(files[f"{t}.json"]),
                     "csv_sha256": sha(files[f"{t}.csv"]), "json_sha256": sha(files[f"{t}.json"]), "metrics": metrics})
    for t, he, en, _ in TABLES + [("changes", "חדש מאז ההורדה הקודמת", "What changed since the previous build", "")]:
        cols = CH_COLS if t == "changes" else COLS
        files[f"pq/{t}.pq"] = pq_kit.m_script(t, he, en, BASE, cols, [c[0] for c in COLUMNS if c[1] in ("number", "integer", "date")] if t != "changes" else
                                              ["old_value", "new_value", "build_date"]).encode("utf-8")
    kit = pq_kit.workbook(BASE, TABLES, COLUMNS, CH_COLS, tabs, log[0]["date"] if log else day)
    files["fox_powerquery.xlsx"] = kit
    man = {"v": 1, "version": VERSION, "site": SITE, "base": BASE, "built": max([x["changed"] for x in tabs] + [log[0]["date"] if log else day]),
           "promise": "v1: a column never changes meaning, a metric id never changes meaning or unit; new columns are appended at the end, new tables and metrics are added; a breaking change opens v2 beside v1.",
           "columns": [{"id": c[0], "type": c[1], "he": c[2], "en": c[3]} for c in COLUMNS], "tables": tabs,
           "changes": {"json": "changes.json", "csv": "changes.csv", "pq": "pq/changes.pq", "builds": len(log), "last": log[0]["date"] if log else None},
           "kit": {"xlsx": "fox_powerquery.xlsx", "bytes": len(kit), "sha256": sha(kit)}}
    files["manifest.json"] = (json.dumps(man, ensure_ascii=False, indent=1) + "\n").encode("utf-8")
    return files


def check():
    T = build_all()
    probs = problems(T)
    man = read_json(OUT / "manifest.json")
    if not man:
        probs.append("manifest.json missing")
    else:
        for x in man["tables"]:
            rows = T.get(x["id"])
            if rows is None:
                probs.append(f"{x['id']}: in the manifest, not built")
                continue
            for ext in ("csv", "json"):
                f = OUT / x[ext]
                b = f.read_bytes() if f.exists() else b""
                fresh = csv_bytes(rows) if ext == "csv" else json_bytes(x["id"], rows)
                if b != fresh:
                    probs.append(f"{x[ext]}: stale (rebuild differs: python3 pipeline/build_tables.py)")
                elif sha(b) != x[f"{ext}_sha256"] or x["rows"] != len(rows):
                    probs.append(f"{x[ext]}: manifest count or sha256 does not match the file")
        missing = {t for t, *_ in TABLES} - {x["id"] for x in man["tables"]}
        if missing:
            probs.append(f"tables missing from the manifest: {sorted(missing)}")
        k = OUT / man["kit"]["xlsx"]
        if not k.exists() or sha(k.read_bytes()) != man["kit"]["sha256"]:
            probs.append("fox_powerquery.xlsx missing or not the manifest's")
        else:
            probs += [f"kit: {p}" for p in pq_kit.verify(k.read_bytes(), [t for t, *_ in TABLES] + ["changes"])]
    lg = read_json(OUT / "changes.json")
    if not lg or not isinstance(lg.get("builds"), list) or not lg["builds"]:
        probs.append("changes.json missing or empty")
    for p in probs[:20]:
        print("  " + p)
    n = sum(len(r) for r in T.values())
    print(f"tables: {len(T)} tables, {n} rows, every row sourced; {len(probs)} problems")
    return 1 if probs else 0


def main():
    if "--check" in sys.argv:
        return check()
    T = build_all()
    probs = problems(T)
    if probs:
        for p in probs[:20]:
            print("  " + p)
        return 1
    prev_log, prev_man = read_json(OUT / "changes.json"), read_json(OUT / "manifest.json")
    files = render(T, prev_log, prev_man, first_build=prev_man is None)
    (OUT / "pq").mkdir(parents=True, exist_ok=True)
    keep = set(files)
    for f in sorted(OUT.rglob("*")):
        if f.is_file() and f.relative_to(OUT).as_posix() not in keep:
            f.unlink()
    for rel, b in sorted(files.items()):
        p = OUT / rel
        if not p.exists() or p.read_bytes() != b:
            p.write_bytes(b)
    tot = sum(len(b) for b in files.values())
    for t, *_ in TABLES:
        print(f"  {t:10} {len(T[t]):7} rows  csv {len(files[t + '.csv']) // 1024:6} KB  json {len(files[t + '.json']) // 1024:6} KB")
    print(f"tables/{VERSION}: {len(T)} tables, {sum(len(r) for r in T.values())} rows, {len(files)} files, {tot // 1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
