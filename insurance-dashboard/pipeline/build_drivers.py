"""A1 · the Driver Graph: the mechanisms layer of the advisory stack (facts -> mechanisms -> scenarios -> positions -> decisions).

Every later module (A2 scenario studio, A3 expectations decoder, A4 attribution, A5 war room, A7 capital options, A8 regulatory simulator,
A9 consolidation, A10 fragility) reads these files and propagates shocks with web/src/lib/drivers.ts. Nothing here is a forecast: an
edge is a mechanic (an accounting identity), a fit on fox's own history (regression), or a sensitivity the company printed (disclosure).

Inputs (all already built and gated; nothing new is extracted here)
  web/public/data/lens.json            Savings Lens: regulator months x managers' segment P&L per quarter (pension, gemel, savings policies)
  web/public/data/flow_npv.json        M3: NPV of net transfers per manager x product (its formula, margin, duration and ke, reused as is)
  web/public/data/market.json          regulator monthly assets, flows and asset-weighted returns per group x product (AUM roll-forward, beta)
  web/public/data/funds/cat.json       gemel-net category returns ("גמל | מניות" = the equity proxy of the stress lab presets)
  web/public/data/macro/boi_curve.json BoI zero curve, 10Y nominal monthly mean from 2008 (the regression's yield series); 1Y nominal (the short end)
  web/public/data/macro/macro.json     BoI policy rate: the days it changed (calendar-day monthly mean -> the policy -> 1Y pass-through)
  web/public/data/lines.json           group statement lines per company and period (profit, tax, equity, ISR, investment result)
  web/public/data/csm/sens.json        IFRS 17 sensitivities as printed (CSM, profit, equity), the stress lab's input
  web/public/data/csm/solvency.json    Solvency II sensitivities as printed (pp of the ratio), the stress lab's input
  web/public/data/csm/capital.json     solvency ratio with / without transitional, own funds, SCR, from the financial statements
  web/public/data/csm/facts/<co>.json  IFRS 17 facts per report: CSM (pipeline/csm_resolve.py), CSM release, board targets
  web/public/data/debt/index.json + debt/<co>.json   MAYA form ת126: principal by linkage and maturity; table ג = credit from banks
  web/src/lib/valuation.ts             ASSUME0 (tax, g, beta, erp): the shared valuation assumptions
Output
  web/public/data/drivers/graph.json   nodes, equations, edges (the graph, the same for every company)
  web/public/data/drivers/<co>.json    per company: current node values, calibrated edges, disclosed points, targets, identity checks

python3 pipeline/build_drivers.py           build
python3 pipeline/build_drivers.py --check   rebuild in memory, compare with the files on disk, and verify (exit 1 on any miss): every
                                            edge has provenance (or is `missing` with a reason), no NaN, signs as expected, the identity
                                            nodes reconcile to the reported figures, the disclosed points equal the stress lab's files,
                                            the NPV per NIS 1bn equals the M3 formula, the shared constants equal valuation.ts, the
                                            short-end edges equal their nodes, cost fits constrained only on a negative fixed cost

Edge methods: identity (an accounting identity over printed inputs), regression (OLS on fox's history: n, window, R², t), disclosure
(as printed by the company: report + page), assumption (a labelled modelling choice, always quality low). Quality: high / medium /
low / missing; the rules are written in graph.json -> meta.quality. Units: NIS millions unless stated; rates percent; shocks in bp
(rates, fees), % (equities, insurance risks, costs) or pp (CPI, net flow as % of assets a year).
Phoenix is the owner's employer: its elasticities are computed like everyone else's (mechanics, not forecasts) and its file carries
meta.flag = "employer".
"""
import datetime as dt
import json
import math
import re
import sys
from math import fsum
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web" / "public" / "data"
OUT = WEB / "drivers"
VALUATION_TS = ROOT / "web" / "src" / "lib" / "valuation.ts"
sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_flow_npv as fnpv  # noqa: E402  (M3: annuity(), the NPV formula; reused, never re-derived)
import csm_resolve  # noqa: E402  (the one rule for "the CSM" at a date)

MAYA = "https://mayafiles.tase.co.il/"
CKAN = "https://data.gov.il"
MM = 'מיליוני ש"ח'
BN = 'מיליארד ש"ח'
MINUS = "−"
WINDOW_M = 60          # months of the market regression (to the regulator's last month)
FRESH, STALE = 24, 36  # disclosure age in months: <= FRESH high, <= STALE medium, older low (FRESH = the stress lab's rule)
EMPLOYER = "phoenix"
SEG_HE = {"pen": "פנסיה", "gem": "גמל והשתלמות", "ic": "פוליסות חיסכון (חוזי השקעה)"}
SEG_SET = {"pen": "fam:pension", "gem": "fam:gemel", "ic": "fam:insurance"}
SEG_FAM = {"pen": ("pension",), "gem": ("gemel",), "ic": ("insurance",)}
SEG_PROD = {"ic": {"policy_2004"}}  # savings policies are sold on the 2004+ tracks (research/glossary_savings_policies.md)
SEG_DS = {"pen": "pensia", "gem": "gemel", "ic": "insurance"}
DS_HE = {"gemel": "גמל-נט", "pensia": "פנסיה-נט", "insurance": "ביטוח-נט"}
EQ_CAT = "גמל | מניות"


# ------------------------------------------------------------------------------------------------------------------------------ format
def r(x, d=4):
    return None if x is None else round(x, d)


def nf(v, d=1):
    if v is None:
        return "–"
    t = f"{v:,.{d}f}"
    if re.fullmatch(r"-[0.,]+", t):
        return t[1:]
    return t.replace("-", MINUS)


def sn(v, d=1):
    return ("+" if v is not None and round(v, d) > 0 else "") + nf(v, d)


def spp(v):  # a printed solvency effect in percentage points: as printed (an integer stays an integer)
    return sn(v, 0 if float(v).is_integer() else 1) + " נ״א"


def pc(v, d=2):
    return "–" if v is None else f"{nf(v, d)}%"


def ql(k):  # "Q2-2026" -> "Q2'26"
    return f"{k[:2]}'{k[5:]}"


def ym(p):  # 202606 -> "06/26"
    return f"{p % 100:02d}/{str(p // 100)[2:]}"


def plab(t, d):  # ("Q", "2026-06-30") -> "Q2'26"; ("FY", ...) -> "FY'25"; ("I", date) -> "Q2'26" at a quarter end
    y = d[2:4]
    q = {"03-31": "Q1", "06-30": "Q2", "09-30": "Q3", "12-31": "Q4"}.get(d[5:10])
    if t == "FY":
        return f"FY'{y}"
    if t == "H":
        return f"H{1 if d[5:7] == '06' else 2}'{y}"
    if t == "I" and q:
        return f"{q}'{y}"
    if q:
        return f"{q}'{y}"
    return f"{d[8:10]}.{d[5:7]}.{y}"


def dlab(d):  # "2025-12-31" -> "Q4'25"; else 31.12.25
    return plab("I", d)


def per_lab(p):  # "2025FY" -> "FY'25"; "2026Q1" -> "Q1'26"
    return f"FY'{p[2:4]}" if p.endswith("FY") else f"{p[4:]}'{p[2:4]}"


def months_between(a, b):  # ISO dates
    return (int(b[:4]) - int(a[:4])) * 12 + int(b[5:7]) - int(a[5:7])


def madd(p, k):
    return fnpv.madd(p, k)


def mdiff(a, b):
    return (a // 100) * 12 + a % 100 - ((b // 100) * 12 + b % 100)


# ------------------------------------------------------------------------------------------------------------------------------ provenance
# The JSON form of web/src/lib/prov.ts Prov: report / reg / calc / none as they are, plus `lts` (resolved in the browser by lens.ts
# ltsProv: the printed components of a managing company's segment figure). calc inputs carry their source as `p` (a nested node).
def P_rep(title, value, unit, url, pg, doc, period, note=None, src_type=None, der=None):
    p = {"k": "report", "title": title, "value": value, "unit": unit, "url": url, "pg": pg, "doc": doc, "period": period}
    if note:
        p["note"] = note
    if src_type:
        p["srcType"] = src_type
    if der:
        p["der"] = der
    return p


def P_reg(metric, month, w, seg, g, p0):
    return {"k": "reg", "metric": metric, "pi": mdiff(month, p0), "w": w, "set": SEG_SET[seg], "g": g}


def P_lts(c, metric, period, title, unit, value, note=None):
    p = {"k": "lts", "c": c, "metric": metric, "period": period, "title": title, "unit": unit, "value": value}
    if note:
        p["note"] = note
    return p


def P_calc(title, value, unit, formula, inputs, est=False, note=None):
    p = {"k": "calc", "title": title, "value": value, "unit": unit, "formula": formula,
         "inputs": [dict({"label": a, "v": b}, **({"p": c} if c else {})) for a, b, c in inputs]}
    if est:
        p["est"] = True
    if note:
        p["note"] = note
    return p


def P_none(title, why):
    return {"k": "none", "title": title, "why": why}


# ------------------------------------------------------------------------------------------------------------------------------ math
def ols(xs, y):
    """y = b0 + b1 x1 + ... + bk xk by the normal equations; xs: list of regressor columns. Returns coefficients, standard errors, R², n."""
    n, k = len(y), len(xs) + 1
    X = [[1.0] + [c[i] for c in xs] for i in range(n)]
    A = [[fsum(X[t][i] * X[t][j] for t in range(n)) for j in range(k)] for i in range(k)]
    bvec = [fsum(X[t][i] * y[t] for t in range(n)) for i in range(k)]
    inv = invert(A)
    if inv is None:
        return None
    beta = [fsum(inv[i][j] * bvec[j] for j in range(k)) for i in range(k)]
    fit = [fsum(beta[j] * X[t][j] for j in range(k)) for t in range(n)]
    my = fsum(y) / n
    sse = fsum((y[t] - fit[t]) ** 2 for t in range(n))
    sst = fsum((v - my) ** 2 for v in y)
    s2 = sse / (n - k) if n > k else float("nan")
    se = [math.sqrt(s2 * inv[i][i]) if inv[i][i] > 0 else float("nan") for i in range(k)]
    return {"b": beta, "se": se, "r2": 1 - sse / sst if sst else 0.0, "n": n}


def invert(A):
    n = len(A)
    M = [row[:] + [1.0 if i == j else 0.0 for j in range(n)] for i, row in enumerate(A)]
    for c in range(n):
        piv = max(range(c, n), key=lambda i: abs(M[i][c]))
        if abs(M[piv][c]) < 1e-12:
            return None
        M[c], M[piv] = M[piv], M[c]
        f = M[c][c]
        M[c] = [v / f for v in M[c]]
        for i in range(n):
            if i != c and M[i][c]:
                g = M[i][c]
                M[i] = [a - g * b for a, b in zip(M[i], M[c])]
    return [row[n:] for row in M]


def q_reg(n, r2, t, monthly):
    """quality of a fitted edge: enough observations, a fit that explains most of the variance, a slope at least two standard errors"""
    need = 36 if monthly else 12
    if n < (24 if monthly else 8) or abs(t) < 2:
        return "low"
    if n >= need and r2 >= 0.7:
        return "high"
    return "medium" if r2 >= 0.4 else "low"


def q_age(months):
    return "high" if months <= FRESH else "medium" if months <= STALE else "low"


# ------------------------------------------------------------------------------------------------------------------------------ the graph
SHOCKS = [
    # k, Hebrew, unit, typical range: the shock vector of drivers.ts (same keys)
    ("policy", "ריבית בנק ישראל", "bp", [-200, 200]),
    ("y10", "תשואת 10 שנים (עקום חסר סיכון)", "bp", [-200, 200]),
    ("eq", "מניות", "%", [-40, 30]),
    ("credit", "מרווחי אשראי", "bp", [-100, 300]),
    ("cpi", "מדד המחירים לצרכן", "pp", [-2, 6]),
    ("flow", "צבירה נטו (% מהנכסים לשנה)", "pp", [-10, 10]),
    ("fee", "שחיקת דמי ניהול על צבירה", "bp", [0, 10]),
    ("cost", "אינפלציית הוצאות (מעבר למדד)", "%", [-10, 20]),
    ("mortality", "שיעורי תמותה", "%", [-20, 20]),
    ("morbidity", "שיעורי תחלואה", "%", [-20, 20]),
    ("lapse", "שיעורי ביטולים", "%", [-30, 30]),
]
NODES = [
    # id, Hebrew, unit, kind (driver / line / output)
    ("aum", "נכסים מנוהלים (לכל מוצר)", MM, "line"),
    ("r_market", "תשואת התיק", "%", "driver"),
    ("net_flow", "צבירה נטו: אורגנית + ניוד", MM, "line"),
    ("organic", "צבירה אורגנית (הפקדות פחות משיכות)", MM, "line"),
    ("transfers", "ניוד נטו", MM, "line"),
    ("fee_yield", "תשואת דמי ניהול על נכסים", "%", "driver"),
    ("revenue", "הכנסות מדמי ניהול, חיסכון ארוך טווח", MM, "output"),
    ("opex", "הוצאות: שיווק ומכירה + הנהלה וכלליות", MM, "line"),
    ("op_profit", "רווח תפעולי, חיסכון ארוך טווח (מגזרי)", MM, "output"),
    ("npv_op", "ערך נוכחי של רווח תפעולי מניוד", MM, "line"),
    ("csm", "יתרת CSM (נטו, קבוצה)", MM, "output"),
    ("csm_release", "שחרור CSM לרווח", MM, "line"),
    ("isr", "רווח משירותי ביטוח", MM, "line"),
    ("inv_income", "רווח מהשקעות ומימון, נטו", MM, "line"),
    ("y1", "תשואת שנה (אפס נומינלי, בנק ישראל)", "%", "driver"),
    ("cash", "מזומנים ושווי מזומנים אחרים (נוסטרו)", MM, "line"),
    ("financing", "הוצאות מימון על חוב", MM, "line"),
    ("tax", "שיעור מס", "%", "driver"),
    ("net_profit", "רווח נקי לבעלי המניות", MM, "output"),
    ("equity", "הון לבעלי המניות (ממוצע)", MM, "line"),
    ("roe", "תשואה להון", "%", "output"),
    ("ke", "מחיר ההון", "%", "driver"),
    ("pb", "מכפיל הון מוצדק", "x", "output"),
    ("own_funds", "הון עצמי לכושר פירעון", MM, "line"),
    ("scr", "הון נדרש לכושר פירעון (SCR)", MM, "line"),
    ("solv_w", "יחס כושר פירעון, עם הוראות מעבר", "%", "output"),
    ("solv_wo", "יחס כושר פירעון, ללא הוראות מעבר", "%", "output"),
    ("dist_capital", "הון עודף מעל יעד הדירקטוריון", MM, "output"),
    ("div_capacity", "עודף מעל סף חלוקת הדיבידנד", MM, "output"),
]
EQUATIONS = [
    # id, output, text, kind
    ("aum", "aum", "AUM(t) = AUM(t−1) × (1 + r_market) + net_flow", "identity"),
    ("net_flow", "net_flow", "net_flow = organic + transfers", "identity"),
    ("revenue", "revenue", "revenue = Σ(product) avgAUM × fee_yield", "identity"),
    ("opex", "opex", "opex = fixed + variable × avgAUM (headcount: not published per segment)", "regression"),
    ("op_profit", "op_profit", "op_profit = revenue − opex", "identity"),
    ("npv_op", "npv_op", "NPV = F × m ÷ 100 × a(D, ke); m = fee_yield × (1 − opex ÷ revenue) (M3, flow_npv.json)", "identity"),
    ("isr", "isr", "ISR = CSM_release + RA_release ± experience (only CSM_release is modelled; the rest is the printed residual)", "identity"),
    ("csm_release", "csm_release", "CSM_release(next year) = CSM × release rate (FY'25: release ÷ average CSM, gross life + health)", "identity"),
    ("inv_income", "inv_income", "inv_income = nostro × return (shocks: the printed IFRS 17 profit sensitivities, after tax)", "disclosure"),
    ("y1", "y1", "Δy1 = β × Δpolicy (OLS on monthly changes: BoI 1Y nominal zero, monthly mean, on the policy rate's calendar-day monthly mean)", "regression"),
    ("inv_cash", "inv_income", "Δinv_income (run rate) = nostro cash and cash equivalents × Δy1 (they reprice within the year)", "identity"),
    ("financing", "financing", "Δfinancing = CPI-linked principal × ΔCPI + next-12-month maturities × Δyield (refinanced) + unlinked bank credit × Δpolicy (assumed prime-linked)", "identity"),
    ("net_profit", "net_profit", "net_profit = (op_profit + ISR + inv_income − financing) × (1 − tax); Δ = Σ Δ(pre-tax) × (1 − tax) + Δ(printed, after tax)", "identity"),
    ("roe", "roe", "ROE = net_profit ÷ average equity", "identity"),
    ("ke", "ke", "ke = rf (BoI 10Y) + β × ERP (valuation.ts ASSUME0)", "identity"),
    ("pb", "pb", "justified P/B = (ROE − g) ÷ (ke − g)", "identity"),
    ("solv", "solv_w", "solvency = own_funds ÷ SCR; Δ = Σ printed Δpp per shock (no diversification credit)", "disclosure"),
    ("dist", "dist_capital", "dist_capital = own_funds − SCR × board_target = SCR × (solvency − target) ÷ 100", "identity"),
    ("div", "div_capacity", "div_capacity = SCR × (solvency − dividend threshold) ÷ 100", "identity"),
]
# the graph's edges: id, from, to, expected sign (+1 / −1; 0 = as printed, either way), unit, Hebrew
EDGES = [
    ("fee.op", "fee", "op_profit", -1, "מיליוני ש״ח לשנה לכל 1 נ״ב", "שחיקת דמי ניהול ← רווח תפעולי"),
    ("tr.npv", "transfers", "npv_op", 0, "מיליוני ש״ח ערך נוכחי לכל מיליארד ש״ח", "ניוד נטו ← ערך נוכחי של רווח תפעולי"),
    ("eq.aum", "eq", "aum", 1, "% מהנכסים לכל 1% במניות", "מניות ← נכסים מנוהלים"),
    ("y10.aum", "y10", "aum", -1, "% מהנכסים לכל 100 נ״ב", "תשואת 10 שנים ← נכסים מנוהלים"),
    ("aum.rev", "aum", "revenue", 1, "מיליוני ש״ח הכנסות לשנה לכל מיליארד ש״ח נכסים", "נכסים ← הכנסות"),
    ("aum.opex", "aum", "opex", 1, "מיליוני ש״ח הוצאות לשנה לכל מיליארד ש״ח נכסים", "נכסים ← הוצאות (רכיב משתנה)"),
    ("cpi.opex", "cpi", "opex", 1, "מיליוני ש״ח לשנה לכל 1 נ״א במדד", "מדד ← הוצאות"),
    ("cpi.fin", "cpi", "financing", 1, "מיליוני ש״ח לשנה לכל 1 נ״א במדד", "מדד ← מימון (קרן צמודה)"),
    ("y10.fin", "y10", "financing", 1, "מיליוני ש״ח לשנה לכל 100 נ״ב", "תשואה ← מימון (מחזור פירעונות 12 חודשים)"),
    ("policy.fin", "policy", "financing", 1, "מיליוני ש״ח לשנה לכל 100 נ״ב", "ריבית בנק ישראל ← מימון (אשראי בנקאי לא צמוד)"),
    ("policy.y1", "policy", "y1", 1, "נ״ב לכל 100 נ״ב", "ריבית בנק ישראל ← תשואת שנה"),
    ("y1.inv", "y1", "inv_income", 1, "מיליוני ש״ח לשנה לכל 100 נ״ב", "תשואת שנה ← הכנסה ממזומני הנוסטרו"),
    ("policy.np", "policy", "net_profit", 0, MM, "ריבית בנק ישראל ← תוצאה מימונית IFRS 17"),
    ("op.np", "op_profit", "net_profit", 1, "מיליוני ש״ח לכל מיליון ש״ח לפני מס", "רווח לפני מס ← רווח נקי (1 − מס)"),
    ("csm.isr", "csm", "csm_release", 1, "מיליוני ש״ח שחרור בשנה לכל מיליון ש״ח CSM", "CSM ← שחרור לרווח"),
    ("np.roe", "net_profit", "roe", 1, "נ״א לכל 100 מיליוני ש״ח", "רווח נקי ← תשואה להון"),
    ("y10.ke", "y10", "ke", 1, "נ״א לכל 100 נ״ב", "תשואה ← מחיר ההון"),
    ("roe.pb", "roe", "pb", 1, "x לכל 1 נ״א", "תשואה להון ← מכפיל הון מוצדק"),
    ("solv.dist", "solv_w", "dist_capital", 1, "מיליוני ש״ח לכל 1 נ״א", "יחס כושר פירעון ← הון עודף"),
    # disclosed sensitivities (as printed)
    ("y10.solv_w", "y10", "solv_w", 0, "נ״א ביחס", "ריבית ← כושר פירעון (עם הוראות מעבר)"),
    ("y10.solv_wo", "y10", "solv_wo", 0, "נ״א ביחס", "ריבית ← כושר פירעון (ללא הוראות מעבר)"),
    ("eq.solv_w", "eq", "solv_w", 0, "נ״א ביחס", "מניות ← כושר פירעון (עם)"),
    ("eq.solv_wo", "eq", "solv_wo", 0, "נ״א ביחס", "מניות ← כושר פירעון (ללא)"),
    ("credit.solv_w", "credit", "solv_w", 0, "נ״א ביחס", "מרווחי אשראי ← כושר פירעון"),
    ("mortality.solv_w", "mortality", "solv_w", 0, "נ״א ביחס", "תמותה ← כושר פירעון"),
    ("morbidity.solv_w", "morbidity", "solv_w", 0, "נ״א ביחס", "תחלואה ← כושר פירעון"),
    ("lapse.solv_w", "lapse", "solv_w", 0, "נ״א ביחס", "ביטולים ← כושר פירעון"),
    ("y10.csm", "y10", "csm", 0, MM, "ריבית ← CSM"),
    ("eq.csm", "eq", "csm", 0, MM, "מניות ← CSM"),
    ("credit.csm", "credit", "csm", 0, MM, "מרווחי אשראי ← CSM"),
    ("mortality.csm", "mortality", "csm", 0, MM, "תמותה ← CSM"),
    ("morbidity.csm", "morbidity", "csm", 0, MM, "תחלואה ← CSM"),
    ("lapse.csm", "lapse", "csm", 0, MM, "ביטולים ← CSM"),
    ("y10.np", "y10", "net_profit", 0, MM, "ריבית ← רווח נקי (גילוי, אחרי מס)"),
    ("eq.np", "eq", "net_profit", 0, MM, "מניות ← רווח נקי (גילוי, אחרי מס)"),
    ("mortality.np", "mortality", "net_profit", 0, MM, "תמותה ← רווח נקי"),
    ("morbidity.np", "morbidity", "net_profit", 0, MM, "תחלואה ← רווח נקי"),
]
EDGE_OF = {e[0]: e for e in EDGES}
RISKS = ("rate", "equity", "mortality", "morbidity", "lapse")
RISK_SHOCK = {"rate": "y10", "equity": "eq", "mortality": "mortality", "morbidity": "morbidity", "lapse": "lapse"}


def graph(built):
    return {
        "meta": {
            "built": built, "v": 1,
            "about": "A1 Driver Graph: nodes, equations and edges. Per-company calibration: drivers/<company>.json. Propagation: web/src/lib/drivers.ts.",
            "methods": {"identity": "an accounting identity over printed or regulator inputs", "regression": "OLS on fox's own history (n, window, R², t printed)",
                        "disclosure": "the company's printed sensitivity (report + page), read as the stress lab reads it: between the disclosed points, clamped beyond",
                        "assumption": "a labelled modelling choice; quality always low"},
            "quality": {"high": "identity over printed inputs; regression with n >= 36 months (12 quarters), R² >= 0.7, |t| >= 2; disclosure at most 24 months before its base",
                        "medium": "R² >= 0.4, or a disclosure 25–36 months old, or an identity over labelled M3 assumptions (duration, ke, average margin) or over a balance held through the year; "
                                  "a cost fit constrained at a fixed cost >= 0, or whose variable cost exceeds the fee yield, is at most medium",
                        "low": "a labelled assumption, a weak or short fit, or a disclosure older than 36 months",
                        "missing": "no free public input publishes it; the reason is written on the edge"},
            "units": {"money": "NIS millions", "rates": "percent", "shocks": "bp (rates, fees, spreads), % (equities, insurance risks, cost), pp (CPI, net flow % of assets a year)"},
        },
        "shocks": [{"k": k, "he": he, "unit": u, "range": rg} for k, he, u, rg in SHOCKS],
        "nodes": [{"id": i, "he": he, "unit": u, "kind": k} for i, he, u, k in NODES],
        "equations": [{"id": i, "out": o, "text": t, "kind": k} for i, o, t, k in EQUATIONS],
        "edges": [{"id": i, "from": a, "to": b, "sign": s, "unit": u, "he": he} for i, a, b, s, u, he in EDGES],
    }


# ------------------------------------------------------------------------------------------------------------------------------ inputs
def load(p):
    return json.loads((WEB / p).read_text(encoding="utf8"))


def assumptions():
    ts = VALUATION_TS.read_text(encoding="utf8")
    m = re.search(r"ASSUME0: Assume = \{([^}]*)\}", ts)
    kv = dict(re.findall(r"(\w+): ([\d.]+)", m.group(1))) if m else {}
    return {k: float(kv[k]) for k in ("erp", "beta", "g", "tax") if k in kv}


class Inputs:
    def __init__(self):
        self.lens = load("lens.json")
        self.npv = load("flow_npv.json")
        self.mkt = load("market.json")
        self.cat = load("funds/cat.json").get(EQ_CAT)
        self.lines = load("lines.json")
        self.sens = load("csm/sens.json")["rows"]
        self.solv = load("csm/solvency.json")
        self.cap = load("csm/capital.json")["companies"]
        self.reg = load("companies/index.json")
        self.debt = load("debt/index.json")
        self.A = assumptions()
        self.last = self.lens["meta"]["last_rep"]                      # "Q2-2026"
        self.ltm = [fnpv.qprev(self.last, k) for k in (3, 2, 1, 0)]
        self.by = {(x["g"], x["s"], x["q"]): x for x in self.lens["rows"]}
        self.npv_by = {(x["g"], x["s"], x["p"]): x for x in self.npv["rows"]}
        self.G = [g["name"] for g in self.lens["groups"]]
        self.p0 = self.lens["meta"]["p0"]
        self.LP = [tuple(p) for p in self.lines["periods"]]
        self.csm_facts = {}
        for f in sorted((WEB / "csm" / "facts").glob("*.json")):
            self.csm_facts[f.stem] = json.loads(f.read_text(encoding="utf8"))
        self.debt_files = {}
        for f in sorted((WEB / "debt").glob("*.json")):
            if f.stem != "index":
                self.debt_files[f.stem] = json.loads(f.read_text(encoding="utf8"))
        self._monthly()

    def _monthly(self):
        """per group x segment x month: assets, flows, asset-weighted return (the regulator's own sums, as market.json carries them)"""
        P, prods = self.mkt["periods"], self.mkt["products"]
        fam = [x["family"] for x in prods]
        key = [x["key"] for x in prods]
        cell = {}
        for row in self.mkt["rows"]:
            pi, prod, g, a, dep, wd, tr, fa, fn, fd, yn, yd, n = row
            for s, fams in SEG_FAM.items():
                if fam[prod] not in fams or (s in SEG_PROD and key[prod] not in SEG_PROD[s]):
                    continue
                c = cell.setdefault((g, s, P[pi]), [0.0] * 7)
                c[0] += a; c[1] += dep; c[2] += wd; c[3] += tr; c[4] += yn; c[5] += yd; c[6] += fa
        self.cell = cell
        self.months = P
        self.curve = load("macro/boi_curve.json")  # the BoI zero curve from 2008 (macro.json's nom10 starts 10/22: too short for 60 months)
        self.y10 = {int(m.replace("-", "")): v for m, v in zip(self.curve["months"], self.curve["nominal"]["10"]) if v is not None}
        self.eq = dict(zip(self.cat["p"], self.cat["y"])) if self.cat else {}
        self.y1 = {int(m.replace("-", "")): v for m, v in zip(self.curve["months"], self.curve["nominal"].get("1", [])) if v is not None}
        self.res = self.mkt["meta"]["resources"]
        self.pkg = self.mkt["meta"]["packages"]
        self._policy()

    def _policy(self):
        """the BoI policy rate as a calendar-day monthly mean (the basis of the curve's monthly means), from the days it changed
        (macro.json rate.changes), to the regulator's last month; a month is kept only when a change on or before its first day fixes
        every one of its days. Also the rate in force on the base date."""
        self.macro = load("macro/macro.json")["series"]["rate"]
        ch = sorted((dt.date.fromisoformat(d), v) for d, v in self.macro["changes"])
        self.pol, self.pol_base = {}, None
        if not ch:
            return
        at = lambda day: [v for d, v in ch if d <= day][-1]
        y, m = ch[0][0].year, ch[0][0].month
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
        end = self.lens["meta"]["asof"]
        while y * 100 + m <= end:
            first, nxt = dt.date(y, m, 1), dt.date(y + (m == 12), m % 12 + 1, 1)
            days = (nxt - first).days
            self.pol[y * 100 + m] = fsum(at(first + dt.timedelta(days=k)) for k in range(days)) / days
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)
        base = dt.date(2026, 6, 30)
        if ch[0][0] <= base:
            self.pol_base = at(base)


# ------------------------------------------------------------------------------------------------------------------------------ helpers
def edge(eid, x, v, method, quality, prov, seg=None, n=None, window=None, fit=None, rng=None, note=None, why=None, extra=None):
    _, a, b, sign, unit, he = EDGE_OF[eid]
    e = {"id": eid + (f".{seg}" if seg else ""), "e": eid, "from": a, "to": b, "he": he + (f" · {SEG_HE[seg]}" if seg else ""),
         "unit": unit, "sign": sign, "x": x, "v": r(v, 6), "method": method, "quality": quality}
    if seg:
        e["seg"] = seg
    for k, val in (("n", n), ("window", window), ("fit", fit), ("range", rng), ("note", note), ("why", why)):
        if val is not None:
            e[k] = val
    if extra:
        e.update(extra)
    e["prov"] = prov
    return e


def missing(eid, why, seg=None, x=None):
    return edge(eid, x, None, "none", "missing", P_none(EDGE_OF[eid][5], why), seg=seg, why=why)


def node(v, unit, period, prov, d=None, **kw):
    out = {"v": r(v, 6), "unit": unit, "period": period, "prov": prov}
    if d is not None:
        out["d"] = d
    out.update(kw)
    return out


class Co:
    """one company: products (savings segments), group lines, insurer capital"""

    def __init__(self, I, c):
        self.I, self.c = I, c
        self.reg = next(x for x in I.reg if x["id"] == c)
        self.name = self.reg["name_he"]
        self.kind = self.reg["kind"]
        self.g = next((i for i, x in enumerate(I.lens["groups"]) if x["id"] == c), None)
        if self.g is None and self.reg.get("market_group") in I.G:
            self.g = I.G.index(self.reg["market_group"])  # more_gemel: the regulator group of its parent
        self.edges, self.nodes, self.checks, self.products, self.notes = [], {}, [], [], []
        self.lines_out = {}

    # ---------------- the lens figures of a group x segment x quarter, with their sources
    def gname(self):
        return self.I.G[self.g]

    def tag(self, s, q):
        return f"{self.gname()} · {SEG_HE[s]} · {ql(q)}"

    def avgP(self, s, x):
        e = x["reg"]["e"]
        ms = [madd(e, -3), madd(e, -2), madd(e, -1), e]
        return P_calc(f"נכסים ממוצעים, רשות · {self.tag(s, x['q'])}", nf(x["reg"]["avg"] / 1000, 2), BN,
                      "(A₀ ÷ 2 + A₁ + A₂ + A₃ ÷ 2) ÷ 3: טרפז על ארבעה סופי חודש. A₀ = סוף הרבעון הקודם (lens.json, avg_reg)",
                      [(f"נכסים · {ym(p)}", nf(v / 1000, 2) if v is not None else "–", P_reg("assets", p, "m", s, self.g, self.I.p0)) for p, v in zip(ms, x["reg"]["m"])])

    def repP(self, s, x, metric, at="q"):
        rp = x["rep"]
        key = rp["keys"][at]
        pre = "ic" if s == "ic" else s
        lab = {"fees": "הכנסות מדמי ניהול", "sm": "שיווק ומכירה", "ga": "הנהלה וכלליות", "op": "רווח תפעולי", "aum": "נכסים מנוהלים בדוח"}[metric]
        v = rp["aO" if at == "o" else "aE"] if metric == "aum" else rp[metric]
        unit = BN if metric == "aum" else MM
        return P_lts(rp["c"], f"{pre}.{metric}", key, f"{lab} · {self.gname()} · {SEG_HE[s]} · {ql(key) if at == 'q' else key[5:] + '/' + key[2:4]}",
                     unit, nf(v, 2 if metric == "aum" else 1))

    def sum4(self, s, label, unit, vals, provs, d=1):
        tot = fsum(vals)
        return tot, P_calc(f"{label} · {self.gname()} · {SEG_HE[s]} · LTM {ql(self.I.last)}", nf(tot, d), unit,
                           f"סכום ארבעת הרבעונים {', '.join(ql(q) for q in self.I.ltm)}", [(ql(q), nf(v, d), p) for q, v, p in zip(self.I.ltm, vals, provs)])

    # ---------------- one savings product
    def product(self, s):
        I = self.I
        lrow = I.by.get((self.g, "ins" if s == "ic" else s, I.last))
        if not lrow:
            return None
        rows = [I.by.get((self.g, "ins" if s == "ic" else s, q)) for q in I.ltm]
        rep = lrow.get("rep") or {}
        own = rep.get("c") is not None and self.c in (rep.get("c"), "more_gemel") or (self.c == "idi" and rep.get("c") == "direct")
        P = {"s": s, "he": SEG_HE[s], "g": self.g, "group": self.gname()}
        ed = []
        if s == "ic":
            # savings policies (IFRS 9 investment contracts): the reported balances; the regulator's 2004+ tracks mix in managers' insurance
            if not own or rep.get("aE") is None or rep.get("aO") is None:
                return None
            A = (rep["aO"] + rep["aE"]) / 2 * 1000
            Ap = P_calc(f"יתרת פוליסות חיסכון ממוצעת · {self.tag(s, I.last)}", nf(A / 1000, 2), BN, "(יתרה בתחילת הרבעון + יתרה בסופו) ÷ 2, מהדוח",
                        [(f"יתרה · {rep['keys']['o']}", nf(rep["aO"], 2), self.repP(s, lrow, "aum", "o")), (f"יתרה · {rep['keys']['e']}", nf(rep["aE"], 2), self.repP(s, lrow, "aum", "e"))])
            P["avg"] = node(A, MM, ql(I.last), Ap)
            P["aum"] = node(rep["aE"] * 1000, MM, rep["keys"]["e"], self.repP(s, lrow, "aum", "e"))
            fees = [((x or {}).get("rep") or {}).get("fees") for x in rows]
            if all(v is not None for v in fees):
                tot, pp = self.sum4(s, "הכנסות מדמי ניהול", MM, fees, [self.repP(s, x, "fees") for x in rows])
                P["fees_ltm"] = node(tot, MM, f"LTM {ql(I.last)}", pp)
                fy = tot / A * 100
                P["fy"] = node(fy, "%", f"LTM {ql(I.last)}", P_calc(f"תשואת דמי ניהול · {self.tag(s, I.last)}", pc(fy, 3), "שנתי",
                                                                      "Σ הכנסות LTM ÷ יתרה ממוצעת ברבעון האחרון × 100", [("Σ הכנסות LTM", nf(tot), pp), ("יתרה ממוצעת", nf(A / 1000, 2), Ap)]))
            ed.append(self.fee_edge(s, A, Ap))
            ed.append(missing("tr.npv", "ביטוח-נט ודוחות חברות הביטוח אינם מפרסמים ניוד לפוליסות חיסכון; M3 מחושב לפנסיה ולגמל בלבד", seg=s, x=1))
            ed.extend(self.beta_edges(s))
            if "fy" in P:
                ed.append(self.rev_edge(s, P["fy"]))
            ed.append(missing("aum.opex", "הוצאות פוליסות החיסכון אינן מודפסות בנפרד בקבוצות הביטוח (LTS_METHOD.md); לא מוקצות בהנחה", seg=s, x=1))
            P["edges"] = ed
            return P
        A = lrow["reg"]["avg"]
        Ap = self.avgP(s, lrow)
        P["avg"] = node(A, MM, ql(I.last), Ap)
        P["aum"] = node(lrow["reg"]["aE"], MM, ym(lrow["reg"]["e"]), P_reg("assets", lrow["reg"]["e"], "m", s, self.g, I.p0))
        if all(rows):
            for k, lab, metric in (("tr", "ניוד נטו", "transfers"), ("org", "צבירה אורגנית", "organic")):
                vals = [x["reg"][k] for x in rows]
                if all(v is not None for v in vals):
                    tot, pp = self.sum4(s, lab, MM, vals, [P_reg(metric, x["reg"]["e"], "q", s, self.g, I.p0) for x in rows], d=0)
                    P[f"{k}_ltm"] = node(tot, MM, f"LTM {ql(I.last)}", pp)
        if own and all(rows) and all((x.get("rep") or {}).get(k) is not None for x in rows for k in ("fees", "sm", "ga", "op")):
            for k, lab in (("fees", "הכנסות מדמי ניהול"), ("sm", "שיווק ומכירה"), ("ga", "הנהלה וכלליות"), ("op", "רווח תפעולי")):
                tot, pp = self.sum4(s, lab, MM, [x["rep"][k] for x in rows], [self.repP(s, x, k) for x in rows])
                P[f"{k}_ltm"] = node(tot, MM, f"LTM {ql(I.last)}", pp)
            opex = P["sm_ltm"]["v"] + P["ga_ltm"]["v"]
            P["opex_ltm"] = node(opex, MM, f"LTM {ql(I.last)}", P_calc(f"הוצאות · {self.gname()} · {SEG_HE[s]} · LTM {ql(I.last)}", nf(opex), MM, "שיווק ומכירה + הנהלה וכלליות",
                                                                        [("שיווק ומכירה", nf(P["sm_ltm"]["v"]), P["sm_ltm"]["prov"]), ("הנהלה וכלליות", nf(P["ga_ltm"]["v"]), P["ga_ltm"]["prov"])]))
            # identity checks: op = fees − S&M − G&A in every quarter; the LTM sum
            for x in rows:
                rp = x["rep"]
                self.check(f"op_identity.{s}.{x['q']}", f"רווח תפעולי = הכנסות − שיווק − הנהלה · {self.tag(s, x['q'])}", rp["op"], rp["fees"] - rp["sm"] - rp["ga"], 0.5)
        nrow = I.npv_by.get((self.g, s, "LTM-" + I.last))
        if nrow and nrow.get("fy") is not None:
            fy = nrow["fy"]
            P["fy"] = node(fy, "%", f"LTM {ql(I.last)}", self.npv_fyP(s, nrow))
        else:
            fy = lrow.get("fy_reg")
            if fy is not None and lrow.get("rep"):
                P["fy"] = node(fy, "%", ql(I.last), P_calc(f"תשואת דמי ניהול על נכסי הרשות · {self.tag(s, I.last)}", pc(fy, 3), "שנתי",
                                                           "הכנסות מדמי ניהול ברבעון (מהדוח) × 4 ÷ נכסים ממוצעים ברבעון (רשות) × 100",
                                                           [("הכנסות מדמי ניהול", nf(lrow["rep"]["fees"]), self.repP(s, lrow, "fees")), ("נכסים ממוצעים", nf(A / 1000, 2), Ap)]))
            elif lrow["reg"].get("posted") is not None:
                fy = lrow["reg"]["posted"]
                P["fy"] = node(fy, "%", ym(lrow["reg"]["e"]), P_calc(f"דמי ניהול ממוצעים מהצבירה, כפי שמפרסמת הרשות · {self.tag(s, I.last)}", pc(fy, 3), "שנתי",
                                                                    "ממוצע משוקלל בנכסים של AVG_ANNUAL_MANAGEMENT_FEE במסלולי הקבוצה (lens.json, posted). אין דוח מגזרי לחברה",
                                                                    [("נכסים בסוף הרבעון", nf(lrow["reg"]["aE"] / 1000, 2), P_reg("assets", lrow["reg"]["e"], "m", s, self.g, I.p0))], est=True,
                                                                    note="שיעור מהצבירה בלבד: בלי דמי ניהול מהפקדות"))
        ed.append(self.fee_edge(s, A, Ap))
        ed.append(self.npv_edge(s, nrow) if nrow and nrow.get("m") is not None else missing(
            "tr.npv", "אין שורת LTM ב-flow_npv.json (נדרשים דוח מגזרי של ארבעה רבעונים ותזרימי רשות)", seg=s, x=1))
        roll_ok, roll_med = self.aum_identity(s)
        for e in self.beta_edges(s):
            if not roll_ok and e["quality"] != "missing":
                e["quality"] = "low"
                e["note"] = (e.get("note", "") + "; " if e.get("note") else "") + f"regulator assets do not roll forward (median monthly residual {roll_med:.2f}% of assets): the return series is not reliable for this group"
            ed.append(e)
        if "fy" in P:
            ed.append(self.rev_edge(s, P["fy"]))
        ed.append(self.opex_edge(s, (P.get("fy") or {}).get("v")) if own else missing("aum.opex", "החברה אינה מפרסמת דוח מגזרי לחברה המנהלת", seg=s, x=1))
        if "opex_ltm" in P:
            ed.append(edge("cpi.opex", 1, P["opex_ltm"]["v"] / 100, "assumption", "low",
                           P_calc(f"מדד ← הוצאות · {self.gname()} · {SEG_HE[s]}", nf(P["opex_ltm"]["v"] / 100, 2), "מיליוני ש״ח לכל 1 נ״א",
                                  "Δ הוצאות = הוצאות LTM × Δ מדד ÷ 100. הנחה: הצמדה מלאה (שכר ותפעול), בלי פיגור; לא נאמד בהיסטוריה (14 רבעונים, שינוי מדד קטן)",
                                  [("הוצאות LTM", nf(P["opex_ltm"]["v"]), P["opex_ltm"]["prov"]), ("מקדם הצמדה (הנחה)", "1.00", None)], est=True),
                           seg=s, note="assumption: full CPI pass-through to costs"))
        P["edges"] = ed
        return P

    def fee_edge(self, s, A, Ap):
        v = -A / 10000
        return edge("fee.op", 1, v, "identity", "high",
                    P_calc(f"1 נ״ב שחיקה ← רווח תפעולי · {self.gname()} · {SEG_HE[s]}", sn(v, 2), "מיליוני ש״ח לשנה",
                           "Δ רווח תפעולי = − נכסים ממוצעים × 0.01% (1 נ״ב, שנתי, לפני מס). ההוצאות אינן משתנות; תמהיל הנכסים קבוע",
                           [("נכסים ממוצעים ברבעון האחרון", nf(A / 1000, 2) + " מיליארד", Ap)]), seg=s, n=1, window=ql(self.I.last))

    def npv_fyP(self, s, row):
        return P_calc(f"תשואת דמי ניהול · {self.tag(s, self.I.last)} · LTM", pc(row["fy"], 4), "שנתי",
                      "Σ הכנסות מדמי ניהול בארבעת הרבעונים ÷ (Σ נכסים ממוצעים ברבעון ÷ 4) × 100 (flow_npv.json, LTM)",
                      [("Σ הכנסות", nf(row["fees"]), self.ltm_sum(s, "fees")), ("Σ נכסים ממוצעים ÷ 4", nf(row["avg"] / 4000, 2) + " מיליארד", self.ltm_avg(s))])

    def ltm_sum(self, s, k):
        rows = [self.I.by.get((self.g, s, q)) for q in self.I.ltm]
        if not all(rows) or not all((x.get("rep") or {}).get(k) is not None for x in rows):
            return None
        return self.sum4(s, {"fees": "הכנסות מדמי ניהול", "sm": "שיווק ומכירה", "ga": "הנהלה וכלליות"}[k], MM, [x["rep"][k] for x in rows], [self.repP(s, x, k) for x in rows])[1]

    def ltm_avg(self, s):
        rows = [self.I.by.get((self.g, s, q)) for q in self.I.ltm]
        if not all(rows):
            return None
        return self.sum4(s, "Σ נכסים ממוצעים", MM, [x["reg"]["avg"] for x in rows], [self.avgP(s, x) for x in rows], d=0)[1]

    def npv_edge(self, s, row):
        I = self.I
        ke = I.npv["meta"]["ke"]
        D = I.npv["dur"][s]["v"]
        a = fnpv.annuity(D, ke["v"])
        m = row["m"]
        v = 1000 * m / 100 * a
        mP = P_calc(f"מרווח תפעולי על נכסים · {self.tag(s, I.last)} · LTM", pc(m, 4), "לשנה", "m = תשואת דמי ניהול × (1 − הוצאות להכנסות ÷ 100) (flow_npv.json)",
                    [("תשואת דמי ניהול", pc(row["fy"], 4), self.npv_fyP(s, row)),
                     ("הוצאות להכנסות", pc(row["ci"], 2), P_calc(f"הוצאות להכנסות · {self.tag(s, I.last)} · LTM", pc(row["ci"], 2), "%", "(Σ שיווק ומכירה + Σ הנהלה וכלליות) ÷ Σ הכנסות × 100",
                                                                 [("Σ שיווק ומכירה", nf(row["sm"]), self.ltm_sum(s, "sm")), ("Σ הנהלה וכלליות", nf(row["ga"]), self.ltm_sum(s, "ga")), ("Σ הכנסות", nf(row["fees"]), self.ltm_sum(s, "fees"))]))])
        rfP = P_rep("תשואה נומינלית אפס 10 שנים, ממוצע חודשי", pc(ke["rf"], 2), "%", ke["rf_url"], None, "בנק ישראל · ZCM", ke["rf_month"][5:] + "/" + ke["rf_month"][2:4],
                    note=f"{ke['rf_code']} · נמשך {ke['rf_retrieved']}", src_type="נתון חיצוני")
        keP = P_calc("מחיר ההון (ke)", pc(ke["v"], 2), "%", "ke = ריבית חסרת סיכון + ביתא × פרמיית סיכון שוק (valuation.ts ASSUME0; flow_npv.json)",
                     [("ריבית חסרת סיכון", pc(ke["rf"], 2), rfP), ("ביתא (הנחה)", nf(ke["beta"], 2), None), ("פרמיית סיכון שוק (הנחה)", pc(ke["erp"], 2), None)], est=True)
        du = I.npv["dur"][s]
        DP = P_calc(f"משך (D) · {SEG_HE[s]}", f"{nf(D, 2)} שנים", "שנים", "D = Σ נכסים ממוצעים ÷ Σ (משיכות + ניוד החוצה), LTM, על המנהלים שמפרסמים ניוד החוצה (flow_npv.json → dur)",
                    [("Σ נכסים ממוצעים", nf(du["avg"], 0), None), ("Σ משיכות (רשות)", nf(du["wd"], 0), None), ("Σ ניוד החוצה (דוחות)", nf(du["out"], 0), None), ("מנהלים", str(du["n"]), None)], est=True,
                    note="הפירוט לכל מנהל ולכל חודש בעמוד הערך הנוכחי של הצבירה (/savings/npv)")
        q = "medium"
        notes = []
        if m <= 0:
            q = "low"
            notes.append("מרווח שלילי: ההוצאות ב-LTM עולות על ההכנסות, ולכן ניוד נכנס מוריד ערך")
        if row.get("mark"):
            q = "low"
            notes.append(row["mark"])
        prov = P_calc(f"מיליארד ש״ח ניוד נטו ← ערך נוכחי של רווח תפעולי · {self.gname()} · {SEG_HE[s]}", nf(v, 2), MM,
                      "NPV = F × m ÷ 100 × a(D, ke), F = 1,000 מיליוני ש״ח; a(D, ke) = (1 − (1 + ke)^−D) ÷ ke (M3, pipeline/build_flow_npv.py; לא נגזר מחדש)",
                      [("מרווח m", pc(m, 4), mP), ("משך D", nf(D, 2), DP), ("ke", pc(ke["v"], 2), keP), ("מקדם היוון a", nf(a, 3), None)], est=True,
                      note=" · ".join(notes) or "אומדן: מרווח ממוצע (לא שולי), בלי צמיחת היתרה ובלי שחיקת דמי ניהול; הנחות M3 מסומנות")
        e = edge("tr.npv", 1, v, "identity", q, prov, seg=s, n=4, window=f"LTM {ql(I.last)}", note="M3 formula over the LTM margin, duration and ke of flow_npv.json",
                 extra={"m": m, "D": D, "ke": ke["v"], "a": r(a, 6), "src": {"g": self.g, "s": s, "p": "LTM-" + I.last}})
        return e

    def rev_edge(self, s, fyn):
        fy = fyn["v"]
        return edge("aum.rev", 1, fy * 10, "identity", "high",
                    P_calc(f"מיליארד ש״ח נכסים ← הכנסות · {self.gname()} · {SEG_HE[s]}", nf(fy * 10, 2), "מיליוני ש״ח לשנה",
                           "Δ הכנסות = Δ נכסים × תשואת דמי הניהול: 1,000 מיליוני ש״ח × fy ÷ 100", [("תשואת דמי ניהול", pc(fy, 4), fyn["prov"])]),
                    seg=s, n=1, window=fyn["period"])

    def opex_edge(self, s, fy=None):
        """quarterly segment costs on average assets: opex = a + b × AUM. A fixed cost cannot be negative: when the free fit puts a < 0
        the fixed / variable split is not identified (the slope has absorbed a cost trend that moved with the assets), so the fit is
        re-run constrained at a = 0 (every cost variable: least squares through the origin, the boundary solution of a >= 0) and labelled.
        A variable cost above the fee yield (growth lowers profit) is kept as the data says, with the reason on the edge."""
        I = self.I
        xs, ys, qs = [], [], []
        for q in I.lens["quarters"]:
            x = I.by.get((self.g, s, q))
            rp = (x or {}).get("rep") or {}
            if x and rp.get("sm") is not None and rp.get("ga") is not None and x["reg"].get("avg"):
                xs.append(x["reg"]["avg"] / 1000)
                ys.append(rp["sm"] + rp["ga"])
                qs.append(q)
        if len(xs) < 6:
            return missing("aum.opex", f"{len(xs)} רבעונים עם הוצאות מגזריות: מעט מדי לאמידה", seg=s, x=1)
        f = ols([xs], ys)
        a0, b0 = f["b"]
        n = f["n"]
        win = f"{ql(qs[0])}–{ql(qs[-1])}"
        cons = a0 < 0
        if cons:
            sxx = fsum(x * x for x in xs)
            b = fsum(x * y for x, y in zip(xs, ys)) / sxx
            my = fsum(ys) / n
            sse = fsum((y - b * x) ** 2 for x, y in zip(xs, ys))
            sst = fsum((y - my) ** 2 for y in ys)
            r2 = 1 - sse / sst if sst else 0.0
            se = math.sqrt(sse / (n - 1) / sxx) if n > 1 else float("nan")
            a = 0.0
        else:
            a, b, se, r2 = a0, b0, f["se"][1], f["r2"]
        t = b / se if se else 0.0
        v = b * 4  # NIS m a year per NIS bn of average assets
        # a cross-check that a level trend cannot drive: quarter-on-quarter changes in costs on changes in assets
        dx = [q1 - q0 for q0, q1 in zip(xs, xs[1:])]
        dy = [q1 - q0 for q0, q1 in zip(ys, ys[1:])]
        fd = ols([dx], dy) if len(dx) >= 5 else None
        d4 = fd["b"][1] * 4 if fd else None
        notes, he = [], []
        if cons:
            notes.append(f"free fit: fixed cost a = {nf(a0, 1)} a quarter (negative), slope {nf(b0 * 4, 2)}: the slope absorbed a cost trend that moved with the assets; "
                         f"constrained at a = 0 (all costs variable)" + (f"; quarter-on-quarter changes give {nf(d4, 2)}" if d4 is not None else ""))
            he.append(f"בהתאמה החופשית יצא קבוע שלילי ({nf(a0, 1)} מיליוני ש״ח ברבעון) ושיפוע {nf(b0 * 4, 2)}: השיפוע ספג מגמת קיצוץ הוצאות שנעה יחד עם הנכסים. "
                      f"נאמד מחדש עם קבוע ≥ 0 (כל ההוצאות משתנות, קו דרך הראשית)" + (f"; שינויים רבעוניים נותנים {nf(d4, 2)}" if d4 is not None else ""))
        odd = fy is not None and v > fy * 10
        if odd:
            notes.append(f"variable cost {nf(v, 2)} per NIS bn exceeds the fee yield ({nf(fy * 10, 2)}): in this window costs rose with assets faster than fees "
                         "(a build-out); kept as fitted, so asset growth lowers operating profit here")
            he.append(f"ההוצאה המשתנה ({nf(v, 2)} לכל מיליארד) גבוהה מתשואת דמי הניהול ({nf(fy * 10, 2)}): בחלון זה ההוצאות גדלו עם הנכסים מהר מההכנסות (שלב בנייה). "
                      "נשמר כפי שנאמד: כאן גידול בנכסים מקטין את הרווח התפעולי")
        prov = P_calc(f"נכסים ← הוצאות (רכיב משתנה) · {self.gname()} · {SEG_HE[s]}", nf(v, 2), "מיליוני ש״ח לשנה לכל מיליארד ש״ח",
                      (f"OLS: הוצאות רבעון (שיווק + הנהלה, מהדוח) = a + b × נכסים ממוצעים (רשות, מיליארדים); ×4 לשנה. n = {n}, {win}, R² = {nf(r2, 2)}, t = {nf(t, 1)}"
                       + (". הקבוע שנאמד שלילי: האמידה עם a = 0 (b = Σxy ÷ Σx²)" if cons else "")),
                      [(f"b (רבעוני)", nf(b, 3), None), ("a (קבוע, רבעוני)", nf(a, 1), None)] + ([("a בהתאמה החופשית", nf(a0, 1), None), ("b בהתאמה החופשית (שנתי)", nf(b0 * 4, 2), None)] if cons else [])
                      + ([("שינויים רבעוניים: b (שנתי)", nf(d4, 2), None)] if cons and d4 is not None else [])
                      + [("R²", nf(r2, 2), None), ("n", str(n), None)] + ([("תשואת דמי ניהול × 10", nf(fy * 10, 2), None)] if fy is not None else [])
                      + [(ql(q), f"{nf(y, 1)} / {nf(x, 1)}", None) for q, x, y in zip(qs, xs, ys)][-4:], est=True,
                      note=" · ".join(he + ["הקשר בין נכסים להוצאות ברבעונים אלה כולל גם אינפלציה וצמיחה; האומדן הוא קשר היסטורי, לא עלות שולית מוכחת"]))
        q = q_reg(n, r2, t, monthly=False)
        if (cons or odd) and q == "high":
            q = "medium"
        fit = {"r2": r(r2, 3), "t": r(t, 2), "a": r(a, 3)}
        if cons:
            fit.update({"c": True, "a0": r(a0, 3), "b0": r(b0 * 4, 4)})
        if d4 is not None:
            fit["d"] = r(d4, 4)
        if v <= 0:
            return edge("aum.opex", 1, None, "regression", "low", prov, seg=s, n=n, window=win, fit={"r2": r(r2, 3), "t": r(t, 2)},
                        note="slope not positive: no usable variable-cost estimate; propagation uses 0", why="שיפוע לא חיובי: אין אומדן לרכיב משתנה")
        return edge("aum.opex", 1, v, "regression", q, prov, seg=s, n=n, window=win, fit=fit, note="; ".join(notes) or None)

    def beta_edges(self, s):
        """r(t) = a + b_eq × equity proxy(t) + b_y × Δ10Y(t) / 100, monthly, the group's asset-weighted return of the segment's tracks"""
        I = self.I
        end = I.lens["meta"]["asof"]
        months = [madd(end, -k) for k in range(WINDOW_M - 1, -1, -1)]
        X1, X2, Y, used = [], [], [], []
        for p in months:
            c = I.cell.get((self.g, s, p))
            yp, yc = I.y10.get(madd(p, -1)), I.y10.get(p)
            if not c or not c[5] or p not in I.eq or yp is None or yc is None:
                continue
            Y.append(c[4] / c[5]); X1.append(I.eq[p]); X2.append((yc - yp) * 100 / 100); used.append(p)
        if len(Y) < 24:
            return [missing("eq.aum", f"{len(Y)} חודשים עם תשואה ונכסים ברשות: מעט מדי", seg=s, x=1), missing("y10.aum", "כנ״ל", seg=s, x=100)]
        f = ols([X1, X2], Y)
        win = f"{ym(used[0])}–{ym(used[-1])}"
        ds = SEG_DS[s]
        res = [x for x in I.res[ds]]
        srcP = P_rep(f"{DS_HE[ds]}: תשואה חודשית ונכסים, מסלולי {self.gname()}", f"{len(Y)} חודשים", "%", f"{CKAN}/dataset/{I.pkg[ds]}", None, DS_HE[ds], win,
                     note=f"MONTHLY_YIELD משוקלל בנכסים (market.json y_num ÷ y_den), {', '.join(x['name'] for x in res)}", src_type="רשות שוק ההון · data.gov.il")
        eqP = P_rep(f"תשואה חודשית, קטגוריית '{EQ_CAT}' בגמל-נט (מתאם המניות של מעבדת התרחישים)", f"{len(Y)} חודשים", "%", f"{CKAN}/dataset/{I.pkg['gemel']}", None, "גמל-נט", win,
                    note="funds/cat.json: תשואה משוקללת בנכסים של מסלולי המניות", src_type="רשות שוק ההון · data.gov.il")
        cv = I.curve
        yP = P_rep("תשואה נומינלית אפס 10 שנים, ממוצע חודשי (שינוי חודשי)", f"{len(Y)} חודשים", "%", cv["url"], None, "בנק ישראל · ZCM", win,
                   note=f"{cv['codes']['nominal']['10']} · macro/boi_curve.json · נמשך {cv['retrieved']}", src_type="נתון חיצוני")
        out = []
        for i, (eid, x, lab, unitlab, scale) in enumerate((("eq.aum", 1, "מניות", "% לכל 1%", 1), ("y10.aum", 100, "תשואת 10 שנים", "% לכל 100 נ״ב", 1))):
            b, se = f["b"][i + 1], f["se"][i + 1]
            t = b / se if se else 0.0
            v = b * scale
            prov = P_calc(f"{lab} ← נכסים מנוהלים · {self.gname()} · {SEG_HE[s]}", sn(v, 3), unitlab,
                          f"OLS חודשי: תשואת התיק (%) = a + b₁ × תשואת מניות (%) + b₂ × Δ תשואת 10 שנים (נ״א). n = {f['n']}, {win}, R² = {nf(f['r2'], 2)}, t = {nf(t, 1)}. "
                          "Δ נכסים ÷ נכסים = b × הזעזוע (בלי השפעת תזרים)",
                          [("תשואות התיק", f"{f['n']} חודשים", srcP), ("תשואת מניות", f"{f['n']} חודשים", eqP), ("Δ תשואת 10 שנים", f"{f['n']} חודשים", yP),
                           ("b₁ (מניות)", nf(f["b"][1], 3), None), ("b₂ (100 נ״ב)", nf(f["b"][2], 3), None), ("R²", nf(f["r2"], 3), None)], est=True)
            q = q_reg(f["n"], f["r2"], t, monthly=True)
            fit = {"r2": r(f["r2"], 3), "t": r(t, 2), "se": r(se, 4)}
            exp = EDGE_OF[eid][3]
            if (v > 0) - (v < 0) != exp:
                out.append(edge(eid, x, None, "regression", "low", prov, seg=s, n=f["n"], window=win, fit=fit, note=f"fitted sign {sn(v, 3)} contradicts the expected sign; not used",
                                why="הסימן שנאמד הפוך לצפוי; לא בשימוש"))
            else:
                out.append(edge(eid, x, v * (1 if eid == "eq.aum" else 1), "regression", q, prov, seg=s, n=f["n"], window=win, fit=fit))
        return out

    def aum_identity(self, s):
        """AUM(t) = AUM(t−1) × (1 + r) + deposits − withdrawals + transfers, month by month over the window: the median residual"""
        I = self.I
        end = I.lens["meta"]["asof"]
        res = []
        for k in range(WINDOW_M - 1, -1, -1):
            p = madd(end, -k)
            a, b = I.cell.get((self.g, s, p)), I.cell.get((self.g, s, madd(p, -1)))
            if not a or not b or not a[5] or b[0] <= 0 or a[0] <= 0 or a[6] < 0.98 * a[0]:
                continue  # the lens's rule: a month whose flows do not cover its assets is not a flow month
            pred = b[0] * (1 + a[4] / a[5] / 100) + a[1] - a[2] + a[3]
            res.append(abs(a[0] - pred) / a[0] * 100)
        if len(res) >= 12:
            res.sort()
            med = res[len(res) // 2]
            return self.check(f"aum_rollforward.{s}", f"AUM(t) = AUM(t−1) × (1 + r) + צבירה נטו · {self.gname()} · {SEG_HE[s]}: חציון השארית החודשית, % מהנכסים ({len(res)} חודשים)",
                              med, 0.0, 0.5, unit="%", level="warn"), med
        return True, None

    def check(self, cid, he, lhs, rhs, tol, unit=MM, level="fail"):
        ok = abs(lhs - rhs) <= tol
        self.checks.append({"id": cid, "he": he, "lhs": r(lhs, 4), "rhs": r(rhs, 4), "tol": tol, "unit": unit, "ok": ok, "level": level})
        return ok

    # ---------------- group lines (lines.json)
    def line(self, key, per):
        x = self.I.lines["data"].get(key, {}).get(self.c)
        if not x:
            return None
        for cell in x["cells"]:
            if self.I.LP[cell[0]] == per:
                pi, v, pg, ui, fl = cell
                url = self.I.lines["urls"][ui] if ui is not None else None
                t, d = per
                return {"v": v / 1000, "pg": pg, "url": url, "der": bool(fl & 1), "label": x["label"]}
        return None

    def lineP(self, key, per, title):
        c = self.line(key, per)
        if not c:
            return None, None
        return c["v"], P_rep(f"{title} · {self.name} · {plab(*per)}", nf(c["v"]), MM, c["url"], c["pg"], f"דוח כספי · {c['label']}", plab(*per),
                             note="Q4 נגזר: FY פחות 9M מאותו דוח" if c["der"] else None, der=True if c["der"] else None)

    def ltm_line(self, key, title):
        qs = [("Q", d) for d in ("2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30")]
        vals, provs = [], []
        for per in qs:
            v, p = self.lineP(key, per, title)
            if v is None:
                return None, None
            vals.append(v); provs.append(p)
        tot = fsum(vals)
        return tot, P_calc(f"{title} · {self.name} · LTM Q2'26", nf(tot), MM, "סכום ארבעת הרבעונים Q3'25, Q4'25, Q1'26, Q2'26 (lines.json)",
                           [(plab(*per), nf(v), p) for per, v, p in zip(qs, vals, provs)])

    def group(self):
        A = self.I.A
        tax = A["tax"]
        n = self.nodes
        np_key = "np_attr" if self.line("np_attr", ("Q", "2026-06-30")) else "np"
        eq_key = "equity_attr" if self.line("equity_attr", ("I", "2026-06-30")) else "total_equity"
        v, p = self.ltm_line(np_key, "רווח נקי לבעלי המניות" if np_key == "np_attr" else "רווח נקי (כולל זכויות מיעוט)")
        if v is not None:
            n["net_profit"] = node(v, MM, "LTM Q2'26", p, basis=np_key)
        for key, nid, title in (("pbt", "pbt", "רווח לפני מס"), ("tax", "tax_exp", "מסים על ההכנסה"), ("np", "np_total", "רווח נקי"),
                                ("ins_res", "isr", "רווח משירותי ביטוח"), ("inv_fin", "inv_income", "רווח מהשקעות ומימון, נטו"), ("op_profit", "op_group", "רווח תפעולי (דוח)")):
            v, p = self.ltm_line(key, title)
            if v is not None:
                n[nid] = node(v, MM, "LTM Q2'26", p)
        # identity: net profit = profit before tax − tax, FY'25 and LTM
        for per in (("FY", "2025-12-31"), ("Q", "2026-06-30")):
            a, b, c = self.line("np", per), self.line("pbt", per), self.line("tax", per)
            if a and b and c:
                self.check(f"np_identity.{per[0]}{per[1][:4]}", f"רווח נקי = רווח לפני מס − מס · {plab(*per)}", a["v"], b["v"] - c["v"], max(1.5, abs(a["v"]) * 0.001))
        if "pbt" in n and "tax_exp" in n and n["pbt"]["v"]:
            te = n["tax_exp"]["v"] / n["pbt"]["v"] * 100
            n["tax_eff"] = node(te, "%", "LTM Q2'26", P_calc(f"שיעור מס אפקטיבי · {self.name} · LTM Q2'26", pc(te, 1), "%", "מסים על ההכנסה ÷ רווח לפני מס × 100",
                                                              [("מסים", nf(n["tax_exp"]["v"]), n["tax_exp"]["prov"]), ("רווח לפני מס", nf(n["pbt"]["v"]), n["pbt"]["prov"])]))
        n["tax"] = node(tax, "%", "הנחה", P_calc("שיעור מס שולי (הנחה)", pc(tax, 2), "%", "מס חברות 23% ומס רווח 17% במוסדות כספיים: valuation.ts ASSUME0.tax", [], est=True,
                                                note="הנחה אחידה לכל החברות; השיעור האפקטיבי מוצג בנפרד"))
        e0, p0 = self.lineP(eq_key, ("I", "2025-06-30"), "הון לבעלי המניות" if eq_key == "equity_attr" else "סך ההון")
        e1, p1 = self.lineP(eq_key, ("I", "2026-06-30"), "הון לבעלי המניות" if eq_key == "equity_attr" else "סך ההון")
        if e0 is not None and e1 is not None:
            avg = (e0 + e1) / 2
            n["equity"] = node(avg, MM, "ממוצע Q2'25–Q2'26", P_calc(f"הון ממוצע · {self.name}", nf(avg), MM, "(הון ליום 30.06.25 + הון ליום 30.06.26) ÷ 2",
                                                                    [("Q2'25", nf(e0), p0), ("Q2'26", nf(e1), p1)]), basis=eq_key)
            n["equity_end"] = node(e1, MM, "Q2'26", p1, basis=eq_key)
        if "net_profit" in n and "equity" in n:
            roe = n["net_profit"]["v"] / n["equity"]["v"] * 100
            n["roe"] = node(roe, "%", "LTM Q2'26", P_calc(f"תשואה להון · {self.name} · LTM Q2'26", pc(roe, 1), "%", "רווח נקי LTM ÷ הון ממוצע × 100",
                                                         [("רווח נקי LTM", nf(n["net_profit"]["v"]), n["net_profit"]["prov"]), ("הון ממוצע", nf(n["equity"]["v"]), n["equity"]["prov"])]))
            self.edges.append(edge("np.roe", 100, 100 / n["equity"]["v"] * 100, "identity", "high",
                                   P_calc(f"100 מיליוני ש״ח רווח ← תשואה להון · {self.name}", sn(10000 / n["equity"]["v"], 3), "נ״א", "Δ ROE = Δ רווח נקי ÷ הון ממוצע × 100",
                                          [("הון ממוצע", nf(n["equity"]["v"]), n["equity"]["prov"])])))
        # ke and justified P/B (the valuation page's model; price never enters)
        ke = self.I.npv["meta"]["ke"]
        keP = P_calc("מחיר ההון (ke)", pc(ke["v"], 2), "%", "ke = ריבית חסרת סיכון (בנק ישראל, אפס 10 שנים) + ביתא × פרמיית סיכון שוק",
                     [("ריבית חסרת סיכון", pc(ke["rf"], 2), P_rep("תשואה נומינלית אפס 10 שנים, ממוצע חודשי", pc(ke["rf"], 2), "%", ke["rf_url"], None, "בנק ישראל · ZCM",
                                                                  ke["rf_month"][5:] + "/" + ke["rf_month"][2:4], note=ke["rf_code"], src_type="נתון חיצוני")),
                      ("ביתא (הנחה)", nf(A["beta"], 2), None), ("פרמיית סיכון שוק (הנחה)", pc(A["erp"], 2), None)], est=True)
        n["ke"] = node(ke["v"], "%", ke["rf_month"][5:] + "/" + ke["rf_month"][2:4], keP)
        self.edges.append(edge("y10.ke", 100, 1.0, "identity", "high", P_calc("100 נ״ב בתשואת 10 שנים ← מחיר ההון", "+1.00", "נ״א", "ke = rf + β × ERP, rf = תשואת 10 שנים: Δke = Δrf", [("rf", pc(ke["rf"], 2), keP)])))
        g = A["g"]
        if "roe" in n and ke["v"] > g:
            pb = (n["roe"]["v"] - g) / (ke["v"] - g)
            n["pb"] = node(pb, "x", "LTM Q2'26", P_calc(f"מכפיל הון מוצדק · {self.name}", f"{nf(pb, 2)}x", "x", "P/B = (ROE − g) ÷ (ke − g) (valuation.ts justifiedPb)",
                                                         [("ROE", pc(n["roe"]["v"], 1), n["roe"]["prov"]), ("ke", pc(ke["v"], 2), keP), ("g (הנחה)", pc(g, 1), None)], est=True), g=g)
            self.edges.append(edge("roe.pb", 1, 1 / (ke["v"] - g), "identity", "high",
                                   P_calc(f"1 נ״א ROE ← מכפיל הון מוצדק · {self.name}", nf(1 / (ke["v"] - g), 3), "x", "d(P/B) ÷ d(ROE) = 1 ÷ (ke − g)", [("ke", pc(ke["v"], 2), keP), ("g", pc(g, 1), None)], est=True)))
        self.edges.append(edge("op.np", 1, 1 - tax / 100, "identity", "high", P_calc("1 ש״ח לפני מס ← רווח נקי", nf(1 - tax / 100, 4), "ש״ח", "1 − שיעור המס (הנחה אחידה, valuation.ts)", [("שיעור מס", pc(tax, 2), n["tax"]["prov"])], est=True)))
        self.debt()
        self.cash()

    def cash(self):
        """the nostro's cash and cash equivalents (the balance sheet's 'other' cash: not the yield-dependent policyholders' cash) reprice
        within the year: Δ investment income (run rate, pre-tax) = cash × Δ 1Y yield. Short-term holdings beyond cash are not split out
        in lines.json, so the channel is a lower bound of the nostro's short end"""
        v, p = self.lineP("cash", ("I", "2026-06-30"), "מזומנים ושווי מזומנים אחרים (נוסטרו)")
        if v is None:
            self.edges.append(missing("y1.inv", "שורת המזומנים של הנוסטרו לא חולצה לחברה (lines.json: cash, מבטחות בלבד)" if self.kind == "insurance_group"
                                      else "שורת המזומנים לא חולצה לחברה (lines.json: cash מכסה את שבע המבטחות)", x=100))
            return
        self.nodes["cash"] = node(v, MM, "Q2'26", p)
        self.edges.append(edge("y1.inv", 100, v / 100, "identity", "medium",
                               P_calc(f"100 נ״ב בתשואת שנה ← הכנסה ממזומני הנוסטרו · {self.name}", sn(v / 100, 2), "מיליוני ש״ח לשנה",
                                      "Δ הכנסה מהשקעות (קצב שנתי, לפני מס) = מזומנים ושווי מזומנים אחרים × Δ תשואת שנה ÷ 10,000. הנחה: היתרה ליום 30.06.26 נשמרת "
                                      "ומתומחרת מחדש בתוך השנה (שווי מזומנים: עד 3 חודשים) בתשואת השנה",
                                      [("מזומנים ושווי מזומנים אחרים", nf(v), p)], est=True,
                                      note="רק המזומנים: השקעות קצרות אחרות של הנוסטרו אינן מופרדות בדוח שחולץ, ולכן זה חסם תחתון. אינו כלול ברגישות הריבית שגולתה "
                                           "(הזזה מקבילה, השפעה מיידית על השווי)"),
                               n=1, window="Q2'26",
                               note="identity over the printed balance; assumption: the Q2'26 balance is held and reprices within the year at the 1Y yield; "
                                    "other short-term nostro holdings are not split out (lower bound); not part of the disclosed parallel-shift rate sensitivity"))

    def debt(self):
        I = self.I
        co = next((x for x in I.debt["companies"] if x["id"] == self.c), None)
        if not co or not co["walls"]:
            for eid, x in (("cpi.fin", 1), ("y10.fin", 100), ("policy.fin", 100)):
                self.edges.append(missing(eid, "אין טופס ת126 (מצבת התחייבויות) לקבוצה", x=x))
            return
        w = co["walls"][0]
        if months_between(w["end"], "2026-06-30") > 12:
            for eid, x in (("cpi.fin", 1), ("y10.fin", 100), ("policy.fin", 100)):
                self.edges.append(missing(eid, f"טופס ת126 האחרון ליום {dlab(w['end'])}: ישן מ-12 חודשים", x=x))
            return
        df = I.debt_files.get(self.c, {})
        cells = {(c[0], c[1], c[2]): c for c in df.get("cells", [])}
        cpi = y1 = tot = 0.0
        parts = []
        for pt in w["parts"]:
            table = "solo" if pt["k"] in ("solo", "sep") else pt["k"]
            c = cells.get((pt["rid"], table, "total"))
            if not c:
                for eid, x in (("cpi.fin", 1), ("y10.fin", 100)):
                    self.edges.append(missing(eid, f"תא הסיכום של הטופס {pt['rid']} לא נמצא", x=x))
                self.edges.append(missing("policy.fin", "הטופס מפרסם הצמדה ומועדי פירעון, לא ריבית קבועה מול משתנה", x=100))
                return
            prin = c[11] - c[10]
            self.check(f"debt_parts.{pt['rid']}.{table}", f"ת126 {pt['rid']} ({table}): קרן לפי הצמדה = קרן בסיכום הקיר", prin / 1000, pt["b"]["total"][0] / 1000, 0.01)
            cpi += c[3] / 1000
            y1 += pt["b"]["y1"][0] / 1000
            tot += prin / 1000
            parts.append((pt, c))
        formP = lambda pt, what, v: P_rep(f"{what} · {pt['k']} · ישות {pt['e']}", nf(v), MM, MAYA + pt["url"], None, f"MAYA טופס ת126 · {pt['ref']}", dlab(w["end"]),
                                          note="מצבת התחייבויות לפי מועדי פירעון; אלפי ש\"ח בטופס, מוצג במיליונים")
        cpiP = P_calc(f"קרן צמודת מדד · {self.name} · {dlab(w['end'])}", nf(cpi), MM, "Σ עמודת 'שקלי צמוד מדד' בשורת הסיכום, על חלקי הקיר המאוחד (build_debt.py)",
                      [(f"{pt['k']} · {pt['e']}", nf(c[3] / 1000), formP(pt, "קרן צמודת מדד", c[3] / 1000)) for pt, c in parts])
        y1P = P_calc(f"פירעונות קרן ב-12 החודשים הבאים · {self.name} · {dlab(w['end'])}", nf(y1), MM, "Σ שורת השנה הראשונה, קרן, על חלקי הקיר",
                     [(f"{pt['k']} · {pt['e']}", nf(pt["b"]["y1"][0] / 1000), formP(pt, "פירעון שנה ראשונה", pt["b"]["y1"][0] / 1000)) for pt, _ in parts])
        self.nodes["debt_cpi"] = node(cpi, MM, dlab(w["end"]), cpiP)
        self.nodes["debt_y1"] = node(y1, MM, dlab(w["end"]), y1P)
        self.nodes["debt_total"] = node(tot, MM, dlab(w["end"]), P_calc(f"קרן חוב · {self.name}", nf(tot), MM, "Σ קרן על חלקי הקיר", [(f"{pt['k']} · {pt['e']}", nf((c[11] - c[10]) / 1000), formP(pt, "קרן", (c[11] - c[10]) / 1000)) for pt, c in parts]))
        self.edges.append(edge("cpi.fin", 1, cpi / 100, "identity", "medium",
                               P_calc(f"1 נ״א מדד ← הוצאות מימון · {self.name}", nf(cpi / 100, 2), "מיליוני ש״ח לשנה", "Δ הוצאות מימון = קרן צמודת מדד × Δ מדד ÷ 100 (הפרשי הצמדה)",
                                      [("קרן צמודת מדד", nf(cpi), cpiP)]), n=1, window=dlab(w["end"]),
                               note="contractual principal (undiscounted); the balance sheet carries amortised cost"))
        self.edges.append(edge("y10.fin", 100, y1 / 100, "assumption", "low",
                               P_calc(f"100 נ״ב ← הוצאות מימון · {self.name}", nf(y1 / 100, 2), "מיליוני ש״ח לשנה", "Δ הוצאות מימון = פירעונות 12 חודשים × Δ תשואה ÷ 10,000 × 100. הנחה: הפירעונות ממוחזרים בתשואה החדשה, באותו מרווח",
                                      [("פירעונות 12 חודשים", nf(y1), y1P)], est=True), n=1, window=dlab(w["end"]), note="assumption: maturities refinanced at the shocked yield"))
        # policy -> financing: ת126 prints linkage (CPI, unlinked, FX) and maturities, never fixed vs floating. Table ג (credit from banks,
        # per entity filing a solo form) is the only lender split: its unlinked-shekel principal is ASSUMED prime-linked (prime = policy +
        # 1.5pp), bonds fixed. Subsidiaries' debt (table ח) is printed without a lender split, so their bank credit is not covered.
        bank, bparts = 0.0, []
        for pt in w["parts"]:
            if pt["k"] not in ("solo", "sep"):
                continue
            c = cells.get((pt["rid"], "bank", "total"))
            b = c[4] / 1000 if c else 0.0
            bank += b
            bparts.append((pt, b, c is not None))
        bankP = P_calc(f"אשראי מבנקים, שקלי לא צמוד · {self.name} · {dlab(w['end'])}", nf(bank), MM,
                       "Σ עמודת 'שקלי לא צמוד' בשורת הסיכום של טבלה ג (אשראי מתאגידים בנקאיים) בטפסי הסולו של הקיר; ישות בלי טבלה ג = 0",
                       [(f"{pt['k']} · {pt['e']}", nf(b), formP(pt, "אשראי מבנקים, שקלי לא צמוד", b) if has else None) for pt, b, has in bparts])
        self.nodes["debt_bank"] = node(bank, MM, dlab(w["end"]), bankP)
        self.edges.append(edge("policy.fin", 100, bank / 100, "assumption", "low",
                               P_calc(f"100 נ״ב בריבית בנק ישראל ← הוצאות מימון · {self.name}", nf(bank / 100, 2), "מיליוני ש״ח לשנה",
                                      "Δ הוצאות מימון = אשראי בנקאי שקלי לא צמוד × Δ ריבית בנק ישראל ÷ 10,000. הנחה: האשראי הבנקאי צמוד פריים (פריים = ריבית בנק ישראל + 1.5 נ״א), "
                                      "האג\"ח בריבית קבועה. טופס ת126 מפרסם הצמדה ומועדי פירעון בלבד, לא ריבית קבועה מול משתנה",
                                      [("אשראי בנקאי שקלי לא צמוד", nf(bank), bankP)], est=True,
                                      note="חוב החברות הבנות (טבלה ח) מודפס בלי פיצול למלווים: האשראי הבנקאי שלהן אינו כלול"),
                               n=1, window=dlab(w["end"]),
                               note="assumption: unlinked bank credit (ת126 table ג, solo forms) floats with prime; bonds fixed; subsidiaries' bank credit not split (not covered)"))

    # ---------------- insurers: CSM, release, solvency, disclosures, targets
    def insurer(self):
        I = self.I
        n = self.nodes
        cf = I.csm_facts.get(self.c)
        urls = {x["period"]: x["url"] for x in cf["files"]} if cf else {}
        reports = list(cf["reports"].items()) if cf else []
        # the CSM at the last balance date, by the one rule
        res = csm_resolve.resolve(reports, "2026Q2", "2026-06-30") if reports else None
        if res:
            f0 = res["fs"][0]
            fp = lambda f, rp: P_rep(f"CSM · {self.name} · Q2'26 · {res['label']}", nf(abs(f['v'])), MM, urls.get(rp), f.get("pg"), f"דוח כספי {per_lab(rp)}", "Q2'26", note=f.get("l"))
            prov = fp(f0, res["rp"]) if len(res["fs"]) == 1 else P_calc(f"CSM · {self.name} · Q2'26", nf(res["v"]), MM, "חיים ועוד בריאות (csm_resolve.py)", [(f["s"], nf(abs(f["v"])), fp(f, res["rp"])) for f in res["fs"]])
            n["csm"] = node(res["v"], MM, "Q2'26", prov, basis=res["label"])
        # release rate: FY'25 gross release, life + health, over the average gross CSM of the same report
        fy = cf["reports"].get("2025FY", []) if cf else []
        rel = [f for f in fy if f["m"] == "csm_release" and f["d"][:10] == "2025-12-31" and f.get("w") in ("fy", "ytd") and f.get("b") == "gross" and f["g"] in ("life", "health")]
        clo = {d: [csm_resolve._pick([f for f in fy if csm_resolve.usable(f)], g, "gross", d) for g in ("life", "health")] for d in ("2024-12-31", "2025-12-31")}
        if len({f["g"] for f in rel}) == 2 and all(all(v) for v in clo.values()) and len(rel) == 2:
            R = fsum(abs(f["v"]) for f in rel)
            c0 = fsum(abs(f["v"]) for f in clo["2024-12-31"])
            c1 = fsum(abs(f["v"]) for f in clo["2025-12-31"])
            rate = R / ((c0 + c1) / 2)
            rp = lambda f, t: P_rep(f"{t} · {self.name} · {f['g']} · FY'25", nf(abs(f["v"])), MM, urls.get("2025FY"), f.get("pg"), "דוח כספי FY'25", "FY'25", note=f.get("l"))
            relP = P_calc(f"קצב שחרור CSM · {self.name} · FY'25", pc(rate * 100, 1), "לשנה", "שחרור CSM ברוטו (חיים + בריאות) ÷ ממוצע יתרת CSM ברוטו (חיים + בריאות) בתחילת השנה ובסופה",
                          [(f"שחרור · {f['g']}", nf(abs(f["v"])), rp(f, "שחרור CSM")) for f in rel] +
                          [(f"CSM ברוטו · {f['g']} · {dlab(d)}", nf(abs(f["v"])), rp(f, f"CSM ברוטו {dlab(d)}")) for d, fs in clo.items() for f in fs])
            n["csm_release_rate"] = node(rate * 100, "%", "FY'25", relP)
            self.edges.append(edge("csm.isr", 1, rate, "identity", "medium", relP, n=1, window="FY'25",
                                   note="the FY'25 rate applied to a shocked CSM: the coverage units of the new CSM are assumed to run off like the book"))
        else:
            self.edges.append(missing("csm.isr", "שחרור CSM ברוטו או יתרות ברוטו לחיים ולבריאות לא חולצו מהדוח השנתי", x=1))
        # IFRS 17 disclosures: CSM, profit, equity, per risk (the stress lab's pickIfrs, ported)
        mine = [x for x in I.sens if x["c"] == self.c]
        tbl = sorted({x["pg"] for x in mine if x.get("rp") == "2025FY" and x.get("pg")})
        where = f"ביאור הרגישויות בדוח FY'25 (עמ' {', '.join(str(p) for p in tbl)})"
        gap_he = {"credit.csm": f"{where} מפרסם ריבית, מניות, תמותה ותחלואה בלבד: אין שורת מרווחי אשראי, ובדוח אין גילוי כמותי אחר של רגישות למרווחים (סיכון המרווח מתואר במילים בלבד)",
                  "lapse.csm": f"{where} מפרסם ריבית, מניות, תמותה ותחלואה בלבד: אין שורת ביטולים. אף מבטחת אינה מפרסמת רגישות CSM לביטולים בדוחות FY'25"}
        for eff, effs, eid in (("csm", ("csm",), "csm"), ("np", ("profit", "pe"), "np"), ("eqb", ("equity", "pe", "profit"), None)):
            pts_all = {}
            for risk in RISKS:
                pick = None
                for e in effs:
                    for b in ("net", "na", "gross"):
                        pts = {}
                        for x in mine:
                            if x["eff"] != e or x["b"] != b or x["risk"] != risk or x.get("dir") is None or x.get("size") is None:
                                continue
                            xx = x["dir"] * x["size"] * (100 if risk == "rate" else 1)
                            pts.setdefault(xx, x)
                        if pts:
                            pick = (e, b, pts)
                            break
                    if pick:
                        break
                if not pick:
                    continue
                e, b, pts = pick
                pts_all[risk] = {"eff": e, "b": b, "pts": [{"x": xx, "v": x["v"], "p": self.sensP(x)} for xx, x in sorted(pts.items())]}
            self.lines_out[eff] = pts_all
            if eid is None:
                continue
            for risk in RISKS:
                sk = RISK_SHOCK[risk]
                key = f"{sk}.{eid}"
                if key not in EDGE_OF:
                    continue
                L = pts_all.get(risk)
                if not L:
                    self.edges.append(missing(key, gap_he[key] if key in gap_he and tbl else "החברה לא גילתה רגישות זו בדוח IFRS 17 (FY'25)", x=None))
                    continue
                xs = {p["x"]: p for p in L["pts"]}
                x0 = {"rate": -50, "equity": -10, "mortality": -5, "morbidity": 5, "lapse": 10}[risk]
                p = xs.get(x0) or L["pts"][0]
                row = next(x for x in mine if x["eff"] == L["eff"] and x["b"] == L["b"] and x["risk"] == risk and x.get("dir") is not None and x["dir"] * x["size"] * (100 if risk == "rate" else 1) == p["x"])
                age = months_between(row["d"], "2026-06-30")
                note = f"basis {L['b']}; effect {L['eff']}" + ("; after tax" if row.get("tax") == "after" else "")
                if eid == "np" and L["eff"] == "pe":
                    note += "; printed as one row for profit and equity"
                self.edges.append(edge(key, p["x"], p["v"], "disclosure", q_age(age), p["p"], n=len(L["pts"]), window=dlab(row["d"]),
                                       rng=[r(min(q["v"] for q in L["pts"]), 3), r(max(q["v"] for q in L["pts"]), 3)], note=note,
                                       extra={"pts": [[q["x"], q["v"]] for q in L["pts"]], "d": row["d"]}))
        for key in ("credit.csm", "lapse.csm"):
            if not any(e["id"] == key for e in self.edges):
                self.edges.append(missing(key, gap_he[key] if tbl else "גילויי הרגישות של IFRS 17 לא חולצו לחברה"))
        self.edges.append(missing("policy.np", "גילויי הרגישות של IFRS 17 לא חולצו לחברה" if not tbl else f"{where} מפרסם רגישות לתזוזה מקבילה של עקום הריבית חסר הסיכון (מחובר לזעזוע 10 שנים) ולא לקצה הקצר או לריבית בנק ישראל; "
                                  "ההשפעה על התוצאה המימונית של IFRS 17 לא נאמדת", x=100))
        self.solvency()

    def sensP(self, x):
        return P_rep(f"{x['l'][:80]} · {self.name} · {dlab(x['d'])}", nf(x["v"]), MM, x.get("u"), x.get("pg"), f"דוח כספי {per_lab(x['rp'])} · גילוי רגישות", dlab(x["d"]),
                     note=f"בסיס {x['b']}{' · אחרי מס' if x.get('tax') == 'after' else ''} · {x['eff']}")

    def solvency(self):
        I = self.I
        n = self.nodes
        cap = I.cap.get(self.c, {})
        pkey = lambda p: (int(p[:4]), {"Q1": 1, "Q2": 2, "Q3": 3, "FY": 4}[p[4:]])
        endof = lambda p: p[:4] + {"Q1": "-03-31", "Q2": "-06-30", "Q3": "-09-30", "FY": "-12-31"}[p[4:]]
        capP = lambda k, p, x, title, unit: P_rep(f"{title} · {self.name} · {per_lab(p)}", nf(x["v"], 1 if unit == "%" else 0) + ("%" if unit == "%" else ""), unit, x.get("u"), x.get("pg"),
                                                  "דוח כושר פירעון כלכלי" if x.get("solv") else "דוח כספי", per_lab(p), note=x.get("s"))
        # the base: the latest date where own funds, SCR and the with-transitional ratio are all printed
        common = sorted({p for p in cap.get("of", {}) if p in cap.get("scr", {}) and p in cap.get("sr_w", {})}, key=pkey)
        if not common:
            for k in ("y10.solv_w", "y10.solv_wo", "eq.solv_w", "eq.solv_wo", "credit.solv_w", "mortality.solv_w", "morbidity.solv_w", "lapse.solv_w", "solv.dist"):
                self.edges.append(missing(k, "אין הון עצמי, SCR ויחס כושר פירעון לאותו תאריך"))
            return
        # own funds ÷ SCR must give the printed ratio: a date where the two were read on different bases (pages) is skipped, and said so
        ok = [p for p in common if abs(cap["of"][p]["v"] / cap["scr"][p]["v"] * 100 - cap["sr_w"][p]["v"]) <= 1.0]
        b = (ok or common)[-1]
        skipped = [p for p in common if pkey(p) > pkey(b)]
        of, scr, srw = cap["of"][b], cap["scr"][b], cap["sr_w"][b]
        if skipped:
            self.notes.append({"id": "solv_base", "he": "בסיס כושר הפירעון: תאריכים מאוחרים דולגו כי הון עצמי ÷ SCR אינו שווה ליחס שהודפס (" + ", ".join(
                f"{per_lab(p)}: {nf(cap['of'][p]['v'] / cap['scr'][p]['v'] * 100, 1)}% מול {nf(cap['sr_w'][p]['v'], 1)}%" for p in skipped) + "); כנראה שני בסיסים בעמודים שונים", "skipped": skipped})
        n["own_funds"] = node(of["v"], MM, per_lab(b), capP("of", b, of, "הון עצמי לכושר פירעון", MM), d=endof(b))
        n["scr"] = node(scr["v"], MM, per_lab(b), capP("scr", b, scr, "הון נדרש לכושר פירעון (SCR)", MM), d=endof(b))
        n["solv_w"] = node(srw["v"], "%", per_lab(b), capP("sr_w", b, srw, "יחס כושר פירעון, עם הוראות מעבר", "%"), d=endof(b))
        self.check(f"solvency_identity.{b}", f"יחס כושר פירעון = הון עצמי ÷ SCR · {per_lab(b)}", of["v"] / scr["v"] * 100, srw["v"], 1.0, unit="%")
        wo = cap.get("sr_wo", {}).get(b)
        if wo:
            n["solv_wo"] = node(wo["v"], "%", per_lab(b), capP("sr_wo", b, wo, "יחס כושר פירעון, ללא הוראות מעבר", "%"), d=endof(b))
        for k, lab in (("sr_w", "יחס כושר פירעון אחרון, עם הוראות מעבר"), ("sr_wo", "יחס כושר פירעון אחרון, ללא הוראות מעבר")):
            ps = sorted(cap.get(k, {}), key=pkey)
            if ps:
                n[k + "_latest"] = node(cap[k][ps[-1]]["v"], "%", per_lab(ps[-1]), capP(k, ps[-1], cap[k][ps[-1]], lab, "%"), d=endof(ps[-1]))
        base_d = endof(b)
        self.edges.append(edge("solv.dist", 1, scr["v"] / 100, "identity", "high",
                               P_calc(f"1 נ״א ביחס ← הון עודף · {self.name}", nf(scr["v"] / 100, 1), "מיליוני ש״ח", "Δ הון עודף = SCR × Δ יחס ÷ 100 (SCR קבוע)", [("SCR", nf(scr["v"]), n["scr"]["prov"])]),
                               n=1, window=per_lab(b)))
        # targets in force at the base date (stress.ts targetsAt, ported; drivers.ts re-picks from the same facts)
        facts = []
        cf = I.csm_facts.get(self.c)
        if cf:
            urls = {x["period"]: x["url"] for x in cf["files"]}
            for rp, F in cf["reports"].items():
                for f in F:
                    if f["m"].startswith("target_"):
                        facts.append({"m": f["m"], "d": f["d"][:10], "v": f["v"], "l": f.get("l", ""), "s": f.get("s", ""), "n": f.get("n", ""), "pg": f.get("pg"), "rp": rp, "u": urls.get(rp)})
        facts = [f for f in facts if TARGET.match(f["m"]) or THRESH.match(f["m"])]
        facts.sort(key=lambda f: (f["d"], f["rp"], f["m"], f["v"]))
        self.targets = facts
        for basis, key in (("w", "w"), ("wo", "wo")):
            t = targets_at(facts, base_d, basis)
            for kind, f in (("board", t["board"]), ("div", t["div"])):
                if f:
                    n[f"target_{kind}_{key}"] = node(f["v"], "%", dlab(f["d"]), P_rep(f"{'יעד הדירקטוריון' if kind == 'board' else 'סף חלוקת דיבידנד'} ({'עם' if basis == 'w' else 'ללא'} הוראות מעבר) · {self.name}",
                                                                                     pc(f["v"], 0), "%", f["u"], f["pg"], f"דוח כספי {per_lab(f['rp'])}", dlab(f["d"]), note=(f["l"] or "")[:120]), m=f["m"])
        # the disclosed solvency points (the stress lab's xOfSolv / solvLines): the newest date, plus the range over every disclosure
        sens = [x for x in I.solv["sens"] if x["c"] == self.c and x_of_solv(x) is not None]
        reps = I.solv["reports"]
        solvP = lambda x: P_rep(f"{x['l']} · {self.name} · {dlab(x['d'])}", spp(x['v']), "נקודות אחוז", MAYA + reps[str(x["r"])]["f"] if str(x["r"]) in reps else None, x.get("pg"),
                                "דוח כושר פירעון כלכלי", dlab(x["d"]), note=f"בסיס: {'עם הוראות מעבר' if x['b'] == 'w' else 'ללא הוראות מעבר' if x['b'] == 'wo' else 'לא צוין'}")
        if not sens:
            have = sorted({v["as_of"] for v in reps.values() if v.get("c") == self.c})
            why = ("רגישויות יחס כושר הפירעון לא חולצו לחברה: דוחות כושר הפירעון שבמאגר הם ליום " + ", ".join(dlab(d) for d in have) +
                   " בלבד, בלי טבלת רגישות; הדוח הכספי FY'25 אינו מפרסם רגישות של היחס") if have else "רגישויות יחס כושר הפירעון לא חולצו לחברה (אין דוח כושר פירעון במאגר)"
            for k in ("y10.solv_w", "y10.solv_wo", "eq.solv_w", "eq.solv_wo", "mortality.solv_w", "morbidity.solv_w", "lapse.solv_w"):
                self.edges.append(missing(k, why))
            self.edges.append(missing("credit.solv_w", "רגישות למרווחי אשראי אינה מופיעה בגילויים שחולצו"))
            return
        newest = max(x["d"] for x in sens)
        at = [x for x in sens if x["d"] == newest]
        self.lines_out["solv"] = {"d": newest, "b": sorted({x["b"] for x in at}), "pts": {}}
        for risk in RISKS:
            pts = {}
            for x in at:
                if x["risk"] == risk:
                    pts.setdefault(x_of_solv(x), x)
            if pts:
                self.lines_out["solv"]["pts"][risk] = [{"x": xx, "v": x["v"], "b": x["b"], "p": solvP(x)} for xx, x in sorted(pts.items())]
        age = months_between(newest, base_d)
        for risk in RISKS:
            sk = RISK_SHOCK[risk]
            L = self.lines_out["solv"]["pts"].get(risk)
            hist = [x for x in sens if x["risk"] == risk]
            for basis in ("w", "wo"):
                key = f"{sk}.solv_{basis}"
                if key not in EDGE_OF:
                    continue
                if not L:
                    self.edges.append(missing(key, f"לא גולתה רגישות ל{ {'rate': 'ריבית', 'equity': 'מניות', 'mortality': 'תמותה', 'morbidity': 'תחלואה', 'lapse': 'ביטולים'}[risk]} בדוח כושר הפירעון האחרון ({dlab(newest)})"))
                    continue
                p = L[0] if risk != "rate" else next((q for q in L if q["x"] < 0), L[0])
                same = [x for x in hist if x_of_solv(x) == p["x"] and (x["b"] == "wo") == (p["b"] == "wo")]  # the range on the point's own basis
                rng = [min(x["v"] for x in same), max(x["v"] for x in same)]
                dates = sorted({x["d"] for x in same})
                win = f"{dlab(dates[0])}–{dlab(dates[-1])}" if len(dates) > 1 else dlab(dates[0])
                q = q_age(age)
                notes = [f"disclosed {dlab(newest)}; base ratio {per_lab(b)}; {age} months apart"]
                if p["b"] == "na":
                    notes.append("basis not stated in the disclosure: applied to the with-transitional ratio")
                if basis == "w":
                    pr = P_calc(f"{shock_he(risk, p['x'])} ← יחס כושר פירעון · {self.name}", spp(p['v']), "נקודות אחוז",
                                "כפי שגולה בדוח כושר הפירעון האחרון; טווח: כל הגילויים לאותו זעזוע", [(f"{dlab(x['d'])} · בסיס {'עם' if x['b'] == 'w' else 'ללא' if x['b'] == 'wo' else 'לא צוין'}", spp(x['v']), solvP(x)) for x in sorted(same, key=lambda z: (z["d"], z["b"]))],
                                note="ישן: הגילוי האחרון רחוק יותר מ-36 חודשים מיחס הבסיס" if q == "low" else None)
                    self.edges.append(edge(key, p["x"], p["v"], "disclosure", q, pr, n=len(dates), window=win, rng=rng, note="; ".join(notes),
                                           extra={"d": newest, "b": p["b"], "pts": [[z["x"], z["v"]] for z in L]}))
                else:
                    wo_pts = [z for z in L if z["b"] == "wo"]
                    if wo_pts:
                        z = wo_pts[0]
                        self.edges.append(edge(key, z["x"], z["v"], "disclosure", q, z["p"], n=1, window=dlab(newest), note="; ".join(notes), extra={"d": newest, "b": "wo", "pts": [[y["x"], y["v"]] for y in wo_pts]}))
                    elif "solv_wo" in n:
                        ratio = n["solv_wo"]["v"] / n["solv_w"]["v"]
                        v = p["v"] * ratio
                        pr = P_calc(f"{shock_he(risk, p['x'])} ← יחס ללא הוראות מעבר (אומדן) · {self.name}", f"{sn(v, 1)} נ״א", "נקודות אחוז",
                                    "אומדן: ההשפעה שגולתה על היחס עם הוראות מעבר × (יחס ללא ÷ יחס עם). הנחה: הזעזוע מזיז את שני היחסים באותו שיעור יחסי; לא גולה ללא הוראות מעבר",
                                    [("ההשפעה שגולתה", spp(p['v']), p["p"]), ("יחס ללא הוראות מעבר", pc(n["solv_wo"]["v"], 0), n["solv_wo"]["prov"]), ("יחס עם הוראות מעבר", pc(n["solv_w"]["v"], 0), n["solv_w"]["prov"])], est=True)
                        self.edges.append(edge(key, p["x"], v, "assumption", "low", pr, n=1, window=dlab(newest), note="assumption: the same relative move on both bases (no without-transitional disclosure)",
                                               extra={"d": newest, "b": "wo~", "scale": r(ratio, 6), "pts": [[z["x"], z["v"]] for z in L]}))
                    else:
                        self.edges.append(missing(key, "אין יחס ללא הוראות מעבר לתאריך הבסיס"))
        self.edges.append(missing("credit.solv_w", "רגישות למרווחי אשראי אינה מופיעה בגילויי כושר הפירעון שחולצו (ריבית, מניות, תמותה, תחלואה, ביטולים, נדל\"ן)"))

    def build(self, built):
        I = self.I
        out = {"meta": {"company": self.c, "name": self.name, "kind": self.kind, "built": built, "base": {"q": ql(I.last), "end": "2026-06-30", "ltm": [ql(q) for q in I.ltm]},
                        "assume": {"tax": I.A["tax"], "g": I.A["g"], "beta": I.A["beta"], "erp": I.A["erp"], "ke": I.npv["meta"]["ke"]["v"], "rf": I.npv["meta"]["ke"]["rf"], "rf_month": I.npv["meta"]["ke"]["rf_month"]}}}
        if self.c == EMPLOYER:
            out["meta"]["flag"] = "employer"
            out["meta"]["flag_note"] = "the owner's employer: elasticities are mechanics computed like every other company's, not a view or a forecast"
        if self.reg.get("market_group") and self.c == "more_gemel":
            out["meta"]["note"] = "the regulator group of מור: savings figures are the group's, shared with drivers/more.json; no statements of its own"
        if self.g is not None:
            for s in ("pen", "gem", "ic"):
                p = self.product(s)
                if p:
                    self.products.append(p)
        self.edges.append(policy_y1(I))
        if I.pol_base is not None:
            M = I.macro
            self.nodes["policy_rate"] = node(I.pol_base, "%", "Q2'26", P_rep("ריבית בנק ישראל ביום 30.06.26", pc(I.pol_base, 2), "%", M["url"], None, f"בנק ישראל · {M['code']}", "Q2'26",
                                                                       note=f"macro/macro.json: הריבית בתוקף ביום הבסיס · נמשך {M['retrieved']}", src_type="נתון חיצוני"))
        if 202606 in I.y1:
            cv = I.curve
            self.nodes["y1"] = node(I.y1[202606], "%", "06/26", P_rep("תשואה נומינלית אפס שנה, ממוצע 06/26", pc(I.y1[202606], 2), "%", cv["url"], None, "בנק ישראל · ZCM", "06/26",
                                                                 note=f"{cv['codes']['nominal']['1']} · macro/boi_curve.json · נמשך {cv['retrieved']}", src_type="נתון חיצוני"))
        if self.reg.get("has_financials") and self.c != "more_gemel":
            self.group()
        else:
            for eid, x in (("cpi.fin", 1), ("y10.fin", 100), ("policy.fin", 100), ("y1.inv", 100)):
                self.edges.append(missing(eid, "לחברה אין דוחות כספיים באתר", x=x))
        if self.kind == "insurance_group" and self.reg.get("has_financials"):
            self.insurer()
        # the savings totals the outputs start from
        prods = [p for p in self.products if p["s"] in ("pen", "gem")]
        if prods and all("fees_ltm" in p for p in prods):
            tot = fsum(p["fees_ltm"]["v"] for p in prods)
            self.nodes["revenue"] = node(tot, MM, f"LTM {ql(I.last)}", P_calc(f"הכנסות מדמי ניהול, פנסיה וגמל · {self.name} · LTM", nf(tot), MM, "Σ המוצרים (מגזרי)",
                                                                         [(p["he"], nf(p["fees_ltm"]["v"]), p["fees_ltm"]["prov"]) for p in prods]))
        if prods and all("op_ltm" in p for p in prods):
            tot = fsum(p["op_ltm"]["v"] for p in prods)
            self.nodes["op_profit"] = node(tot, MM, f"LTM {ql(I.last)}", P_calc(f"רווח תפעולי, פנסיה וגמל · {self.name} · LTM", nf(tot), MM, "Σ המוצרים (מגזרי, לפני מס)",
                                                                           [(p["he"], nf(p["op_ltm"]["v"]), p["op_ltm"]["prov"]) for p in prods]))
        out["products"] = self.products
        out["nodes"] = self.nodes
        out["edges"] = self.edges
        out["lines"] = self.lines_out
        out["targets"] = getattr(self, "targets", [])
        out["checks"] = self.checks
        out["notes"] = self.notes
        return out


# ------------------------------------------------------------------------------------------------------------------------------ the short end
def policy_y1(I):
    """Δ1Y = a + β × Δpolicy, monthly changes of monthly means (BoI 1Y nominal zero on the policy rate's calendar-day mean), over the months
    the policy series covers to the regulator's last month. Changes, not levels: two trending rates in levels give a spurious fit. The same
    edge in every company file (a market relation, not a company's)"""
    if getattr(I, "_py1", None) is not None:
        return json.loads(json.dumps(I._py1))
    ms = sorted(m for m in I.pol if m in I.y1)
    pairs = [(m0, m1) for m0, m1 in zip(ms, ms[1:]) if mdiff(m1, m0) == 1]
    if len(pairs) < 24:
        e = missing("policy.y1", f"{len(pairs)} חודשים של ריבית בנק ישראל ותשואת שנה: מעט מדי לאמידה", x=100)
    else:
        X = [I.pol[m1] - I.pol[m0] for m0, m1 in pairs]
        Y = [I.y1[m1] - I.y1[m0] for m0, m1 in pairs]
        f = ols([X], Y)
        b, se = f["b"][1], f["se"][1]
        t = b / se if se else 0.0
        win = f"{ym(pairs[0][1])}–{ym(pairs[-1][1])}"
        M = I.macro
        cv = I.curve
        polP = P_rep("ריבית בנק ישראל, ממוצע חודשי לפי ימים", f"{len(pairs) + 1} חודשים", "%", M["url"], None, f"בנק ישראל · {M['code']}", win,
                     note=f"macro/macro.json: ימי השינוי של הריבית ({len(M['changes'])} שינויים מ-{M['changes'][0][0]}), ממוצע לפי ימי לוח · נמשך {M['retrieved']}", src_type="נתון חיצוני")
        y1P = P_rep("תשואה נומינלית אפס שנה, ממוצע חודשי", f"{len(pairs) + 1} חודשים", "%", cv["url"], None, "בנק ישראל · ZCM", win,
                    note=f"{cv['codes']['nominal']['1']} · macro/boi_curve.json · נמשך {cv['retrieved']}", src_type="נתון חיצוני")
        prov = P_calc("ריבית בנק ישראל ← תשואת שנה", nf(b * 100, 1), "נ״ב לכל 100 נ״ב",
                      f"OLS חודשי בשינויים: Δ תשואת שנה (נ״א) = a + β × Δ ריבית בנק ישראל (נ״א), ממוצעים חודשיים. n = {f['n']}, {win}, R² = {nf(f['r2'], 2)}, t = {nf(t, 1)}",
                      [("ריבית בנק ישראל", f"{f['n'] + 1} חודשים", polP), ("תשואת שנה", f"{f['n'] + 1} חודשים", y1P), ("β", nf(b, 3), None), ("a (נ״א לחודש)", nf(f["b"][0], 3), None),
                       ("R²", nf(f["r2"], 3), None)], est=True,
                      note="העברה בתוך החודש: תשואת השנה מקדימה את ההחלטה, ולכן β חודשי הוא חלק מהתזוזה המלאה. החלון כולל מחזור העלאה והורדה אחד")
        q = q_reg(f["n"], f["r2"], t, monthly=True)
        e = edge("policy.y1", 100, b * 100, "regression", q, prov, n=f["n"], window=win, fit={"r2": r(f["r2"], 3), "t": r(t, 2), "se": r(se, 4), "a": r(f["b"][0], 4)},
                 note="monthly changes of monthly means; the 1Y yield anticipates decisions, so the same-month beta understates the full pass-through; one hiking and one cutting cycle")
    I._py1 = e
    return json.loads(json.dumps(e))


# ------------------------------------------------------------------------------------------------------------------------------ stress.ts ports
TARGET = re.compile(r"^target_solvency_ratio(_board|_minimum|_min_stability|_min_stability_with_transitional|_min_with_transitional|_min_without_transitional|_with_transitional_minimum|_min(imum)?_with(out)?_transitional)?$")
THRESH = re.compile(r"^target_(solvency_ratio_dividend_threshold|dividend_threshold|solvency_dividend_threshold)")
WO = re.compile(r"without[ _](the )?(application of )?(the )?(transitional|tmtp)|ללא (התחשבות ב|יישום |)הוראות", re.I)
WI = re.compile(r"\bwith[ _](the )?(application of )?(the )?(transitional|tmtp)|taking (the |into account the )?transitional|בתקופת הפריסה|ביישום הוראות|בהתחשב בהוראות|תוך התחשבות בהוראות", re.I)


def basis_of(f):
    if re.search(r"without_(transitional|tmtp)", f["m"]):
        return "wo"
    if re.search(r"with_(transitional|tmtp)", f["m"]):
        return "w"
    for t in (f.get("l") or "", f.get("s") or "", f.get("n") or ""):
        if WO.search(t):
            return "wo"
        if WI.search(t):
            return "w"
    return None


def targets_at(facts, d, basis):
    y, m = int(d[:4]), int(d[5:7]) + 6
    y, m = y + (m - 1) // 12, (m - 1) % 12 + 1
    until = f"{y:04d}-{m:02d}-{d[8:10]}"
    if until[5:] in ("02-30", "02-31", "04-31", "06-31", "09-31", "11-31"):  # JS Date overflow: setMonth rolls the day over
        until = {"02-30": f"{y:04d}-03-02", "02-31": f"{y:04d}-03-03"}.get(until[5:], f"{y:04d}-{m + 1:02d}-01")
    ok = [f for f in facts if (TARGET.match(f["m"]) or THRESH.match(f["m"])) and 90 <= f["v"] <= 250 and f["d"] <= until and basis_of(f) == basis]
    latest = lambda xs: sorted(xs, key=lambda f: (f["d"], f.get("rp") or ""))[-1] if xs else None
    return {"board": latest([f for f in ok if TARGET.match(f["m"])]), "div": latest([f for f in ok if THRESH.match(f["m"])])}


def x_of_solv(s):
    if s["risk"] not in RISKS:
        return None
    t = re.sub(r"\s+", " ", s["l"])
    dir_ = -1 if re.search(r"ירידה|הפחתה|decrease|down", t, re.I) else 1 if re.search(r"עלייה|עליה|תוספת|increase|up", t, re.I) else 0
    if not dir_:
        return None
    bp = re.search(r"(\d+(?:\.\d+)?)\s*(?:נקודות בסיס|נ\"ב|bp)", t, re.I)
    pct = re.search(r"(\d+(?:\.\d+)?)\s*%", t)
    if s["risk"] == "rate":
        return dir_ * float(bp.group(1)) if bp else None
    return dir_ * float(pct.group(1)) if pct else None


def shock_he(risk, x):
    he = {"rate": "ריבית", "equity": "מניות", "mortality": "תמותה", "morbidity": "תחלואה", "lapse": "ביטולים"}[risk]
    u = " נ״ב" if risk == "rate" else "%"
    return f"{he} {'+' if x > 0 else MINUS}{nf(abs(x), 0)}{u}"


# ------------------------------------------------------------------------------------------------------------------------------ build / verify
def build():
    I = Inputs()
    built = I.lens["meta"]["generated"]  # the build date follows the inputs, so a rebuild on another day is identical
    files = {"graph.json": graph(built)}
    for x in I.reg:
        files[f"{x['id']}.json"] = Co(I, x["id"]).build(built)
    return files, I


def walk_prov(p, path, bad):
    if not isinstance(p, dict) or "k" not in p:
        bad.append(("provenance", path, "not a source node"))
        return
    k = p["k"]
    if k == "report":
        if not p.get("url") and not p.get("doc"):
            bad.append(("provenance", path, "report without url or document"))
    elif k == "reg":
        if not isinstance(p.get("pi"), int) or p["pi"] < 0:
            bad.append(("provenance", path, "regulator month index"))
    elif k == "lts":
        if not (p.get("c") and p.get("metric") and p.get("period")):
            bad.append(("provenance", path, "lts key"))
    elif k == "calc":
        if not p.get("formula"):
            bad.append(("provenance", path, "calc without formula"))
        for i, x in enumerate(p.get("inputs", [])):
            if "p" in x:
                walk_prov(x["p"], f"{path}.in[{i}]", bad)
    elif k == "none":
        if not p.get("why"):
            bad.append(("provenance", path, "none without a reason"))
    else:
        bad.append(("provenance", path, f"unknown kind {k}"))


def verify(files, I):
    bad = []

    def finite(v, path):
        if isinstance(v, float) and not math.isfinite(v):
            bad.append(("NaN", path))
        elif isinstance(v, dict):
            for k, y in v.items():
                finite(y, f"{path}.{k}")
        elif isinstance(v, list):
            for i, y in enumerate(v):
                finite(y, f"{path}[{i}]")
    finite(files, "")
    A = assumptions()
    if not A or any(k not in A for k in ("tax", "g", "beta", "erp")):
        bad.append(("valuation.ts ASSUME0 not readable", A))
    ke = I.npv["meta"]["ke"]
    if A.get("beta") != ke["beta"] or A.get("erp") != ke["erp"]:
        bad.append(("ke constants differ between valuation.ts and flow_npv.json",))
    sens_rows = {(x["c"], x["eff"], x["b"], x["risk"], x.get("dir"), x.get("size")): x["v"] for x in I.sens}
    solv_rows = {}
    for x in I.solv["sens"]:
        solv_rows.setdefault((x["c"], x["d"], x["risk"], x_of_solv(x)), set()).add(x["v"])
    n_edges = n_missing = 0
    for name, d in files.items():
        if name == "graph.json":
            continue
        c = d["meta"]["company"]
        edges = list(d["edges"]) + [e for p in d["products"] for e in p["edges"]]
        for e in edges:
            n_edges += 1
            path = f"{c}:{e['id']}"
            if e["quality"] == "missing":
                n_missing += 1
                if e["v"] is not None or not e.get("why"):
                    bad.append(("missing edge with a value or without a reason", path))
                continue
            walk_prov(e.get("prov"), path, bad)
            if e["method"] not in ("identity", "regression", "disclosure", "assumption"):
                bad.append(("method", path, e["method"]))
            if e["method"] == "assumption" and e["quality"] != "low":
                bad.append(("an assumption above quality low", path))
            if e["v"] is None:
                if e["quality"] != "low" or not e.get("why"):
                    bad.append(("edge without a value must be low with a reason", path))
                continue
            sg = e["sign"]
            if e["e"] == "tr.npv":
                sg = (e["m"] > 0) - (e["m"] < 0)
                a = fnpv.annuity(e["D"], e["ke"])
                if abs(1000 * e["m"] / 100 * a - e["v"]) > 1e-6 * max(1, abs(e["v"])):
                    bad.append(("NPV per NIS 1bn differs from the M3 formula", path))
                row = I.npv_by.get((e["src"]["g"], e["src"]["s"], e["src"]["p"]))
                if not row or abs(row["m"] - e["m"]) > 1e-9 or abs(I.npv["dur"][e["src"]["s"]]["v"] - e["D"]) > 1e-9 or abs(ke["v"] - e["ke"]) > 1e-9:
                    bad.append(("NPV inputs differ from flow_npv.json", path))
                elif row.get("npv_tr") is not None and row.get("tr") and abs(row["tr"] / 1000 * e["v"] - row["npv_tr"]) > 0.01 + 1e-4 * abs(row["npv_tr"]):
                    bad.append(("NPV per NIS 1bn × the LTM transfers differs from flow_npv.json npv_tr", path))
            if sg and ((e["v"] > 0) - (e["v"] < 0)) not in (sg, 0):
                bad.append(("sign", path, e["v"], sg))
            if e["method"] == "disclosure" and e["to"] == "csm" or e["e"].endswith(".np") and e["method"] == "disclosure":
                for xx, vv in e.get("pts", []):
                    risk = next(k for k, s in RISK_SHOCK.items() if s == e["from"])
                    hit = [v for (cc, eff, b, rk, di, size), v in sens_rows.items() if cc == c and rk == risk and di is not None and size is not None and di * size * (100 if risk == "rate" else 1) == xx and v == vv]
                    if not hit:
                        bad.append(("disclosed point not in csm/sens.json", path, xx, vv))
            if e["method"] == "disclosure" and e["to"].startswith("solv"):
                risk = next(k for k, s in RISK_SHOCK.items() if s == e["from"])
                for xx, vv in e.get("pts", []):
                    if vv not in solv_rows.get((c, e["d"], risk, xx), set()):
                        bad.append(("disclosed point not in csm/solvency.json", path, xx, vv))
        for ln in ("csm", "np", "eqb"):
            for risk, L in d["lines"].get(ln, {}).items():
                for pt in L["pts"]:
                    walk_prov(pt["p"], f"{c}:lines.{ln}.{risk}", bad)
        for nid, nd in d["nodes"].items():
            walk_prov(nd["prov"], f"{c}:node.{nid}", bad)
        for p in d["products"]:
            for k in ("avg", "aum", "fy", "fees_ltm", "op_ltm", "opex_ltm", "tr_ltm", "org_ltm"):
                if k in p:
                    walk_prov(p[k]["prov"], f"{c}:{p['s']}.{k}", bad)
        for ch in d["checks"]:
            if not ch["ok"] and ch["level"] == "fail":
                bad.append(("identity does not reconcile", c, ch["id"], ch["lhs"], ch["rhs"], ch["tol"]))
    # the short end and the cost fits: one policy -> 1Y edge everywhere; the cash and bank-credit identities over their own nodes; a
    # constrained cost fit only where the free fixed cost was negative; a variable cost above the fee yield always carries its reason
    py = {dumps(d["edges"][[e["e"] for e in d["edges"]].index("policy.y1")]) for k, d in files.items() if k != "graph.json" and any(e["e"] == "policy.y1" for e in d["edges"])}
    if len(py) != 1 or sum(1 for k, d in files.items() if k != "graph.json" and any(e["e"] == "policy.y1" for e in d["edges"])) != len(files) - 1:
        bad.append(("policy.y1 differs between companies or is missing from one",))
    for name, d in files.items():
        if name == "graph.json":
            continue
        c = d["meta"]["company"]
        for e in d["edges"]:
            if e["e"] == "y1.inv" and e["v"] is not None and abs(e["v"] - d["nodes"]["cash"]["v"] / 100) > 1e-6:
                bad.append(("y1.inv differs from cash ÷ 100", c))
            if e["e"] == "policy.fin" and e["v"] is not None and abs(e["v"] - d["nodes"]["debt_bank"]["v"] / 100) > 1e-6:
                bad.append(("policy.fin differs from bank credit ÷ 100", c))
        if d["meta"]["kind"] == "insurance_group" and d["lines"].get("csm") and not any(e["e"] == "policy.np" and e["quality"] == "missing" for e in d["edges"]):
            bad.append(("insurer without the labelled policy -> IFRS 17 gap", c))
        for pr in d["products"]:
            for e in pr["edges"]:
                if e["e"] != "aum.opex" or e["v"] is None:
                    continue
                fit = e.get("fit") or {}
                if fit.get("c") and not fit.get("a0", 0) < 0:
                    bad.append(("constrained cost fit without a negative free intercept", c, pr["s"]))
                if not fit.get("c") and fit.get("a", 0) < 0:
                    bad.append(("cost fit with a negative fixed cost", c, pr["s"]))
                fy = (pr.get("fy") or {}).get("v")
                if fy is not None and e["v"] > fy * 10 and "exceeds the fee yield" not in (e.get("note") or ""):
                    bad.append(("variable cost above the fee yield without its reason", c, pr["s"]))
    gids = {e["id"] for e in files["graph.json"]["edges"]}
    for name, d in files.items():
        if name != "graph.json":
            for e in d["edges"] + [e for p in d["products"] for e in p["edges"]]:
                if e["e"] not in gids:
                    bad.append(("edge not in the graph", name, e["id"]))
    return bad, n_edges, n_missing


def dumps(d):
    return json.dumps(d, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    files, I = build()
    bad, n_edges, n_missing = verify(files, I)
    n_checks = sum(len(d["checks"]) for k, d in files.items() if k != "graph.json")
    if "--check" in sys.argv:
        diff = [k for k, d in files.items() if not (OUT / k).exists() or json.loads((OUT / k).read_text(encoding="utf8")) != json.loads(dumps(d))]
        stray = [f.name for f in OUT.glob("*.json") if f.name not in files] if OUT.exists() else []
        print(f"drivers: {len(files) - 1} companies, {n_edges} edges ({n_missing} missing with a reason), {n_checks} identity checks; "
              f"{'rebuild matches' if not diff and not stray else 'DIFFERS: ' + ', '.join(diff + stray)}; {len(bad)} misses")
        for b in bad[:20]:
            print("  ", b)
        sys.exit(0 if not bad and not diff and not stray else 1)
    if bad:
        print("misses:")
        for b in bad[:40]:
            print("  ", b)
        sys.exit(1)
    OUT.mkdir(parents=True, exist_ok=True)
    for k, d in files.items():
        (OUT / k).write_text(dumps(d), encoding="utf8")
    sz = sum((OUT / k).stat().st_size for k in files)
    print(f"wrote {OUT.relative_to(ROOT)}/: {len(files)} files, {sz:,} bytes; {len(files) - 1} companies, {n_edges} edges ({n_missing} missing with a reason), {n_checks} identity checks")
