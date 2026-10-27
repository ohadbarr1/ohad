"""A3 · the Expectations Decoder: what the current multiple requires you to believe, per listed company.

Reverse-engineers the market value. A forward model to FY'28 on A1's identities, a terminal value at the justified P/B, and a solver
that finds, one input at a time, the value that makes the model equal the market value (the "single-lever" view), and the FY'28 ROE
path that does the same. Each required input is then scored against what the company itself has done.

    value  = Σ PV(distributions, H2'26 · FY'27 · FY'28) + PV(justified P/B(ROE FY'28) × book FY'28)        discounted from the price date at ke
    NP(p)  = NP_norm + s × (1 − t) × [Δ savings op(p) + Δ CSM release(p)] + (1 − t) × rf × (book(p) − book₀)  (annual run rate × length)
    savings op(p) = avgAUM(p) × fee yield(p) × (1 − cost/income(p))                                         pension + gemel, segment figures
    avgAUM(p) = avgAUM(LTM) × (1 + CAGR)^τ;  τ = years from the LTM midpoint to the period's midpoint
    CSM release(p) = rate(p) × CSM;  CSM(next) = CSM + length × (rate₀ × CSM₀ − rate(p) × CSM)              new business held at the trailing release
    NP_norm = LTM attributable profit + the printed after-tax equity sensitivity at (normal equity return − LTM equity return), clamped at the
              disclosed points (normal = rf + β × ERP; the stress lab's reading of the IFRS 17 disclosure)
    distributions = payout (LTM dividends ÷ LTM profit) × NP;  book(next) = book + NP − distributions;  book₀ = equity at Q2'26 less the
              dividends paid between the balance date and the price date
    justified P/B = (ROE − g) ÷ (ke − g)  (valuation.ts);  ke, g, tax rate: ASSUME0 + the BoI 10Y (drivers/<co>.json meta.assume)
    a lever ramps linearly from its trailing value (LTM midpoint) to the solved value (FY'28 midpoint); AUM compounds at a constant CAGR

Inputs (all built and gated already)
  web/public/data/companies/index.json + <id>.price.json   the listed names (has_price); market value, shares and dividends at 22.10.26
                                                           (a single manual input per name, "מחיר 22.10.26, קלט ידני": no price history)
  web/public/data/drivers/<id>.json        A1: LTM profit, tax, equity, CSM, release rate, the savings segment, ke / g, disclosed sensitivities
  web/public/data/market.json              the regulator's monthly assets and posted fees per group (rolling two-year windows)
  web/public/data/lens.json                the managers' reported segment fees, costs and assets per quarter (fee yield trend, cost/income)
  web/public/data/kpi.json                 XBRL profit and equity (the LTM ROE of each quarter)
  web/public/data/funds/cat.json           gemel-net category returns: "גמל | מניות", the equity return of the normalisation
  web/public/data/targets.json, series/<id>.json   management's FY'28 targets as printed; the reported group AUM they compare with
Output
  web/public/data/expectations/<id>.json, expectations/index.json

python3 pipeline/build_expectations.py           build
python3 pipeline/build_expectations.py --check   rebuild in memory, compare with the files on disk, and verify: the forward model rebuilt from
                                                 each file's own stored inputs reproduces the market value at every solved input within 0.5%,
                                                 every figure carries provenance, the price date is shown, no NaN
Phoenix (the owner's employer) is computed like every other company. This is what the price implies, not a recommendation.
"""
import datetime as dt
import json
import math
import sys
from math import fsum
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web" / "public" / "data"
OUT = WEB / "expectations"
sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_drivers as A1  # noqa: E402  (provenance helpers, formats, the shared constants)

nf, pc, P_rep, P_calc, P_none, ols = A1.nf, A1.pc, A1.P_rep, A1.P_calc, A1.P_none, A1.ols
MM = A1.MM
CKAN = A1.CKAN
MAYA = A1.MAYA
EQ_CAT = A1.EQ_CAT
TOL = 0.5                 # %: the model must reproduce the market value at a solved input within this
SHARE_MIN = 15.0          # %: a lever whose segment is under this share of LTM pre-tax profit cannot move the price (nonbinding)
PLAUS_X = 2.0             # a requirement more than this multiple of the company's own historical maximum is not a finding (nonbinding)
N_HIST = 24               # quarters of history a required input is scored against
WIN = 24                  # months: the plausibility window ("the same two-year window")
PRICE_LABEL = "מחיר 22.10.26, קלט ידני"
SEG = ("pen", "gem")      # the savings segment: pension + gemel (the products whose P&L is printed per segment)
FAMS = {"pension", "gemel"}
H28 = "FY'28"
PER = [  # label, end, mid, length (years)
    ("H2'26", "2026-12-31", "2026-09-30", 0.5),
    ("FY'27", "2027-12-31", "2027-06-30", 1.0),
    ("FY'28", "2028-12-31", "2028-06-30", 1.0),
]
BOUNDS = {"aum": (-50.0, 300.0), "fee": (0.0, 5.0), "ci": (0.0, 200.0), "csm": (0.0, 100.0), "roe": (-50.0, 150.0)}
LEVER_HE = {"aum": "צמיחת נכסים, פנסיה וגמל", "fee": "תשואת דמי ניהול, פנסיה וגמל", "ci": "יחס עלות להכנסה, פנסיה וגמל",
            "csm": "קצב שחרור CSM", "roe": "ROE ב-FY'28"}
LEVER_UNIT = {"aum": "% לשנה", "fee": "% מהנכסים", "ci": "%", "csm": "% לשנה", "roe": "%"}


# ---------------------------------------------------------------- small helpers
def r6(x):
    return None if x is None else round(x, 6)


def iso(d):
    return dt.date.fromisoformat(d)


def years(a, b):
    return (iso(b) - iso(a)).days / 365.25


def mlab(p):  # 202606 -> "06/26"
    return f"{p % 100:02d}/{str(p // 100)[2:]}"


def qlab(p):  # 202606 -> "Q2'26"
    return f"Q{(p % 100 + 2) // 3}'{str(p // 100)[2:]}"


def madd(p, k):
    t = (p // 100) * 12 + p % 100 - 1 + k
    return (t // 12) * 100 + t % 12 + 1


def months_iso(d):  # "2026-06-30" -> 202606
    return int(d[:4]) * 100 + int(d[5:7])


def load(p):
    return json.loads((WEB / p).read_text(encoding="utf8"))


def fig(v, prov, unit=None, **kw):
    o = {"v": r6(v), "prov": prov}
    if unit:
        o["unit"] = unit
    o.update(kw)
    return o


def pct_rank(vals, req, higher_is_demanding=True):
    """share of the history that is less demanding than the requirement (100 = never done)"""
    if not vals:
        return None
    less = sum(1 for v in vals if (v < req if higher_is_demanding else v > req))
    return round(100.0 * less / len(vals), 1)


def eval_line(pts, x):
    """stress.ts evalLine: exact at a disclosed point, interpolated between (the origin sits between), clamped beyond"""
    if not pts or x == 0:
        return 0.0, False
    P = sorted(pts) + [(0.0, 0.0)]
    P.sort()
    lo, hi = P[0][0], P[-1][0]
    xe = min(max(x, lo), hi)
    for a, b in zip(P, P[1:]):
        if a[0] <= xe <= b[0]:
            if b[0] == a[0]:
                return a[1], xe != x
            return a[1] + (b[1] - a[1]) * (xe - a[0]) / (b[0] - a[0]), xe != x
    return 0.0, xe != x


# ---------------------------------------------------------------- the forward model (pure: numbers in, numbers out)
def model(m, x):
    """m: the stored model inputs of a company; x: {aum, fee, ci, csm} (the levers' FY'28 values; aum = CAGR) and optionally roe (FY'28 ROE).
    Returns the value and the path. Every quantity in NIS m or %."""
    ke, g, t, s, p = m["ke"] / 100, m["g"] / 100, m["tax"] / 100, m["attr"], m["payout"] / 100
    B = m["b0"] - m["div_after"]
    B0 = B
    csm = m["csm0"]
    rows, V = [], 0.0
    base_path = m.get("_base_roe")  # the trailing path's ROE per period (only for the ROE lever)
    for i, (lab, tau, L, tdisc) in enumerate(m["periods"]):
        w = tau / m["periods"][-1][1]
        if x.get("roe") is not None and base_path is not None:
            roe = base_path[i] + (x["roe"] - base_path[-1]) * w
            k = roe / 100 * L
            NP = k * B / (1 - k * (1 - p) / 2) if abs(1 - k * (1 - p) / 2) > 1e-9 else 0.0
        else:
            d_sav = 0.0
            if m["a_ltm"] is not None:
                A = m["a_ltm"] * (1 + x["aum"] / 100) ** tau
                fy = m["fy0"] + (x["fee"] - m["fy0"]) * w
                ci = m["ci0"] + (x["ci"] - m["ci0"]) * w
                d_sav = A * fy / 100 * (1 - ci / 100) - m["op0"]
            d_rel = 0.0
            if m["csm0"] is not None:
                rr = m["rr0"] + (x["csm"] - m["rr0"]) * w
                rel = rr / 100 * csm
                d_rel = rel - m["rr0"] / 100 * m["csm0"]
                csm = csm + L * (m["rr0"] / 100 * m["csm0"] - rel)
            run = m["np"] + m["adj"] + s * (1 - t) * (d_sav + d_rel) + (1 - t) * m["rf"] / 100 * (B - B0)
            NP = run * L
        D = p * NP
        Be = B + NP - D
        roe = NP / L / ((B + Be) / 2) * 100 if B + Be else 0.0
        V += D / (1 + ke) ** tdisc
        rows.append({"p": lab, "np": NP / L, "b": Be, "roe": roe, "d": D})
        B = Be
    roeT = rows[-1]["roe"] / 100
    jpb = (roeT - g) / (ke - g) if ke > g else float("nan")
    TV = jpb * B
    V += TV / (1 + ke) ** m["periods"][-1][3]
    return {"v": V, "rows": rows, "jpb": jpb, "tv": TV, "b28": B}


def trail_x(m):
    return {"aum": m["c0"] if m["a_ltm"] is not None else 0.0, "fee": m["fy0"], "ci": m["ci0"], "csm": m["rr0"], "roe": None}


def solve(m, key, target):
    """bisection on one lever, the others at their trailing value. status: ok / beyond (the bound is not enough) / below (even the lower
    bound gives too much)"""
    lo, hi = BOUNDS[key]
    x0 = trail_x(m)

    def f(v):
        x = dict(x0)
        x[key] = v
        return model(m, x)["v"] - target

    flo, fhi = f(lo), f(hi)
    if flo == fhi or (flo > 0) == (fhi > 0):
        inc = fhi > flo
        # both on the same side. beyond: even the most favourable bound leaves the model below the market value (bound = that end);
        # below: even the least favourable bound already justifies it (bound = that end)
        if flo < 0 and fhi < 0:
            return None, "beyond", (hi if inc else lo)
        return None, "below", (lo if inc else hi)
    a, b = lo, hi
    for _ in range(200):
        mid = (a + b) / 2
        fm = f(mid)
        if (fm > 0) == (flo > 0):
            a, flo = mid, fm
        else:
            b = mid
        if b - a < 1e-10:
            break
    return (a + b) / 2, "ok", None


# ---------------------------------------------------------------- inputs
class Inputs:
    def __init__(self):
        self.reg = load("companies/index.json")
        self.mkt = load("market.json")
        self.lens = load("lens.json")
        self.kpi = load("kpi.json")["companies"]
        self.tg = load("targets.json")
        self.cat = load("funds/cat.json").get(EQ_CAT)
        self.drv = {f.stem: json.loads(f.read_text(encoding="utf8")) for f in sorted((WEB / "drivers").glob("*.json")) if f.stem != "graph"}
        self.series = {f.stem: json.loads(f.read_text(encoding="utf8")) for f in sorted((WEB / "series").glob("*.json")) if f.stem != "index"}
        self._monthly()

    def _monthly(self):
        """per group x month: pension + gemel assets and the posted fee on assets (fee_num ÷ fee_den), the regulator's own sums"""
        P = self.mkt["periods"]
        fam = [x["family"] for x in self.mkt["products"]]
        cell = {}
        for row in self.mkt["rows"]:
            pi, prod, g, a, dep, wd, tr, fa, fn, fd, yn, yd, n = row
            if fam[prod] not in FAMS:
                continue
            c = cell.setdefault((g, P[pi]), [0.0, 0.0, 0.0])
            c[0] += a
            c[1] += fn
            c[2] += fd
        self.cell = cell
        self.P = P
        pk = self.mkt["meta"]["packages"]
        self.url_pen, self.url_gem = f"{CKAN}/dataset/{pk['pensia']}", f"{CKAN}/dataset/{pk['gemel']}"
        self.eq = dict(zip(self.cat["p"], self.cat["y"])) if self.cat else {}

    def aum(self, g, p):
        c = self.cell.get((g, p))
        return c[0] if c and c[0] > 0 else None

    def fee(self, g, p):
        c = self.cell.get((g, p))
        return c[1] / c[2] if c and c[2] else None


def reg_prov(I, gname, p, g=None):
    a = I.aum(g, p) if g is not None else None
    return P_rep(f"נכסים מנוהלים, פנסיה וגמל · {gname} · {mlab(p)}", nf(a / 1000, 1) + " מיליארד" if a else f"{mlab(p)}", MM, I.url_pen, None, "פנסיה-נט, גמל-נט", mlab(p),
                 note=f"market.json: סכום המסלולים של הקבוצה במשפחות פנסיה וגמל; גם {I.url_gem}", src_type="רשות שוק ההון · data.gov.il")


# ---------------------------------------------------------------- history: what the company has done
def kpi_roe(k):
    """LTM ROE per quarter end: kpi.ts CompanyKpi.value('roe') in Python (profit LTM ÷ average of equity now and four quarters back)"""
    per = k["periods"]
    idx = {p: i for i, p in enumerate(per)}
    canon = k.get("canon", {})

    def raw(key, p):
        i = idx.get(p)
        if i is None:
            return None
        c = canon.get(key, {}).get(p)
        return c[0] if c else k["values"].get(key, [None] * len(per))[i]

    def pk(y, q):
        return f"{y}FY" if q == 4 else f"{y}Q{q}"

    def quarter(y, q):
        if q < 4:
            return raw("profit", pk(y, q))
        c4 = canon.get("profit", {}).get(f"{y}Q4")
        if c4:
            return c4[0]
        fy, a, b, c = raw("profit", pk(y, 4)), raw("profit", pk(y, 1)), raw("profit", pk(y, 2)), raw("profit", pk(y, 3))
        return None if None in (fy, a, b, c) else fy - a - b - c

    out = []
    for p in per:
        y, q = int(p[:4]), (4 if p.endswith("FY") else int(p[5:]))
        if q == 4 and raw("profit", p) is not None:
            ltm = raw("profit", p)
        else:
            vs = []
            yy, qq = y, q
            for _ in range(4):
                vs.append(quarter(yy, qq))
                qq -= 1
                if qq == 0:
                    yy, qq = yy - 1, 4
            ltm = None if None in vs else fsum(vs)
        e1, e0 = raw("equity", p), raw("equity", pk(y - 1, q))
        if ltm is None or not e1 or not e0:
            continue
        out.append((p, ltm / ((e1 + e0) / 2) * 100, k["rid"][idx[p]] if k.get("rid") else None, ltm / 1000, e1 / 1000))
    return out


def per_tag(p):
    return f"FY'{p[2:4]}" if p.endswith("FY") else f"Q{p[5:]}'{p[2:4]}"


# ---------------------------------------------------------------- one company
class Co:
    def __init__(self, I, entry, price):
        self.I, self.e, self.px = I, entry, price
        self.id = entry["id"]
        self.d = I.drv.get(self.id)
        self.name = entry["name_he"]
        self.gaps = []

    # -- the market side
    def market(self):
        p = self.px
        vendor = f"{p['source']} · נייר {p['ticker']} · {PRICE_LABEL}"
        self.mcap = p["mcap"]
        self.mcapP = {"k": "price", "title": f"שווי שוק כפי שמפרסמת הבורסה ({PRICE_LABEL})", "value": f"{nf(p['mcap'], 0)} {MM}", "ticker": p.get("name") or p["ticker"],
                      "vendor": vendor, "date": p["asof"]}
        self.shP = {"k": "price", "title": "הון רשום למסחר (מניות)", "value": f"{nf(p['shares'] / 1e6, 1)} מיליון", "ticker": p.get("name") or p["ticker"], "vendor": vendor, "date": p["asof"]}
        self.pxP = {"k": "price", "title": f"מחיר למניה ({PRICE_LABEL})", "value": f"{nf(p['last'] / 100, 2)} ש\"ח", "ticker": p.get("name") or p["ticker"], "vendor": vendor, "date": p["asof"]}

    def build(self):
        d = self.d
        if not d:
            return self.na("אין קובץ מנגנונים (A1) לחברה")
        n = d["nodes"]
        V = lambda k: (n.get(k) or {}).get("v")  # noqa: E731  (rebound below when the filer's own figures replace the nodes)
        if V("equity_end") is None or V("net_profit") is None:
            return self.na("אין הון או רווח LTM מדווחים לחברה עצמה בקובץ המנגנונים (A1): המכפיל לא מחושב")
        if not self.px.get("mcap") or not self.px.get("shares"):
            return self.na("אין שווי שוק או מספר מניות בקובץ המחיר")
        self.market()
        I = self.I
        A = d["meta"]["assume"]
        self.filer = None
        k = I.kpi.get(self.id)
        if k and k.get("filer"):
            # the listed security is another entity (Yelin Lapidot under Atrao): the multiple, the profit and the book are the filer's own
            fl = k["filer"]
            rs = kpi_roe(k)
            if not rs or rs[-1][0] != {"Q2'26": "2026Q2"}.get(d["meta"]["base"]["q"], rs[-1][0]):
                return self.na(f"המחיר הוא של {fl['name']}; אין לה רווח LTM והון לרבעון הבסיס")
            p_, roe_, rid, ltm, e1 = rs[-1]
            xb = lambda title, v, concept: {"k": "xbrl", "title": f"{title} · {fl['name']} · {per_tag(p_)}", "value": nf(v), "unit": MM, "company": fl["name"], "period": per_tag(p_),
                                            "rid": rid, "concept": concept, "note": fl.get("note")}
            n = dict(n)
            n["equity_end"] = {"v": e1, "prov": xb("הון לבעלי המניות", e1, "EquityAttributableToOwnersOfParent")}
            n["net_profit"] = {"v": ltm, "prov": P_calc(f"רווח נקי LTM · {fl['name']} · {per_tag(p_)}", nf(ltm), MM, "Σ ארבעת הרבעונים (XBRL, kpi.json)", [("LTM", nf(ltm), xb("רווח לבעלי המניות", ltm, "ProfitLossAttributableToOwnersOfParent"))])}
            n["roe"] = {"v": roe_, "prov": P_calc(f"ROE LTM · {fl['name']} · {per_tag(p_)}", pc(roe_, 1), "%", "רווח LTM ÷ הון ממוצע (עכשיו ולפני שנה)", [("רווח LTM", nf(ltm), n["net_profit"]["prov"])])}
            for key in ("pbt", "tax_exp", "np_total"):
                n.pop(key, None)
            self.filer = fl
            V = lambda k: (n.get(k) or {}).get("v")  # noqa: E731
            self.gaps.append(f"המחיר הוא של {fl['name']} (מחזיקה {fl.get('stake', '–')}% ב{self.name}): המכפיל, הרווח וההון הם שלה; מנופי החיסכון של {self.name} לא מחושבים")
        base_end = d["meta"]["base"]["end"]
        ltm_mid = (iso(base_end) - dt.timedelta(days=0)).replace(year=iso(base_end).year - 1, month=12, day=31) if base_end[5:] == "06-30" else None
        if ltm_mid is None:
            return self.na(f"תאריך בסיס לא צפוי: {base_end}")
        ltm_mid = ltm_mid.isoformat()
        asof = self.px["asof"]
        self.base_q = d["meta"]["base"]["q"]
        # equity and the dividends paid after the balance date
        B0 = V("equity_end")
        sh = self.px["shares"]
        after = [(dd, a) for dd, a in self.px["dividends"] if base_end < dd <= asof]
        div_after = fsum(a for _, a in after) / 100 * sh / 1e6
        lo = f"{int(asof[:4]) - 1}{asof[4:]}"
        ltm_dps = fsum(a for dd, a in self.px["dividends"] if dd > lo) / 100
        NP = V("net_profit")
        payout = min(100.0, max(0.0, ltm_dps * sh / 1e6 / NP * 100)) if NP > 0 else 0.0
        vendor = f"{self.px['source']} · נייר {self.px['ticker']} · נגזר מהתאמת שער הבסיס ביום האקס"
        divP = {"k": "price", "title": "דיבידנד למניה, LTM לפי יום האקס", "value": f"{nf(ltm_dps, 2)} ש\"ח", "ticker": self.px.get("name") or self.px["ticker"], "vendor": vendor, "date": asof}
        payoutP = P_calc("שיעור חלוקה, LTM", pc(payout, 1), "%", "דיבידנד למניה LTM × מניות ÷ רווח נקי LTM לבעלי המניות (רכישות עצמיות לא נכללות)",
                         [("דיבידנד למניה, LTM", f"{nf(ltm_dps, 2)} ש\"ח", divP), ("מניות", f"{nf(sh / 1e6, 1)} מיליון", self.shP), ("רווח נקי LTM", nf(NP), n["net_profit"]["prov"])], est=True)
        divAfterP = P_calc(f"דיבידנד ששולם בין {A1.dlab(base_end)} לתאריך המחיר", nf(div_after), MM, "Σ דיבידנד למניה (יום אקס אחרי תאריך המאזן ועד תאריך המחיר) × מניות",
                           [(f"אקס {dd}", f"{nf(a / 100, 2)} ש\"ח", {"k": "price", "title": f"דיבידנד, אקס {dd}", "value": f"{nf(a / 100, 2)} ש\"ח", "ticker": self.px.get("name") or self.px["ticker"], "vendor": vendor, "date": asof}) for dd, a in after]
                           + [("מניות", f"{nf(sh / 1e6, 1)} מיליון", self.shP)])
        # tax and attribution
        pbt, tx, npt = V("pbt"), V("tax_exp"), V("np_total")
        if pbt is None and tx is not None and npt is not None:
            pbt = npt + tx
        if tx is None and pbt is not None and npt is not None:
            tx = pbt - npt
        if pbt and tx is not None and pbt > 0:
            tax = tx / pbt * 100
            taxP = P_calc(f"שיעור מס אפקטיבי · {self.name} · LTM", pc(tax, 1), "%", "מסים על ההכנסה ÷ רווח לפני מס (חסר אחד מהם: רווח לפני מס = רווח נקי + מסים)",
                          [(k, nf(v), (n.get(key) or {}).get("prov")) for k, v, key in (("מסים", tx, "tax_exp"), ("רווח לפני מס", pbt, "pbt"), ("רווח נקי", npt, "np_total")) if v is not None])
        else:
            tax = A["tax"]
            taxP = n["tax"]["prov"]
            self.gaps.append("אין רווח לפני מס ומסים: שיעור המס השולי (הנחה)")
        attr = NP / npt if npt else 1.0
        attrP = P_calc("חלק בעלי המניות ברווח", pc(attr * 100, 1), "%", "רווח לבעלי המניות ÷ רווח נקי", [("לבעלי המניות", nf(NP), n["net_profit"]["prov"])] + ([("רווח נקי", nf(npt), n["np_total"]["prov"])] if npt else []))
        ke, g, rf = A["ke"], A["g"], A["rf"]
        keP, rfP = n["ke"]["prov"], n["ke"]["prov"]["inputs"][0].get("p") if n["ke"]["prov"].get("inputs") else n["ke"]["prov"]
        gP = P_calc("צמיחה לטווח ארוך (g)", pc(g, 2), "%", "הנחה: אמצע יעד האינפלציה של בנק ישראל (1%–3%), valuation.ts ASSUME0", [], est=True)
        # normalised investment result: the printed after-tax equity sensitivity at the normal minus the LTM equity return
        adj, adjP, eqltm = 0.0, None, None
        pts = None if self.filer else ((d.get("lines") or {}).get("np") or {}).get("equity", {}).get("pts")
        ltm_months = [madd(months_iso(base_end), -k) for k in range(11, -1, -1)]
        if pts and all(mm in I.eq for mm in ltm_months):
            r = 1.0
            for mm in ltm_months:
                r *= 1 + I.eq[mm] / 100
            eqltm = (r - 1) * 100
            normal = rf + A["beta"] * A["erp"]
            x = normal - eqltm
            adj, clamped = eval_line([(q["x"], q["v"]) for q in pts], x)
            eqP = P_rep(f"תשואת '{EQ_CAT}' בגמל-נט, {mlab(ltm_months[0])}–{mlab(ltm_months[-1])}", pc(eqltm, 1), "%", self.I.url_gem, None, "גמל-נט", f"LTM {self.base_q}",
                        note="funds/cat.json: תשואה משוקללת בנכסים, מצטברת על 12 חודשים", src_type="רשות שוק ההון · data.gov.il")
            adjP = P_calc(f"נרמול תוצאת ההשקעות · {self.name}", nf(adj), MM,
                          "השפעת המניות על הרווח אחרי מס כפי שגולתה, בזעזוע = תשואה נורמלית (rf + β × ERP) − תשואת המניות LTM; בין הנקודות שגולו ליניארית, מעבר להן נעצר בקצה",
                          [("תשואת מניות LTM", pc(eqltm, 1), eqP), ("תשואה נורמלית (rf + β × ERP)", pc(normal, 2), keP), ("זעזוע", A1.sn(x, 1) + "%", None)]
                          + [(f"גילוי: מניות {A1.sn(q['x'], 0)}%", nf(q["v"]), q.get("p")) for q in pts], est=True,
                          note="נעצר בנקודה שגולתה (±10%)" if clamped else None)
        elif d["meta"]["kind"] == "insurance_group":
            self.gaps.append("אין גילוי רגישות רווח למניות: תוצאת ההשקעות LTM לא נורמלה")
        npn = NP + adj
        npnP = P_calc(f"רווח נקי מנורמל · {self.name} · LTM {self.base_q}", nf(npn), MM, "רווח נקי LTM לבעלי המניות + נרמול תוצאת ההשקעות",
                      [("רווח נקי LTM", nf(NP), n["net_profit"]["prov"])] + ([("נרמול", nf(adj), adjP)] if adjP else []), est=bool(adjP))
        # savings segment
        prods = [] if self.filer else [p for p in d["products"] if p["s"] in SEG and (p.get("fees_ltm") or {}).get("v") and (p.get("op_ltm") or {}).get("v") is not None and (p.get("fy") or {}).get("v")]
        sav = None
        if prods:
            g_idx = prods[0]["g"]
            rev = fsum(p["fees_ltm"]["v"] for p in prods)
            op = fsum(p["op_ltm"]["v"] for p in prods)
            a_ltm = fsum(p["fees_ltm"]["v"] / p["fy"]["v"] * 100 for p in prods)
            fy0 = rev / a_ltm * 100
            ci0 = (1 - op / rev) * 100
            phe = " + ".join(p["he"] for p in prods)
            revP = P_calc(f"הכנסות מדמי ניהול LTM · {self.name} · {phe}", nf(rev), MM, "Σ המוצרים (מגזרי)", [(p["he"], nf(p["fees_ltm"]["v"]), p["fees_ltm"]["prov"]) for p in prods])
            opP = P_calc(f"רווח תפעולי LTM · {self.name} · {phe}", nf(op), MM, "Σ המוצרים (מגזרי, לפני מס)", [(p["he"], nf(p["op_ltm"]["v"]), p["op_ltm"]["prov"]) for p in prods])
            aP = P_calc(f"נכסים ממוצעים LTM · {self.name} · {phe}", nf(a_ltm / 1000, 1), "מיליארד ש\"ח", "Σ הכנסות מדמי ניהול LTM ÷ תשואת דמי הניהול LTM, לכל מוצר",
                        [(p["he"], nf(p["fees_ltm"]["v"] / p["fy"]["v"] * 100 / 1000, 1), p["fy"]["prov"]) for p in prods])
            fyP = P_calc(f"תשואת דמי ניהול LTM · {self.name} · {phe}", pc(fy0, 3), "%", "הכנסות מדמי ניהול LTM ÷ נכסים ממוצעים LTM", [("הכנסות", nf(rev), revP), ("נכסים ממוצעים", nf(a_ltm), aP)])
            ciP = P_calc(f"יחס עלות להכנסה LTM · {self.name} · {phe}", pc(ci0, 1), "%", "1 − רווח תפעולי ÷ הכנסות מדמי ניהול", [("רווח תפעולי", nf(op), opP), ("הכנסות", nf(rev), revP)])
            sav = dict(g=g_idx, rev=rev, op=op, a_ltm=a_ltm, fy0=fy0, ci0=ci0, revP=revP, opP=opP, aP=aP, fyP=fyP, ciP=ciP, he=phe)
        else:
            self.gaps.append("אין רווח תפעולי מגזרי לפנסיה ולגמל: מנופי החיסכון לא מחושבים")
        self.sav = sav
        # CSM
        csm = None
        if V("csm") and V("csm_release_rate") and not self.filer:
            csm = dict(v=V("csm"), rr=V("csm_release_rate"), P=n["csm"]["prov"], rrP=n["csm_release_rate"]["prov"])
        self.csm = csm
        # the share of LTM pre-tax profit each lever's segment carries (the nonbinding rule)
        self.pbt = pbt if pbt and pbt > 0 else (NP / attr / (1 - tax / 100) if NP > 0 else None)
        self.share = {}
        if self.pbt:
            if sav:
                self.share["sav"] = sav["op"] / self.pbt * 100
            if csm:
                self.share["csm"] = csm["rr"] / 100 * csm["v"] / self.pbt * 100
        # history first (the AUM trailing value is the five-year realised CAGR)
        hist = self.history(base_end)
        c0 = hist["aum5"]["v"] if sav and hist.get("aum5") else 0.0
        periods = [[lab, round(A1.months_between(ltm_mid, mid) / 12, 6), L, round(years(asof, end), 6)] for lab, end, mid, L in PER]
        m = {"mcap": self.mcap, "b0": B0, "div_after": r6(div_after), "np": NP, "adj": r6(adj), "tax": r6(tax), "attr": r6(attr), "payout": r6(payout),
             "rf": rf, "ke": ke, "g": g, "a_ltm": r6(sav["a_ltm"]) if sav else None, "fy0": r6(sav["fy0"]) if sav else None, "ci0": r6(sav["ci0"]) if sav else None,
             "op0": r6(sav["op"]) if sav else None, "c0": r6(c0), "csm0": csm["v"] if csm else None, "rr0": r6(csm["rr"]) if csm else None, "periods": periods}
        self.m = m
        out = {"id": self.id, "name": self.name, "kind": d["meta"]["kind"], "status": "ok"}
        if d["meta"].get("flag"):
            out["flag"] = d["meta"]["flag"]
        b0P = n["equity_end"]["prov"]
        pb = self.mcap / B0
        pbP = P_calc(f"מכפיל הון (P/B) · {self.name}", f"{nf(pb, 2)}x", "x", "שווי שוק ÷ הון לבעלי המניות",
                     [("שווי שוק", nf(self.mcap, 0), self.mcapP), (f"הון, {self.base_q}", nf(B0), b0P)], est=True)
        base = model(m, trail_x(m))
        mm = dict(m)
        mm["_base_roe"] = [rw["roe"] for rw in base["rows"]]
        valP = self.valueP("שווי המודל בערכים הנוכחיים", base, m, trail_x(m), b0P, npnP, payoutP, divAfterP, keP, gP)
        out["price"] = {"date": asof, "label": PRICE_LABEL, "px": fig(self.px["last"] / 100, self.pxP, 'ש"ח'), "mcap": fig(self.mcap, self.mcapP, MM), "shares": fig(sh, self.shP)}
        out["base"] = {
            "q": self.base_q, "ltm": d["meta"]["base"]["ltm"], "end": base_end,
            "pb": fig(pb, pbP, "x"), "equity": fig(B0, b0P, MM), "div_after": fig(div_after, divAfterP, MM), "np_ltm": fig(NP, n["net_profit"]["prov"], MM),
            "adj": fig(adj, adjP, MM) if adjP else None, "eq_ltm": fig(eqltm, adjP["inputs"][0]["p"], "%") if adjP else None,
            "np_norm": fig(npn, npnP, MM), "roe_ltm": fig(V("roe"), n["roe"]["prov"], "%"), "tax": fig(tax, taxP, "%"), "attr": fig(attr * 100, attrP, "%"),
            "payout": fig(payout, payoutP, "%"), "ke": fig(ke, keP, "%", est=True), "g": fig(g, gP, "%", est=True), "rf": fig(rf, rfP, "%"),
            "value": fig(base["v"], valP, MM), "gap": fig((self.mcap / base["v"] - 1) * 100, P_calc("שווי שוק מול שווי המודל בערכים הנוכחיים", pc((self.mcap / base["v"] - 1) * 100, 1), "%",
                                                                                                    "שווי שוק ÷ שווי המודל − 1", [("שווי שוק", nf(self.mcap, 0), self.mcapP), ("שווי המודל", nf(base["v"], 0), valP)], est=True), "%"),
            "path": [{"p": rw["p"], "np": r6(rw["np"]), "roe": r6(rw["roe"]), "b": r6(rw["b"])} for rw in base["rows"]],
            "savings": {"he": sav["he"], "aum": fig(sav["a_ltm"], sav["aP"], MM), "fy": fig(sav["fy0"], sav["fyP"], "%"), "ci": fig(sav["ci0"], sav["ciP"], "%"),
                        "op": fig(sav["op"], sav["opP"], MM), "rev": fig(sav["rev"], sav["revP"], MM)} if sav else None,
            "csm": {"csm": fig(csm["v"], csm["P"], MM), "rr": fig(csm["rr"], csm["rrP"], "%")} if csm else None,
        }
        out["model"] = m
        # levers
        levers = []
        for key in ("aum", "fee", "ci", "csm"):
            if key in ("aum", "fee", "ci") and not sav or key == "csm" and not csm:
                continue
            levers.append(self.lever(key, m, hist, keP, gP, b0P, npnP, payoutP, divAfterP))
        roe = self.lever_roe(mm, hist, base, keP, gP, b0P, npnP, payoutP, divAfterP)
        out["levers"] = levers
        out["roe"] = roe
        out["targets"] = self.targets()
        out["rank"] = self.rank(levers, roe)
        out["verdict"] = self.verdict(levers, roe, hist, out["targets"], base)
        out["gaps"] = self.gaps
        return out

    def na(self, why):
        return {"id": self.id, "name": self.name, "kind": self.e["kind"], "status": "na", "why": why}

    def valueP(self, title, res, m, x, b0P, npnP, payoutP, divAfterP, keP, gP):
        rows = res["rows"]
        return P_calc(f"{title} · {self.name}", nf(res["v"], 0), MM,
                      "שווי = Σ ערך נוכחי של החלוקות (H2'26, FY'27, FY'28) + ערך נוכחי של P/B מוצדק(ROE FY'28) × הון FY'28; היוון ב-ke מתאריך המחיר",
                      [(f"הון {self.base_q}", nf(m["b0"]), b0P), ("פחות דיבידנד ששולם אחרי המאזן", nf(m["div_after"]), divAfterP), ("רווח נקי מנורמל LTM", nf(m["np"] + m["adj"]), npnP),
                       ("שיעור חלוקה", pc(m["payout"], 1), payoutP), ("ke", pc(m["ke"], 2), keP), ("g", pc(m["g"], 2), gP)]
                      + [(f"רווח {rw['p']} (קצב שנתי)", nf(rw["np"]), None) for rw in rows] + [(f"ROE {rows[-1]['p']}", pc(rows[-1]["roe"], 1), None),
                                                                                             ("P/B מוצדק בסוף התקופה", f"{nf(res['jpb'], 2)}x", None), ("הון FY'28", nf(res["b28"]), None)], est=True)

    # -- history per lever
    def history(self, base_end):
        I, sav = self.I, self.sav
        h = {}
        endm = months_iso(base_end)
        qends = [madd(endm, -3 * k) for k in range(N_HIST - 1, -1, -1)]
        if sav:
            g = sav["g"]
            gname = I.mkt["groups"][g]
            a1, a0 = I.aum(g, endm), I.aum(g, madd(endm, -60))
            if a1 and a0:
                v = ((a1 / a0) ** (1 / 5) - 1) * 100
                h["aum5"] = fig(v, P_calc(f"צמיחת נכסים, 5 שנים · {self.name} · פנסיה וגמל", pc(v, 1), "% לשנה", "(נכסים בסוף ÷ נכסים בהתחלה)^(1/5) − 1; כולל תשואה וצבירה",
                                          [(mlab(madd(endm, -60)), nf(a0 / 1000, 1) + " מיליארד", reg_prov(I, gname, madd(endm, -60), g)), (mlab(endm), nf(a1 / 1000, 1) + " מיליארד", reg_prov(I, gname, endm, g))]), "% לשנה")
            W = []
            for e in qends:
                s0 = madd(e, -WIN)
                A0, A1v, F0, F1 = I.aum(g, s0), I.aum(g, e), I.fee(g, s0), I.fee(g, e)
                if A0 and A1v and F0 is not None and F1 is not None:
                    W.append({"e": e, "cagr": ((A1v / A0) ** (12 / WIN) - 1) * 100, "dfee": (F1 - F0) * 100 / (WIN / 12)})
            h["win"] = W
            winP = lambda what: P_calc(f"{what} · {self.name} · חלונות של שנתיים", f"{len(W)} חלונות", "", "חלון = 24 חודשים שמסתיימים בכל סוף רבעון; נכסים: (סוף ÷ התחלה)^(1/2) − 1; דמי ניהול: (סוף − התחלה) ÷ 2, נ״ב לשנה",
                                       [(f"{qlab(w['e'])}", f"{nf(w['cagr'], 1)}% · {A1.sn(w['dfee'], 1)} נ״ב", None) for w in W] + [("מקור", "פנסיה-נט, גמל-נט", reg_prov(I, gname, endm, g))],
                                       note="דמי ניהול מהצבירה כפי שדווחו לרשות (ממוצע משוקלל בנכסים); תשואת דמי הניהול במודל היא מהדוחות (כולל דמי ניהול מהפקדה)")
            h["winP_aum"], h["winP_fee"] = winP("צמיחת נכסים"), winP("שינוי בדמי הניהול מהצבירה")
            # reported LTM fee yield per quarter (lens: managers' fees ÷ the regulator's average assets) and the quarterly cost/income
            gi = sav["g"]
            rows = {x["q"]: x for x in I.lens["rows"] if x["g"] == gi and x["s"] == "pg"}
            qs = I.lens["quarters"]
            ltm = []
            for i in range(3, len(qs)):
                rs = [rows.get(q) for q in qs[i - 3:i + 1]]
                if all(r and r.get("rep") and r["rep"].get("fees") is not None and r.get("reg") for r in rs):
                    ltm.append((qs[i], fsum(r["rep"]["fees"] for r in rs) / (fsum(r["reg"]["avg"] for r in rs) / 4) * 100))
            if len(ltm) >= 4:
                last8 = ltm[-8:]
                f = ols([list(range(len(last8)))], [v for _, v in last8])
                slope = f["b"][1] * 4 * 100 if f else None
                h["fee_trend"] = fig(slope, P_calc(f"מגמת תשואת דמי הניהול · {self.name} · פנסיה וגמל · {len(last8)} רבעונים", A1.sn(slope, 1) + " נ״ב לשנה", "נ״ב לשנה",
                                                   "שיפוע OLS של תשואת דמי הניהול LTM (הכנסות מדמי ניהול מהדוחות ÷ נכסים ממוצעים ברשות) × 4",
                                                   [(A1.ql(q), pc(v, 3), None) for q, v in last8] + [("תשואה LTM אחרונה", pc(sav["fy0"], 3), sav["fyP"])]), "נ״ב לשנה", n=len(last8))
            ci = [(q, rows[q]["ci"]) for q in qs if rows.get(q) and rows[q].get("ci") is not None][-N_HIST:]
            h["ci"] = ci
            h["ciP"] = P_calc(f"יחס עלות להכנסה לפי רבעון · {self.name} · פנסיה וגמל", f"{len(ci)} רבעונים", "%", "(שיווק ומכירה + הנהלה וכלליות) ÷ הכנסות מדמי ניהול, דוחות החברות המנהלות (lens.json)",
                              [(A1.ql(q), pc(v, 1), None) for q, v in ci] + [("LTM אחרון", pc(sav["ci0"], 1), sav["ciP"])])
            # the AUM CAGR at each quarter of the cost/income history (the joint check of the cost lever)
            h["cagr_at"] = {q: next((w["cagr"] for w in W if qlab(w["e"]) == A1.ql(q)), None) for q, _ in ci}
            # peers' LTM cost/income (A1 drivers files)
            peers = []
            for cid, f in I.drv.items():
                ps = [p for p in f["products"] if p["s"] in SEG and (p.get("fees_ltm") or {}).get("v") and (p.get("op_ltm") or {}).get("v") is not None]
                if ps:
                    rv, o = fsum(p["fees_ltm"]["v"] for p in ps), fsum(p["op_ltm"]["v"] for p in ps)
                    peers.append((cid, f["meta"]["name"], (1 - o / rv) * 100, ps))
            if peers:
                best = min(peers, key=lambda x: x[2])
                h["ci_best"] = fig(best[2], P_calc(f"יחס עלות להכנסה LTM, הנמוך בענף · {best[1]}", pc(best[2], 1), "%", "1 − רווח תפעולי ÷ הכנסות מדמי ניהול, פנסיה וגמל, LTM; הנמוך מבין כל החברות בקבצי A1",
                                                   [(f"{x[1]}", pc(x[2], 1), None) for x in sorted(peers, key=lambda x: x[2])]), "%", who=best[1], id=best[0])
        if self.csm:
            peers = [(cid, f["meta"]["name"], f["nodes"]["csm_release_rate"]["v"], f["nodes"]["csm_release_rate"]["prov"]) for cid, f in I.drv.items() if (f["nodes"].get("csm_release_rate") or {}).get("v")]
            h["rr_peers"] = peers
            h["rrP"] = P_calc("קצב שחרור CSM, FY'25 · כל המבטחות", f"{len(peers)} מבטחות", "% לשנה", "שחרור CSM ברוטו (חיים + בריאות) ÷ ממוצע היתרה ברוטו; IFRS 17 מ-2025: שנה אחת לכל חברה, ולכן ההשוואה היא לענף",
                              [(x[1], pc(x[2], 1), x[3]) for x in sorted(peers, key=lambda x: x[2])])
        k = I.kpi.get(self.id)
        if k:
            rs = kpi_roe(k)[-N_HIST:]
            h["roe"] = rs
            h["roeP"] = P_calc(f"ROE LTM לפי רבעון · {self.name}", f"{len(rs)} רבעונים", "%", "רווח נקי LTM לבעלי המניות ÷ ממוצע ההון בסוף הרבעון ולפני שנה (XBRL, kpi.json); IFRS 4 עד 2024, IFRS 17 מ-2025",
                               [(per_tag(p), pc(v, 1), {"k": "xbrl", "title": f"רווח לבעלי המניות · {self.name} · {per_tag(p)}", "value": pc(v, 1), "company": self.name, "period": per_tag(p),
                                                        "rid": rid, "concept": "ProfitLossAttributableToOwnersOfParent", "note": "ROE מחושב: רווח LTM ÷ הון ממוצע"}) for p, v, rid, *_ in rs])
        return h

    def hist_block(self, vals, req, P, higher=True, unit="%", what="", status="ok"):
        if not vals:
            return None
        s = sorted(vals)
        pr = 100.0 if status == "beyond" else 0.0 if status == "below" else pct_rank(vals, req, higher)
        return {"what": what, "n": len(vals), "min": r6(s[0]), "med": r6(s[len(s) // 2] if len(s) % 2 else (s[len(s) // 2 - 1] + s[len(s) // 2]) / 2), "max": r6(s[-1]),
                "pct": pr, "unit": unit, "dir": "up" if higher else "down", "prov": P}

    def lever(self, key, m, h, keP, gP, b0P, npnP, payoutP, divAfterP):
        v, st, bound = solve(m, key, self.mcap)
        x = trail_x(m)
        if v is not None:
            x[key] = v
        res = model(m, x) if v is not None else None
        trail = {"aum": (m["c0"], h.get("aum5", {}).get("prov") if h.get("aum5") else P_none("צמיחת נכסים", "אין 5 שנים בנתוני הרשות")), "fee": (m["fy0"], self.sav and self.sav["fyP"]),
                 "ci": (m["ci0"], self.sav and self.sav["ciP"]), "csm": (m["rr0"], self.csm and self.csm["rrP"])}[key]
        L = {"k": key, "he": LEVER_HE[key], "unit": LEVER_UNIT[key], "status": st, "trail": fig(trail[0], trail[1], LEVER_UNIT[key])}
        if v is not None:
            L["req"] = fig(v, self.valueP(f"{LEVER_HE[key]} הנדרש/ת", res, m, x, b0P, npnP, payoutP, divAfterP, keP, gP) | {"title": f"{LEVER_HE[key]}: הערך שבו שווי המודל = שווי השוק · {self.name}", "value": self.fmt(key, v)}, LEVER_UNIT[key])
            L["roe28"] = r6(res["rows"][-1]["roe"])
            L["check"] = {"value": r6(res["v"]), "err": r6((res["v"] / self.mcap - 1) * 100)}
        else:
            L["req"] = None
            L["bound"] = bound
        hb, ref, joint = None, [], None
        if key == "aum" and h.get("win"):
            hb = self.hist_block([w["cagr"] for w in h["win"]], v, h["winP_aum"], True, "% לשנה", "צמיחת נכסים בחלון של שנתיים", st)
            if h.get("aum5"):
                ref.append({"he": "5 שנים בפועל", **h["aum5"]})
            tg = self.target_aum()
            if tg:
                ref.append(tg)
            if v is not None:
                k = [w for w in h["win"] if w["cagr"] >= v and w["dfee"] >= 0]
                joint = {"he": "צמיחת נכסים כזו בלי שחיקה בדמי הניהול", "k": len(k), "n": len(h["win"]), "first": qlab(h["win"][0]["e"]), "last": qlab(h["win"][-1]["e"]),
                         "when": [qlab(w["e"]) for w in k]}
        if key == "fee" and h.get("win"):
            req_d = (v - m["fy0"]) * 100 / m["periods"][-1][1] if v is not None else None
            hb = self.hist_block([w["dfee"] for w in h["win"]], req_d, h["winP_fee"], True, "נ״ב לשנה", "שינוי בדמי הניהול מהצבירה בחלון של שנתיים", st)
            if req_d is not None:
                L["req_d"] = r6(req_d)
            if h.get("fee_trend"):
                ref.append({"he": "מגמת 8 רבעונים", **h["fee_trend"]})
            if v is not None:
                k = [w for w in h["win"] if w["dfee"] >= req_d and w["cagr"] >= m["c0"]]
                joint = {"he": "שינוי כזה בדמי הניהול עם צמיחת הנכסים של 5 השנים", "k": len(k), "n": len(h["win"]), "first": qlab(h["win"][0]["e"]), "last": qlab(h["win"][-1]["e"]),
                         "when": [qlab(w["e"]) for w in k]}
        if key == "ci" and h.get("ci"):
            hb = self.hist_block([c for _, c in h["ci"]], v, h["ciP"], False, "%", "יחס עלות להכנסה ברבעון", st)
            if h.get("ci_best"):
                ref.append({"he": f"הנמוך בענף ({h['ci_best']['who']})", **{k: h["ci_best"][k] for k in ("v", "prov", "unit")}})
            if v is not None:
                qs = [(q, c) for q, c in h["ci"] if h["cagr_at"].get(q) is not None]
                k = [q for q, c in qs if c <= v and h["cagr_at"][q] >= m["c0"]]
                joint = {"he": "יחס עלות כזה ברבעון שבו הנכסים צמחו בקצב 5 השנים", "k": len(k), "n": len(qs), "first": A1.ql(qs[0][0]) if qs else None, "last": A1.ql(qs[-1][0]) if qs else None,
                         "when": [A1.ql(q) for q in k]}
        if key == "csm" and h.get("rr_peers"):
            hb = self.hist_block([x[2] for x in h["rr_peers"]], v, h["rrP"], True, "% לשנה", "קצב שחרור FY'25 במבטחות (IFRS 17 מ-2025)", st)
        L["hist"] = hb
        L["ref"] = ref
        L["joint"] = joint
        return self.classify(L, m, h)

    def classify(self, L, m, h):
        """nonbinding: the lever cannot move the price. Its segment is under SHARE_MIN % of LTM pre-tax profit, or the solver found no value
        in range (or an impossible one: cost/income below 0), or the requirement is more than PLAUS_X × the company's own historical
        maximum (AUM CAGR; the yearly fee-yield change; the cost/income improvement over its range; peers' CSM release). The mechanical
        solution stays in the file (`mech`), labelled, for the provenance sheet only; the percentile, the joint check and the ranking drop it."""
        k, hb = L["k"], L.get("hist")
        seg = self.share.get("csm" if k == "csm" else "sav")
        segHe = "שחרור CSM" if k == "csm" else "פלח פנסיה וגמל"
        why = None
        v = L["req"]["v"] if L.get("req") else None
        if seg is not None and seg < SHARE_MIN:
            why, kind = f"{segHe} ≈ {nf(seg, 0)}% מהרווח לפני מס", "share"
        elif L["status"] != "ok" or (k == "ci" and v is not None and v < 0):
            why, kind = "לא קיים פתרון בטווח", "range"
        elif hb:
            mx = None
            if k == "aum" and hb["max"] > 0:
                mx, req = hb["max"], v
            elif k == "fee":
                mx, req = max(abs(hb["min"]), abs(hb["max"])), abs(L.get("req_d") or 0)
            elif k == "ci":
                mx, req = (hb["max"] - hb["min"]) or None, m["ci0"] - v
            elif k == "csm" and hb["max"] > 0:
                mx, req = hb["max"], v
            if mx and req > PLAUS_X * mx:
                what = {"aum": f"השיא של החברה בחלון של שנתיים ({nf(hb['max'], 1)}%)", "fee": f"השינוי השנתי הגדול ביותר שלה ({nf(mx, 1)} נ״ב)",
                        "ci": f"טווח יחס העלות שלה ({nf(hb['min'], 1)}%–{nf(hb['max'], 1)}%)", "csm": f"השיא בענף ב-FY'25 ({nf(hb['max'], 1)}%)"}[k]
                why, kind = f"נדרש יותר מפי {nf(PLAUS_X, 0)} מ{what}", "range"
        if why is None:
            return L
        L["solved"] = L["status"]
        L["status"] = "nonbinding"
        L["reason"] = why
        L["why"] = kind
        if seg is not None:
            L["share"] = r6(seg)
        if L.get("req"):
            prov = dict(L["req"]["prov"], title=f"פתרון מכני (לא מנוף מכריע: {why}) · {L['he']} · {self.name}")
            L["mech"] = fig(L["req"]["v"], prov, L["unit"])
            L["req"] = None
        if hb:
            hb["pct"] = None
        L["joint"] = None
        return L

    def lever_roe(self, mm, h, base, keP, gP, b0P, npnP, payoutP, divAfterP):
        v, st, bound = solve(mm, "roe", self.mcap)
        out = {"k": "roe", "he": LEVER_HE["roe"], "unit": "%", "status": st, "trail": fig(base["rows"][-1]["roe"], P_calc(f"ROE FY'28 בערכים הנוכחיים · {self.name}", pc(base["rows"][-1]["roe"], 1), "%",
                                                                                                                        "רווח FY'28 במודל בערכים הנוכחיים ÷ הון ממוצע", [("רווח מנורמל LTM", nf(mm["np"] + mm["adj"]), npnP)], est=True), "%")}
        if v is None:
            out["req"], out["bound"] = None, bound
        else:
            x = trail_x(mm)
            x["roe"] = v
            res = model(mm, x)
            out["req"] = fig(v, self.valueP("ROE FY'28 הנדרש", res, mm, x, b0P, npnP, payoutP, divAfterP, keP, gP) | {"title": f"ROE FY'28 שבו שווי המודל = שווי השוק · {self.name}", "value": pc(v, 1)}, "%")
            out["check"] = {"value": r6(res["v"]), "err": r6((res["v"] / self.mcap - 1) * 100)}
            out["path"] = [{"p": rw["p"], "roe": r6(rw["roe"]), "np": r6(rw["np"])} for rw in res["rows"]]
        if h.get("roe"):
            vals = [x[1] for x in h["roe"]]
            out["hist"] = self.hist_block(vals, v, h["roeP"], True, "%", "ROE LTM ברבעון", st)
            mx = max(h["roe"], key=lambda x: x[1])
            out["hist"]["max_at"] = per_tag(mx[0])
            out["hist"]["first"], out["hist"]["last"] = per_tag(h["roe"][0][0]), per_tag(h["roe"][-1][0])
        else:
            out["hist"] = None
        return out

    def fmt(self, key, v):
        return {"aum": f"{nf(v, 1)}% לשנה", "fee": pc(v, 3), "ci": pc(v, 1), "csm": f"{nf(v, 1)}% לשנה", "roe": pc(v, 1)}[key]

    # -- management's targets
    def trow(self, ms, seg=("group",)):
        rows = [x for x in self.I.tg["rows"] if x["c"] == self.id and x["m"] in ms and x.get("seg") in seg and x.get("h") in (2028,)]
        if not rows:
            return None
        x = max(rows, key=lambda x: (ms.index(x["m"]) * -1, x["d"]))
        doc = self.I.tg["docs"].get(str(x["doc"]))
        url = MAYA + doc[4] if doc else None
        val = x["v"] if x["v"] is not None else None
        txt = (nf(val, 0) if val is not None else f"{nf(x['lo'], 0)}–{nf(x['hi'], 0)}") + ("%" if x["u"] == "pct" else f" {MM}")
        prov = P_rep(f"{x['l']} · {self.name} · {H28}", txt, "%" if x["u"] == "pct" else MM, url, x.get("pg"), "מצגת / דוח החברה" if x.get("src") == "pres" else "דוח החברה", H28, note=x.get("q") or None)
        return {"m": x["m"], "he": x["l"], "v": val, "lo": x.get("lo"), "hi": x.get("hi"), "unit": x["u"], "prov": prov}

    def targets(self):
        t = {}
        for k, ms in (("roe", ["target_core_roe", "target_roe"]), ("profit", ["target_core_profit", "target_core_income", "target_net_income"]), ("aum", ["target_aum"])):
            x = self.trow(ms)
            if x:
                t[k] = x
        return t

    def target_aum(self):
        t = self.trow(["target_aum"])
        s = self.I.series.get(self.id)
        if not t or not s:
            return None
        row = next((r for r in s["rows"] if r["m"] == "aum_total" and r["g"] == "group"), None)
        if not row:
            return None
        k = max(row["vals"])
        cur = row["vals"][k]
        q = int(k[5]) if "Q" in k else 4
        end = f"{k[:4]}-{['03-31', '06-30', '09-30', '12-31'][q - 1]}"
        yrs = years(end, "2028-12-31")
        lo, hi = (t["lo"], t["hi"]) if t["v"] is None else (t["v"], t["v"])
        c_lo, c_hi = ((lo / cur["v"]) ** (1 / yrs) - 1) * 100, ((hi / cur["v"]) ** (1 / yrs) - 1) * 100
        curP = P_rep(f"נכסים מנוהלים, קבוצה · {self.name} · {per_tag(k.replace('Q4', 'FY'))}", nf(cur["v"] / 1000, 0) + " מיליארד", MM, cur.get("u"), cur.get("pg"), "דוח / מצגת החברה", per_tag(k.replace("Q4", "FY")))
        txt = f"{nf(c_lo, 1)}%–{nf(c_hi, 1)}%" if lo != hi else pc(c_lo, 1)
        prov = P_calc(f"צמיחה שיעד הנכסים של ההנהלה מגלם · {self.name}", txt, "% לשנה", "(יעד FY'28 ÷ נכסים מנוהלים מדווחים אחרונים)^(1 ÷ שנים) − 1; נכסי הקבוצה כפי שהיא מדווחת, לא רק פנסיה וגמל",
                      [("נכסים מנוהלים אחרונים", nf(cur["v"] / 1000, 0) + " מיליארד", curP), ("יעד FY'28", (f"{nf(lo / 1000, 0)}–{nf(hi / 1000, 0)}" if lo != hi else nf(lo / 1000, 0)) + " מיליארד", t["prov"]),
                       ("שנים", nf(yrs, 2), None)])
        return {"he": "יעד ההנהלה (נכסי הקבוצה)", "v": r6((c_lo + c_hi) / 2), "lo": r6(c_lo), "hi": r6(c_hi), "unit": "% לשנה", "prov": prov,
                "aum_lo": lo, "aum_hi": hi, "aum_now": cur["v"]}

    # -- ranking parts and the verdict line
    def rank(self, levers, roe):
        parts = [{"k": L["k"], "pct": L["hist"]["pct"]} for L in levers if L.get("hist") and L["status"] != "nonbinding"]
        if roe.get("hist"):
            parts.append({"k": "roe", "pct": roe["hist"]["pct"]})
        ps = [p["pct"] for p in parts if p["pct"] is not None]
        return {"max": max(ps) if ps else None, "parts": parts, "key": sorted(ps, reverse=True)}

    def verdict(self, levers, roe, h, tg, base):
        """the verdict line: a template over the numbers (never generated text). Leads with the most plausible single lever when one is
        inside the company's own history; otherwise with the FY'28 ROE the price requires, and says why no single lever gets there."""
        nm = f"{self.filer['name']} ({self.name})" if self.filer else self.name
        mn = "מ" + nm
        gap = self.mcap / base["v"] - 1
        roe_txt, roe_short = "", ""
        if roe.get("req"):
            rv = roe["req"]["v"]
            hb = roe.get("hist")
            hist_t = ""
            if hb:
                if rv > hb["max"]:
                    hist_t = f"מעל כל אחד מ-{hb['n']} הרבעונים שנמדדו (שיא: {nf(hb['max'], 1)}% ב-{hb['max_at']})"
                elif rv < hb["min"]:
                    hist_t = f"מתחת לכל אחד מ-{hb['n']} הרבעונים שנמדדו"
                else:
                    hist_t = f"באחוזון {nf(hb['pct'], 0)} של {hb['n']} הרבעונים שנמדדו"
            tt = ""
            if tg.get("roe"):
                t = tg["roe"]
                tt = f"יעד ההנהלה ל-FY'28: {nf(t['v'], 0) + '%' if t['v'] is not None else nf(t['lo'], 0) + '%–' + nf(t['hi'], 0) + '%'}"
            roe_short = f"ROE של {nf(rv, 1)}% ב-FY'28"
            roe_txt = roe_short + (f", {hist_t}" if hist_t else "") + (f"; {tt}" if tt else "")
        elif roe.get("status") == "beyond":
            roe_txt = roe_short = f"ROE של יותר מ-{nf(roe['bound'], 0)}% ב-FY'28"
        if gap <= 0:
            a = next((L for L in levers if L["k"] == "aum"), None)
            lead = f"במכפיל {nf(self.mcap / self.m['b0'], 2)}x השוק מגלם ל{nm} פחות מהמגמה"
            if a and a["status"] == "ok":
                lead += f": צמיחת נכסים בפנסיה ובגמל של {nf(a['req']['v'], 1)}% בשנה מול {nf(a['trail']['v'], 1)}% ב-5 השנים האחרונות"
                if roe_txt:
                    lead += f", ו-{roe_txt}"
            elif roe_txt:
                lead += f": {roe_txt}"
            return lead + "."
        ok = [L for L in levers if L["status"] == "ok" and L.get("hist") and L["hist"]["pct"] is not None and L["hist"]["pct"] < 100]
        if ok:
            best = min(ok, key=lambda L: (L["hist"]["pct"], ["aum", "fee", "ci", "csm"].index(L["k"])))
            req, jt = self.lever_text(best)
            S = [f"השוק דורש {mn} {req}; {jt}."]
            if roe_txt:
                S.append(f"במונחי תשואה: {roe_txt}.")
            return " ".join(S)
        S = [f"השוק דורש {mn} {roe_txt}." if roe_txt else f"שווי השוק של {nm} גבוה משווי המודל ב-{nf(gap * 100, 0)}%."]
        binding = [L for L in levers if L["status"] == "ok" and L.get("hist")]
        if binding:
            a = min(binding, key=lambda L: (L["hist"]["pct"] if L["hist"]["pct"] is not None else 101, ["aum", "fee", "ci", "csm"].index(L["k"])))
            req, jt = self.lever_text(a, alone=True)
            S.append(f"אף מנוף בודד לא מגיע לשם בתוך ההיסטוריה שלה: לבדה, {req}; {jt}.")
        nb = [L for L in levers if L["status"] == "nonbinding"]
        if nb and not binding:
            sh = next((L for L in nb if L.get("why") == "share" and L["k"] != "csm"), None)
            if sh:
                S.append(f"מנופי החיסכון אינם מכריעים: {sh['reason']}.")
            else:
                S.append("אף מנוף בודד אינו מכריע: " + "; ".join(f"{L['he']}: {L['reason']}" for L in nb) + ".")
        return " ".join(S)

    def lever_text(self, L, alone=False):
        v, k = L["req"]["v"], L["k"]
        if k == "aum":
            req = (f"צמיחת הנכסים בפנסיה ובגמל הייתה צריכה להגיע ל-{nf(v, 1)}% בשנה עם תשואת דמי ניהול קבועה" if alone else
                   f"להחזיק תשואת דמי ניהול קבועה ולצבור נכסים בפנסיה ובגמל ב-{nf(v, 1)}% בשנה עד FY'28")
        elif k == "fee":
            req = (f"תשואת דמי הניהול בפנסיה ובגמל הייתה צריכה לעלות ל-{pc(v, 2)} (מ-{pc(L['trail']['v'], 2)})" if alone else
                   f"להעלות את תשואת דמי הניהול בפנסיה ובגמל ל-{pc(v, 2)} (מ-{pc(L['trail']['v'], 2)}) עד FY'28" if L.get("req_d", 0) > 0.05 else
                   f"להחזיק את תשואת דמי הניהול בפנסיה ובגמל ב-{pc(v, 2)} עד FY'28")
        elif k == "ci":
            req = (f"יחס העלות להכנסה בפנסיה ובגמל היה צריך לרדת ל-{nf(v, 1)}% (מ-{nf(L['trail']['v'], 1)}%)" if alone else
                   f"להוריד את יחס העלות להכנסה בפנסיה ובגמל ל-{nf(v, 1)}% (מ-{nf(L['trail']['v'], 1)}%) עד FY'28")
        else:
            req = (f"שחרור ה-CSM היה צריך להגיע ל-{nf(v, 1)}% בשנה (מ-{nf(L['trail']['v'], 1)}%)" if alone else
                   f"להאיץ את שחרור ה-CSM ל-{nf(v, 1)}% בשנה (מ-{nf(L['trail']['v'], 1)}%)")
        j, hb = L.get("joint"), L["hist"]
        if k in ("aum", "fee") and j and j["n"]:
            jt = (f"היא מעולם לא עשתה את שניהם באותו חלון של שנתיים ({j['n']} חלונות, {j['first']}–{j['last']})" if j["k"] == 0 else
                  f"היא עשתה את שניהם ב-{j['k']} מתוך {j['n']} חלונות של שנתיים ({j['first']}–{j['last']})")
        elif k == "ci" and j and j["n"]:
            jt = (f"היא מעולם לא הגיעה לכך ברבעון שבו הנכסים צמחו בקצב 5 השנים ({j['n']} רבעונים)" if j["k"] == 0 else
                  f"היא הגיעה לכך ב-{j['k']} מתוך {j['n']} רבעונים שבהם הנכסים צמחו בקצב 5 השנים")
        elif k == "csm":
            jt = (f"מעל כל אחת מ-{hb['n']} המבטחות ב-FY'25 (שיא: {nf(hb['max'], 1)}%)" if hb["pct"] >= 100 else f"באחוזון {nf(hb['pct'], 0)} של {hb['n']} המבטחות ב-FY'25")
        else:
            jt = f"זה באחוזון {nf(hb['pct'], 0)} של ההיסטוריה שלה ({hb['n']} תצפיות)"
        return req, jt


# ---------------------------------------------------------------- build / verify
def build():
    I = Inputs()
    cos, built = [], []
    for e in I.reg:
        if not e.get("has_price"):
            continue
        p = load(f"companies/{e['id']}.price.json")
        c = Co(I, e, p)
        out = c.build()
        if out["status"] == "ok":
            built.append(I.drv[e["id"]]["meta"]["built"])
        cos.append(out)
    asof = sorted({load(f"companies/{e['id']}.price.json")["asof"] for e in I.reg if e.get("has_price")})
    meta = {"built": max(built) if built else None, "v": 1, "price_date": asof[-1], "price_dates": asof, "price_label": PRICE_LABEL, "horizon": H28,
            "periods": [x[0] for x in PER], "n_hist": N_HIST, "win_months": WIN, "tol_pct": TOL,
            "method": "value = Σ PV(distributions H2'26–FY'28) + PV(justified P/B(ROE FY'28) × book FY'28); one input solved at a time (bisection), the others at their trailing value"}
    idx = {"meta": meta, "companies": []}
    for c in cos:
        row = {"id": c["id"], "name": c["name"], "kind": c["kind"], "status": c["status"]}
        if c["status"] != "ok":
            row["why"] = c["why"]
        else:
            row.update({"pb": c["base"]["pb"]["v"], "gap": c["base"]["gap"]["v"], "max": c["rank"]["max"], "key": c["rank"]["key"], "verdict": c["verdict"],
                        "parts": [dict({"k": L["k"], "he": L["he"], "unit": L["unit"], "status": L["status"], "req": L["req"]["v"] if L.get("req") else None, "bound": L.get("bound"),
                                         "trail": L["trail"]["v"], "pct": L["hist"]["pct"] if L.get("hist") else None}, **({"reason": L["reason"]} if L.get("reason") else {}))
                                    for L in c["levers"] + [c["roe"]]]})
            if c.get("flag"):
                row["flag"] = c["flag"]
        idx["companies"].append(row)
    ok = [r for r in idx["companies"] if r["status"] == "ok"]
    ok.sort(key=lambda r: ([-x for x in r["key"]], r["name"]))
    for i, r in enumerate(ok):
        r["rank"] = i + 1
    idx["companies"] = ok + [r for r in idx["companies"] if r["status"] != "ok"]
    files = {f"{c['id']}.json": dict(c, meta={k: meta[k] for k in ("built", "v", "price_date", "price_label", "horizon", "periods", "n_hist", "win_months", "tol_pct", "method")}) for c in cos}
    files["index.json"] = idx
    return files


def walk(p, where, bad, depth=0):
    if depth > 40:
        return
    if not isinstance(p, dict) or "k" not in p:
        bad.append(f"{where}: provenance missing")
        return
    k = p["k"]
    if k == "report" and not p.get("url") and p.get("pg") is None and not p.get("doc"):
        bad.append(f"{where}: report without url, page or document")
    elif k == "price" and not p.get("date"):
        bad.append(f"{where}: price without a date")
    elif k == "none" and not p.get("why"):
        bad.append(f"{where}: none without a reason")
    elif k == "calc":
        for i, x in enumerate(p.get("inputs", [])):
            if x.get("p") is not None:
                walk(x["p"], f"{where}/{i}", bad, depth + 1)


def finite(x, where, bad):
    if isinstance(x, float) and not math.isfinite(x):
        bad.append(f"{where}: not finite")
    elif isinstance(x, dict):
        for k, v in x.items():
            finite(v, f"{where}.{k}", bad)
    elif isinstance(x, list):
        for i, v in enumerate(x):
            finite(v, f"{where}[{i}]", bad)


def figs(x, where, out):
    """every {v: number, prov} in the file"""
    if isinstance(x, dict):
        if "v" in x and "prov" in x:
            out.append((where, x))
        for k, v in x.items():
            if k != "prov":
                figs(v, f"{where}.{k}", out)
    elif isinstance(x, list):
        for i, v in enumerate(x):
            figs(v, f"{where}[{i}]", out)


def verify(files):
    bad, n_chk = [], 0
    idx = files["index.json"]
    if not idx["meta"].get("price_date") or idx["meta"].get("price_label") != PRICE_LABEL:
        bad.append("index: price date or label missing")
    for name, c in files.items():
        finite(c, name, bad)
        if name == "index.json" or c.get("status") != "ok":
            continue
        if c["price"]["date"] != c["meta"]["price_date"] and c["price"]["date"] not in idx["meta"]["price_dates"]:
            bad.append(f"{name}: price date not shown")
        F = []
        figs(c, name, F)
        for w, f in F:
            if f["v"] is not None:
                walk(f["prov"], w, bad)
        m = c["model"]
        # the forward model, rebuilt from the file's own inputs, reproduces the market value at every solved input
        base = model(m, trail_x(m))
        mm = dict(m, _base_roe=[rw["roe"] for rw in base["rows"]])
        for L in c["levers"] + [c["roe"]]:
            if L["status"] == "nonbinding":
                if not L.get("reason") or L.get("req") is not None or (L.get("hist") or {}).get("pct") is not None:
                    bad.append(f"{name}: {L['k']} nonbinding without a reason, or still showing a requirement / percentile")
                if any(p["k"] == L["k"] for p in c["rank"]["parts"]):
                    bad.append(f"{name}: nonbinding {L['k']} drives the ranking")
                if not L.get("mech"):
                    continue
            elif L["status"] != "ok":
                if L.get("bound") is None:
                    bad.append(f"{name}: {L['k']} not solved and no bound")
                continue
            x = trail_x(m)
            x[L["k"]] = (L["mech"] if L["status"] == "nonbinding" else L["req"])["v"]
            v = model(mm if L["k"] == "roe" else m, x)["v"]
            n_chk += 1
            err = abs(v / m["mcap"] - 1) * 100
            if err > TOL:
                bad.append(f"{name}: {L['k']} at {x[L['k']]:.4f} gives {v:,.1f} against {m['mcap']:,.1f} ({err:.2f}%)")
        # the trailing inputs reproduce the stored base value
        if abs(base["v"] - c["base"]["value"]["v"]) > 0.5:
            bad.append(f"{name}: base value {base['v']:.1f} ≠ stored {c['base']['value']['v']:.1f}")
        if not c.get("verdict"):
            bad.append(f"{name}: no verdict")
    return bad, n_chk


def dumps(d):
    return json.dumps(d, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    files = build()
    bad, n_chk = verify(files)
    ok = [c for n, c in files.items() if n != "index.json" and c["status"] == "ok"]
    if "--check" in sys.argv:
        diff = [n for n, c in files.items() if not (OUT / n).exists() or json.loads((OUT / n).read_text(encoding="utf8")) != json.loads(dumps(c))]
        extra = [p.name for p in OUT.glob("*.json") if p.name not in files] if OUT.exists() else []
        print(f"expectations: {len(ok)} listed names decoded, {len(files) - 1 - len(ok)} not available; {n_chk} solved inputs reproduce the market value within {TOL}%; "
              f"{'rebuild matches' if not diff and not extra else 'DIFFERS: ' + ', '.join(diff + extra)}; {len(bad)} misses")
        for b in bad[:20]:
            print("  ", b)
        sys.exit(0 if not diff and not extra and not bad else 1)
    if bad:
        print("misses:")
        for b in bad[:40]:
            print("  ", b)
        sys.exit(1)
    OUT.mkdir(parents=True, exist_ok=True)
    for n, c in files.items():
        (OUT / n).write_text(dumps(c), encoding="utf8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(files)} files; {len(ok)} decoded, {n_chk} solved inputs checked")
    for r in files["index.json"]["companies"]:
        if r["status"] != "ok":
            print(f"  {r['id']:10s} n/a: {r['why']}")
            continue
        parts = "  ".join(f"{p['k']}={'–' if p['req'] is None else round(p['req'], 2)}{'' if p['status'] == 'ok' else '(' + p['status'] + ')'}@{p['pct']}" for p in r["parts"])
        print(f"  {r['rank']:2d} {r['id']:10s} P/B {r['pb']:.2f} gap {r['gap']:+6.1f}%  max {r['max']}  {parts}")
