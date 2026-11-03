"""Nowcast engine (module M1): a bottom-up estimate of each manager's pension + gemel revenue and operating profit, made BEFORE the
quarterly print, frozen in an append-only ledger, then scored against the actual. UNPUBLISHED: the /nowcast page is not linked anywhere.

python3 pipeline/build_nowcast.py           write the live stage to the ledger (only if that stage file does not exist yet), rerun the
                                            backtest, write web/public/data/nowcast.json and data/nowcast/est_events.json
python3 pipeline/build_nowcast.py --depfee [--raw DIR]   LOCAL (pandas + the regulator parquet): write web/public/data/nowcast_depfee.json,
                                            the monthly deposit fee per group x segment that the published per-track files do not carry
python3 pipeline/build_nowcast.py --check   rebuild in memory and compare with nowcast.json (and nowcast_f2e.json) on disk; every ledger entry's inputs hash
                                            recomputes; nothing about phoenix is stored (exit 1 on any miss). The gate runs this plus
                                            the immutability check against git HEAD (pipeline/gate.py, check `nowcast`).

Inputs (all published files of this repo, free public data only):
  web/public/data/lens.json        regulator month-end assets and flows per group x segment (gemel-net, pensia-net; data.gov.il) and
                                   each manager's reported segment fees, selling & marketing, G&A, operating profit (lts.json, from the
                                   managing companies' own reports; every figure opens to its report page through lts_prov/<c>.json)
  data/registry/documents.csv      publication day of every report on MAYA (the backtest's "what was known when")
  web/public/data/calendar.json    the expected print day of the next quarter (the live stage dates)
  web/public/data/macro/macro.json Bank of Israel policy rate (the normalised nostro return, investment houses only)
  data/extracted_fs/<c>/<p>.json   investment houses' balance sheets (nostro financial assets, with page)

Method (version METHOD; every assumption below is labelled as such on the page):
  stages      Stage 1 = months 1-2 of the quarter actual, month 3 extrapolated ("2/3 nowcast"), nominally T - 42 days;
              Stage 2 = all three months actual ("full nowcast"), nominally T - 11 days; T = the print day.
              Stage 3 = the print: actual vs Stage 1 and Stage 2 is a scorecard row; the Stage 1 -> Stage 2 revision is its own column.
  avgAUM      trapezoid over the four month ends (A0/2 + A1 + A2 + A3/2) / 3, A0 = the previous quarter's last month (as lens.json).
              Stage 1, ASSUMPTION: A3 = A2 + the mean monthly net flow (organic accrual + net transfers) of months 1-2: no market return
              in month 3 (a random walk on prices), flows at the quarter-to-date pace.
  feeYield    trailing-4Q realised yield per manager x segment = sum(fees) x 4 / sum(avgAUM) x 100 over the last four REPORTED
              quarters printed before the as-of day, plus a drift term. ASSUMPTION: drift = DRIFT_DAMP x the OLS slope of the
              quarterly yields (last up to 8 printed quarters, at least 4) x 2.5 quarters (trailing-window centroid to the target).
  revenue     sum over segments of feeYield / 100 x avgAUM x 3 / 12 (NIS m, quarter).
  opex        revenue x trailing-4Q cost/income, seasonally adjusted: cost/income = sum(S&M + G&A) / sum(fees x s_q), s_q = 1 for
              Q1-Q3 and k for Q4, k = the mean over complete printed years of ci(Q4) / mean ci(Q1-Q3) of that year, clamped to
              [K_LO, K_HI]; 1 when no complete year was printed (ASSUMPTION: Q4 one-offs recur in proportion).
  op (seg)    revenue - opex: the same definition as the reported segment operating profit (fees - S&M - G&A; lts.json).
  nostro      investment houses only, NOT scored (the repo has no matched actual): nostro financial assets at the last printed balance
              date x the Bank of Israel policy rate on the as-of day / 4. ASSUMPTION: a normalised return equal to the policy rate,
              no mark-to-market gains or losses. Shown as a separate line: segment op + nostro = the whole-business proxy.
  scope       investment houses (HOUSES): the savings segment is most of the business, shown as a whole-business proxy with the nostro
              line. Insurers: a SEGMENT estimate of the managing company only (pension + gemel), never group earnings.
  phoenix     ABSTAIN_PHOENIX (off since 27.10.26, owner's decision): when on, nothing about phoenix is computed or stored.
              Phoenix joined Q3'26 stage 1 after it was frozen, through the dated addendum stage1.add-20261027.json.
  backtest    every past quarter, as of its own Stage 1 / Stage 2 day: reported quarters only if printed before that day (documents.csv),
              regulator months only up to the stage's months. LIMIT: the regulator's monthly files are the current vintage (data.gov.il
              does not keep vintages), so later revisions to old months are in the backtest inputs.
  f2e         wave 11, its own file (nowcast_f2e.json) and write-once ledger (data/ledger/nowcast_f2e/<quarter>/stage2.json): the
              regulator's track-level fee book (assets x management fee + deposits x deposit fee) mapped to the reported fee line by the
              manager's calibrated ratio; method and assumptions at the F2E section below.
  lens        the existing Savings Lens nowcast method (last quarter's yield, last quarter's costs, months to date) is scored beside M1
              on the same days as a baseline.
"""
import csv
import datetime as dt
import hashlib
import json
import math
import statistics
import sys
from math import fsum
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web" / "public" / "data"
OUT = WEB / "nowcast.json"
LEDGER = ROOT / "data" / "ledger" / "nowcast"
EVENTS = ROOT / "data" / "nowcast" / "est_events.json"

METHOD = "m1.0"
# ---- the owner's switch: fox does not estimate its owner's employer. Set to False only by the owner's decision.
ABSTAIN_PHOENIX = False  # owner decision 27.10.26: phoenix is estimated like every other manager
ABSTAIN_TEXT = "fox אינו מעריך את הפניקס"
# ---- coverage
COVER = ([] if ABSTAIN_PHOENIX else ["phoenix"]) + ["harel", "migdal", "clal", "menora", "meitav", "altshuler", "more", "analyst", "yelin"]
HOUSES = {"meitav", "altshuler", "more", "analyst", "yelin"}
NOT_COVERED = {
    "ibi": "אין לקבוצה מגזר פנסיה וגמל בדוחות שבאתר, וחברת הגמל שלה כלולה ברשות בקבוצת \"קרנות ענפיות ואחרות\"",
}
SEGS = ("pen", "gem")
SEG_HE = {"pen": "פנסיה", "gem": "גמל והשתלמות"}
# ---- method parameters (each one an assumption, printed on the page)
S1_DAYS, S2_DAYS = 42, 11     # stage days before the print
PUB_DAY = 9                   # regulator month M is read on day PUB_DAY of month M+2 (August 2026 was read 09.10.26)
DRIFT_DAMP = 0.5
DRIFT_H = 2.5
K_LO, K_HI = 0.7, 1.6
MIN_BASE = 4
FIRST_TARGET = (2024, 1)      # the first quarter with four printed base quarters (segment P&L starts Q1'23)
# nostro financial assets per house: balance-sheet line labels summed (current and non-current rows), page cited
NOSTRO = {
    "altshuler": ["השקעות לזמן קצר", "השקעות לזמן ארוך"],
    "more": ["נכסים פיננסיים הנמדדים בשווי הוגן דרך רווח או הפסד"],
    "analyst": ["נכסים פיננסיים בשווי הוגן דרך רווח או הפסד", "נכסים פיננסיים בשווי הוגן דרך רווח כולל אחר"],
    "meitav": ["השקעות לזמן קצר"],
    "yelin": ["נכסים פיננסיים בשווי הוגן דרך רווח והפסד", "השקעות שאינן סחירות"],
}
DOC_KEYS = {"more": ["more", "more_gemel"]}  # MAYA filers whose report carries the manager's figures


def r(x, d=3):
    return None if x is None else round(x, d)


def madd(p, k):
    t = (p // 100) * 12 + (p % 100 - 1) + k
    return (t // 12) * 100 + t % 12 + 1


def qkey(y, q):
    return f"Q{q}-{y}"


def qparse(k):
    return int(k[3:]), int(k[1])


def qprev(y, q, n=1):
    for _ in range(n):
        y, q = (y, q - 1) if q > 1 else (y - 1, 4)
    return y, q


def qnext(y, q):
    return (y, q + 1) if q < 4 else (y + 1, 1)


def qlabel(k):
    return f"{k[:2]}'{k[5:]}"


def pub_day(ym):
    """ASSUMPTION: the day fox can read regulator month ym (data.gov.il keeps no release dates)"""
    y, m = divmod(madd(ym, 2), 100)
    return dt.date(y, m, PUB_DAY)


def sha(obj):
    return hashlib.sha256(json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


# ------------------------------------------------------------------------------------------------------------------------- inputs
class Inputs:
    def __init__(self):
        self.lens = json.loads((WEB / "lens.json").read_text(encoding="utf-8"))
        L = self.lens
        self.G = {g["lts"]: i for i, g in enumerate(L["groups"]) if g["lts"]}
        self.months = L["months"]
        self.mi = {p: i for i, p in enumerate(self.months)}
        self.rows = {(x["g"], x["s"], x["q"]): x for x in L["rows"]}
        self.asof = L["meta"]["asof"]
        self.last_rep = qparse(L["meta"]["last_rep"])
        # print days
        self.printed, self.pdf = {}, {}
        with open(ROOT / "data" / "registry" / "documents.csv", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                if row["file_type"] == "pdf1" and row["url"]:
                    self.pdf[row["report_id"]] = "https://mayafiles.tase.co.il/" + row["url"]
                if row["doc_type"] not in ("quarterly", "annual"):
                    continue
                p = row["period"]
                key = (row["company"], p)
                d = row["publish_date"][:10]
                if key not in self.printed or d < self.printed[key]:
                    self.printed[key] = d
        cal = json.loads((WEB / "calendar.json").read_text(encoding="utf-8"))
        self.expected = {c["id"]: (c["next"].get("period"), c["next"].get("expected")) for c in cal["companies"] if c.get("next")}
        macro = json.loads((WEB / "macro" / "macro.json").read_text(encoding="utf-8"))["series"]["rate"]
        self.rate = macro["changes"]
        self.rate_src = {"source": macro["source"], "code": macro["code"], "url": macro["url"]}
        m = json.loads((WEB / "market.json").read_text(encoding="utf-8"))["meta"]
        self.fetched = m.get("fetched")

    def A(self, g, s, ym):
        ser = self.lens["series"].get(f"{g}|{s}")
        i = self.mi.get(ym)
        return None if ser is None or i is None else ser["a"][i]

    def flow(self, g, s, ym):
        ser = self.lens["series"].get(f"{g}|{s}")
        i = self.mi.get(ym)
        if ser is None or i is None or ser["org"][i] is None or ser["tr"][i] is None:
            return None
        return ser["org"][i] + ser["tr"][i]

    def print_day(self, c, y, q):
        """the day the quarter's figures became public: the earliest MAYA report of the manager's filers (Q4 = the annual report);
        None when not on MAYA"""
        p = f"{y}FY" if q == 4 else f"{y}Q{q}"
        ds = [self.printed.get((k, p)) for k in DOC_KEYS.get(c, [c])]
        ds = [d for d in ds if d]
        return min(ds) if ds else None

    def rate_on(self, day):
        v = None
        for d, x in self.rate:
            if d <= day:
                v = x
        return v

    def nostro(self, c, asof):
        """nostro financial assets (NIS m) at the latest balance date printed before asof, with its page"""
        if c not in NOSTRO:
            return None
        best = None
        for f in sorted((ROOT / "data" / "extracted_fs" / c).glob("*.json")):
            p = f.stem
            y, t = int(p[:4]), p[4:]
            q = 4 if t == "FY" else int(t[1])
            day = self.print_day(c, y, q)
            if not day or day >= asof:
                continue
            if best is None or (y, q) > best[0]:
                best = ((y, q), f, day)
        if not best:
            return None
        (y, q), f, day = best
        d = json.loads(f.read_text(encoding="utf-8"))
        end = f"{y}-{q * 3:02d}-{[31, 30, 30, 31][q - 1]}"
        mult = {"NIS thousands": 1e-3, "NIS millions": 1.0}.get(d.get("unit"))
        if mult is None:
            return None
        for st in d["statements"]:
            if st["statement"] != "balance":
                continue
            ci = next((i for i, col in enumerate(st["columns"]) if col.get("date") == end), None)
            if ci is None:
                continue
            parts = []
            for row in st["rows"]:
                if row.get("label") in NOSTRO[c] and row.get("values") and row["values"][ci] is not None:
                    parts.append({"l": row["label"], "v": r(row["values"][ci] * mult, 3), "pg": row.get("page")})
            if parts:
                return {"bal": r(fsum(x["v"] for x in parts), 3), "date": end, "period": f.stem, "rid": d.get("report_id_he"),
                        "url": self.pdf.get(str(d.get("report_id_he"))), "printed": day, "parts": parts}
        return None


# ------------------------------------------------------------------------------------------------------------------------- engine
def ols_slope(ys):
    n = len(ys)
    xs = list(range(n))
    mx, my = fsum(xs) / n, fsum(ys) / n
    den = fsum((x - mx) ** 2 for x in xs)
    return fsum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den if den else 0.0


def estimate(I, c, y, q, stage, asof, method="m1"):
    """one manager x quarter x stage as of a day. method 'm1' (this engine) or 'lens' (the Savings Lens baseline). Returns None when
    the inputs are not there; never reads a reported quarter printed on or after asof, nor a month after the stage's last month."""
    g = I.G[c]
    e = y * 100 + q * 3
    ms = [madd(e, -3), madd(e, -2), madd(e, -1), e]
    used = ms[:3] if stage == 1 else ms
    asof_s = asof.isoformat()
    # base quarters printed before asof
    hist = []
    yy, qq = qprev(y, q)
    while (yy, qq) >= (2023, 1) and len(hist) < 8:
        day = I.print_day(c, yy, qq)
        if day and day < asof_s:
            hist.append((yy, qq, day))
        yy, qq = qprev(yy, qq)
    hist.reverse()  # oldest first
    segs, total_rev, total_opex = {}, [], []
    op_ok = True
    for s in SEGS:
        base = []  # the contiguous run of printed quarters ending at the latest one (a hole resets it)
        for (yy, qq, day) in hist:
            row = I.rows.get((g, s, qkey(yy, qq)))
            if not row or row.get("fy_reg") is None or not row.get("rep") or row["rep"]["fees"] is None:
                base = []
                continue
            base.append((yy, qq, day, row))
        if len(base) < (1 if method == "lens" else MIN_BASE):
            continue
        A = [I.A(g, s, p) for p in ms]
        if any(A[i] is None for i in range(len(used))):
            continue
        flows = [I.flow(g, s, p) for p in ms[1:3]]
        if stage == 1:
            known = [f for f in flows if f is not None]
            drift_flow = fsum(known) / len(known) if known else 0.0
            a3 = A[2] + drift_flow
            mrows = [{"ym": p, "a": A[i]} for i, p in enumerate(ms[:3])] + [{"ym": e, "a": r(a3, 1), "est": 1, "flow": r(drift_flow, 1),
                                                                             "flows": [{"ym": p, "v": r(f, 1)} for p, f in zip(ms[1:3], flows)]}]
            A3 = a3
        else:
            mrows = [{"ym": p, "a": A[i]} for i, p in enumerate(ms)]
            A3 = A[3]
        avg = (A[0] / 2 + A[1] + A[2] + A3 / 2) / 3
        last = base[-1][3]
        if method == "lens":
            # the Savings Lens nowcast (build_lens.py): last printed quarter's yield x months-to-date average; costs of that quarter
            if stage == 1:
                avg = (A[0] / 2 + A[1] + A[2] / 2) / 2
            yld = last["fy_reg"]
            rev = yld / 100 * avg * 3 / 12
            sm, ga = last["rep"]["sm"], last["rep"]["ga"]
            opex = None if sm is None or ga is None else sm + ga
            segs[s] = {"rev": r(rev), "opex": r(opex)}
        else:
            b4 = base[-MIN_BASE:]
            y_tr = fsum(b[3]["rep"]["fees"] for b in b4) * 4 / fsum(b[3]["reg"]["avg"] for b in b4) * 100
            ys = [b[3]["fy_reg"] for b in base[-8:]]
            slope = ols_slope(ys)
            drift = DRIFT_DAMP * slope * DRIFT_H
            yld = y_tr + drift
            rev = yld / 100 * avg * 3 / 12
            # cost / income, seasonally adjusted
            have = {(b[0], b[1]): b[3]["rep"] for b in base}
            ks = []
            for yr in sorted({b[0] for b in base}):
                qs = [have.get((yr, k)) for k in (1, 2, 3, 4)]
                if all(x and x["fees"] and x["sm"] is not None and x["ga"] is not None for x in qs):
                    ci = [(x["sm"] + x["ga"]) / x["fees"] for x in qs]
                    m3 = fsum(ci[:3]) / 3
                    if m3 > 0:
                        ks.append({"y": yr, "k": r(ci[3] / m3, 4)})
            k = min(K_HI, max(K_LO, fsum(x["k"] for x in ks) / len(ks))) if ks else 1.0
            costs_ok = all(b[3]["rep"]["sm"] is not None and b[3]["rep"]["ga"] is not None for b in b4)
            if costs_ok:
                ci_base = fsum(b[3]["rep"]["sm"] + b[3]["rep"]["ga"] for b in b4) / fsum(b[3]["rep"]["fees"] * (k if b[1] == 4 else 1.0) for b in b4)
                ci_t = ci_base * (k if q == 4 else 1.0)
                opex = rev * ci_t
            else:
                ci_base = ci_t = opex = None
            segs[s] = {
                "rev": r(rev), "opex": r(opex), "yld": r(yld, 5), "y_tr": r(y_tr, 5), "slope": r(slope, 6), "drift": r(drift, 6),
                "avg": r(avg, 2), "months": mrows,
                "base": [{"q": qkey(b[0], b[1]), "printed": b[2], "fees": b[3]["rep"]["fees"], "sm": b[3]["rep"]["sm"], "ga": b[3]["rep"]["ga"],
                          "avg": b[3]["reg"]["avg"], "fy": b[3]["fy_reg"], "in4": 1 if b in b4 else 0} for b in base[-8:]],
                "ci_base": r(ci_base, 6), "ci": r(ci_t, 6), "k": r(k, 4), "ks": ks,
            }
        total_rev.append(rev)
        if segs[s]["opex"] is None:
            op_ok = False
        else:
            total_opex.append(segs[s]["opex"])
    if not segs:
        return None
    rev = fsum(total_rev)
    op = r(rev - fsum(total_opex)) if op_ok else None
    out = {"c": c, "g": g, "q": qkey(y, q), "stage": stage, "asof": asof_s, "segs": segs, "rev": r(rev), "op": op}
    if method == "m1":
        out["lag_ok"] = all(pub_day(p) <= asof for p in used[1:])
        if c in HOUSES:
            nb = I.nostro(c, asof_s)
            rate = I.rate_on(asof_s)
            if nb and rate is not None:
                out["nostro"] = {**nb, "rate": rate, "est": r(nb["bal"] * rate / 100 / 4)}
                if op is not None:
                    out["op_whole"] = r(op + out["nostro"]["est"])
    return out


def actual(I, c, y, q, segs):
    """the reported figure of the same segments (None when the quarter is not printed or a segment is missing)"""
    g = I.G[c]
    fees, op = [], []
    for s in segs:
        row = I.rows.get((g, s, qkey(y, q)))
        if not row or not row.get("rep") or row["rep"]["fees"] is None:
            return None
        fees.append(row["rep"]["fees"])
        op.append(row["rep"]["op"])
    return {"rev": r(fsum(fees)), "op": r(fsum(op)) if all(v is not None for v in op) else None}


def err_pp(est, act):
    """an operating-profit miss in points of the actual revenue (a thin margin makes the % miss on profit explode)"""
    if est is None or act is None or act.get("op") is None or not act.get("rev"):
        return None
    return r((est - act["op"]) / act["rev"] * 100, 3)


def err(est, act):
    if est is None or act is None or act == 0:
        return None
    return r((est - act) / abs(act) * 100, 3)


def stage_day(T, stage):
    return T - dt.timedelta(days=S1_DAYS if stage == 1 else S2_DAYS)


# ------------------------------------------------------------------------------------------------------------------------- backtest
def backtest(I):
    rows = []
    y, q = FIRST_TARGET
    while (y, q) <= I.last_rep:
        for c in COVER:
            T = I.print_day(c, y, q)
            if not T:
                continue
            T = dt.date.fromisoformat(T)
            row = {"c": c, "q": qkey(y, q), "T": T.isoformat()}
            for st in (1, 2):
                day = stage_day(T, st)
                e = estimate(I, c, y, q, st, day)
                b = estimate(I, c, y, q, st, day, method="lens")
                if not e:
                    continue
                a = actual(I, c, y, q, list(e["segs"]))
                row[f"s{st}"] = {"day": day.isoformat(), "rev": e["rev"], "op": e["op"], "lag_ok": e["lag_ok"],
                                 "segs": {s: {k: v[k] for k in ("rev", "opex", "yld", "y_tr", "drift", "avg", "ci", "k")} for s, v in e["segs"].items()},
                                 "lens": {"rev": b["rev"], "op": b["op"]} if b and set(b["segs"]) == set(e["segs"]) else None}
                if a:
                    row["act"] = a
                    row[f"s{st}"]["e_rev"] = err(e["rev"], a["rev"])
                    row[f"s{st}"]["e_op"] = err(e["op"], a["op"])
                    row[f"s{st}"]["e_opm"] = err_pp(e["op"], a)
                    if row[f"s{st}"]["lens"]:
                        row[f"s{st}"]["lens"]["e_rev"] = err(b["rev"], a["rev"])
                        row[f"s{st}"]["lens"]["e_op"] = err(b["op"], a["op"])
                        row[f"s{st}"]["lens"]["e_opm"] = err_pp(b["op"], a)
            if "s1" in row and "s2" in row:
                row["rev_s1s2"] = err(row["s2"]["rev"], row["s1"]["rev"])  # the revision, % of Stage 1
            if "act" in row:
                rows.append(row)
        y, q = qnext(y, q)
    return rows


def summarise(rows):
    def stats(xs):
        xs = [x for x in xs if x is not None]
        if not xs:
            return None
        return {"n": len(xs), "mape": r(fsum(abs(x) for x in xs) / len(xs), 2), "bias": r(fsum(xs) / len(xs), 2),
                "max": r(max(xs, key=abs), 2)}
    out = {}
    for c in COVER + ["all"]:
        rs = [x for x in rows if c == "all" or x["c"] == c]
        if not rs:
            continue
        o = {}
        for st in ("s1", "s2"):
            o[st] = {"rev": stats([x.get(st, {}).get("e_rev") for x in rs]), "op": stats([x.get(st, {}).get("e_op") for x in rs]),
                     "opm": stats([x.get(st, {}).get("e_opm") for x in rs]),
                     "lens_rev": stats([(x.get(st, {}).get("lens") or {}).get("e_rev") for x in rs]),
                     "lens_op": stats([(x.get(st, {}).get("lens") or {}).get("e_op") for x in rs]),
                     "lens_opm": stats([(x.get(st, {}).get("lens") or {}).get("e_opm") for x in rs])}
        o["rev_s1s2"] = stats([x.get("rev_s1s2") for x in rs])
        out[c] = o
    return out


# ------------------------------------------------------------------------------------------------------------------------- live + ledger
def live_stage(I):
    """the quarter after the last printed one, and the stage today's data supports (None before month 2 is in)"""
    y, q = qnext(*I.last_rep)
    e = y * 100 + q * 3
    if I.asof >= e:
        return y, q, 2
    if I.asof >= madd(e, -1):
        return y, q, 1
    return y, q, None


def ledger_path(qk, stage):
    return LEDGER / qk / f"stage{stage}.json"


def make_entry(I, y, q, stage, now, only=None):
    rows = []
    for c in (only or COVER):
        ts = [I.expected.get(k) for k in DOC_KEYS.get(c, [c])]
        ts = [x[1] for x in ts if x and x[0] == f"{y}Q{q}" and x[1]]
        T = min(ts) if ts else None
        e = estimate(I, c, y, q, stage, now.date())
        if not e:
            continue
        e["T_expected"] = T
        e["nominal_day"] = stage_day(dt.date.fromisoformat(T), stage).isoformat() if T else None
        e["scope"] = "house" if c in HOUSES else "segment"
        rows.append(e)
    inputs = {"method": METHOD, "params": {"S1_DAYS": S1_DAYS, "S2_DAYS": S2_DAYS, "PUB_DAY": PUB_DAY, "DRIFT_DAMP": DRIFT_DAMP, "DRIFT_H": DRIFT_H,
                                           "K_LO": K_LO, "K_HI": K_HI, "MIN_BASE": MIN_BASE},
              "lens_generated": I.lens["meta"]["generated"], "regulator_asof": I.asof, "regulator_fetched": I.fetched,
              "last_rep": I.lens["meta"]["last_rep"], "rate_source": I.rate_src, "rows": rows}
    return {"quarter": qkey(y, q), "stage": stage, "created_at": now.isoformat(timespec="seconds"), "method_version": METHOD,
            "inputs_hash": sha(inputs), "abstain": ({"phoenix": ABSTAIN_TEXT} if ABSTAIN_PHOENIX else {}), "inputs": inputs}


def read_ledger():
    out = []
    if LEDGER.exists():
        for f in sorted(LEDGER.glob("*/stage*.json")):  # stageN.json, then any dated addendum stageN.add-YYYYMMDD.json
            out.append(json.loads(f.read_text(encoding="utf-8")))
    return out


def scorecard_live(I, ledger):
    """Stage 3: every frozen estimate against the actual once printed"""
    by = {}
    for L in ledger:
        for e in L["inputs"]["rows"]:
            by.setdefault((e["c"], L["quarter"]), {})[L["stage"]] = {"rev": e["rev"], "op": e["op"], "segs": list(e["segs"]), "created_at": L["created_at"]}
    out = []
    for (c, qk), st in sorted(by.items()):
        y, q = qparse(qk)
        segs = (st.get(1) or st.get(2))["segs"]
        a = actual(I, c, y, q, segs)
        row = {"c": c, "q": qk, "s1": st.get(1), "s2": st.get(2), "act": a}
        for k in (1, 2):
            if st.get(k) and a:
                row[f"s{k}"] = {**st[k], "e_rev": err(st[k]["rev"], a["rev"]), "e_op": err(st[k]["op"], a["op"]), "e_opm": err_pp(st[k]["op"], a)}
        if st.get(1) and st.get(2):
            row["rev_s1s2"] = err(st[2]["rev"], st[1]["rev"])
        out.append(row)
    return out


def est_events(I, ledger, score):
    """events shaped for the M2 feed (feed.json `est`); written to data/nowcast/, merged into the feed only when the owner publishes.
    Reported figures use the source kind {k: lts, c, metric, per} (lts.json; the feed has no kind for a managing company's own report
    that is not on MAYA yet): to be added to build_feed / check_feed at merge."""
    ev = []
    for L in ledger:
        qk = L["quarter"]
        y, q = qparse(qk)
        by, bq = qprev(y, q)
        for e in L["inputs"]["rows"]:
            g = e["g"]
            base = actual(I, e["c"], by, bq, list(e["segs"]))
            last_m = max(m["ym"] for s in e["segs"].values() for m in s["months"] if not m.get("est"))
            fin = {"l": "אומדן", "v": e["rev"], "u": "m", "s": {"k": "calc", "fx": "Σ מגזרים: תשואת דמי ניהול × נכסים ממוצעים × 3 ÷ 12",
                   "in": [{"l": f"נכסים · {SEG_HE[s]} · {m['ym'] % 100:02d}/{str(m['ym'] // 100)[2:]}", "v": round(m["a"] / 1000, 6), "u": "bn",
                           "s": {"k": "reg", "metric": "assets", "ym": m["ym"], "pi": None, "w": "m", "set": "fam:pension" if s == "pen" else "fam:gemel", "g": g}}
                          for s, v in e["segs"].items() for m in v["months"] if not m.get("est")]}}
            rows = [{"l": f"הכנסות פנסיה וגמל, אומדן שלב {L['stage']}", "ab": [f"{qlabel(qk)} אומדן", f"{qlabel(qkey(by, bq))} בפועל"], "a": fin,
                     **({"b": {"v": base["rev"], "u": "m", "s": {"k": "lts", "c": e["c"], "metric": "fees", "per": qkey(by, bq), "segs": list(e["segs"])}}} if base else {})}]
            if e.get("op") is not None:
                rows.append({"l": f"רווח תפעולי מגזרי, אומדן שלב {L['stage']}", "a": {"v": e["op"], "u": "m", "s": {"k": "calc", "fx": "הכנסות באומדן − הכנסות × הוצאות להכנסות",
                             "in": [{"l": "הכנסות באומדן", "v": e["rev"], "u": "m", "s": fin["s"]}]}},
                             **({"b": {"v": base["op"], "u": "m", "s": {"k": "lts", "c": e["c"], "metric": "op", "per": qkey(by, bq), "segs": list(e["segs"])}}} if base and base["op"] is not None else {})})
            ev.append({"id": f"est:{qk}:s{L['stage']}:{e['c']}", "t": "est", "d": L["created_at"][:10], "dk": "fetched", "c": e["c"], "per": f"{y}Q{q}",
                       "h": f"אומדן {qlabel(qk)}, שלב {L['stage']} ({'2/3 חודשים' if L['stage'] == 1 else '3/3 חודשים'})" + (" · אומדן מגזרי, לא רווח הקבוצה" if e["scope"] == "segment" else ""),
                       "src": {"k": "reg", "ym": last_m}, "rows": rows, "to": f"/nowcast?q={qk}", "draft": 1})
    for s in score:
        if not s.get("act"):
            continue
        y, q = qparse(s["q"])
        ev.append({"id": f"est:{s['q']}:score:{s['c']}", "t": "est", "d": I.print_day(s["c"], y, q), "dk": "pub", "c": s["c"], "per": f"{y}Q{q}",
                   "h": f"אומדן מול בפועל, {qlabel(s['q'])}", "src": {"k": "lts", "c": s["c"], "per": s["q"]},
                   "rows": [{"l": f"הכנסות, שלב {k}", "a": {"v": s[f's{k}']["rev"], "u": "m", "s": {"k": "ledger", "q": s["q"], "stage": k}},
                             "b": {"v": s["act"]["rev"], "u": "m", "s": {"k": "lts", "c": s["c"], "metric": "fees", "per": s["q"]}}} for k in (1, 2) if s.get(f"s{k}")],
                   "to": f"/nowcast?q={s['q']}", "draft": 1})
    return ev


def fill_pi(ev, I):
    """the feed's regulator source: the month's index in market.json periods and the exact aggregate (NIS bn) the feed re-reads"""
    m = json.loads((WEB / "market.json").read_text(encoding="utf-8"))
    pi = {p: i for i, p in enumerate(m["periods"])}
    fam = {i: "fam:" + pr["family"] for i, pr in enumerate(m["products"])}
    cells = {}
    for row in m["rows"]:
        k = (row[0], fam[row[1]], row[2])
        cells[k] = cells.get(k, 0.0) + row[3]
    for e in ev:
        for row in e.get("rows", []):
            for x in row["a"]["s"].get("in", []):
                if x["s"].get("k") == "reg":
                    i = pi.get(x["s"]["ym"])
                    x["s"]["pi"] = i
                    if (i, x["s"]["set"], x["s"]["g"]) in cells:
                        x["v"] = round(cells[(i, x["s"]["set"], x["s"]["g"])] / 1000, 6)
    return ev


# ========================================================================================================================= F2E
# Flow-to-earnings (wave 11, method F2E_METHOD): the regulator's own fee book, track by track, mapped to the reported fee line.
#   implied   accumulation fees  = (R0/2 + R1 + R2 + R3/2) / 12, R_m = Σ_tracks TOTAL_ASSETS_m × AVG_ANNUAL_MANAGEMENT_FEE_m / 100 (NIS m a
#             year, market.json fee_num) scaled by assets / assets-with-a-fee (tracks without a published fee: ASSUMPTION, the group's
#             average); m0 = the previous quarter's last month (a trapezoid, as lens avg_reg)
#             + deposit fees     = Σ_{m1..m3} Σ_tracks DEPOSITS_m × AVG_DEPOSIT_FEE_m / 100 (nowcast_depfee.json), scaled the same way
#   ratio     reported segment fees (lens rep.fees, report page) ÷ implied, per manager × segment × printed quarter
#   nowcast   ratio_hat × implied of the target quarter; ratio_hat = mean of the last F2E_N ratios printed before the as-of day;
#             range = implied × (ratio_hat ∓ F2E_Z × sd), sd = sample standard deviation of the last up to F2E_SD printed ratios.
#             A manager's range = Σ of its segments' ranges (ASSUMPTION: segment errors fully correlated, the wider reading)
#   profit    ONLY with disclosed costs: segment op = revenue × (1 − M1's cost/income: trailing-4Q (S&M + G&A) ÷ fees, Q4-seasonal); labelled
#   timing    the Stage 2 day (T − S2_DAYS) of every printed quarter; only reports printed before it, months up to the quarter's third
F2E_METHOD = "f2e1.0"
F2E_OUT = WEB / "nowcast_f2e.json"
DEPFEE = WEB / "nowcast_depfee.json"
F2E_LEDGER = ROOT / "data" / "ledger" / "nowcast_f2e"
DF_FROM = 202201              # deposit-fee cells kept from this month (the first base quarter Q1'23 needs 12/22)
F2E_N = 4                     # ratio_hat: mean of the last F2E_N printed ratios (ASSUMPTION)
F2E_SD = 8                    # dispersion window, printed quarters (ASSUMPTION)
F2E_Z = 2.0                   # range half-width in standard deviations (ASSUMPTION)
FAM_SEG = {"pension": "pen", "gemel": "gem"}
DF_TOL = 0.05                 # NIS m: Σ deposits of the deposit-fee file vs market.json, per group × segment × month


def extract_depfee(raw):
    """LOCAL ONLY (pandas + the regulator's parquet, data/raw or --raw DIR): Σ DEPOSITS × AVG_DEPOSIT_FEE per month × group × segment, the
    monthly deposit fee the published per-track files do not carry yet. Same filters and group rule as build_market.py (TOTAL_ASSETS
    present; managing corporation -> group by build_market.group_of), so Σ dep equals market.json's dep (checked by --check in CI)."""
    import pandas as pd
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import build_market as BM
    m = json.loads((WEB / "market.json").read_text(encoding="utf-8"))
    gi = {g: i for i, g in enumerate(m["groups"])}
    rows = []
    for fname, s in (("pensia", "pen"), ("gemel", "gem")):
        d = pd.read_parquet(raw / f"{fname}.parquet", columns=["MANAGING_CORPORATION", "REPORT_PERIOD", "TOTAL_ASSETS", "DEPOSITS", "AVG_DEPOSIT_FEE"])
        d = d[d["TOTAL_ASSETS"].notna() & (d["REPORT_PERIOD"] >= DF_FROM)].copy()
        d["g"] = d["MANAGING_CORPORATION"].map(BM.group_of).map(gi)
        assert d["g"].notna().all(), "a managing corporation outside market.json groups"
        d["dep"] = d["DEPOSITS"].fillna(0.0)
        ok = d["DEPOSITS"].notna() & d["AVG_DEPOSIT_FEE"].notna()
        d["dd"] = d["dep"].where(ok, 0.0)
        d["dfn"] = (d["dep"] * d["AVG_DEPOSIT_FEE"]).where(ok, 0.0)
        d["n"] = ok.astype(int)
        agg = d.groupby(["REPORT_PERIOD", "g"], as_index=False).agg(dep=("dep", "sum"), dd=("dd", "sum"), dfn=("dfn", "sum"), n=("n", "sum"))
        for x in agg.itertuples(index=False):
            rows.append([int(x.REPORT_PERIOD), int(x.g), s, round(float(x.dep), 3), round(float(x.dd), 3), round(float(x.dfn), 4), int(x.n)])
    rows.sort(key=lambda x: (x[0], x[1], x[2]))
    out = {"v": 1, "asof": m["meta"]["asof"], "fetched": m["meta"]["fetched"], "from": DF_FROM,
           "method": "לכל חודש × קבוצה × מגזר (פנסיה: פנסיה-נט; גמל והשתלמות: גמל-נט): dep = Σ DEPOSITS; dd = Σ DEPOSITS של מסלולים שפרסמו "
                     "AVG_DEPOSIT_FEE; dfn = Σ DEPOSITS × AVG_DEPOSIT_FEE (מיליוני ש\"ח × אחוז); n = מספר המסלולים האלה. שיוך לקבוצה ולמגזר: כמו market.json",
           "src": m["meta"]["source"], "resources": {k: m["meta"]["resources"][k] for k in ("pensia", "gemel")}, "groups": m["groups"],
           "cols": ["ym", "g", "s", "dep", "dd", "dfn", "n"], "rows": rows}
    DEPFEE.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return out


class RegBook:
    """the regulator's fee book per group × segment × month: market.json (assets, Σ assets × fee) and nowcast_depfee.json"""

    def __init__(self, I):
        m = json.loads((WEB / "market.json").read_text(encoding="utf-8"))
        assert [g["name"] for g in I.lens["groups"]] == m["groups"], "lens groups and market groups differ"
        P = m["periods"]
        fam = [p["family"] for p in m["products"]]
        parts = {}
        for row in m["rows"]:
            pi, pr, g, a, dep, wd, tr, fa, fn, fd = row[:10]
            s = FAM_SEG.get(fam[pr])
            if s and P[pi] >= DF_FROM:
                x = parts.setdefault((g, s, P[pi]), ([], [], [], []))
                for lst, v in zip(x, (a, fn, fd, dep)):
                    lst.append(v)
        self.mk = {k: tuple(fsum(v) for v in x) for k, x in parts.items()}
        self.df = None
        if DEPFEE.exists():
            d = json.loads(DEPFEE.read_text(encoding="utf-8"))
            self.df_meta = {k: d[k] for k in ("asof", "fetched", "from", "method", "src", "resources")}
            self.df = {(x[1], x[2], x[0]): x[3:] for x in d["rows"]}

    def month(self, g, s, ym):
        x = self.mk.get((g, s, ym))
        if not x or not x[0]:
            return None
        a, fn, fd, dep = x
        if not fd:
            return None
        return {"ym": ym, "a": r(a, 1), "fee": r(fn / fd, 5), "cov": r(fd / a * 100, 2), "R": r(fn * a / fd / 100, 4)}

    def dmonth(self, g, s, ym):
        x = self.mk.get((g, s, ym))
        if self.df is None or not x:
            return None
        d = self.df.get((g, s, ym))
        if d is None:
            return {"ym": ym, "dep": 0.0, "depfee": None, "dcov": None, "D": 0.0} if not x[3] else None
        dep, dd, dfn, n = d
        if not dd:
            return {"ym": ym, "dep": r(dep, 1), "depfee": None, "dcov": 0.0, "D": 0.0, "n": n}
        return {"ym": ym, "dep": r(dep, 1), "depfee": r(dfn / dd, 4), "dcov": r(dd / dep * 100, 2) if dep else None, "D": r(dfn * dep / dd / 100, 4), "n": n}

    def implied(self, g, s, y, q):
        e = y * 100 + q * 3
        ms = [madd(e, -3), madd(e, -2), madd(e, -1), e]
        M = [self.month(g, s, p) for p in ms]
        Dm = [self.dmonth(g, s, p) for p in ms[1:]]
        if any(x is None for x in M) or any(x is None for x in Dm):
            return None
        acc = fsum([M[0]["R"] / 2, M[1]["R"], M[2]["R"], M[3]["R"] / 2]) / 12
        dep = fsum(x["D"] for x in Dm)
        return {"acc": r(acc, 4), "dep": r(dep, 4), "imp": r(acc + dep, 4), "months": M, "dmonths": Dm}


def sd_sample(xs):
    if len(xs) < 2:
        return None
    mu = fsum(xs) / len(xs)
    return math.sqrt(fsum((x - mu) ** 2 for x in xs) / (len(xs) - 1))


def ratio_hist(I, R, c, s, upto=None, before=None):
    """every printed quarter of manager c × segment s (oldest first): reported fees, regulator-implied, ratio. upto: quarters < (y, q);
    before: printed before that ISO day. A hole (unprinted or no implied) resets the run: only the contiguous run to the latest counts."""
    g = I.G[c]
    out = []
    y, q = 2023, 1
    while (y, q) <= I.last_rep and (upto is None or (y, q) < upto):
        day = I.print_day(c, y, q)
        row = I.rows.get((g, s, qkey(y, q)))
        t = R.implied(g, s, y, q)
        ok = day and (before is None or day < before) and row and row.get("rep") and row["rep"]["fees"] is not None and t and t["imp"] > 0
        if ok:
            out.append({"q": qkey(y, q), "printed": day, "fees": row["rep"]["fees"], "acc": t["acc"], "dep": t["dep"], "imp": t["imp"],
                        "ratio": r(row["rep"]["fees"] / t["imp"], 5), "R": [m["R"] for m in t["months"]], "D": [m["D"] for m in t["dmonths"]]})
        elif before is not None:
            out = []
        y, q = qnext(y, q)
    return out


def f2e_estimate(I, R, c, y, q, asof):
    """manager c, quarter (y, q), as of a day: None when fewer than F2E_N printed ratios or the quarter's months are not all in"""
    g = I.G[c]
    asof_s = asof.isoformat()
    segs = {}
    m1 = estimate(I, c, y, q, 2, asof)
    for s in SEGS:
        base = ratio_hist(I, R, c, s, upto=(y, q), before=asof_s)
        if len(base) < F2E_N:
            continue
        t = R.implied(g, s, y, q)
        if not t or t["imp"] <= 0:
            continue
        rs = [b["ratio"] for b in base]
        rh = fsum(rs[-F2E_N:]) / F2E_N
        sd = sd_sample(rs[-F2E_SD:])
        rev = rh * t["imp"]
        ci = (m1 or {}).get("segs", {}).get(s, {}).get("ci")
        segs[s] = {"rev": r(rev), "lo": r((rh - F2E_Z * sd) * t["imp"]), "hi": r((rh + F2E_Z * sd) * t["imp"]), "ratio": r(rh, 5), "sd": r(sd, 5),
                   "acc": t["acc"], "dep": t["dep"], "imp": t["imp"], "months": t["months"], "dmonths": t["dmonths"],
                   "base": [{**b, "in_n": 1 if i >= len(base) - F2E_N else 0} for i, b in enumerate(base[-F2E_SD:], len(base) - min(len(base), F2E_SD))],
                   "ci": ci, "opex": r(rev * ci) if ci is not None else None}
    if not segs:
        return None
    rev = fsum(x["rev"] for x in segs.values())
    op_ok = all(x["opex"] is not None for x in segs.values())
    e = y * 100 + q * 3
    return {"c": c, "g": g, "q": qkey(y, q), "asof": asof_s, "segs": segs, "rev": r(rev), "lo": r(fsum(x["lo"] for x in segs.values())),
            "hi": r(fsum(x["hi"] for x in segs.values())), "imp": r(fsum(x["imp"] for x in segs.values())),
            "op": r(rev - fsum(x["opex"] for x in segs.values())) if op_ok else None, "m1_rev": (m1 or {}).get("rev"),
            "lag_ok": all(pub_day(p) <= asof for p in (madd(e, -2), madd(e, -1), e)), "scope": "house" if c in HOUSES else "segment"}


def f2e_backtest(I, R):
    rows = []
    y, q = FIRST_TARGET
    while (y, q) <= I.last_rep:
        for c in COVER:
            T = I.print_day(c, y, q)
            if not T:
                continue
            day = stage_day(dt.date.fromisoformat(T), 2)
            e = f2e_estimate(I, R, c, y, q, day)
            if not e:
                continue
            a = actual(I, c, y, q, list(e["segs"]))
            if not a:
                continue
            rows.append({"c": c, "q": e["q"], "T": T, "day": day.isoformat(), "rev": e["rev"], "lo": e["lo"], "hi": e["hi"], "imp": e["imp"], "op": e["op"],
                         "lag_ok": e["lag_ok"], "act": a, "e_rev": err(e["rev"], a["rev"]), "in": 1 if e["lo"] <= a["rev"] <= e["hi"] else 0,
                         "e_opm": err_pp(e["op"], a), "m1_rev": e["m1_rev"], "e_m1": err(e["m1_rev"], a["rev"]),
                         "segs": {s: {k: v[k] for k in ("rev", "lo", "hi", "ratio", "sd", "acc", "dep", "imp", "ci")} for s, v in e["segs"].items()}})
        y, q = qnext(y, q)
    return rows


def f2e_summary(rows):
    def st(xs, ins=None):
        xs = [x for x in xs if x is not None]
        if not xs:
            return None
        o = {"n": len(xs), "mdae": r(statistics.median(abs(x) for x in xs), 2), "mape": r(fsum(abs(x) for x in xs) / len(xs), 2),
             "bias": r(fsum(xs) / len(xs), 2), "max": r(max(xs, key=abs), 2)}
        if ins is not None:
            o["cover"] = r(fsum(ins) / len(ins) * 100, 1)
        return o
    out = {}
    for c in COVER + ["all"]:
        rs = [x for x in rows if c == "all" or x["c"] == c]
        if rs:
            out[c] = {"rev": st([x["e_rev"] for x in rs], [x["in"] for x in rs]), "opm": st([x["e_opm"] for x in rs]), "m1": st([x["e_m1"] for x in rs])}
    return out


def f2e_ledger_path(qk):
    return F2E_LEDGER / qk / "stage2.json"


def f2e_entry(I, R, y, q, now):
    rows = []
    for c in COVER:
        ts = [I.expected.get(k) for k in DOC_KEYS.get(c, [c])]
        ts = [x[1] for x in ts if x and x[0] == f"{y}Q{q}" and x[1]]
        e = f2e_estimate(I, R, c, y, q, now.date())
        if e:
            e["T_expected"] = min(ts) if ts else None
            rows.append(e)
    inputs = {"method": F2E_METHOD, "params": {"F2E_N": F2E_N, "F2E_SD": F2E_SD, "F2E_Z": F2E_Z, "S2_DAYS": S2_DAYS, "PUB_DAY": PUB_DAY},
              "regulator_asof": I.asof, "regulator_fetched": I.fetched, "depfee": R.df_meta["fetched"], "last_rep": I.lens["meta"]["last_rep"], "rows": rows}
    return {"quarter": qkey(y, q), "stage": 2, "created_at": now.isoformat(timespec="seconds"), "method_version": F2E_METHOD, "inputs_hash": sha(inputs), "inputs": inputs}


def f2e_read_ledger():
    return [json.loads(f.read_text(encoding="utf-8")) for f in sorted(F2E_LEDGER.glob("*/stage2.json"))] if F2E_LEDGER.exists() else []


def f2e_score(I, ledger):
    out = []
    for L in ledger:
        y, q = qparse(L["quarter"])
        for e in L["inputs"]["rows"]:
            a = actual(I, e["c"], y, q, list(e["segs"]))
            row = {"c": e["c"], "q": L["quarter"], "rev": e["rev"], "lo": e["lo"], "hi": e["hi"], "op": e["op"], "created_at": L["created_at"], "act": a}
            if a:
                row.update(e_rev=err(e["rev"], a["rev"]), e_opm=err_pp(e["op"], a), **{"in": 1 if e["lo"] <= a["rev"] <= e["hi"] else 0})
            out.append(row)
    return out


def f2e_depfee_check(R):
    """the deposit-fee file's Σ deposits equals market.json per group × segment × month (both read the same DEPOSITS column)"""
    if R.df is None:
        return ["nowcast_depfee.json missing: run build_nowcast.py --depfee where the regulator parquet is"]
    bad = []
    for k, x in R.mk.items():
        d = R.df.get(k)
        dep = d[0] if d else 0.0
        if abs(dep - x[3]) > DF_TOL:
            bad.append(f"depfee {k}: Σ deposits {dep:.2f} vs market.json {x[3]:.2f}")
    return bad[:5]


def f2e_build(I, R, ledger):
    hist = {c: {s: h for s in SEGS if (h := ratio_hist(I, R, c, s))} for c in COVER}
    bt = f2e_backtest(I, R)
    return {"meta": {"method": F2E_METHOD, "draft": True, "built_from": {"lens": I.lens["meta"]["generated"], "regulator_asof": I.asof, "last_rep": I.lens["meta"]["last_rep"],
                                                                          "depfee": R.df_meta["fetched"]}, "depfee": R.df_meta},
            "params": {"F2E_N": F2E_N, "F2E_SD": F2E_SD, "F2E_Z": F2E_Z, "S2_DAYS": S2_DAYS, "PUB_DAY": PUB_DAY, "FIRST_TARGET": qkey(*FIRST_TARGET)},
            "cover": COVER, "houses": sorted(HOUSES), "hist": hist,
            "ledger": [{k: L[k] for k in ("quarter", "stage", "created_at", "method_version", "inputs_hash")} | {"rows": L["inputs"]["rows"]} for L in ledger],
            "score": f2e_score(I, ledger), "backtest": bt, "summary": f2e_summary(bt)}


def build(I, ledger):
    bt = backtest(I)
    y, q, st = live_stage(I)
    out = {
        "meta": {"method": METHOD, "built_from": {"lens": I.lens["meta"]["generated"], "regulator_asof": I.asof, "last_rep": I.lens["meta"]["last_rep"]},
                 "draft": True, "live": {"q": qkey(y, q), "stage": st}},
        "params": {"S1_DAYS": S1_DAYS, "S2_DAYS": S2_DAYS, "PUB_DAY": PUB_DAY, "DRIFT_DAMP": DRIFT_DAMP, "DRIFT_H": DRIFT_H, "K_LO": K_LO, "K_HI": K_HI, "MIN_BASE": MIN_BASE},
        "cover": COVER, "houses": sorted(HOUSES), "abstain": {"phoenix": ABSTAIN_TEXT} if ABSTAIN_PHOENIX else {}, "not_covered": NOT_COVERED,
        "ledger": [{k: L[k] for k in ("quarter", "stage", "created_at", "method_version", "inputs_hash")} | {"rows": L["inputs"]["rows"]} for L in ledger],
        "score": scorecard_live(I, ledger),
        "backtest": bt,
        "summary": summarise(bt),
    }
    return out


def no_phoenix(obj):
    s = json.dumps(obj, ensure_ascii=False)
    return '"c": "phoenix"' not in s and '"c":"phoenix"' not in s


def main():
    if "--depfee" in sys.argv:
        raw = Path(sys.argv[sys.argv.index("--raw") + 1]) if "--raw" in sys.argv else ROOT / "data" / "raw"
        out = extract_depfee(raw)
        print(f"wrote {DEPFEE.relative_to(ROOT)}: {len(out['rows'])} cells, {DF_FROM}..{out['asof']}, from {raw}")
        return 0
    I = Inputs()
    if ABSTAIN_PHOENIX:
        assert "phoenix" not in COVER
    check = "--check" in sys.argv
    y, q, st = live_stage(I)
    if not check and st and "--dry" not in sys.argv:
        p = ledger_path(qkey(y, q), st)
        if p.exists():
            print(f"ledger: {p.relative_to(ROOT)} exists (frozen); not rewritten")
            # a manager covered after the stage was frozen gets a dated addendum: the frozen file is never touched
            have = {e["c"] for f in p.parent.glob(f"stage{st}*.json") for e in json.loads(f.read_text(encoding="utf-8"))["inputs"]["rows"]}
            missing = [c for c in COVER if c not in have]
            now = dt.datetime.now().astimezone()
            a = p.parent / f"stage{st}.add-{now:%Y%m%d}.json"
            if missing and not a.exists():
                entry = make_entry(I, y, q, st, now, only=missing)
                if entry["inputs"]["rows"]:
                    a.write_text(json.dumps(entry, ensure_ascii=False, indent=1), encoding="utf-8")
                    print(f"ledger: wrote addendum {a.relative_to(ROOT)} ({', '.join(e['c'] for e in entry['inputs']['rows'])})")
        else:
            entry = make_entry(I, y, q, st, dt.datetime.now().astimezone())
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps(entry, ensure_ascii=False, indent=1), encoding="utf-8")
            print(f"ledger: wrote {p.relative_to(ROOT)} ({len(entry['inputs']['rows'])} managers, hash {entry['inputs_hash'][:12]})")
    ledger = read_ledger()
    bad = []
    for L in ledger:
        if sha(L["inputs"]) != L["inputs_hash"]:
            bad.append(f"ledger {L['quarter']} stage {L['stage']}: inputs hash does not recompute")
        if ABSTAIN_PHOENIX and not no_phoenix(L):
            bad.append(f"ledger {L['quarter']} stage {L['stage']}: carries a phoenix estimate")
    d = build(I, ledger)
    if ABSTAIN_PHOENIX and not no_phoenix(d):
        bad.append("nowcast.json carries a phoenix estimate")
    # ---- F2E (wave 11): its own write-once ledger (stage 2 only: the three months of the quarter in), file and checks
    R = RegBook(I)
    bad += f2e_depfee_check(R)
    if not check and st == 2 and "--dry" not in sys.argv and R.df is not None:
        p = f2e_ledger_path(qkey(y, q))
        if not p.exists():
            entry = f2e_entry(I, R, y, q, dt.datetime.now().astimezone())
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps(entry, ensure_ascii=False, indent=1), encoding="utf-8")
            print(f"f2e ledger: wrote {p.relative_to(ROOT)} ({len(entry['inputs']['rows'])} managers, hash {entry['inputs_hash'][:12]})")
    f2e_ledger = f2e_read_ledger()
    for L in f2e_ledger:
        if sha(L["inputs"]) != L["inputs_hash"] or L["method_version"] != L["inputs"]["method"]:
            bad.append(f"f2e ledger {L['quarter']}: inputs hash does not recompute")
    f = f2e_build(I, R, f2e_ledger) if R.df is not None else None
    if check:
        disk = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else None
        same = disk == json.loads(json.dumps(d, ensure_ascii=False))
        fdisk = json.loads(F2E_OUT.read_text(encoding="utf-8")) if F2E_OUT.exists() else None
        fsame = f is not None and fdisk == json.loads(json.dumps(f, ensure_ascii=False))
        print(f"nowcast.json {'matches' if same else 'DIFFERS from'} a rebuild; nowcast_f2e.json {'matches' if fsame else 'DIFFERS from'} a rebuild; "
              f"{len(ledger)} + {len(f2e_ledger)} ledger entries; {len(d['backtest'])} + {len(f['backtest']) if f else 0} backtest rows; {len(bad)} problems")
        for b in bad:
            print("  ", b)
        return 0 if same and fsame and not bad else 1
    if bad:
        print("problems:", bad)
        return 1
    OUT.write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    F2E_OUT.write_text(json.dumps(f, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    fs = f["summary"].get("all", {}).get("rev") or {}
    print(f"wrote {F2E_OUT.relative_to(ROOT)}: {F2E_OUT.stat().st_size:,} bytes; f2e backtest {len(f['backtest'])} manager-quarters, "
          f"median |error| {fs.get('mdae')}%, MAPE {fs.get('mape')}%, range cover {fs.get('cover')}%")
    ev = fill_pi(est_events(I, ledger, d["score"]), I)
    EVENTS.parent.mkdir(parents=True, exist_ok=True)
    EVENTS.write_text(json.dumps({"v": 1, "t": "est", "contract": "feed.json events (wave1-m2-feed, build_feed.py docstring)", "events": ev}, ensure_ascii=False, indent=1), encoding="utf-8")
    s = d["summary"].get("all", {})
    print(f"wrote {OUT.relative_to(ROOT)}: {OUT.stat().st_size:,} bytes; backtest {len(d['backtest'])} manager-quarters; "
          f"S1 revenue MAPE {s.get('s1', {}).get('rev', {}) and s['s1']['rev']['mape']}%, S2 {s.get('s2', {}).get('rev', {}) and s['s2']['rev']['mape']}%; "
          f"{len(ev)} est events -> {EVENTS.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
