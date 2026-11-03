"""The standardised IFRS 17 layer: one grid of metrics x quarters x segments x portfolios for the seven listed insurers.

python3 pipeline/build_ifrs_std.py           -> web/public/data/ifrs17/industry.json (industry summary) + ifrs17/<company>.json
python3 pipeline/build_ifrs_std.py --check   rebuild in memory and compare with the files (exit 1 on a difference or an unexplained break)

Source: data/extracted_ifrs_std/<company>/<period>.json (EXTRACT_SPEC.md v10): the Capital Market Authority's note "by main portfolio
groups" that every insurer prints in each report from 2025 (results and balances per portfolio), the CSM / RA / loss-component movement
tables and the expected CSM release table. Each figure was checked against its page (pipeline/verify_ifrs_std.py) when extracted.

Rules (nothing estimated):
- Values are converted to NIS millions from the printed unit; each cell keeps the report id and page it was printed on.
- A quarter is the printed three-month column; where only cumulative columns exist the quarter is the difference of two printed
  cumulative figures (flag 1, both inputs listed). Q4 = year less nine months, always derived.
- When several reports print the same cell, the period's own report wins, then the newest report that reprints it; a different reprint
  is flagged restated (2) with the other value kept.
- Signs: revenue and expenses are stored as printed magnitudes (expenses as a positive cost) where the table's own identity
  revenue - expenses = result before reinsurance fixes the sign; the reinsurance result is stored as its contribution to the insurance
  service result (flag 8 when the printed sign was turned to satisfy result before reinsurance + reinsurance = result).
- No insurer prints a split by measurement model (VFA vs GMM): the notes separate PAA from GMM/VFA combined. The "VFA" view is the
  filers' own mapping (accounting-policy note: policies with a yield-dependent savings component are measured under VFA), shown as such.
- Every metric x segment x quarter that is not printed is an explicit null with the reason.
- The CSM roll-forward identity (opening + movements = closing) is checked for every printed roll-forward; every break is listed.
"""
import json
import re
import sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from bridge import solve  # noqa: E402

SRC = ROOT / "data" / "extracted_ifrs_std"
DATA = ROOT / "web" / "public" / "data"
OUTD = DATA / "ifrs17"
OUT1 = OUTD / "industry.json"
FILES = "https://mayafiles.tase.co.il/"
INSURERS = ["phoenix", "harel", "migdal", "clal", "menora", "ayalon", "hachshara"]
QUARTERS = [f"{y}Q{q}" for y in (2024, 2025, 2026) for q in (1, 2, 3, 4)][:10]  # 2024Q1 .. 2026Q2
SEGS = ["life", "health", "pc"]
SEG_HE = {"life": "חיים וחיסכון", "health": "בריאות", "pc": "כללי", "lh": "חיים ובריאות", "group": "סך שלושת המגזרים", "life_health_risk": "סיכוני חיים ובריאות"}

# standard metrics: id -> (Hebrew label, kind, extraction names)
METRICS = {
    "insurance_revenue": ("הכנסות משירותי ביטוח", "flow"),
    "insurance_service_expenses": ("הוצאות משירותי ביטוח", "flow"),
    "isr_before_reinsurance": ("תוצאת שירותי ביטוח לפני ביטוח משנה", "flow"),
    "reinsurance_result": ("תוצאת ביטוח משנה", "flow"),
    "insurance_service_result": ("תוצאת שירותי ביטוח", "flow"),
    "losses_onerous": ("הפסדים בגין חוזים מכבידים", "flow"),
    "csm": ("CSM (ברוטו, חוזים שהונפקו)", "stock"),
    "ra": ("RA (ברוטו)", "stock"),
    "be": ("אומדן ערך נוכחי של תזרימים (BE)", "stock"),
    "lrc_excl_lc": ("LRC למעט רכיב הפסד", "stock"),
    "loss_component": ("רכיב הפסד (LC)", "stock"),
    "lic": ("LIC", "stock"),
}
FLOWS = [m for m, (_, k) in METRICS.items() if k == "flow"]
STOCKS = [m for m, (_, k) in METRICS.items() if k == "stock"]
RF_ROWS = ["csm_opening", "csm_new_business", "csm_interest_accretion", "csm_changes_in_estimates", "csm_release", "csm_other", "csm_closing"]
RF_HE = {"csm_opening": "יתרת פתיחה", "csm_new_business": "עסק חדש", "csm_interest_accretion": "צבירת ריבית", "csm_changes_in_estimates": "שינויים באומדנים",
         "csm_release": "שחרור לרווח", "csm_other": "אחר (כפי שהודפס)", "csm_closing": "יתרת סגירה"}
STD_BUCKETS = [("1", "עד שנה", (0, 1)), ("2-5", "1–5 שנים", (1, 5)), ("5-10", "5–10 שנים", (5, 10)), ("10+", "מעל 10 שנים", (10, 99))]


def port_std(seg, p):
    """The regulator's portfolio groups under one code across filers (the printed name is kept beside it)."""
    p = (p or "total").strip()
    if p in ("total",):
        return "total"
    if "שאינו תלוי תשואה" in p:
        return "life_nonyield"
    if "תלוי תשואה" in p:
        return "life_yield"
    if re.search(r"ללא (רכיב|מרכיב) (חיסכון|חסכון)", p):
        return "life_risk"
    if "סיכוני חיים" in p:
        return "life_risk"
    if "סיעוד" in p:
        return "ltc_ind" if "פרט" in p else "ltc_grp" if "קבוצ" in p else None
    if "רפואיות" in p:
        return "med_ind" if "פרט" in p else "med_grp" if "קבוצ" in p else None
    if "רכב חובה" in p:
        return "motor_comp"
    if "רכב רכוש" in p:
        return "motor_prop"
    if re.search(r"(^|[\s:\-])אחר$", p):
        return "health_other" if seg in ("health", "life_health_risk") or "בריאות" in p else "pc_other" if seg == "pc" else "health_other"
    return None


PORT_HE = {"life_risk": "ללא רכיב חיסכון (ריסק)", "life_nonyield": "חיסכון שאינו תלוי תשואה", "life_yield": "חיסכון תלוי תשואה",
           "ltc_ind": "סיעודי פרט", "ltc_grp": "סיעודי קבוצתי", "med_ind": "הוצאות רפואיות ונכויות פרט", "med_grp": "הוצאות רפואיות ונכויות קבוצתי",
           "health_other": "בריאות אחר", "motor_comp": "רכב חובה", "motor_prop": "רכב רכוש", "pc_other": "כללי אחר", "total": "סך המגזר"}
PORT_SEG = {"life_risk": "life", "life_nonyield": "life", "life_yield": "life", "ltc_ind": "health", "ltc_grp": "health", "med_ind": "health",
            "med_grp": "health", "health_other": "health", "motor_comp": "pc", "motor_prop": "pc", "pc_other": "pc"}
UNIT = {"NIS millions": 1.0, "NIS thousands": 0.001, "NIS billions": 1000.0}


def qend(k):
    y, q = int(k[:4]), int(k[-1])
    return f"{y}-{['03-31', '06-30', '09-30', '12-31'][q - 1]}"


def qkey(d):
    m = {"03-31": 1, "06-30": 2, "09-30": 3, "12-31": 4}.get(d[5:10])
    return f"{d[:4]}Q{m}" if m else None


def prevq(k):
    y, q = int(k[:4]), int(k[-1])
    return f"{y - 1}Q4" if q == 1 else f"{y}Q{q - 1}"


def opening_date(d):
    y, m, dd = (int(x) for x in d[:10].split("-"))
    return str(date(y, m, dd) - timedelta(days=1)) if dd == 1 else d[:10]


def window_start(d, w):
    y, m = int(d[:4]), int(d[5:7])
    if w == "q":
        return str(date(y, m - 2, 1) - timedelta(days=1))
    return str(date(y, 1, 1) - timedelta(days=1))


def pkey(p):
    return (int(p[:4]), {"Q1": 1, "Q2": 2, "Q3": 3, "FY": 4}[p[4:]])


def own_period(d):
    k = qkey(d)
    return None if not k else k[:4] + ("FY" if k.endswith("Q4") else k[4:])


def rid_of(x, d):
    m = re.search(r"(\d{6,8})", str(x.get("doc") or ""))
    return int(m.group(1)) if m else int(d.get("report_id_he") or 0)


def load():
    """Every fact of every insurer, normalised: c, rp, m, seg, port, ph (printed portfolio), b, w, d, v (NIS m), pg, r, l, src, ..."""
    rows, nf = [], defaultdict(list)
    for c in INSURERS:
        for f in sorted((SRC / c).glob("*.json")):
            d = json.loads(f.read_text(encoding="utf-8"))
            rp = f.stem
            for x in d.get("not_found", []):
                nf[(c, rp)].append(x)
            fu = UNIT.get(d.get("unit"), 1.0)
            for x in d["facts"]:
                ent = x.get("entity")
                if ent and ent not in ("מאוחד", "הקבוצה"):
                    continue  # Ayalon prints the insurer and its subsidiary beside the consolidated column: the consolidated one only
                seg = x.get("segment") or ""
                if seg.startswith("pc:"):
                    continue
                v = x.get("value")
                u = UNIT.get(x.get("unit"), fu) if x.get("unit") not in ("percent",) else None
                row = {"c": c, "rp": rp, "m": x["metric"], "seg": seg, "ph": x.get("portfolio") or "total", "b": x.get("basis") or "na",
                       "w": x.get("window"), "d": (x.get("date") or "")[:10], "pg": x.get("page_he"), "r": rid_of(x, d),
                       "l": " ".join(str(x.get("label") or "").split())[:90], "src": x.get("source") or "table"}
                if x.get("table"):
                    row["tb"] = x["table"]
                for k in ("model", "bucket", "transition", "note"):
                    if x.get(k):
                        row[k] = x[k] if k != "note" else " ".join(str(x[k]).split())[:200]
                row["v"] = None if v is None or u is None else round(float(v) * u, 4)
                row["port"] = port_std(seg, row["ph"])
                # Ayalon prints its life portfolios against the "ביטוח חיים" column of table 5ב.3 (insurance contracts only)
                if c == "ayalon" and seg == "life" and row["ph"] == "ביטוח חיים":
                    row["port"] = "total"
                elif c == "ayalon" and seg == "life" and row["ph"] == "total" and x.get("table") != "B3" and x["metric"] in METRICS:
                    row["port"] = "total_segment"
                # Menora: the product table's columns (life insurance / investment contracts / pension / gemel) are not portfolios
                if c == "menora" and row["ph"] in ("סה\"כ מגזר", "ביטוח חיים", "חוזי ביטוח", "חוזי השקעה", "פנסיה", "גמל"):
                    row["port"] = "product:" + row["ph"]
                rows.append(row)
    return rows, nf


def pick(cands, k):
    """One print of a cell: the period's own report first, then the newest reprint; restated when another report differs."""
    own = own_period(qend(k)) if k else None
    cands = sorted(cands, key=lambda r: (r["rp"] != own, tuple(-x for x in pkey(r["rp"])), r["src"] != "table", r["pg"] or 0))
    best = cands[0]
    alt = next((r for r in cands[1:] if r["v"] is not None and best["v"] is not None and abs(r["v"] - best["v"]) > 0.5 and r["rp"] != best["rp"]), None)
    return best, alt


def cell(r, flags=0, alt=None):
    out = [round(r["v"], 3), r["pg"], r["r"]]
    if r["src"] in ("chart", "text"):
        flags |= 4
    if alt:
        flags |= 2
    if flags:
        out.append(flags)
    if alt:
        out.append([round(alt["v"], 3), alt["pg"], alt["r"]])
    return out


def series(rows, c, seg, port, m, sgn=None):
    """Quarterly series of one metric: {quarter: cell}. Flows: the printed quarter, else the difference of two cumulative prints."""
    F = [r for r in rows if r["c"] == c and r["seg"] == seg and r["port"] == port and r["m"] == m and r["v"] is not None and r["b"] in ("na", "gross")
         and not r.get("transition") and not r.get("bucket")]
    by = defaultdict(list)
    for r in F:
        by[(r["w"], r["d"])].append(r)
    out = {}
    val = (lambda r: r["v"] * (sgn(r) if sgn else 1))
    for k in QUARTERS:
        e = qend(k)
        if METRICS[m][1] == "stock":
            if by.get(("instant", e)):
                b, a = pick(by[("instant", e)], k)
                out[k] = cell(b, alt=a)
            continue
        q = k[-1]
        hit = by.get(("q", e)) or (by.get(("ytd", e)) if q == "1" else None) or (by.get(("fy", e)) if False else None)
        if hit:
            b, a = pick(hit, k)
            out[k] = cell({**b, "v": val(b)}, alt=a and {**a, "v": val(a)})
            continue
        cum = by.get(("fy", e)) if q == "4" else by.get(("ytd", e))
        pe = qend(prevq(k))
        prev = by.get(("ytd", pe)) or (by.get(("q", pe)) if prevq(k).endswith("Q1") else None)
        if cum and prev and q != "1":
            b1, _ = pick(cum, k)
            b0, _ = pick(prev, prevq(k))
            out[k] = [round(val(b1) - val(b0), 3), None, None, 1, [[1, round(val(b1), 3), b1["pg"], b1["r"]], [-1, round(val(b0), 3), b0["pg"], b0["r"]]]]
    return out


def sign_rules(rows):
    """Per company and report: the sign that makes the table's own identities hold, for expenses and the reinsurance result."""
    by = defaultdict(dict)
    for r in rows:
        if r["m"] in ("insurance_revenue", "insurance_service_expenses", "isr_before_reinsurance", "reinsurance_result", "insurance_service_result") and r["v"] is not None:
            by[(r["c"], r["rp"], r["seg"], r["ph"], r["w"], r["d"], r["b"])][r["m"]] = r["v"]
    votes = defaultdict(lambda: defaultdict(int))
    for (c, rp, *_), m in by.items():
        if {"insurance_revenue", "insurance_service_expenses", "isr_before_reinsurance"} <= set(m):
            rv, ex, ib = m["insurance_revenue"], m["insurance_service_expenses"], m["isr_before_reinsurance"]
            if abs(rv - ex - ib) <= 2 and abs(rv + ex - ib) > 2:
                votes[(c, rp, "exp")][1] += 1
            elif abs(rv + ex - ib) <= 2 and abs(rv - ex - ib) > 2:
                votes[(c, rp, "exp")][-1] += 1
        if {"isr_before_reinsurance", "reinsurance_result", "insurance_service_result"} <= set(m):
            ib, rr, isr = m["isr_before_reinsurance"], m["reinsurance_result"], m["insurance_service_result"]
            if abs(ib + rr - isr) <= 2 and abs(ib - rr - isr) > 2:
                votes[(c, rp, "re")][1] += 1
            elif abs(ib - rr - isr) <= 2 and abs(ib + rr - isr) > 2:
                votes[(c, rp, "re")][-1] += 1
    rule = {}
    for k, v in votes.items():
        rule[k] = 1 if v[1] >= v[-1] else -1
    return rule


def rollforwards(rows):
    """Every printed CSM roll-forward: (company, report, segment, portfolio, basis, window, end date) with its identity check."""
    out = []
    mv = defaultdict(list)
    for r in rows:
        if not r["m"].startswith("csm_") or r["v"] is None or r.get("transition") or r.get("bucket") or r["m"].startswith(("csm_subtotal", "csm_expected")):
            continue
        if r["seg"] in ("investment_contracts", "group_incl_investment_contracts"):
            continue
        mv[(r["c"], r["rp"], r["seg"], r["b"])].append(r)
    for (c, rp, seg, b), F in mv.items():
        closes = [r for r in F if r["m"] == "csm_closing" and r["port"] == "total"]
        for cl in closes:
            for w in ("q", "ytd", "fy"):
                start = window_start(cl["d"], w)
                op = [r for r in F if r["m"] == "csm_opening" and r["port"] == "total" and opening_date(r["d"]) == start
                      and r["w"] in ("instant", w, None, "na") and (r["w"] == "instant" or r["d"] == cl["d"] or opening_date(r["d"]) == start)]
                moves = [r for r in F if r["w"] == w and r["d"] == cl["d"] and r["m"] not in ("csm_opening", "csm_closing")]
                if not op or not moves:
                    continue
                tot = [r for r in moves if r["port"] == "total"]
                have = {r["m"] for r in tot}
                # a movement printed only by sub-portfolio (release of growth products and of the run-off book) enters by its parts
                subs = [r for r in moves if r["port"] != "total" and r["m"] not in have]
                use = tot + subs
                if w == "q" and cl["d"][5:10] == "03-31":
                    pass
                o = sorted(op, key=lambda r: r["src"] != "table")[0]
                signs, how = solve(o["v"], cl["v"], [r["v"] for r in use], tol=max(2.0 * max(1, len(use)) * 0.5, abs(cl["v"]) * 0.0005))
                diff = round(cl["v"] - o["v"] - sum(r["v"] for r in use), 3)
                k = qkey(cl["d"])
                rf = {"c": c, "rp": rp, "seg": seg, "b": b, "w": w, "d": cl["d"], "k": k, "how": how or "breaks", "ok": bool(signs), "diff": diff,
                      "open": [round(o["v"], 3), o["pg"], o["r"]], "close": [round(cl["v"], 3), cl["pg"], cl["r"]],
                      "rows": [[r["m"] if not r["m"].startswith("csm_other") else "csm_other", r["l"] or r["m"], round(r["v"] * (sg if signs else 1), 3), r["pg"], r["r"],
                                (4 if r["src"] in ("chart", "text") else 0) | (8 if signs and sg == -1 else 0), r["ph"] if r["port"] != "total" else None]
                               for r, sg in zip(use, signs or [1] * len(use))]}
                if any(r["src"] == "chart" for r in [o, cl, *use]):
                    rf["chart"] = 1
                ms = {r["m"] for r in use}
                if not ({"csm_new_business", "csm_release"} <= ms and len(use) >= 3):
                    rf["how"], rf["ok"], rf["partial"] = "partial", False, 1  # one or two rows of a chart: not a roll-forward to test
                out.append(rf)
    # one roll-forward per (company, report, segment, basis, window, date): a table over a chart
    seen, uniq = set(), []
    for rf in sorted(out, key=lambda r: (r.get("chart", 0), not r["ok"])):
        key = (rf["c"], rf["rp"], rf["seg"], rf["b"], rf["w"], rf["d"])
        if key not in seen:
            seen.add(key)
            uniq.append(rf)
    return sorted(uniq, key=lambda r: (r["c"], r["d"], r["w"], r["seg"], r["b"], r["rp"]))


def runoff(rows):
    out = {}
    for c in INSURERS:
        F = [r for r in rows if r["c"] == c and r["m"] == "csm_expected_release" and r["v"] is not None and r["rp"] == "2025FY" and r["d"] == "2025-12-31"]
        tabs = defaultdict(list)
        for r in F:
            tabs[(r["seg"], r["b"])].append(r)
        def years(bk):
            t = (bk or "").replace("–", "-")
            if re.search(r"עד שנה|up to 1|^1$|first year", t, re.I):
                return (0, 1)
            m = re.search(r"(\d+)\s*-\s*(\d+)", t)
            if m and int(m.group(1)) < 100:
                return (int(m.group(1)), int(m.group(2)))
            m = re.search(r"(?:מעל|over|above)\s*(\d+)", t, re.I)
            if m and int(m.group(1)) < 100:
                return (int(m.group(1)), 99)
            return None
        res = {}
        for (seg, b), T in tabs.items():
            if seg not in ("group", "life", "health", "life_health"):
                continue
            pr = [(years(r["bucket"]), r) for r in T]
            pr = [(y, r) for y, r in pr if y]
            if len(pr) < 3:
                continue
            pr.sort(key=lambda t: t[0])
            printed = [[r["bucket"], round(r["v"], 3), r["pg"], r["r"], list(y)] for y, r in pr]
            std = []
            for sid, he, (lo, hi) in STD_BUCKETS:
                parts = [(y, r) for y, r in pr if y[0] >= lo and y[1] <= hi]
                straddle = [(y, r) for y, r in pr if y[0] < hi and y[1] > lo and not (y[0] >= lo and y[1] <= hi)]
                if straddle or not parts:
                    std.append([sid, he, None, "המדרגות שהודפסו אינן מתחלקות לטווח הזה" if straddle else "לא הודפס"])
                elif len(parts) == 1:
                    std.append([sid, he, round(parts[0][1]["v"], 3), parts[0][1]["pg"], parts[0][1]["r"]])
                else:
                    std.append([sid, he, round(sum(r["v"] for _, r in parts), 3), None, None, 1, [[r["bucket"], round(r["v"], 3), r["pg"], r["r"]] for _, r in parts]])
            res[f"{seg}|{b}"] = {"seg": seg, "b": b, "asof": "2025-12-31", "printed": printed, "std": std}
        out[c] = res
    return out


def models(rows):
    out = defaultdict(list)
    seen = set()
    for r in rows:
        if r["m"] == "model_mapping" and r.get("model"):
            k = (r["c"], r["seg"], r["port"] or r["ph"], r["model"])
            if k in seen:
                continue
            seen.add(k)
            out[r["c"]].append({"seg": r["seg"], "port": r["port"], "ph": r["ph"], "model": r["model"], "pg": r["pg"], "r": r["r"], "l": r["l"], "rp": r["rp"]})
    return dict(out)


def why_missing(nf, c, k, m, seg):
    rp = own_period(qend(k))
    if k < "2025Q1":
        return 0
    if (c, rp) not in nf and not any(cc == c for cc, _ in nf):
        return 1
    toks = {"insurance_revenue": "revenue", "insurance_service_expenses": "expense", "isr_before_reinsurance": "before", "reinsurance_result": "reinsurance",
            "insurance_service_result": "service_result", "losses_onerous": "onerous", "csm": "csm", "ra": "ra", "be": "be", "lrc_excl_lc": "lrc",
            "loss_component": "loss", "lic": "lic"}
    for x in nf.get((c, rp), []):
        t = (str(x.get("metric", "")) + " " + str(x.get("segment", ""))).lower()
        if toks[m] in t and (seg in t or "all" in t or "segment" not in x):
            return str(x.get("why", ""))[:220]
    return 2


REASONS = ["2024: IFRS 17 בתוקף מ-1.1.2025; לשנת 2024 קיימים רק נתוני ההשוואה שהודפסו בדוחות 2025, והחתך הזה לא הודפס בהם",
           "אין דוח של התקופה בחילוץ",
           "לא הודפס בדוח התקופה בחתך הזה (לרבות: הביאור הביניים אינו מפרט את המדד לפי קבוצת תיקים, או רק עמודה מצטברת ללא עמודת רבעון קודם)"]


def build():
    rows, nf = load()
    rule = sign_rules(rows)

    def sgn_for(m):
        if m == "insurance_service_expenses":
            return lambda r: rule.get((r["c"], r["rp"], "exp"), 1) * (1 if r["v"] >= 0 or rule.get((r["c"], r["rp"], "exp"), 1) == 1 else 1)
        if m == "reinsurance_result":
            return lambda r: rule.get((r["c"], r["rp"], "re"), 1)
        return None

    reasons = list(REASONS)
    rix = {s: i for i, s in enumerate(reasons)}
    comp, summary = {}, {}
    for c in INSURERS:
        segs = {}
        nulls = {}
        for seg in SEGS + (["life_health_risk"] if c == "menora" else []):
            ms = {}
            for m in METRICS:
                s = series(rows, c, seg, "total", m, sgn_for(m))
                if m == "insurance_service_expenses":
                    s = {k: ([abs(v[0]), *v[1:]] if v and v[0] is not None and (len(v) < 4 or not (v[3] & 1)) else v) for k, v in s.items()}
                ms[m] = s
                for k in QUARTERS:
                    if k not in s:
                        why = why_missing(nf, c, k, m, seg)
                        if isinstance(why, str):
                            if why not in rix:
                                rix[why] = len(reasons)
                                reasons.append(why)
                            why = rix[why]
                        nulls.setdefault(seg, {}).setdefault(m, {})[k] = why
            segs[seg] = ms
        # life + health together: comparable across filers (Hachshara reports health inside life; Menora regrouped in 2026Q2)
        lh = {}
        for m in METRICS:
            lh[m] = {}
            for k in QUARTERS:
                parts = [(s, segs[s][m].get(k)) for s in ("life", "health", "life_health_risk") if s in segs]
                have = [(s, x) for s, x in parts if x]
                if c == "hachshara" and segs["life"][m].get(k):
                    x = segs["life"][m][k]
                    lh[m][k] = [x[0], None, None, 1, [[1, x[0], x[1], x[2], "life"]]] if x[1] is None else [*x[:3], (x[3] if len(x) > 3 else 0) | 16]
                    continue
                need = ["life", "health"] if not (c == "menora" and segs.get("life_health_risk", {}).get(m, {}).get(k)) else ["life", "life_health_risk"]
                if all(dict(have).get(s) for s in need):
                    lh[m][k] = [round(sum(dict(have)[s][0] for s in need), 3), None, None, 1, [[1, dict(have)[s][0], dict(have)[s][1], dict(have)[s][2], s] for s in need]]
        segs["lh"] = lh
        # portfolios (the regulator's groups), stocks and the main flows
        ports = defaultdict(dict)
        for p in PORT_SEG:
            for seg in ("life", "health", "life_health_risk") if PORT_SEG[p] != "pc" else ("pc",):
                if PORT_SEG[p] == "health" and seg == "life" and c != "hachshara":
                    continue
                for m in ("csm", "ra", "be", "lrc_excl_lc", "loss_component", "lic", "insurance_revenue", "isr_before_reinsurance", "insurance_service_result", "reinsurance_result"):
                    s = series(rows, c, seg, p, m, sgn_for(m))
                    if s:
                        ports[p].setdefault(m, {}).update(s)
        ph = defaultdict(set)
        for r in rows:
            if r["c"] == c and r["port"] in PORT_SEG:
                ph[r["port"]].add(r["ph"])
        # the filers' own mapping: yield-dependent savings -> VFA; a model view = the sum of the portfolios mapped to it (flag 1)
        mv = {}
        for model, members in (("vfa", ["life_yield"]), ("gmm_paa", [p for p in PORT_SEG if p != "life_yield" and PORT_SEG[p] != "pc"])):
            mv[model] = {}
            for m in ("csm", "ra", "be", "insurance_revenue", "isr_before_reinsurance"):
                mv[model][m] = {}
                for k in QUARTERS:
                    xs = [(p, ports[p].get(m, {}).get(k)) for p in members if ports.get(p, {}).get(m, {}).get(k)]
                    if xs and (model == "vfa" or len(xs) >= 2):
                        mv[model][m][k] = [round(sum(x[0] for _, x in xs), 3), None, None, 1, [[1, x[0], x[1], x[2], p] for p, x in xs]]
        comp[c] = {"segs": segs, "nulls": nulls, "ports": dict(ports), "port_he": {p: sorted(v) for p, v in ph.items()}, "model_view": mv}
    rfs = rollforwards(rows)
    ro = runoff(rows)
    mods = models(rows)
    # the CSM roll-forward per insurer-quarter: the best printed one (net over gross, the whole book over a segment, a table over a chart)
    rank_seg = {"group": 0, "life_health": 1, "life": 3, "health": 4, "life_health_risk": 5}
    rank_b = {"net": 0, "na": 1, "gross": 2, "reinsurance": 3}
    rfq = defaultdict(dict)
    for rf in rfs:
        if not rf["k"] or rf.get("partial"):
            continue
        span = "q" if rf["w"] == "q" or (rf["w"] == "ytd" and rf["k"].endswith("Q1")) else rf["w"]
        cur = rfq[rf["c"]].get((rf["k"], span))
        key = lambda x: (not x["ok"], rank_b.get(x["b"], 9), rank_seg.get(x["seg"], 9), x.get("chart", 0))
        if rf["seg"] in rank_seg and (cur is None or key(rf) < key(cur)):
            rfq[rf["c"]][(rf["k"], span)] = rf
    brief = lambda r: {k: r[k] for k in ("c", "rp", "seg", "b", "w", "d", "diff", "open", "close")} | {"n": len(r["rows"]), "chart": r.get("chart", 0)}
    recon = {"checked": sum(1 for r in rfs if not r.get("partial")), "ok": sum(1 for r in rfs if r["ok"]),
             "breaks": [brief(r) for r in rfs if not r["ok"] and not r.get("partial")], "partial": [brief(r) for r in rfs if r.get("partial")]}
    cover = {}
    for c in INSURERS:
        cov = {}
        for k in QUARTERS:
            got = {s: [m for m in METRICS if comp[c]["segs"][s][m].get(k)] for s in SEGS + (["life_health_risk"] if c == "menora" else [])}
            cov[k] = {s: len(v) for s, v in got.items()}
            cov[k]["rf"] = "q" if (k, "q") in rfq[c] else "ytd" if (k, "ytd") in rfq[c] else "fy" if (k, "fy") in rfq[c] else None
        cover[c] = cov
    stamp = {"built": None, "unit": "NIS millions", "source": "דוחות כספיים של החברות, MAYA: ביאור 'מידע נוסף לפי קבוצות תיקים עיקריות' (פורמט רשות שוק ההון), "
             "טבלאות התנועה ב-CSM, RA ורכיב ההפסד וטבלת ההכרה הצפויה ב-CSM; כל מספר עם עמוד", "files": FILES}
    meta = {"quarters": QUARTERS, "insurers": INSURERS, "segs": {s: SEG_HE[s] for s in ["life", "health", "pc", "lh", "life_health_risk"]},
            "metrics": {m: {"he": he, "kind": k} for m, (he, k) in METRICS.items()}, "ports": PORT_HE, "port_seg": PORT_SEG, "rf_he": RF_HE,
            "flags": {"1": "נגזר: הפרש/סכום של מספרים שהודפסו (הרכיבים מצורפים)", "2": "דוח מאוחר הדפיס ערך אחר", "4": "נקרא מגרף או מטקסט",
                      "8": "סימן הותאם לזהות הטבלה", "16": "הכשרה מציגה את הבריאות בתוך מגזר החיים"},
            "reasons": reasons, "no_2023": "IFRS 17 אומץ ב-1.1.2025 עם מספרי השוואה ל-2024; רבעוני 2023 לא דווחו לפי IFRS 17",
            "model_note": "אף מבטחת אינה מדפיסה פיצול לפי מודל מדידה (VFA מול GMM): הביאורים מפרידים PAA מ-GMM/VFA יחד. תצוגת VFA כאן היא מיפוי של החברות עצמן "
                          "(ביאור המדיניות: פוליסות עם רכיב חיסכון תלוי תשואה נמדדות ב-VFA) — סכום תיקי 'חיסכון תלוי תשואה'; השאר = שאר תיקי חיים ובריאות (GMM, וחלק מהבריאות הקצרה ב-PAA)."}
    industry = {**stamp, **meta, "coverage": cover, "nulls": {c: comp[c]["nulls"] for c in INSURERS}, "recon": recon, "runoff": ro, "models": mods,
                "rf": {c: {f"{k}|{s}": v for (k, s), v in d.items()} for c, d in rfq.items()},
                "table": {c: {"lh": comp[c]["segs"]["lh"], "pc": comp[c]["segs"]["pc"], "vfa": comp[c]["model_view"]["vfa"], "gmm_paa": comp[c]["model_view"]["gmm_paa"]} for c in INSURERS},
                "onerous": {c: {s: {"loss_component": comp[c]["segs"][s]["loss_component"], "losses_onerous": comp[c]["segs"][s]["losses_onerous"]}
                                for s in SEGS + (["life_health_risk"] if c == "menora" else [])} for c in INSURERS}}
    per = {c: {**stamp, "meta": meta, "company": c, **comp[c], "rfs": [r for r in rfs if r["c"] == c], "runoff": ro.get(c, {}), "models": mods.get(c, []),
               "quarters": QUARTERS} for c in INSURERS}
    return industry, per


def dump(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def main(argv):
    industry, per = build()
    check = "--check" in argv
    built = json.loads(OUT1.read_text(encoding="utf-8")).get("built") if check and OUT1.exists() else date.today().isoformat()
    industry["built"] = built
    for c in per:
        per[c]["built"] = built
    outs = {OUT1: dump(industry), **{OUTD / f"{c}.json": dump(v) for c, v in per.items()}}
    r = industry["recon"]
    if check:
        diff = [str(p.relative_to(ROOT)) for p, s in outs.items() if not p.exists() or p.read_text(encoding="utf-8") != s]
        print(f"ifrs_std: {len(INSURERS)} insurers, {r['checked']} CSM roll-forwards checked, {r['ok']} close, {len(r['breaks'])} breaks listed"
              + (f"; differs from a rebuild: {', '.join(diff)}" if diff else "; files equal a rebuild"))
        return 1 if diff else 0
    OUTD.mkdir(parents=True, exist_ok=True)
    for p, s in outs.items():
        p.write_text(s, encoding="utf-8")
    print(f"ifrs_std: {len(INSURERS)} insurers, {r['checked']} CSM roll-forwards checked, {r['ok']} close, {len(r['breaks'])} breaks, {len(r['partial'])} partial (not tested):")
    for b in r["partial"]:
        print("  PARTIAL", b["c"], b["rp"], b["seg"], b["b"], b["w"], b["d"], "rows", b["n"])
    for b in r["breaks"]:
        print("  BREAK", b["c"], b["rp"], b["seg"], b["b"], b["w"], b["d"], "diff", b["diff"], "chart" if b["chart"] else "")
    print("sizes:", {p.name: len(s) // 1024 for p, s in outs.items()}, "KB")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
