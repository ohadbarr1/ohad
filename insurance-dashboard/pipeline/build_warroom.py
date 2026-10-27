"""A5 · the Competitive War Room: how much net transfer flow (ניוד) one basis point of RELATIVE fee advantage buys, per product, estimated
from the regulator's track-level monthly files; and the board the move simulator (/warroom) plays on. Standard library only.

Input : web/public/data/prov/reg/<g>/<year>.json   every track of every group by month (assets, opening assets, fee, return, transfers),
                                                    the regulator's Gemel-Net / Pensia-Net files as pipeline/build_market.py cut them
        web/public/data/market.json                 products, groups, periods, the datasets' resource names
        web/public/data/funds.json                  today's track category of each active track (build_funds.py)
        web/public/data/lens.json                   net transfers per group x segment x quarter (the context line)
        web/public/data/companies/index.json        regulator group -> company id (the A1 driver file of each competitor)
        pipeline/build_funds.py                     the track-category rules (TRACK), read as data, so a closed track is classified the same way
Output: web/public/data/warroom/elasticity.json     the estimates, per product, with every specification, fit and quality label
        web/public/data/warroom/board.json          per product x track category: each manager's assets, fee, tracks, recent net transfers,
                                                    and the revealed substitution (who loses when a manager wins), latest month

python3 pipeline/build_warroom.py           build
python3 pipeline/build_warroom.py --check   rebuild in memory, compare with the files on disk, verify: every estimate has n, se, t and a
                                            quality label, no NaN anywhere, every figure has provenance down to a regulator dataset and month
                                            (a `fund` leaf or a dataset `report` leaf with its window), allocation weights sum to 1 (exit 1 on a miss)

THE FEE FIELD. AVG_ANNUAL_MANAGEMENT_FEE changes only in January (2020-26: every one of the 2,897 changes on pension, gemel and hishtalmut
tracks is a January value, bar two June ones): it is an annual average. Its timing is tested here, not assumed: across groups, the YoY change
of the asset-weighted posted fee correlates 0.84 with the change of the fee yield the managers REPORT for the PREVIOUS year and 0.67 with the
same year (meta.fee_timing recomputes it). So the fee posted in year Y is the fee charged in Y-1, and the panel re-times it:
fee_charged(track, Y) = fee posted in January of Y+1. The sample ends in 12/25 (the last year whose charged fee is published).

THE MODEL (one per product: pension = קרנות חדשות, gemel = תגמולים ואישית לפיצויים, hishtalmut = קרנות השתלמות):
    tr_it / A_i,t-1 x 100  =  a_i + g_ct + sum_k=0..6 b_k relfee_i,t-k + c1 rel12_i,t-1 + c2 rel36_i,t-1 + c3 no36_i,t-1 + c4 ln A_i,t-1 + e
      i track, t month, c the track's category (pipeline/build_funds.py TRACK: כללי, עד 50, מניות, עוקב מדד S&P 500 ...)
      tr = INTERNAL_TRANSFERS (net transfers between funds, NIS m), A = opening assets (the previous month's TOTAL_ASSETS)
      relfee = (fee charged by the track - the asset-weighted fee of the OTHER groups' tracks in its category that month) x 100, bp
      rel12 / rel36 = the track's compounded 12 / 36-month return minus the same mean of the other groups (pp); no36 = 1 where the
      track has no 36-month history (rel36 then 0), so young tracks (the index trackers) stay in the sample
    weights: opening assets (the flow of the market, not of the average track); errors clustered by track
    a_i: track fixed effects (identification from each track's own fee changes); g_ct: category x month effects (only the advantage
    over the same month's competitors counts; transfers are zero-sum within a category)
    B = sum b_k: the steady monthly flow, % of the track's assets, per 1bp of relative fee (negative = a cheaper track gains)
Robustness (reported beside it, never mixed in): (mgr) adding manager x month effects (absorbs a manager's reputation shocks); (fd) first
differences; (posted) the fee as posted, unshifted. Pooled: the three products in one regression (category x product x month effects).
Quality: high = t(B) <= -3 and the same sign in every robustness; medium = t <= -2; low = t <= -1; none = t > -1 or the wrong sign (not
used: the simulator says so instead of moving any money).
Excluded: the sector funds (group "קרנות ענפיות ואחרות", closed to the public), personal-management tracks (בניהול אישי / IRA), track-months
under NIS 100m of opening assets, |transfers| over 20% of opening assets in a month (mergers and track splits, not choices).

THE BOARD (latest month): per product x category x manager, the assets (TOTAL_ASSETS), the posted fee (asset-weighted), the net transfers of the
last quarter and the last 12 months, each figure with its tracks. Revealed substitution: for a manager m, each competitor j's monthly net
transfers in the category regressed on m's (01/20 to the latest month): d_j = max(0, -slope_j), normalised. Used where the competitors mirror at
least 30% of m's flow over at least 36 months; else the competitors' share of the category's assets (labelled). Units: NIS m, bp, % a month.
"""
import ast
import datetime as dt
import json
import math
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from warroom_ols import fit, lincom, ols1  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web" / "public" / "data"
OUT = WEB / "warroom"
PRODS = {
    "pen": {"he": "פנסיה מקיפה", "key": "pension_new", "ds": "pensia", "a1": "pen", "fam": "pension", "url": "https://data.gov.il/dataset/pensia-net"},
    "gemel": {"he": "קופות גמל", "key": "gemel", "ds": "gemel", "a1": "gem", "fam": "gemel", "url": "https://data.gov.il/dataset/gemelnet"},
    "hisht": {"he": "קרנות השתלמות", "key": "hishtalmut", "ds": "gemel", "a1": "gem", "fam": "gemel", "url": "https://data.gov.il/dataset/gemelnet"},
}
DS_HE = {"gemel": "גמל-נט", "pensia": "פנסיה-נט"}
LETTER = {"gemel": "g", "pensia": "p", "insurance": "i"}
SECTOR = "קרנות ענפיות ואחרות"
IRA = re.compile(r"בניהול אישי|\bira\b|ניהול אישי", re.I)
Y0, FROM, TO = 2016, 202001, 202512   # history loaded from 2016 (36-month returns); estimation window 01/20-12/25
LAGS = 6
MIN_A, TRIM = 100.0, 0.20
MIN_DIV_N, MIN_COVER = 36, 0.30
NAMES = [f"relfee_l{k}" for k in range(LAGS + 1)] + ["rel12", "rel36", "no36", "lnA"]


def load(p):
    return json.loads((WEB / p).read_text(encoding="utf8"))


def track_rules():
    """the TRACK rules of build_funds.py, read from its source as data (it needs pandas to run; the rules are plain literals)"""
    for n in ast.parse((ROOT / "pipeline" / "build_funds.py").read_text(encoding="utf8")).body:
        if isinstance(n, ast.Assign) and getattr(n.targets[0], "id", None) == "TRACK":
            return [(re.compile(rx), lab) for rx, lab in ast.literal_eval(n.value)]
    raise SystemExit("build_funds.py: TRACK not found")


def mlabel(p):
    return f"{p % 100:02d}/{str(p // 100)[2:]}"


def madd(p, k):
    t = (p // 100) * 12 + (p % 100 - 1) + k
    return (t // 12) * 100 + t % 12 + 1


def r(x, d=4):
    return None if x is None else round(x, d)


# ------------------------------------------------------------------------------------------------------------------------------ data
class Panel:
    def __init__(self):
        mk = load("market.json")
        self.mk = mk
        self.P = [p["key"] for p in mk["products"]]
        self.G = mk["groups"]
        self.periods = mk["periods"]
        self.asof = mk["periods"][-1]
        self.res = mk["meta"]["resources"]
        funds = load("funds.json")["funds"]
        self.cur_track = {f["k"]: f["track"] for f in funds}
        rules = track_rules()
        reg = load("companies/index.json")
        self.co = {}
        for c in reg:
            if c.get("market_group") and c["id"] != "more_gemel":
                self.co.setdefault(c["market_group"], c["id"])
        want = {v["key"]: k for k, v in PRODS.items()}
        self.tr = {}   # (ds, id) -> track
        for g, gname in enumerate(self.G):
            for y in range(Y0, self.asof // 100 + 1):
                f = WEB / "prov" / "reg" / str(g) / f"{y}.json"
                if not f.exists():
                    continue
                d = json.loads(f.read_text(encoding="utf8"))
                for i, fu in enumerate(d["funds"]):
                    ds, fid, name, pi, mgr = fu
                    prod = want.get(self.P[pi])
                    if prod is None:
                        continue
                    key = (ds, fid)
                    t = self.tr.get(key)
                    if t is None:
                        k = LETTER[ds] + str(fid)
                        cat = self.cur_track.get(k)
                        if cat is None:
                            low = name.lower()
                            cat = next((lab for rx, lab in rules if rx.search(low)), "אחר")
                        t = self.tr[key] = {"ds": ds, "id": fid, "name": name, "prod": prod, "cat": cat, "g": {}, "a": {}, "prev": {}, "fee": {},
                                            "y": {}, "tr": {}, "ira": bool(IRA.search(name))}
                    for j, m in enumerate(d["months"]):
                        if d["a"][i][j] is None:
                            continue
                        t["g"][m] = g
                        for c in ("a", "prev", "fee", "y", "tr"):
                            v = d[c][i][j]
                            if v is not None:
                                t[c][m] = v
        self.months = sorted({m for t in self.tr.values() for m in t["a"]})
        # posted fee per track and year: its January value (constant within the year bar two June steps); charged(Y) = posted(Y + 1)
        for t in self.tr.values():
            post = {}
            for m in sorted(t["fee"]):
                post.setdefault(m // 100, (t["fee"][m], m))
            t["post"] = post
            t["charged"] = {y - 1: v[0] for y, v in post.items()}
        self.ok = lambda t, m: self.G[t["g"][m]] != SECTOR and not t["ira"]

    # ---- the cross-section of one month: leave-own-group-out category means ----
    def loo(self, prod, m, val):
        """{(cat, g): (weighted mean of val over the OTHER groups' tracks of the category, total weight)} at month m, weights = opening assets"""
        S = defaultdict(lambda: [0.0, 0.0])
        G = defaultdict(lambda: [0.0, 0.0])
        for t in self.tr.values():
            if t["prod"] != prod or m not in t["g"] or not self.ok(t, m):
                continue
            w = t["prev"].get(m)
            v = val(t, m)
            if not w or w <= 0 or v is None:
                continue
            S[t["cat"]][0] += w * v
            S[t["cat"]][1] += w
            G[(t["cat"], t["g"][m])][0] += w * v
            G[(t["cat"], t["g"][m])][1] += w
        out = {}
        for (c, g), (sv, sw) in G.items():
            tv, tw = S[c]
            if tw - sw > 0:
                out[(c, g)] = ((tv - sv) / (tw - sw), tw - sw)
        return out


def cumret(t, m, n):
    """compounded return of the n months to m, %, when every one is published"""
    x, p = 1.0, m
    for _ in range(n):
        y = t["y"].get(p)
        if y is None:
            return None
        x *= 1 + y / 100
        p = madd(p, -1)
    return (x - 1) * 100


# ------------------------------------------------------------------------------------------------------------------------------ estimation
def rows_of(P, prod, fee_kind="charged", lo=FROM, hi=TO):
    """the regression rows of one product: dict(track, cat, g, m, y, x[lags], rel12, rel36, no36, lnA, w)"""
    feeof = (lambda t, m: t["charged"].get(m // 100)) if fee_kind == "charged" else (lambda t, m: t["post"].get(m // 100, (None,))[0])
    months = [m for m in P.months if madd(lo, -(LAGS + 1)) <= m <= hi]
    rel = {}
    for m in months:
        rel[m] = {"fee": P.loo(prod, m, feeof), "r12": P.loo(prod, m, lambda t, mm: cumret(t, mm, 12)), "r36": P.loo(prod, m, lambda t, mm: cumret(t, mm, 36))}
    out = []
    for t in P.tr.values():
        if t["prod"] != prod:
            continue
        for m in sorted(t["tr"]):
            if not (lo <= m <= hi) or m not in t["g"] or not P.ok(t, m):
                continue
            A = t["prev"].get(m)
            if not A or A < MIN_A or abs(t["tr"][m]) > TRIM * A:
                continue
            xs = []
            for k in range(LAGS + 1):
                mk = madd(m, -k)
                f = feeof(t, mk) if mk in t["g"] else None
                L = rel.get(mk, {}).get("fee", {}).get((t["cat"], t["g"].get(mk)))
                if f is None or L is None:
                    break
                xs.append((f - L[0]) * 100)
            if len(xs) < LAGS + 1:
                continue
            m1 = madd(m, -1)
            o12 = cumret(t, m1, 12)
            L12 = rel.get(m1, {}).get("r12", {}).get((t["cat"], t["g"].get(m1)))
            if o12 is None or L12 is None:
                continue
            o36 = cumret(t, m1, 36)
            L36 = rel.get(m1, {}).get("r36", {}).get((t["cat"], t["g"].get(m1)))
            has36 = o36 is not None and L36 is not None
            out.append({"k": (t["ds"], t["id"]), "cat": t["cat"], "g": t["g"][m], "m": m, "y": t["tr"][m] / A * 100, "x": xs,
                        "rel12": o12 - L12[0], "rel36": (o36 - L36[0]) if has36 else 0.0, "no36": 0.0 if has36 else 1.0, "lnA": math.log(A), "w": A,
                        "tr": t["tr"][m], "A": A, "prod": prod})
    return out


def design(R):
    return [x["x"] + [x["rel12"], x["rel36"], x["no36"], x["lnA"]] for x in R]


def summarise(f):
    a = [1.0 if i <= LAGS else 0.0 for i in range(len(f["b"]))]
    B, se = lincom(f, a)
    return {"B": r(B, 6), "se": r(se, 6), "t": r(B / se if se else 0.0, 2), "n": f["n"], "clusters": f["clusters"], "r2": r(f["r2"], 4),
            "coef": [{"x": nm, "b": r(b, 6), "se": r(s, 6), "t": r(tt, 2)} for nm, b, s, tt in zip(f["names"], f["b"], f["se"], f["t"])]}


def spec_main(R, extra_fe=False):
    y = [x["y"] for x in R]
    fes = [[x["k"] for x in R], [(x["prod"], x["cat"], x["m"]) for x in R]]
    if extra_fe:
        fes.append([(x["g"], x["m"]) for x in R])
    return summarise(fit(y, design(R), [x["w"] for x in R], fes, [x["k"] for x in R], NAMES))


def spec_fd(R):
    """first differences: the change of the flow rate on the change of the relative fee (lags 0-6) and of the controls"""
    by = {(x["k"], x["m"]): x for x in R}
    D = []
    for x in R:
        p = by.get((x["k"], madd(x["m"], -1)))
        if not p:
            continue
        D.append({"k": x["k"], "cat": x["cat"], "m": x["m"], "prod": x["prod"], "y": x["y"] - p["y"],
                  "X": [a - b for a, b in zip(design([x])[0], design([p])[0])], "w": x["w"]})
    keep = [i for i in range(len(NAMES)) if any(d["X"][i] for d in D)]   # the no36 switch rarely flips: dropped when constant
    f = fit([d["y"] for d in D], [[d["X"][i] for i in keep] for d in D], [d["w"] for d in D], [[(d["prod"], d["cat"], d["m"]) for d in D]],
            [d["k"] for d in D], [NAMES[i] for i in keep])
    return summarise(f)


def quality(main, rob):
    t, B = main["t"], main["B"]
    if B is None or B >= 0 or t > -1:
        return "none", "האות חלש או בסימן הפוך: לא משמש לסימולציה"
    agree = all(x["B"] is not None and x["B"] < 0 for x in rob.values())
    if t <= -3 and agree:
        return "high", "t ≤ −3 והסימן זהה בכל בדיקות החוסן"
    if t <= -2:
        return "medium", "t ≤ −2" + ("" if agree else "; בדיקת חוסן אחת לפחות בסימן הפוך")
    return "low", "−2 < t ≤ −1: כיוון בלבד" + ("" if agree else "; בדיקת חוסן אחת לפחות בסימן הפוך")


def ramp(main):
    """the cumulative share of B reached by month k after a change: from the lag coefficients when each is well determined and the profile
    is monotone; otherwise a straight six-month ramp (an assumption, labelled)"""
    b = [c["b"] for c in main["coef"][:LAGS + 1]]
    tt = [c["t"] for c in main["coef"][:LAGS + 1]]
    B = main["B"]
    if B and B < 0:
        cum, s = [], 0.0
        for x in b:
            s += x
            cum.append(s / B)
        if all(t_ <= -1 for t_ in tt if t_ is not None) and all(0 <= c <= 1.0001 for c in cum) and all(cum[i] <= cum[i + 1] + 1e-9 for i in range(LAGS)):
            return {"how": "lags", "c": [r(c, 4) for c in cum]}
    return {"how": "assumed", "c": [r((k + 1) / (LAGS + 1), 4) for k in range(LAGS + 1)]}


def fee_events(P, prod):
    """declared fee changes in the sample: track-years whose charged fee moved, by size (tracks of NIS 100m and more)"""
    n1 = n5 = 0
    cuts = rises = 0
    for t in P.tr.values():
        if t["prod"] != prod or t["ira"]:
            continue
        for y in range(FROM // 100, TO // 100 + 1):
            a, b = t["charged"].get(y - 1), t["charged"].get(y)
            m = y * 100 + 1
            if a is None or b is None or (t["prev"].get(m) or 0) < MIN_A or m not in t["g"] or not P.ok(t, m):
                continue
            d = round((b - a) * 100, 1)
            if abs(d) >= 1:
                n1 += 1
                cuts += d < 0
                rises += d > 0
            if abs(d) >= 5:
                n5 += 1
    return {"ge1": n1, "ge5": n5, "cuts": cuts, "rises": rises}


def fee_timing(P):
    """the test behind the re-timing: YoY change of the posted fee (asset-weighted, group x gemel family, January) against the change of the
    fee yield the group reports (lens.json fy_reg, year mean) in the same year and in the previous year"""
    lens = load("lens.json")
    fy = defaultdict(list)
    for x in lens["rows"]:
        if x["s"] == "gem" and x["q"].startswith("Q") and x.get("fy_reg"):
            fy[(x["g"], int(x["q"][3:]))].append(x["fy_reg"])
    fy = {k: sum(v) / len(v) for k, v in fy.items() if len(v) == 4 or k[1] == P.asof // 100}
    post = defaultdict(lambda: [0.0, 0.0])
    for t in P.tr.values():
        if t["prod"] not in ("gemel", "hisht"):
            continue
        for y, (v, m) in t["post"].items():
            a = t["a"].get(m)
            if a and m in t["g"]:
                post[(t["g"][m], y)][0] += a * v
                post[(t["g"][m], y)][1] += a
    post = {k: v[0] / v[1] for k, v in post.items() if v[1] > 0}

    def corr(lag):
        xs, ys = [], []
        for (g, y), v in post.items():
            if (g, y - 1) in post and (g, y - lag) in fy and (g, y - lag - 1) in fy:
                xs.append(v - post[(g, y - 1)])
                ys.append(fy[(g, y - lag)] - fy[(g, y - lag - 1)])
        n = len(xs)
        if n < 5:
            return None, n
        mx, my = sum(xs) / n, sum(ys) / n
        sxy = sum((a - mx) * (b - my) for a, b in zip(xs, ys))
        sxx = sum((a - mx) ** 2 for a in xs)
        syy = sum((b - my) ** 2 for b in ys)
        return round(sxy / math.sqrt(sxx * syy), 3), n
    c0, n0 = corr(0)
    c1, n1 = corr(1)
    jan = tot = 0
    for t in P.tr.values():
        prev = None
        for m in sorted(t["fee"]):
            v = t["fee"][m]
            if prev is not None and m >= FROM and abs(v - prev) >= 0.005:
                tot += 1
                jan += m % 100 == 1
            prev = v
    return {"corr_same": c0, "n_same": n0, "corr_prior": c1, "n_prior": n1, "changes": tot, "january": jan,
            "rule": "fee_charged(Y) = AVG_ANNUAL_MANAGEMENT_FEE posted in January of Y+1"}


# ------------------------------------------------------------------------------------------------------------------------------ provenance
def ds_leaf(P, prod, lo, hi, what):
    pr = PRODS[prod]
    names = ", ".join(x["name"] for x in P.res.get(pr["ds"], []))
    return {"k": "report", "title": f"{DS_HE[pr['ds']]}: {what}, מסלולי {pr['he']}", "value": f"{mlabel(lo)}–{mlabel(hi)}", "unit": "חודשים",
            "url": pr["url"], "pg": None, "doc": DS_HE[pr["ds"]], "period": f"{mlabel(lo)}–{mlabel(hi)}", "srcType": "רשות שוק ההון · data.gov.il",
            "note": f"INTERNAL_TRANSFERS, TOTAL_ASSETS, AVG_ANNUAL_MANAGEMENT_FEE, MONTHLY_YIELD לפי מסלול וחודש (web/public/data/prov/reg); {names}"}


def fund_leaf(P, t, m, col, value, unit):
    return {"k": "fund", "title": f"{t['name']} · {mlabel(m)}", "value": value, "unit": unit, "ds": t["ds"], "id": t["id"], "period": m, "col": col}


def est_prov(P, prod, s, q, why, ev, tracks):
    pr = PRODS[prod]
    lags = " · ".join(f"b{c['x'][-1]} {c['b']:+.4f} (t {c['t']:.1f})" for c in s["coef"][:LAGS + 1])
    return {"k": "calc", "title": f"גמישות הניוד לדמי ניהול יחסיים · {pr['he']}", "value": f"{s['B']:+.4f}", "unit": "% מהנכסים בחודש לכל 1 נ״ב", "est": True,
            "formula": ("WLS חודשי על לוח מסלולים: ניוד נטו ÷ נכסי פתיחה × 100 = אפקט מסלול + אפקט קטגוריה×חודש + Σ b_k × דמי ניהול יחסיים (נ״ב, "
                        "פיגורים 0–6) + תשואה יחסית 12 ו-36 חודשים + ln נכסים. B = Σ b_k. שגיאות מקובצות לפי מסלול. דמי הניהול: ממוצע שנתי, מוזז שנה "
                        "(הערך שמתפרסם בינואר מתאר את השנה הקודמת)"),
            "inputs": [{"label": "ניוד, נכסים, דמי ניהול ותשואה לפי מסלול וחודש", "v": f"{s['n']:,} מסלול-חודשים", "p": ds_leaf(P, prod, madd(FROM, -36), TO, "ניוד, נכסים, דמי ניהול ותשואה")},
                       {"label": "מסלולים (אשכולות)", "v": f"{s['clusters']}"},
                       {"label": "B = Σ b_k", "v": f"{s['B']:+.4f} (se {s['se']:.4f}, t {s['t']:.2f})"},
                       {"label": "פיגורים", "v": lags},
                       {"label": "R² בתוך", "v": f"{s['r2']:.3f}"},
                       {"label": "שינויי דמי ניהול בחלון (≥1 נ״ב / ≥5 נ״ב)", "v": f"{ev['ge1']} / {ev['ge5']} ({ev['cuts']} הורדות, {ev['rises']} העלאות)"},
                       {"label": f"איכות: {q}", "v": why}],
            "note": f"מסלולי {pr['he']}, {mlabel(FROM)}–{mlabel(TO)}; {tracks} מסלולים. לא נכללו: קרנות ענפיות, מסלולים בניהול אישי, חודשים מתחת ל-100 מיליון ש״ח ומעבר של 20% מהנכסים בחודש"}


# ------------------------------------------------------------------------------------------------------------------------------ build
def estimate(P):
    prods, pooled_rows = {}, []
    for prod, pr in PRODS.items():
        R = rows_of(P, prod)
        pooled_rows += R
        main = spec_main(R)
        rob = {"mgr": spec_main(R, extra_fe=True), "fd": spec_fd(R)}
        Rp = rows_of(P, prod, "posted", FROM, P.asof)
        rob["posted"] = spec_main(Rp)
        q, why = quality(main, rob)
        ev = fee_events(P, prod)
        tracks = len({x["k"] for x in R})
        ms = sorted({x["m"] for x in R})
        rp = ramp(main)
        peak = max(range(LAGS + 1), key=lambda k: -main["coef"][k]["b"]) if main["B"] and main["B"] < 0 else None
        half = next((k for k, c in enumerate(rp["c"]) if c >= 0.5), None) if rp["how"] == "lags" else None
        prods[prod] = {"he": pr["he"], "a1": pr["a1"], "fam": pr["fam"], "ds": pr["ds"], "main": main, "rob": rob, "quality": q, "why": why,
                       "per_bp_year": r(-main["B"] * 12, 4), "ramp": rp, "peak_lag": peak, "half_lag": half, "events": ev, "tracks": tracks,
                       "window": f"{mlabel(ms[0])}–{mlabel(ms[-1])}", "flow_share": r(sum(x["tr"] for x in R if x["tr"] > 0) / max(1e-9, sum(x["A"] for x in R)) * 100, 4),
                       "prov": est_prov(P, prod, main, q, why, ev, tracks)}
    pooled = spec_main(pooled_rows)
    pq, pwhy = quality(pooled, {})
    return prods, {"main": pooled, "quality": pq, "why": pwhy, "per_bp_year": r(-pooled["B"] * 12, 4)}


def board(P):
    asof = P.asof
    y = asof // 100
    q_end = (asof // 100) * 100 + ((asof % 100 - 1) // 3) * 3   # last full quarter's end month
    if asof % 100 in (3, 6, 9, 12):
        q_end = asof
    q_months = [madd(q_end, -2), madd(q_end, -1), q_end]
    l12 = [madd(asof, -k) for k in range(11, -1, -1)]
    out = {}
    for prod, pr in PRODS.items():
        cats = defaultdict(lambda: defaultdict(list))
        for t in P.tr.values():
            if t["prod"] != prod or asof not in t["g"] or not P.ok(t, asof) or (t["a"].get(asof) or 0) <= 0:
                continue
            cats[t["cat"]][t["g"][asof]].append(t)
        clist = []
        for cat, by in cats.items():
            tot = sum(t["a"][asof] for ts in by.values() for t in ts)
            if len(by) < 2 or tot < 1000:
                continue
            mgrs = []
            for g, ts in sorted(by.items(), key=lambda kv: -sum(t["a"][asof] for t in kv[1])):
                ts = sorted(ts, key=lambda t: -t["a"][asof])
                A = sum(t["a"][asof] for t in ts)
                fw = [(t["a"][asof], t["post"].get(y, (None,))[0]) for t in ts]
                fa = sum(a for a, f in fw if f is not None)
                fee = sum(a * f for a, f in fw if f is not None) / fa if fa else None
                trq = sum(t["tr"].get(m, 0.0) for t in ts for m in q_months)
                tr12 = sum(t["tr"].get(m, 0.0) for t in ts for m in l12)
                mgrs.append({"g": g, "c": P.co.get(P.G[g]), "he": P.G[g], "A": r(A, 1), "fee": r(fee, 4), "trq": r(trq, 1), "tr12": r(tr12, 1),
                             "tracks": [[t["ds"], t["id"], t["name"], r(t["a"][asof], 1), r(t["post"].get(y, (None,))[0], 2),
                                         [r(t["tr"].get(m, 0.0), 1) for m in q_months], r(sum(t["tr"].get(m, 0.0) for m in l12), 1)] for t in ts]})
            # revealed substitution: monthly net transfers of every manager in the category (closed tracks included), 01/20 to asof
            series = defaultdict(lambda: defaultdict(float))
            for t in P.tr.values():
                if t["prod"] != prod or t["cat"] != cat or t["ira"]:
                    continue
                for m, v in t["tr"].items():
                    if FROM <= m <= asof and m in t["g"] and P.G[t["g"][m]] != SECTOR:
                        series[t["g"][m]][m] += v
            months = [m for m in P.months if FROM <= m <= asof]
            gs = [x["g"] for x in mgrs]
            div = {}
            for mv in gs:
                xs = [series[mv].get(m, 0.0) for m in months]
                raw = {}
                for j in gs:
                    if j == mv:
                        continue
                    o = ols1([series[j].get(m, 0.0) for m in months], xs)
                    if o:
                        raw[j] = {"b": r(o[1], 4), "t": r(o[1] / o[2], 2) if o[2] and o[2] == o[2] else None}
                cover = sum(max(0.0, -v["b"]) for v in raw.values())
                share = {x["g"]: x["A"] for x in mgrs if x["g"] != mv}
                st = sum(share.values())
                use = cover >= MIN_COVER and len(months) >= MIN_DIV_N
                if use:
                    w = {j: max(0.0, -raw[j]["b"]) / cover for j in raw}
                else:
                    w = {j: a / st for j, a in share.items()}
                w = {str(j): r(v, 4) for j, v in w.items()}
                div[str(mv)] = {"how": "revealed" if use else "share", "cover": r(cover, 3), "n": len(months), "w": w,
                                "raw": {str(j): v for j, v in raw.items()}}
            clist.append({"cat": cat, "A": r(tot, 1), "mgrs": mgrs, "div": div})
        clist.sort(key=lambda c: -c["A"])
        out[prod] = {"he": pr["he"], "a1": pr["a1"], "ds": pr["ds"], "cats": clist}
    return out, q_months, l12


def context(P):
    """net transfers per group x segment, the last reported quarter and the one before (lens.json), for the context line"""
    lens = load("lens.json")
    rows = [x for x in lens["rows"] if x["q"].startswith("Q") and x["s"] in ("pen", "gem")]
    qs = sorted({x["q"] for x in rows}, key=lambda q: (int(q[3:]), int(q[1])))
    last = qs[-4:]
    ctx = defaultdict(dict)
    for x in rows:
        tr = (x.get("reg") or {}).get("tr")
        if x["q"] in last and tr is not None:
            ctx[str(x["g"])].setdefault(x["s"], {})[x["q"]] = r(tr, 1)
    pi = {q: P.periods.index(int(q[3:]) * 100 + int(q[1]) * 3) for q in last if int(q[3:]) * 100 + int(q[1]) * 3 in P.periods}
    return {"q": last, "pi": pi, "tr": ctx}


def build():
    P = Panel()
    prods, pooled = estimate(P)
    bd, q_months, l12 = board(P)
    fl = load("flow_npv.json")
    meta = {"built": dt.date.today().isoformat(), "asof": P.asof, "window": f"{mlabel(FROM)}–{mlabel(TO)}", "lags": LAGS,
            "source": "הרשות לשוק ההון: גמל-נט, פנסיה-נט (data.gov.il), לפי מסלול וחודש",
            "fee_timing": fee_timing(P), "unit": {"B": "% of opening assets a month per 1bp of relative fee", "per_bp_year": "% of assets a year per 1bp of fee advantage"},
            "excl": {"min_assets": MIN_A, "trim": TRIM, "sector": SECTOR, "ira": "בניהול אישי"}}
    el = {"meta": meta, "products": prods, "pooled": pooled}
    bm = {"meta": {"built": meta["built"], "asof": P.asof, "fee_year": P.asof // 100, "q_months": q_months, "l12": [l12[0], l12[-1]],
                   "div": {"min_n": MIN_DIV_N, "min_cover": MIN_COVER}, "ke": fl["meta"]["ke"], "dur": {k: v["v"] for k, v in fl["dur"].items()},
                   "resources": {k: [x["name"] for x in v] for k, v in P.res.items() if k in ("gemel", "pensia")}},
          "groups": P.G, "co": {str(i): P.co.get(g) for i, g in enumerate(P.G)}, "products": bd, "ctx": context(P)}
    return {"elasticity.json": el, "board.json": bm}


# ------------------------------------------------------------------------------------------------------------------------------ verify
def verify(files):
    bad = []

    def finite(v, path):
        if isinstance(v, float) and (v != v or v in (float("inf"), float("-inf"))):
            bad.append(f"NaN/inf at {path}")
        elif isinstance(v, dict):
            for k, x in v.items():
                finite(x, f"{path}.{k}")
        elif isinstance(v, list):
            for i, x in enumerate(v):
                finite(x, f"{path}[{i}]")
    for k, d in files.items():
        finite(d, k)
    el = files["elasticity.json"]
    for prod, p in el["products"].items():
        m = p["main"]
        for key in ("B", "se", "t", "n", "r2"):
            if m.get(key) is None:
                bad.append(f"{prod}: main.{key} missing")
        if not m.get("n") or m["n"] < 100:
            bad.append(f"{prod}: n = {m.get('n')} (under 100)")
        if p["quality"] not in ("high", "medium", "low", "none"):
            bad.append(f"{prod}: quality {p['quality']}")
        if p["prov"].get("k") != "calc" or not any((x.get("p") or {}).get("k") == "report" and (x["p"].get("url") or "").startswith("https://data.gov.il") for x in p["prov"]["inputs"]):
            bad.append(f"{prod}: provenance does not reach a regulator dataset")
        for nm, s in p["rob"].items():
            if s.get("n") is None or s.get("t") is None:
                bad.append(f"{prod}: robustness {nm} without n or t")
        exp, _ = quality(m, p["rob"])
        if exp != p["quality"]:
            bad.append(f"{prod}: quality {p['quality']} != rule {exp}")
        if abs(sum(c["b"] for c in m["coef"][:LAGS + 1]) - m["B"]) > 1e-4:
            bad.append(f"{prod}: B != sum of the lag coefficients")
    bd = files["board.json"]
    for prod, p in bd["products"].items():
        for c in p["cats"]:
            if abs(sum(x["A"] for x in c["mgrs"]) - c["A"]) > 0.5:
                bad.append(f"{prod}/{c['cat']}: managers do not add to the category")
            for x in c["mgrs"]:
                if abs(sum(sum(t[5]) for t in x["tracks"]) - x["trq"]) > 0.5:
                    bad.append(f"{prod}/{c['cat']}/{x['he']}: track transfers do not add to the manager's quarter")
                if abs(sum(t[3] for t in x["tracks"]) - x["A"]) > 0.5:
                    bad.append(f"{prod}/{c['cat']}/{x['he']}: tracks do not add to the manager")
            for mv, dv in c["div"].items():
                s = sum(dv["w"].values())
                if dv["w"] and abs(s - 1) > 2e-3:
                    bad.append(f"{prod}/{c['cat']}/{mv}: allocation weights sum to {s}")
    return bad


def dumps(d):
    return json.dumps(d, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    files = build()
    bad = verify(files)
    el = files["elasticity.json"]
    line = "; ".join(f"{k} B {p['main']['B']:+.4f} t {p['main']['t']:.2f} n {p['main']['n']} {p['quality']}" for k, p in el["products"].items())
    if "--check" in sys.argv:
        diff = []
        for k, d in files.items():
            f = OUT / k
            if not f.exists():
                diff.append(k)
                continue
            disk = json.loads(f.read_text(encoding="utf8"))
            disk["meta"]["built"] = d["meta"]["built"]
            if disk != json.loads(dumps(d)):
                diff.append(k)
        print(f"warroom: {line}; {'rebuild matches' if not diff else 'DIFFERS: ' + ', '.join(diff)}; {len(bad)} misses")
        for b in bad[:20]:
            print("  ", b)
        sys.exit(0 if not bad and not diff else 1)
    if bad:
        print("misses:")
        for b in bad[:40]:
            print("  ", b)
        sys.exit(1)
    OUT.mkdir(parents=True, exist_ok=True)
    for k, d in files.items():
        (OUT / k).write_text(dumps(d), encoding="utf8")
    print(f"wrote {OUT.relative_to(ROOT)}/: {', '.join(f'{k} {(OUT / k).stat().st_size:,} bytes' for k in files)}; {line}")
