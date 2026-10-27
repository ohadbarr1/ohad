"""The Fragility Monitor (module A10): per manager, seven early-warning signals, each with its value, trend, peer percentile, a stated
threshold rule and a state (ok / watch / alert / no data). There is NO composite: a manager's status is the list of its signals in watch
or alert, each with the figures that put it there. Standard library only; reads published files only.

python3 pipeline/build_fragility.py            write web/public/data/fragility.json
python3 pipeline/build_fragility.py --check    rebuild in memory and compare with the file on disk; every signal in a data state carries
                                               provenance and an as-of date; no composite field (score, rating, index, total ...) exists
                                               anywhere in the file; every feed event figure equals the history it cites (gate `fragility`)

Signals (`sig`), each per segment where the business has segments (pension, provident), the manager's state = its worst segment:
  flow   net transfers (regulator, monthly), rolling 3 months ending at the regulator's last month
         watch: 3M net transfers < 0 and below the previous 3M window
         alert: 3M net transfers < 0 in each of the last `flow_run` non-overlapping 3M windows and their size >= `flow_pct`% of assets at
                the window's start
  fee    realised fee yield = reported fee income x 4 / regulator average assets (lens.json fy_reg), YoY change in basis points
         watch: YoY <= -`fee_watch` bp       alert: YoY <= -`fee_alert` bp
  perf   36-month Sharpe of every open track (monthly returns, gemel-net / pensia-net / bituach-net) minus the median of the other managers'
         tracks in the same product x track category (categories with >= 4 managers), asset-weighted over the manager's tracks.
         Risk-free = BoI nominal 1Y zero yield (monthly mean) / 12. Sharpe = mean(r - rf) x 12 / (stdev(r) x sqrt 12)
         watch: gap <= -`perf_watch` or the gap fell >= `perf_decay` in 12 months       alert: gap <= -`perf_alert`
  cost   cost / income LTM = sum(S&M + G&A) / sum(fees) x 100 over four quarters (lens.json)
         watch: LTM up >= `cost_watch` pp YoY      alert: LTM >= `cost_alert`%
  solv   solvency ratio on the basis of the board target A2 measures headroom against (scenarios.ts targetOf), trend = change over ~1 year
         watch: headroom < `solv_watch` pp or the ratio fell >= `solv_drop` pp in a year       alert: below the target
  csm    CSM runway = closing gross CSM (life + health) / the year's gross CSM release (FY, the LTM of Q4), csm/facts
         watch: runway < `csm_watch` years or shortened >= `csm_drop` years YoY       alert: runway < `csm_alert` years
  scen   A2's worst case: the lowest headroom over the board target across the Scenario Studio presets (the solvency channel of
         scenarios.ts runOne, ported here; web/tests/fragility.unit.ts checks the two agree)
         watch: worst-case headroom < `scen_watch` pp       alert: a preset breaches the target (or the base is already below it)
Data quality: a stale or missing input is "nodata" with its reason (never ok); "na" = the signal does not apply (a fund house's solvency).
Thresholds are assumptions (labelled, in `params`), overridable on /fragility through the URL; the page re-runs the same rules.
Feed (module M2): a manager crossing into watch / alert on a signal (from the state of the period before) is an event of type
`fragility`, dated by the data's own date; build_positions.py marks the positions that reference the company for review.
"""
import argparse
import datetime as dt
import json
import math
import re
import statistics
import sys
from math import fsum
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import csm_resolve  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"
OUT = DATA / "fragility.json"
FILES = "https://mayafiles.tase.co.il/"
FROM = "2025-01-01"   # feed events from the IFRS 17 era (the feed's own start)
MM = 'מיליוני ש"ח'
MINUS = "−"
EQ_CAT = "גמל | מניות"
SKIP = {"more_gemel": "אותה חברה מנהלת כמו מור, קבוצת שוק אחת"}

# ------------------------------------------------------------------------------------------------ the rules (labelled assumptions)
PARAMS = {
    "flow_pct": {"v": 1.0, "he": "העברות נטו 3M, שיעור מהנכסים להתראה", "u": "%", "sig": "flow"},
    "flow_run": {"v": 3, "he": "חלונות 3M רצופים שליליים להתראה", "u": "חלונות", "sig": "flow"},
    "fee_watch": {"v": 2.0, "he": "שחיקת תשואת דמי ניהול YoY למעקב", "u": "נ״ב", "sig": "fee"},
    "fee_alert": {"v": 5.0, "he": "שחיקת תשואת דמי ניהול YoY להתראה", "u": "נ״ב", "sig": "fee"},
    "fee_rel": {"v": 1.0, "he": "שחיקה מעבר לחציון העמיתים באותו מוצר", "u": "נ״ב", "sig": "fee"},
    "perf_watch": {"v": 0.15, "he": "פער שארפ 3Y מול חציון העמיתים למעקב", "u": "שארפ", "sig": "perf"},
    "perf_alert": {"v": 0.30, "he": "פער שארפ 3Y מול חציון העמיתים להתראה", "u": "שארפ", "sig": "perf"},
    "perf_decay": {"v": 0.15, "he": "ירידת הפער ב-12 חודשים למעקב", "u": "שארפ", "sig": "perf"},
    "cost_watch": {"v": 3.0, "he": "עליית יחס הוצאות להכנסות LTM, YoY, למעקב", "u": "נ״א", "sig": "cost"},
    "cost_alert": {"v": 100.0, "he": "יחס הוצאות להכנסות LTM להתראה", "u": "%", "sig": "cost"},
    "solv_watch": {"v": 20.0, "he": "מרווח מעל יעד הדירקטוריון למעקב", "u": "נ״א", "sig": "solv"},
    "solv_drop": {"v": 10.0, "he": "ירידת היחס בשנה למעקב", "u": "נ״א", "sig": "solv"},
    "csm_watch": {"v": 8.0, "he": "אורך חיי CSM למעקב", "u": "שנים", "sig": "csm"},
    "csm_alert": {"v": 5.0, "he": "אורך חיי CSM להתראה", "u": "שנים", "sig": "csm"},
    "csm_drop": {"v": 1.0, "he": "קיצור אורך החיים YoY למעקב", "u": "שנים", "sig": "csm"},
    "scen_watch": {"v": 10.0, "he": "מרווח ליעד בתרחיש הגרוע למעקב", "u": "נ״א", "sig": "scen"},
}
SIGS = [
    {"id": "flow", "he": "ניוד נטו", "short": "ניוד", "metric": "העברות נטו, 3 חודשים", "u": "dm", "better": "hi", "pctl": "העברות נטו 3M ÷ נכסים",
     "rule": {"watch": "העברות נטו 3M שליליות ונמוכות מחלון ה-3M הקודם", "alert": "העברות נטו 3M שליליות ב-{flow_run} חלונות 3M רצופים, בהיקף של {flow_pct}% מהנכסים בתחילת החלון לפחות"},
     "src": "רשות שוק ההון: פנסיה-נט, גמל-נט (INTERNAL_TRANSFERS, TOTAL_ASSETS)", "segs": ["pen", "gem"]},
    {"id": "fee", "he": "שחיקת דמי ניהול", "short": "דמי ניהול", "metric": "תשואת דמי ניהול ממומשת, שנתי", "u": "pct", "better": "hi", "pctl": "שינוי YoY בנ״ב",
     "rule": {"watch": "תשואת דמי הניהול ירדה ב-{fee_watch} נ״ב לפחות YoY, וב-{fee_rel} נ״ב לפחות יותר מחציון העמיתים", "alert": "ירידה של {fee_alert} נ״ב לפחות YoY, וב-{fee_rel} נ״ב לפחות יותר מחציון העמיתים"},
     "src": "הכנסות מדמי ניהול: דוחות החברות המנהלות; נכסים ממוצעים: רשות שוק ההון (lens.json fy_reg)", "segs": ["pen", "gem"]},
    {"id": "perf", "he": "שחיקת ביצועים", "short": "ביצועים", "metric": "פער שארפ 3Y מול חציון העמיתים", "u": "r", "better": "hi", "pctl": "פער שארפ",
     "rule": {"watch": "פער של −{perf_watch} או פחות, או פער שלילי שירד ב-{perf_decay} לפחות ב-12 חודשים", "alert": "פער של −{perf_alert} או פחות"},
     "src": "תשואות חודשיות של המסלולים (גמל-נט, פנסיה-נט, ביטוח-נט); ריבית חסרת סיכון: עקום האפס של בנק ישראל, שנה", "segs": ["pen", "gem", "ins"]},
    {"id": "cost", "he": "זחילת עלויות", "short": "עלויות", "metric": "יחס הוצאות להכנסות, LTM", "u": "pct", "better": "lo", "pctl": "יחס LTM",
     "rule": {"watch": "יחס LTM עלה ב-{cost_watch} נ״א לפחות YoY", "alert": "יחס LTM של {cost_alert}% ומעלה"},
     "src": "דוחות החברות המנהלות: ביאור מגזרי פעילות (lens.json)", "segs": ["pen", "gem"]},
    {"id": "solv", "he": "מסלול כושר הפירעון", "short": "כושר פירעון", "metric": "יחס כושר פירעון מול יעד הדירקטוריון", "u": "pct", "better": "hi", "pctl": "מרווח מעל היעד",
     "rule": {"watch": "מרווח של פחות מ-{solv_watch} נ״א מעל היעד, או ירידה של {solv_drop} נ״א לפחות בשנה", "alert": "היחס מתחת ליעד"},
     "src": "דוחות כספיים ודוחות כושר פירעון (כרטיסי הדוח, csm/solvency.json); היעד: כפי שחדר התרחישים מודד (A2)", "segs": ["all"]},
    {"id": "csm", "he": "אורך חיי CSM", "short": "CSM", "metric": "CSM ברוטו ÷ שחרור שנתי", "u": "r", "better": "hi", "pctl": "שנים",
     "rule": {"watch": "פחות מ-{csm_watch} שנים, או התקצרות של {csm_drop} שנים לפחות YoY", "alert": "פחות מ-{csm_alert} שנים"},
     "src": "דוח שנתי: תנועה ב-CSM, חיים ובריאות, ברוטו (csm/facts)", "segs": ["all"]},
    {"id": "scen", "he": "מרווח בתרחיש", "short": "תרחיש", "metric": "מרווח ליעד בתרחיש הגרוע (A2)", "u": "pp", "better": "hi", "pctl": "מרווח בתרחיש הגרוע",
     "rule": {"watch": "מרווח של פחות מ-{scen_watch} נ״א בתרחיש הגרוע", "alert": "תרחיש חוצה את היעד, או מתחת ליעד כבר בבסיס"},
     "src": "חדר התרחישים (A2): רגישויות יחס כושר הפירעון שגולו, יעד הדירקטוריון, שבעת התרחישים המוגדרים", "segs": ["all"]},
]
SIG_IDS = [s["id"] for s in SIGS]
RANK = {"ok": 0, "watch": 1, "alert": 2}
SEG_HE = {"pen": "פנסיה", "gem": "גמל והשתלמות", "ins": "ביטוחי מנהלים ופוליסות חיסכון", "all": ""}
SEG_SET = {"pen": "fam:pension", "gem": "fam:gemel"}
FAM_SEG = {"pensia": "pen", "gemel": "gem", "insurance": "ins"}
STALE_RATIO_M = 15    # months before the last reported quarter's end: an older solvency ratio is stale


def P(k):
    return PARAMS[k]["v"]


def state(sig, x, prm=None):
    """the threshold rule of one signal on its inputs (web/src/lib/fragility.ts stateOf is the same function)"""
    p = {k: v["v"] for k, v in PARAMS.items()}
    p.update(prm or {})
    if sig == "flow":
        if x["v3"] >= 0:
            return "ok"
        if x["run"] >= p["flow_run"] and x["a0"] and -x["v3"] / x["a0"] * 100 >= p["flow_pct"]:
            return "alert"
        return "watch" if x["p3"] is not None and x["v3"] < x["p3"] else "ok"
    if sig == "fee":
        rel = x.get("rel") is None or x["rel"] <= -p["fee_rel"]
        return "alert" if x["d"] <= -p["fee_alert"] and rel else "watch" if x["d"] <= -p["fee_watch"] and rel else "ok"
    if sig == "perf":
        if x["g"] <= -p["perf_alert"]:
            return "alert"
        return "watch" if x["g"] <= -p["perf_watch"] or (x["g"] < 0 and x["d"] is not None and x["d"] <= -p["perf_decay"]) else "ok"
    if sig == "cost":
        if x["l"] >= p["cost_alert"]:
            return "alert"
        return "watch" if x["d"] is not None and x["d"] >= p["cost_watch"] else "ok"
    if sig == "solv":
        if x["h"] < 0:
            return "alert"
        return "watch" if x["h"] < p["solv_watch"] or (x["d"] is not None and x["d"] <= -p["solv_drop"]) else "ok"
    if sig == "csm":
        if x["y"] < p["csm_alert"]:
            return "alert"
        return "watch" if x["y"] < p["csm_watch"] or (x["d"] is not None and x["d"] <= -p["csm_drop"]) else "ok"
    if sig == "scen":
        if x["hw"] < 0 or x["h0"] < 0:
            return "alert"
        return "watch" if x["hw"] < p["scen_watch"] else "ok"
    raise KeyError(sig)


# ------------------------------------------------------------------------------------------------ helpers
def load(p):
    return json.loads((DATA / p).read_text(encoding="utf-8"))


def r6(x):
    return None if x is None else round(x, 6)


def nf(v, d=1):
    if v is None:
        return "–"
    t = f"{v:,.{d}f}"
    if re.fullmatch(r"-[0.,]+", t):
        return t[1:]
    return t.replace("-", MINUS)


def sn(v, d=1):
    return ("+" if v is not None and round(v, d) > 0 else "") + nf(v, d)


def jround(x):
    """Math.round of JavaScript (half up), for the presets ported from scenarios.ts"""
    return math.floor(x + 0.5)


def madd(p, k):
    t = (p // 100) * 12 + p % 100 - 1 + k
    return (t // 12) * 100 + t % 12 + 1


def ym(p):
    return f"{p % 100:02d}/{str(p // 100)[2:]}"


def month_end(p):
    y, m = divmod(p, 100)
    nxt = dt.date(y + (m == 12), m % 12 + 1, 1)
    return (nxt - dt.timedelta(days=1)).isoformat()


def lq(k):  # "Q2-2026" -> "Q2'26"
    return f"{k[:2]}'{k[5:]}"


def qkey(k):  # "Q2-2026" -> "2026Q2"
    return f"{k[3:]}{k[:2]}"


def q_end(k):  # "Q2-2026" -> 202606
    return int(k[3:]) * 100 + int(k[1]) * 3


def dlab(d):  # "2025-12-31" -> "31.12.25"
    return f"{d[8:10]}.{d[5:7]}.{d[2:4]}"


def months_between(a, b):  # ISO dates a <= b
    return (int(b[:4]) - int(a[:4])) * 12 + int(b[5:7]) - int(a[5:7])


def add_months_iso(d, k):
    """JavaScript Date.setMonth: the day overflows into the next month (2025-12-31 + 6 = 2026-07-01)"""
    y, m, day = int(d[:4]), int(d[5:7]), int(d[8:10])
    t = y * 12 + m - 1 + k
    y, m = divmod(t, 12)
    first = dt.date(y, m + 1, 1)
    return (first + dt.timedelta(days=day - 1)).isoformat()


def P_rep(title, value, unit, url, pg, doc, period, note=None):
    p = {"k": "report", "title": title, "value": value, "unit": unit, "url": url, "pg": pg, "doc": doc, "period": period}
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


def P_lts(c, metric, period, title, unit, value):
    return {"k": "lts", "c": c, "metric": metric, "period": period, "title": title, "unit": unit, "value": value}


def P_fund(title, value, unit, ds, id_, period, col, note=None):
    p = {"k": "fund", "title": title, "value": value, "unit": unit, "ds": ds, "id": id_, "period": period, "col": col}
    if note:
        p["note"] = note
    return p


def percentile(vals, v, better):
    """share of the other managers with a worse value (ties count half), 0-100; None below three managers"""
    others = list(vals)
    others.remove(v)
    if len(others) < 2:
        return None
    worse = sum(1 for x in others if (x < v if better == "hi" else x > v))
    tie = sum(1 for x in others if x == v)
    return round((worse + tie / 2) / len(others) * 100)


# ------------------------------------------------------------------------------------------------ the published files
class Ctx:
    def __init__(self):
        self.lens = load("lens.json")
        self.market = load("market.json")
        self.funds = load("funds.json")
        self.cat = load("funds/cat.json")
        self.curve = load("macro/boi_curve.json")
        self.macro = load("macro/macro.json")
        self.cal = load("calendar.json")
        self.solvency = load("csm/solvency.json")
        self.reg = load("companies/index.json")
        self.cards_ix = (load("cards/index.json").get("co") or {}) if (DATA / "cards" / "index.json").exists() else {}
        self.cos = {c["id"]: c["name_he"] for c in self.reg}
        self.kind = {c["id"]: c["kind"] for c in self.reg}
        self.P = self.market["periods"]
        self.MG = self.market["groups"]
        L = self.lens
        self.Q = L["quarters"]
        self.months = L["months"]
        self.groups = L["groups"]
        self.gix = {g["id"]: i for i, g in enumerate(self.groups) if g["id"]}
        self.rows = {(r["g"], r["s"], r["q"]): r for r in L["rows"]}
        self.last_q = L["meta"]["last_rep"]
        self.reg_asof = L["meta"]["asof"]
        self.ref_end = month_end(q_end(self.last_q))
        self.prints = {}
        for c in self.cal["companies"]:
            for h in c.get("history") or []:
                self.prints[(c["id"], h["period"])] = h["date"]
            if c.get("last"):
                self.prints.setdefault((c["id"], c["last"]["period"]), c["last"]["date"])
        self.drivers = {}
        for c in self.reg:
            f = DATA / "drivers" / f"{c['id']}.json"
            if f.exists():
                self.drivers[c["id"]] = json.loads(f.read_text(encoding="utf-8"))
        self.y1 = {m: v for m, v in zip(self.curve["months"], self.curve["nominal"]["1"])}

    def pi(self, month):
        return self.P.index(month)

    def mg(self, c):
        """market.json group index of a company (lens group order = market group order, matched by name)"""
        g = self.gix.get(c)
        return None if g is None else self.MG.index(self.groups[g]["name"])

    def print_date(self, c, qk):
        """publication day of the report of quarter "Q2-2026" (a Q4 is the annual report)"""
        k = qkey(qk)
        return self.prints.get((c, k[:4] + "FY" if k.endswith("Q4") else k))

    def card(self, c, p):
        f = DATA / "cards" / c / f"{p}.json"
        return json.loads(f.read_text(encoding="utf-8")) if f.exists() else None


# ------------------------------------------------------------------------------------------------ flow: net transfers, rolling 3M
def sig_flow(X, c):
    g = X.gix.get(c)
    if g is None:
        return None
    out = {}
    mg = X.mg(c)
    for s in ("pen", "gem"):
        ser = X.lens["series"].get(f"{g}|{s}")
        if not ser or not any(a for a in ser["a"] if a):
            continue
        tr, a, M = ser["tr"], ser["a"], X.months
        n = len(M)

        def win(i):  # 3 months ending at index i
            if i - 2 < 0 or any(tr[j] is None for j in range(i - 2, i + 1)):
                return None
            return fsum(tr[i - 2:i + 1])

        def a0(i):  # assets at the end of the month before the window
            return a[i - 3] if i - 3 >= 0 and a[i - 3] else None

        hist = []
        for i in range(max(0, n - 30), n):
            v3 = win(i)
            if v3 is None or a0(i) is None:
                continue
            p3 = win(i - 3) if i - 3 >= 0 else None
            run = 0
            for k in range(4):
                w = win(i - 3 * k) if i - 3 * k >= 0 else None
                if w is None or w >= 0:
                    break
                run += 1
            x = {"v3": r6(v3), "p3": r6(p3), "a0": r6(a0(i)), "run": run}
            hist.append((M[i], x, state("flow", x)))
        if not hist or hist[-1][0] != X.reg_asof:
            live = [M[i] for i in range(n) if a[i]]
            if live and live[-1] == X.reg_asof:
                out[s] = {"st": "nodata", "why": f"פחות משישה חודשי נתונים (מאז {ym(live[0])}): אין חלון 3M וחלון קודם"}
            else:
                out[s] = {"st": "nodata", "why": f"אין נתוני רשות ל-{ym(X.reg_asof)}", "stale": True}
            continue
        m, x, st = hist[-1]
        pi = X.pi(m)
        prov = {"k": "reg", "metric": "transfers", "pi": pi, "w": "q", "set": SEG_SET[s], "g": mg}
        provA = {"k": "reg", "metric": "assets", "pi": pi - 3, "w": "m", "set": SEG_SET[s], "g": mg}
        provP = {"k": "reg", "metric": "transfers", "pi": pi - 3, "w": "q", "set": SEG_SET[s], "g": mg}
        share = x["v3"] / x["a0"] * 100
        # the Savings Lens quarter beside it (flow share of the quarter, net transfers of the quarter)
        lr = X.rows.get((g, s, X.last_q))
        lens = None
        if lr:
            lens = {"q": lq(X.last_q), "tr": lr["reg"].get("tr"), "fs": lr.get("flow_share"),
                    "prov": {"k": "reg", "metric": "transfers", "pi": X.pi(q_end(X.last_q)), "w": "q", "set": SEG_SET[s], "g": mg}}
        out[s] = {"st": st, "x": x, "v": x["v3"], "t": r6(x["v3"] - x["p3"]) if x["p3"] is not None else None, "m": r6(share),
                  "asof": ym(m), "d": month_end(m), "prov": prov, "provA": provA, "provP": provP if x["p3"] is not None else None,
                  "ser": [[ym(h[0]), h[1]["v3"]] for h in hist[-12:]], "h": [[str(h[0]), h[1]["v3"], h[2]] for h in hist], "lens": lens,
                  "dk": "month"}
    return out


def active(X, g, s):
    """the group manages assets in the segment at the regulator's last month"""
    ser = X.lens["series"].get(f"{g}|{s}")
    return bool(ser and ser["a"] and ser["a"][-1])


# ------------------------------------------------------------------------------------------------ fee: realised fee yield, YoY
def fy_prov(X, c, g, s, qk):
    r = X.rows[(g, s, qk)]
    mg = X.mg(c)
    m3 = q_end(qk)
    ms = [madd(m3, -3), madd(m3, -2), madd(m3, -1), m3]
    avg = r["reg"]["avg"]
    avgP = P_calc(f"נכסים ממוצעים, רשות · {X.cos[c]} · {SEG_HE[s]} · {lq(qk)}", nf(avg / 1000, 2), 'מיליארד ש"ח',
                  "(A₀ ÷ 2 + A₁ + A₂ + A₃ ÷ 2) ÷ 3: טרפז על ארבעה סופי חודש; A₀ = סוף הרבעון הקודם (lens.json, avg_reg)",
                  [(f"נכסים · {ym(m)}", nf(v / 1000, 2), {"k": "reg", "metric": "assets", "pi": X.pi(m), "w": "m", "set": SEG_SET[s], "g": mg})
                   for m, v in zip(ms, r["reg"]["m"])])
    fees = r["rep"]["fees"]
    lc = r["rep"]["c"]
    return P_calc(f"תשואת דמי ניהול · {X.cos[c]} · {SEG_HE[s]} · {lq(qk)}", f"{nf(r['fy_reg'], 4)}%", "שנתי",
                  "הכנסות מדמי ניהול ברבעון × 4 ÷ נכסים ממוצעים של הרשות × 100 (lens.json fy_reg)",
                  [("הכנסות מדמי ניהול", nf(fees, 1), P_lts(lc, f"{s}.fees", qk, f"הכנסות מדמי ניהול · {X.cos[c]} · {SEG_HE[s]} · {lq(qk)}", MM, nf(fees, 1))),
                   ("נכסים ממוצעים, רשות", f"{nf(avg / 1000, 2)} מיליארד", avgP)])


def sig_fee(X, c):
    g = X.gix.get(c)
    if g is None:
        return None
    out = {}
    for s in ("pen", "gem"):
        have = [q for q in X.Q if (X.rows.get((g, s, q)) or {}).get("fy_reg") is not None and (X.rows.get((g, s, q)) or {}).get("rep")]
        if not have:
            if active(X, g, s):
                out[s] = {"st": "nodata", "why": "אין הכנסות מדמי ניהול מדווחות למגזר (החברה המנהלת אינה מפרסמת דוח מגזרי)"}
            continue
        hist = []
        for i, q in enumerate(X.Q):
            if i < 4 or q not in have or X.Q[i - 4] not in have:
                continue
            y, y4 = X.rows[(g, s, q)]["fy_reg"], X.rows[(g, s, X.Q[i - 4])]["fy_reg"]
            x = {"y": y, "y4": y4, "d": r6((y - y4) * 100)}
            hist.append((q, x, state("fee", x)))
        if not hist or hist[-1][0] != X.last_q:
            out[s] = {"st": "nodata", "stale": True, "why": f"אין הכנסות מדמי ניהול מדווחות ל-{lq(X.last_q)} או ל-{lq(X.Q[X.Q.index(X.last_q) - 4])}"}
            continue
        q, x, st = hist[-1]
        q4 = X.Q[X.Q.index(q) - 4]
        prov = fy_prov(X, c, g, s, q)
        prov4 = fy_prov(X, c, g, s, q4)
        out[s] = {"st": st, "x": x, "v": x["y"], "t": x["d"], "asof": lq(q), "d": X.print_date(c, q), "dk": "pub", "prov": prov,
                  "provT": P_calc(f"שינוי YoY · תשואת דמי ניהול · {X.cos[c]} · {SEG_HE[s]}", f"{sn(x['d'], 1)} נ״ב", "נ״ב",
                                  f"({lq(q)} − {lq(q4)}) × 100", [(lq(q), f"{nf(x['y'], 4)}%", prov), (lq(q4), f"{nf(x['y4'], 4)}%", prov4)]),
                  "ser": [[lq(qq), X.rows[(g, s, qq)]["fy_reg"]] for qq in have[-12:]], "h": [[qkey(h[0]), r6(h[1]["d"] / 100), h[2]] for h in hist],
                  "m": x["d"], "_hx": {qkey(h[0]): h[1] for h in hist}}
    return out


def fee_relative(X, raw):
    """the fee rule reads the change against the peers' median change in the same product and quarter (the sector's own compression)"""
    by = {}
    for c, sig in raw.items():
        for s, x in sig["fee"].items():
            for k, hx in (x.get("_hx") or {}).items():
                by.setdefault((s, k), {})[c] = hx["d"]
    for c, sig in raw.items():
        for s, x in sig["fee"].items():
            hx = x.pop("_hx", None)
            if not hx:
                continue
            for k, xx in hx.items():
                others = [v for cc, v in by[(s, k)].items() if cc != c]
                xx["med"] = r6(statistics.median(others)) if len(others) >= 2 else None
                xx["rel"] = r6(xx["d"] - xx["med"]) if xx["med"] is not None else None
            x["h"] = [[h[0], h[1], state("fee", hx[h[0]])] for h in x["h"]]
            last = x["h"][-1][0]
            x["x"] = hx[last]
            x["st"] = state("fee", hx[last])
            peers = sorted(((cc, v) for cc, v in by[(s, last)].items() if cc != c), key=lambda t: t[1])
            if x["x"]["med"] is not None:
                x["provM"] = P_calc(f"חציון השינוי אצל העמיתים · {SEG_HE[s]} · {per_label('fee', last)}", f"{sn(x['x']['med'], 1)} נ״ב", "נ״ב",
                                    "חציון השינוי YoY בתשואת דמי הניהול של שאר המנהלים באותו מוצר וברבעון",
                                    [(X.cos.get(cc, cc), f"{sn(v, 1)} נ״ב", None) for cc, v in peers])


# ------------------------------------------------------------------------------------------------ cost: cost / income LTM
def sig_cost(X, c):
    g = X.gix.get(c)
    if g is None:
        return None
    out = {}

    def ok(s, q):
        r = X.rows.get((g, s, q))
        rp = (r or {}).get("rep") or {}
        return r is not None and all(rp.get(k) is not None for k in ("fees", "sm", "ga")) and rp["fees"] > 0

    def ltm(s, i):
        qs = X.Q[i - 3:i + 1] if i >= 3 else []
        if len(qs) < 4 or not all(ok(s, q) for q in qs):
            return None, qs
        R = [X.rows[(g, s, q)]["rep"] for q in qs]
        return fsum(x["sm"] + x["ga"] for x in R) / fsum(x["fees"] for x in R) * 100, qs

    for s in ("pen", "gem"):
        if not any(ok(s, q) for q in X.Q):
            if active(X, g, s):
                out[s] = {"st": "nodata", "why": "אין הוצאות שיווק והנהלה מדווחות למגזר"}
            continue
        hist = []
        for i, q in enumerate(X.Q):
            l, _ = ltm(s, i)
            if l is None:
                continue
            l4, _ = ltm(s, i - 4) if i >= 4 else (None, [])
            x = {"l": r6(l), "l4": r6(l4), "d": r6(l - l4) if l4 is not None else None, "q": X.rows[(g, s, q)].get("ci")}
            hist.append((q, x, state("cost", x)))
        if not hist or hist[-1][0] != X.last_q:
            out[s] = {"st": "nodata", "stale": True, "why": f"אין הוצאות והכנסות מדווחות לארבעת הרבעונים עד {lq(X.last_q)}"}
            continue
        q, x, st = hist[-1]
        i = X.Q.index(q)
        lc = X.rows[(g, s, q)]["rep"]["c"]

        def ltmP(i):
            l, qs = ltm(s, i)
            ins = []
            for qq in qs:
                rp = X.rows[(g, s, qq)]["rep"]
                for k, he in (("sm", "שיווק ומכירה"), ("ga", "הנהלה וכלליות"), ("fees", "הכנסות מדמי ניהול")):
                    ins.append((f"{he} · {lq(qq)}", nf(rp[k], 1), P_lts(lc, f"{s}.{k}", qq, f"{he} · {X.cos[c]} · {SEG_HE[s]} · {lq(qq)}", MM, nf(rp[k], 1))))
            return P_calc(f"יחס הוצאות להכנסות LTM · {X.cos[c]} · {SEG_HE[s]} · {lq(X.Q[i])}", f"{nf(l, 1)}%", "%",
                          "Σ (שיווק ומכירה + הנהלה וכלליות) ÷ Σ הכנסות מדמי ניהול × 100, ארבעה רבעונים", ins)
        prov = ltmP(i)
        provT = None
        if x["d"] is not None:
            provT = P_calc(f"שינוי YoY · יחס הוצאות להכנסות LTM · {X.cos[c]} · {SEG_HE[s]}", f"{sn(x['d'], 1)} נ״א", "נ״א",
                           f"LTM {lq(q)} − LTM {lq(X.Q[i - 4])}", [(f"LTM {lq(q)}", f"{nf(x['l'], 1)}%", prov), (f"LTM {lq(X.Q[i - 4])}", f"{nf(x['l4'], 1)}%", ltmP(i - 4))])
        out[s] = {"st": st, "x": x, "v": x["l"], "t": x["d"], "asof": lq(q), "d": X.print_date(c, q), "dk": "pub", "prov": prov, "provT": provT,
                  "ser": [[lq(h[0]), h[1]["l"]] for h in hist[-12:]], "h": [[qkey(h[0]), h[1]["l"], h[2]] for h in hist], "m": x["l"], "q": x["q"]}
    return out


# ------------------------------------------------------------------------------------------------ perf: 36-month Sharpe vs peers
class Perf:
    """every open track's 36-month Sharpe at each of the last 13 month ends, and the category medians"""
    N = 36

    def __init__(self, X):
        self.X = X
        self.asof = X.funds["asof"]
        self.ends = [madd(self.asof, -k) for k in range(12, -1, -1)]
        name2id = {g["name"]: g["id"] for g in X.groups if g["id"]}
        self.tracks = []
        for f in X.funds["funds"]:
            c = name2id.get(f["grp"])
            if not c or f["closed"] or f["fam"] not in FAM_SEG or not f.get("n") or f["n"] < self.N:
                continue
            h = json.loads((DATA / "funds" / f"{f['k']}.json").read_text(encoding="utf-8"))
            ix = {p: i for i, p in enumerate(h["p"])}
            sh = {}
            for e in self.ends:
                ms = [madd(e, -k) for k in range(self.N - 1, -1, -1)]
                if not all(m in ix and h["y"][ix[m]] is not None for m in ms):
                    continue
                rf = [self.X.y1.get(f"{m // 100}-{m % 100:02d}") for m in ms]
                if any(x is None for x in rf):
                    continue
                r = [h["y"][ix[m]] for m in ms]
                sd = statistics.stdev(r)
                if not sd:
                    continue
                ex = fsum(a - b / 12 for a, b in zip(r, rf)) / self.N
                a = h["a"][ix[e]] if h["a"][ix[e]] else None
                sh[e] = {"s": ex * 12 / (sd * math.sqrt(12)), "mr": fsum(r) / self.N, "rf": fsum(rf) / self.N / 12, "sd": sd, "a": a}
            if sh:
                self.tracks.append({"c": c, "seg": FAM_SEG[f["fam"]], "cat": f"{f['prod']} | {f['track']}", "k": f["k"], "id": f["id"],
                                    "ds": {"pensia": "pensia", "gemel": "gemel", "insurance": "insurance"}[f["fam"]], "name": f["name"], "sh": sh})
        # per end month and category: the managers present
        self.by = {}
        for t in self.tracks:
            for e in t["sh"]:
                self.by.setdefault((e, t["seg"], t["cat"]), []).append(t)

    def gap(self, c, seg, e):
        num = den = 0.0
        rows = []
        for (ee, s, cat), ts in self.by.items():
            if ee != e or s != seg:
                continue
            mine = [t for t in ts if t["c"] == c]
            others = [t for t in ts if t["c"] != c]
            if not mine or len({t["c"] for t in ts}) < 4:
                continue
            med = statistics.median(t["sh"][e]["s"] for t in others)
            for t in mine:
                x = t["sh"][e]
                if not x["a"]:
                    continue
                num += x["a"] * (x["s"] - med)
                den += x["a"]
                rows.append((t, x, med, cat, len({o["c"] for o in others})))
        if not den:
            return None, []
        return num / den, rows


def sig_perf(X, c, PF):
    out = {}
    for s in ("pen", "gem", "ins"):
        if not any(t["c"] == c and t["seg"] == s for t in PF.tracks):
            continue
        hist = []
        for i, e in enumerate(PF.ends):
            g, rows = PF.gap(c, s, e)
            if g is None:
                continue
            g12 = PF.gap(c, s, madd(e, -12))[0] if madd(e, -12) in PF.ends else None
            x = {"g": r6(g), "g12": r6(g12), "d": r6(g - g12) if g12 is not None else None}
            hist.append((e, x, state("perf", x), rows))
        if not hist or hist[-1][0] != PF.asof:
            out[s] = {"st": "nodata", "stale": True, "why": "אין מסלול עם 36 תשואות חודשיות רצופות בקטגוריה עם 4 מנהלים לפחות"}
            continue
        e, x, st, rows = hist[-1]
        rows.sort(key=lambda r: -r[1]["a"])
        A = fsum(r[1]["a"] for r in rows)
        own = fsum(r[1]["a"] * r[1]["s"] for r in rows) / A
        peer = fsum(r[1]["a"] * r[2] for r in rows) / A

        def trackP(t, xx):
            ttl = f"שארפ 36 חודשים · {t['name']} · {ym(e)}"
            return P_calc(ttl, nf(xx["s"], 2), "", "(ממוצע תשואה חודשית − ממוצע ריבית חסרת סיכון חודשית) × 12 ÷ (סטיית תקן חודשית × √12), 36 חודשים",
                          [("ממוצע תשואה חודשית", f"{nf(xx['mr'], 3)}%", P_fund(f"תשואה חודשית · {t['name']}", "36 חודשים", "%", t["ds"], t["id"], e, "MONTHLY_YIELD",
                                                                              f"{ym(madd(e, -35))}–{ym(e)}: התשואות החודשיות שפורסמו")),
                           ("ממוצע ריבית חסרת סיכון חודשית", f"{nf(xx['rf'], 3)}%", P_rep("ריבית חסרת סיכון · אפס נומינלי שנה, ממוצע חודשי", f"{nf(xx['rf'] * 12, 2)}% לשנה", "%",
                                                                                         X.curve["url"], None, f"{X.curve['source']} · {X.curve['codes']['nominal']['1']}", f"{ym(madd(e, -35))}–{ym(e)}",
                                                                                         f"נמשך {X.curve['retrieved']}; ÷ 12 לחודש")),
                           ("סטיית תקן חודשית", f"{nf(xx['sd'], 3)}%", None)])
        ins = [(f"{t['name']} ({cat}, {k} מנהלים אחרים)", f"{nf(xx['s'], 2)} מול חציון {nf(med, 2)} · נכסים {nf(xx['a'], 0)}", trackP(t, xx))
               for t, xx, med, cat, k in rows[:8]]
        if len(rows) > 8:
            ins.append((f"ועוד {len(rows) - 8} מסלולים", f"{nf(fsum(r[1]['a'] for r in rows[8:]), 0)} מיליוני ש\"ח נכסים", None))
        prov = P_calc(f"פער שארפ 3Y מול העמיתים · {X.cos[c]} · {SEG_HE[s]} · {ym(e)}", sn(x["g"], 2), "שארפ",
                      "Σ נכסים × (שארפ המסלול − חציון שארפ המסלולים של המנהלים האחרים באותה קטגוריה) ÷ Σ נכסים; קטגוריות עם 4 מנהלים לפחות",
                      ins, note=f"שארפ משוקלל של המנהל {nf(own, 2)} מול חציון עמיתים משוקלל {nf(peer, 2)}; {len(rows)} מסלולים")
        out[s] = {"st": st, "x": x, "v": x["g"], "t": x["d"], "asof": ym(e), "d": month_end(e), "dk": "month", "prov": prov,
                  "own": r6(own), "peer": r6(peer), "nt": len(rows),
                  "ser": [[ym(h[0]), h[1]["g"]] for h in hist[-12:]], "h": [[str(h[0]), h[1]["g"], h[2]] for h in hist], "m": x["g"]}
    return out


# ------------------------------------------------------------------------------------------------ the board target (scenarios.ts targetOf)
TARGET = re.compile(r"^target_solvency_ratio(_board|_minimum|_min_stability|_min(imum)?_(with|without)_transitional|_with_transitional_minimum)?$")


def end_of_period(p):
    m = re.match(r"^(Q[1-4]|FY)'(\d\d)$", p or "")
    if not m:
        return None
    q = 4 if m.group(1) == "FY" else int(m.group(1)[1])
    return f"20{m.group(2)}-{['03-31', '06-30', '09-30', '12-31'][q - 1]}"


def target_of(f):
    N = f["nodes"]

    def node(k, r, b, label):
        n = N.get(k)
        if n and n.get("v") is not None and (N.get(r) or {}).get("v") is not None:
            return {"v": n["v"], "basis": b, "ratio": r, "label": label, "period": n["period"], "prov": n["prov"]}
        return None
    t = node("target_board_w", "solv_w", "w", "יעד הדירקטוריון, עם הוראות מעבר") or node("target_board_wo", "solv_wo", "wo", "יעד הדירקטוריון, ללא הוראות מעבר")
    if t or f["meta"]["kind"] != "insurance_group" or (N.get("solv_w") or {}).get("v") is None:
        return t
    end = N["solv_w"].get("d") or end_of_period(N["solv_w"]["period"])
    if not end:
        return None
    until = add_months_iso(end, 6)
    c = sorted([x for x in f["targets"] if TARGET.match(x["m"]) and 90 <= x["v"] <= 250 and x["d"] <= until], key=lambda x: (x["d"], x.get("rp") or ""))
    if not c:
        return None
    c = c[-1]
    rp = c.get("rp")
    per = (f"FY'{rp[2:4]}" if rp.endswith("FY") else f"{rp[4:]}'{rp[2:4]}") if rp else c["d"]
    return {"v": c["v"], "basis": "na", "ratio": "solv_w", "label": "יעד יחס כושר הפירעון שפורסם", "period": per,
            "est": "בסיס היעד לא צוין בנוסח: נמדד מול היחס עם הוראות מעבר",
            "prov": P_rep(f"יעד יחס כושר פירעון · {f['meta']['name']}", f"{nf(c['v'], 1 if c['v'] % 1 else 0)}%", "%", c.get("u"), c.get("pg"), "דוח כספי", per, c.get("l"))}


# ------------------------------------------------------------------------------------------------ solv: the ratio against the board target
def ratio_series(X, c, basis):
    """ratio date -> {v, d (publication), prov} on one basis: w = with the transitional measures (the report cards, first disclosure;
    the dedicated solvency reports; A1's node), wo = without (the dedicated reports; A1's node)"""
    by = {}
    if basis in ("w", "na"):
        for p in sorted((X.cards_ix.get(c) or {}).get("p") or []):
            card = X.card(c, p)
            r = next((x for x in (card or {}).get("rows", []) if x["k"] == "sr"), None)
            if not r or r["cur"] not in card["f"] or card["f"][r["cur"]].get("v") is None:
                continue
            fct = card["f"][r["cur"]]
            s = fct.get("s") or {}
            at, pub = r["at"], (card.get("doc") or {}).get("pub")
            if at in by and by[at]["d"] and pub and by[at]["d"] <= pub:
                continue
            url = card["u"][s["u"]] if s.get("u") is not None and s["u"] < len(card.get("u") or []) else None
            by[at] = {"v": fct["v"], "d": pub, "prov": P_rep(f"יחס כושר פירעון, עם הוראות מעבר · {X.cos[c]} · {dlab(at)}", f"{nf(fct['v'], 1)}%", "%", url, s.get("pg"),
                                                              f"כרטיס דוח {p}", dlab(at), s.get("l"))}
    key = "sr_wo" if basis == "wo" else "sr_w"
    S = X.solvency
    for at, e in (S["companies"].get(c) or {}).items():
        x = e.get(key)
        if not isinstance(x, dict) or at in by:
            continue
        rep = S["reports"].get(str(x.get("r"))) or {}
        by[at] = {"v": x["v"], "d": rep.get("pub"), "prov": P_rep(f"יחס כושר פירעון, {'ללא' if basis == 'wo' else 'עם'} הוראות מעבר · {X.cos[c]} · {dlab(at)}",
                                                                   f"{nf(x['v'], 1)}%", "%", FILES + rep["f"] if rep.get("f") else None, x.get("pg"),
                                                                   f"דוח כושר פירעון ({rep.get('e', '')})", dlab(at))}
    n = (X.drivers.get(c) or {}).get("nodes", {}).get("solv_wo" if basis == "wo" else "solv_w")
    if n and n.get("v") is not None and n.get("d") and n["d"] not in by:
        by[n["d"]] = {"v": n["v"], "d": None, "prov": n["prov"]}
    return {k: by[k] for k in sorted(by)}


def sig_solv(X, c):
    if X.kind.get(c) != "insurance_group":
        return {"all": {"st": "na", "why": "לא מבטחת"}}
    f = X.drivers.get(c)
    t = target_of(f) if f else None
    if not t:
        return {"all": {"st": "nodata", "why": "לא נמצא יעד דירקטוריון ליחס כושר הפירעון"}}
    basis = t["basis"]
    ser = ratio_series(X, c, "wo" if basis == "wo" else "w")
    if not ser:
        return {"all": {"st": "nodata", "why": "לא נמצא יחס כושר פירעון"}}
    dates = list(ser)
    hist = []
    for i, at in enumerate(dates):
        r = ser[at]["v"]
        prev = [d for d in dates[:i] if 9 <= months_between(d, at) <= 15]
        r1d = min(prev, key=lambda d: abs(months_between(d, at) - 12)) if prev else None
        r1 = ser[r1d]["v"] if r1d else None
        x = {"r": r, "t": t["v"], "h": r6(r - t["v"]), "r1": r1, "d": r6(r - r1) if r1 is not None else None, "at1": r1d}
        hist.append((at, x, state("solv", x)))
    at, x, st = hist[-1]
    cut = add_months_iso(X.ref_end, -STALE_RATIO_M)
    bl = "ללא" if basis == "wo" else "עם"
    tP = t["prov"]
    prov = P_calc(f"מרווח מעל היעד · {X.cos[c]} · {dlab(at)}", f"{sn(x['h'], 1)} נ״א", "נ״א",
                  f"יחס כושר פירעון ({bl} הוראות מעבר) − {t['label']}",
                  [(f"יחס ליום {dlab(at)}", f"{nf(x['r'], 1)}%", ser[at]["prov"]), (f"{t['label']} · {t['period']}", f"{nf(t['v'], 1 if t['v'] % 1 else 0)}%", tP)],
                  est=bool(t.get("est")), note=t.get("est"))
    provT = None
    if x["at1"]:
        provT = P_calc(f"שינוי היחס בשנה · {X.cos[c]}", f"{sn(x['d'], 1)} נ״א", "נ״א", f"{dlab(at)} − {dlab(x['at1'])}",
                       [(dlab(at), f"{nf(x['r'], 1)}%", ser[at]["prov"]), (dlab(x["at1"]), f"{nf(x['r1'], 1)}%", ser[x["at1"]]["prov"])])
    cell = {"st": st, "x": x, "v": x["r"], "t": x["d"], "asof": dlab(at), "d": at, "dk": "pub", "prov": prov, "provR": ser[at]["prov"], "provT": provT,
            "basis": basis, "target": {"v": t["v"], "label": t["label"], "period": t["period"], "est": t.get("est")},
            "ser": [[dlab(h[0]), h[1]["r"]] for h in hist[-12:]],
            "h": [[h[0], h[1]["r"], h[2], ser[h[0]]["d"]] for h in hist], "m": x["h"]}
    if at < cut:
        cell.update(st="nodata", stale=True, why=f"היחס האחרון ({bl} הוראות מעבר, הבסיס של היעד) ליום {dlab(at)}: ישן מ-{STALE_RATIO_M} חודשים לפני {lq(X.last_q)}")
    return {"all": cell}


# ------------------------------------------------------------------------------------------------ csm: runway = closing CSM / annual release
def sig_csm(X, c):
    if X.kind.get(c) != "insurance_group":
        return {"all": {"st": "na", "why": "לא מבטחת"}}
    p = DATA / "csm" / "facts" / f"{c}.json"
    if not p.exists():
        return {"all": {"st": "nodata", "why": "לא חולצו גילויי IFRS 17"}}
    cf = json.loads(p.read_text(encoding="utf-8"))
    urls = {x["period"]: x["url"] for x in cf["files"]}
    yrs = sorted(k for k in cf["reports"] if k.endswith("FY"))
    if not yrs:
        return {"all": {"st": "nodata", "why": "אין דוח שנתי עם תנועה ב-CSM"}}
    rp = yrs[-1]
    fy = cf["reports"][rp]
    y = int(rp[:4])
    use = [f for f in fy if csm_resolve.usable(f)]

    def point(d):
        rel = [f for f in fy if f["m"] == "csm_release" and f["d"][:10] == d and f.get("w") in ("fy", "ytd") and f.get("b") == "gross" and f["g"] in ("life", "health")
               and csm_resolve.whole(f, f["g"])]
        gs = sorted({f["g"] for f in rel})
        if gs != ["health", "life"] and not (gs == ["life"] and csm_resolve.life_only(fy)):
            return None
        rel = [sorted([f for f in rel if f["g"] == g], key=lambda f: f.get("pg") or 0)[0] for g in gs]
        clo = [csm_resolve._pick(use, g, "gross", d) for g in gs]
        if not all(clo):
            return None
        R = fsum(abs(f["v"]) for f in rel)
        C = fsum(csm_resolve._value(f)[0] for f in clo)
        if not R:
            return None
        lab = f"FY'{d[2:4]}"
        rP = lambda f, t: P_rep(f"{t} · {X.cos[c]} · {f['g']} · {lab}", nf(abs(f["v"]) if f["m"] == "csm_release" else csm_resolve._value(f)[0], 1), MM, urls.get(rp), f.get("pg"),
                                f"דוח כספי FY'{rp[2:4]}", lab, f.get("l"))
        prov = P_calc(f"אורך חיי CSM · {X.cos[c]} · {lab}", f"{nf(C / R, 1)} שנים", "שנים",
                      f"CSM ברוטו לסוף השנה ({' + '.join('חיים' if g == 'life' else 'בריאות' for g in gs)}) ÷ שחרור CSM ברוטו בשנה (LTM של Q4)",
                      [(f"CSM ברוטו · {f['g']} · {dlab(d)}", nf(csm_resolve._value(f)[0], 1), rP(f, "CSM ברוטו")) for f in clo] +
                      [(f"שחרור · {f['g']} · {lab}", nf(abs(f["v"]), 1), rP(f, "שחרור CSM")) for f in rel],
                      note=None if gs == ["health", "life"] else "חיים בלבד: החברה לא מדפיסה טבלת CSM לבריאות")
        return {"y": C / R, "C": C, "R": R, "gs": gs, "prov": prov}
    cur, prv = point(f"{y}-12-31"), point(f"{y - 1}-12-31")
    if not cur:
        return {"all": {"st": "nodata", "why": f"שחרור CSM ברוטו או יתרות ברוטו לחיים ולבריאות לא חולצו מהדוח השנתי FY'{rp[2:4]}"}}
    x = {"y": r6(cur["y"]), "y1": r6(prv["y"]) if prv else None, "d": r6(cur["y"] - prv["y"]) if prv else None}
    st = state("csm", x)
    hist = []
    if prv:
        x0 = {"y": r6(prv["y"]), "y1": None, "d": None}
        hist.append([f"{y - 1}FY", x0["y"], state("csm", x0), X.prints.get((c, f"{y - 1}FY"))])
    hist.append([rp, x["y"], st, X.prints.get((c, rp))])
    provT = None
    if prv:
        provT = P_calc(f"שינוי אורך החיים YoY · {X.cos[c]}", f"{sn(x['d'], 2)} שנים", "שנים", f"FY'{rp[2:4]} − FY'{str(y - 1)[2:]}",
                       [(f"FY'{rp[2:4]}", nf(cur["y"], 2), cur["prov"]), (f"FY'{str(y - 1)[2:]}", nf(prv["y"], 2), prv["prov"])])
    cell = {"st": st, "x": x, "v": x["y"], "t": x["d"], "asof": f"FY'{rp[2:4]}", "d": X.prints.get((c, rp)) or f"{y}-12-31", "dk": "pub", "prov": cur["prov"], "provT": provT,
            "C": r6(cur["C"]), "R": r6(cur["R"]), "ser": [[f"FY'{h[0][2:4]}", h[1]] for h in hist], "h": hist, "m": x["y"]}
    lag = (int(X.last_q[3:]) * 4 + int(X.last_q[1])) - (y * 4 + 4)
    if lag > 2:
        cell.update(st="nodata", stale=True, why=f"הדוח השנתי האחרון עם תנועה ב-CSM הוא FY'{rp[2:4]}: יותר משני רבעונים לפני {lq(X.last_q)}")
    return {"all": cell}


# ------------------------------------------------------------------------------------------------ scen: A2's worst case (scenarios.ts, solvency channel)
def eval_line(pts, x):
    """stress.ts evalLine: exact at a disclosed point, a straight line between, clamped beyond; the origin sits between the sides"""
    if not pts:
        return None
    allp = sorted(pts, key=lambda p: p["x"])
    i0 = next((i for i, p in enumerate(allp) if p["x"] > 0), len(allp))
    allp = allp[:i0] + [None] + allp[i0:]
    at = lambda p: p["x"] if p else 0
    val = lambda p: p["v"] if p else 0
    if x == 0:
        return {"v": 0, "extra": False}
    lo, hi = at(allp[0]), at(allp[-1])
    xe = min(hi, max(lo, x))
    extra = xe != x
    hit = next((p for p in allp if at(p) == xe), "none")
    if hit != "none":
        return {"v": val(hit), "extra": extra}
    for a, b in zip(allp, allp[1:]):
        if at(a) < xe < at(b):
            return {"v": val(a) + (val(b) - val(a)) * (xe - at(a)) / (at(b) - at(a)), "extra": extra}
    return None


def read_line(pts, x):
    if not pts or not x:
        return None
    return eval_line(pts, x)


def eq_run(cat, a, b):
    c = cat.get(EQ_CAT)
    if not c:
        return None
    rows = [(m, y) for m, y in zip(c["p"], c["y"]) if a <= m <= b]
    want = (b // 100 - a // 100) * 12 + b % 100 - a % 100 + 1
    if not rows or len(rows) != want:
        return None
    v = 1.0
    for _, y in rows:
        v *= 1 + y / 100
    return (v - 1) * 100


def presets(X, base_end):
    """the seven Scenario Studio presets (scenarios.ts presets), as the two inputs the solvency ratio reads: 10Y (bp) and equities (%)"""
    cv = X.curve
    at = lambda m: cv["nominal"]["10"][cv["months"].index(m)] if m in cv["months"] else None
    at1 = lambda m: cv["nominal"]["1"][cv["months"].index(m)] if m in cv["months"] else None
    e08 = eq_run(X.cat, 200801, 200812)
    n0, n1, s0, s1 = at("2008-01"), at("2008-12"), at1("2008-01"), at1("2008-12")
    p08 = {"id": "2008", "he": "2008 חוזר", "y10": jround((n1 - n0) * 20) * 5 if n0 is not None and n1 is not None else 0, "eq": jround(e08) if e08 is not None else 0,
           "ok": e08 is not None and None not in (n0, n1, s0, s1)}
    S = X.macro["series"]
    bm = base_end[:7]
    nom = (S.get("nom10") or {}).get("months") or []
    nl = nom[-1] if nom else None
    nb = next((v for k, v in nom if k == bm), None)
    by, bmo = int(bm[:4]), int(bm[5:7])
    eq_end = (X.cat.get(EQ_CAT) or {}).get("p", [0])[-1]
    eq_a = (by + 1) * 100 + 1 if bmo == 12 else by * 100 + bmo + 1
    e = eq_run(X.cat, eq_a, eq_end) if eq_end >= eq_a else None
    pnow = {"id": "now", "he": "הרבעון הנוכחי", "y10": jround((nl[1] - nb) * 100 / 5) * 5 if nl and nb is not None else 0,
            "eq": jround(e * 10) / 10 if e is not None else 0, "ok": bool(S) and e is not None,
            "note": f"10 שנים {bm} ← {nl[0] if nl else '–'}; מניות {ym(eq_a)}–{ym(eq_end)}"}
    return [
        {"id": "rate", "he": "ירידת ריבית", "y10": -120, "eq": 0, "ok": True},
        {"id": "eqdd", "he": "מפולת מניות", "y10": 0, "eq": -25, "ok": True},
        p08,
        {"id": "fee", "he": "תקרת דמי ניהול", "y10": 0, "eq": 0, "ok": True},
        {"id": "freeze", "he": "הקפאת ניוד", "y10": 0, "eq": 0, "ok": True},
        {"id": "stag", "he": "סטגפלציה", "y10": 200, "eq": -10, "ok": True},
        pnow,
    ]


def solv_delta(f, y10, eq, ratio):
    """Δ of the ratio under (y10, eq), as drivers.ts propagate reads it (clamp): with the transitional measures the sum of the disclosed
    lines; without them a disclosure on that basis, else the same relative move. None = not computable (no lines under a shock)."""
    N = f["nodes"]
    SL = f["lines"].get("solv")
    shock = {"rate": y10, "equity": eq}
    if (y10 or eq) and not SL:
        return None, []
    dW, wo, used = 0.0, [], []
    if SL:
        for r in ("rate", "equity", "mortality", "morbidity", "lapse"):
            x = shock.get(r, 0)
            if not x:
                continue
            pts = [q for q in SL["pts"].get(r) or [] if q.get("b") != "wo"]
            e = read_line(pts, x)
            if e is None:
                continue
            dW += e["v"]
            used.append((r, x, e, pts))
            ewo = read_line([q for q in SL["pts"].get(r) or [] if q.get("b") == "wo"], x)
            if ewo:
                wo.append(ewo["v"])
    if ratio == "solv_w":
        return dW, used
    sw, swo = (N.get("solv_w") or {}).get("v"), (N.get("solv_wo") or {}).get("v")
    if swo is None or not sw:
        return None, used
    if wo:
        return fsum(wo), used
    return (dW * swo / sw if dW else 0.0), used


def sig_scen(X, c, PR):
    if X.kind.get(c) != "insurance_group":
        return {"all": {"st": "na", "why": "לא מבטחת"}}
    f = X.drivers.get(c)
    t = target_of(f) if f else None
    if not t:
        return {"all": {"st": "nodata", "why": "לא נמצא יעד דירקטוריון ליחס (A2 לא מודד מרווח)"}}
    N = f["nodes"]
    R = N[t["ratio"]]
    base = R["v"] - t["v"]
    res = []
    for p in PR:
        if not p["ok"]:
            continue
        d, used = solv_delta(f, p["y10"], p["eq"], t["ratio"])
        res.append({"id": p["id"], "he": p["he"], "y10": p["y10"], "eq": p["eq"], "d": r6(d), "v": r6(base + d) if d is not None else None, "used": used})
    bl = "ללא" if t["ratio"] == "solv_wo" else "עם"
    rd = R.get("d") or end_of_period(R.get("period"))
    SL = f["lines"].get("solv")
    if any(r["v"] is None for r in res):
        why = "רגישויות יחס כושר הפירעון לא חולצו לחברה: היחס אחרי התרחיש לא חושב"
        return {"all": {"st": "nodata", "why": why, "h0": r6(base), "asof": R.get("period"), "d": rd}}
    worst = min(res, key=lambda r: (r["v"], PR.index(next(p for p in PR if p["id"] == r["id"]))))
    x = {"h0": r6(base), "hw": worst["v"], "p": worst["id"]}
    st = state("scen", x)
    ins = [(f"יחס {bl} הוראות מעבר · {R['period']}", f"{nf(R['v'], 1)}%", R["prov"]), (f"{t['label']} · {t['period']}", f"{nf(t['v'], 1 if t['v'] % 1 else 0)}%", t["prov"])]
    for r in res:
        sub = [(f"{'10 שנים' if k == 'rate' else 'מניות'} {sn(x_, 0)}{' נ״ב' if k == 'rate' else '%'}{' · מחוץ לטווח, נחתך' if e['extra'] else ''}", f"{sn(e['v'], 1)} נ״א",
                P_calc(f"{'10 שנים' if k == 'rate' else 'מניות'} {sn(x_, 0)} · יחס כושר פירעון · {X.cos[c]}", f"{sn(e['v'], 1)} נ״א", "נ״א",
                       f"מקו הנקודות שגולו בדוח כושר הפירעון ליום {SL['d']} (stress.ts evalLine)", [(f"גולה: {sn(q['x'], 0)}", f"{sn(q['v'], 1)} נ״א", q.get("p")) for q in pts]))
               for k, x_, e, pts in r["used"]]
        if t["ratio"] == "solv_wo" and r["used"]:
            sub.append(("ללא הוראות מעבר", "אותה תזוזה יחסית (הנחה, A1)" if not any(q.get("b") == "wo" for q in sum((u[3] for u in r["used"]), [])) else "גילוי", None))
        ins.append((f"תרחיש · {r['he']}", f"{sn(r['v'], 1)} נ״א" + (f" (Δ {sn(r['d'], 1)})" if r["d"] else ""),
                    P_calc(f"מרווח ליעד · {X.cos[c]} · {r['he']}", f"{sn(r['v'], 1)} נ״א", "נ״א", "מרווח בבסיס + Δ היחס בתרחיש (ערוץ כושר הפירעון של חדר התרחישים, ללא פיזור)",
                           [("מרווח בבסיס", f"{sn(base, 1)} נ״א", None)] + sub) if r["used"] else None))
    prov = P_calc(f"מרווח ליעד בתרחיש הגרוע · {X.cos[c]}", f"{sn(worst['v'], 1)} נ״א", "נ״א",
                  f"min על תרחישי חדר התרחישים של (יחס {bl} הוראות מעבר + Δ בתרחיש − היעד)", ins, est=bool(t.get("est")), note=t.get("est"))
    cell = {"st": st, "x": x, "v": x["hw"], "t": r6(x["hw"] - x["h0"]), "asof": R.get("period"), "d": rd, "dk": "pub", "prov": prov,
            "pre": [{"id": r["id"], "he": r["he"], "y10": r["y10"], "eq": r["eq"], "v": r["v"]} for r in res], "worst": worst["id"], "worst_he": worst["he"],
            "lines": SL["d"] if SL else None, "ser": [[r["he"], r["v"]] for r in res], "h": [], "m": x["hw"]}
    cut = add_months_iso(X.ref_end, -STALE_RATIO_M)
    low = any(e["to"] in ("solv_w",) and e["method"] == "disclosure" and e["quality"] == "low" for e in f["edges"])
    if rd and rd < cut:
        cell.update(st="nodata", stale=True, why=f"יחס הבסיס של A2 ({bl} הוראות מעבר) ליום {dlab(rd)}: ישן מ-{STALE_RATIO_M} חודשים לפני {lq(X.last_q)}")
    elif low:
        cell.update(st="nodata", stale=True, why=f"רגישויות היחס שגולו ליום {dlab(SL['d'])}: ישנות מ-36 חודשים לפני יחס הבסיס (A1: איכות נמוכה)")
    return {"all": cell}


# ------------------------------------------------------------------------------------------------ assembly
def manager_cell(sig, segs, peers):
    """the manager's cell of one signal: the state of its worst segment (ties: the lower percentile) and every segment (`segs`); the
    figures of the cell are those of `segs[seg]`"""
    data = {s: x for s, x in segs.items() if x["st"] in RANK}
    better = next(z for z in SIGS if z["id"] == sig)["better"]
    for s, x in data.items():
        vals = peers.get(s) or []
        x["pct"] = percentile(vals, x["m"], better) if x["m"] in vals else None
        x["n"] = len(vals)
    if not data:
        if not segs:
            return {"st": "na", "why": "אין פעילות רלוונטית בנתונים", "seg": None, "segs": {}}
        why = "; ".join(f"{SEG_HE[s] + ': ' if SEG_HE[s] else ''}{x.get('why', '')}" for s, x in segs.items())
        st = "na" if all(x["st"] == "na" for x in segs.values()) else "nodata"
        out = {"st": st, "why": why, "seg": None, "segs": segs}
        if any(x.get("stale") for x in segs.values()):
            out["stale"] = True
        return out
    drv = max(data, key=lambda s: (RANK[data[s]["st"]], -(data[s]["pct"] if data[s]["pct"] is not None else 50)))
    return {"st": data[drv]["st"], "seg": drv, "segs": segs}


def crossings(cell):
    """the periods where the manager's state rose into watch / alert from the state of the period before (both data states); the segment
    that carried the new state, with its own figure then and at its previous point"""
    per = {}
    for s, x in (cell.get("segs") or {}).items():
        for h in x.get("h") or []:
            per.setdefault(h[0], {})[s] = h
    out, prev = [], None
    for k in sorted(per):
        hs = per[k]
        s = max(hs, key=lambda z: RANK[hs[z][2]])
        stt = hs[s][2]
        if prev is not None and RANK[stt] > RANK[prev] and stt in ("watch", "alert"):
            own = [h for h in cell["segs"][s]["h"] if h[0] < k]
            out.append({"per": k, "st": stt, "from": prev, "seg": s, "v": hs[s][1], "pk": own[-1][0] if own else None, "pv": own[-1][1] if own else None,
                        "d": hs[s][3] if len(hs[s]) > 3 else None})
        prev = stt
    return out


UNIT_EV = {"flow": "dm", "fee": "pp", "perf": "r", "cost": "pct", "solv": "pct", "csm": "r"}
EV_L = {"flow": "העברות נטו, 3 חודשים", "fee": "שינוי YoY בתשואת דמי הניהול, נק׳ אחוז", "perf": "פער שארפ 3Y מול חציון העמיתים", "cost": "יחס הוצאות להכנסות, LTM",
        "solv": "יחס כושר פירעון", "csm": "אורך חיי CSM, שנים"}
ST_HE = {"ok": "תקין", "watch": "מעקב", "alert": "התראה", "nodata": "אין נתונים", "na": "לא רלוונטי"}


def per_label(sig, k):
    if sig in ("flow", "perf"):
        return ym(int(k))
    if sig == "solv":
        return dlab(k)
    if k.endswith("FY"):
        return f"FY'{k[2:4]}"
    return f"{k[4:]}'{k[2:4]}"


def events(X, rows):
    """the crossings as feed events (build_feed.py merges them; check_feed.py re-reads every figure here)"""
    out = []
    for row in rows:
        c = row["c"]
        for sig in SIG_IDS:
            cell = row["sig"][sig]
            if sig == "scen" or cell["st"] == "na":
                continue
            for x in crossings(cell):
                k = x["per"]
                if sig in ("flow", "perf"):
                    d, dk, per = month_end(int(k)), "month", k
                elif sig in ("fee", "cost"):
                    d, dk, per = X.print_date(c, f"{k[4:]}-{k[:4]}"), "pub", k
                    if not d:
                        d, dk, per = month_end(q_end(f"{k[4:]}-{k[:4]}")), "month", str(q_end(f"{k[4:]}-{k[:4]}"))
                else:
                    d, dk, per = x["d"], "pub", k
                if not d or d < FROM:
                    continue
                sh = next(z for z in SIGS if z["id"] == sig)
                segl = SEG_HE[x["seg"]]
                src = lambda kk: {"k": "frag", "c": c, "sig": sig, "seg": x["seg"], "per": kk}
                r = {"l": f"{EV_L[sig]}{' · ' + segl if segl else ''}", "ab": [per_label(sig, k)], "a": {"v": r6(x["v"]), "u": UNIT_EV[sig], "s": src(k)}}
                if x["pk"] is not None:
                    r["ab"].append(per_label(sig, x["pk"]))
                    r["b"] = {"v": r6(x["pv"]), "u": UNIT_EV[sig], "s": src(x["pk"])}
                out.append({"id": f"frag:{c}:{sig}:{k}", "t": "fragility", "d": d, "dk": dk, "c": c, "per": per,
                            "h": f"{sh['he']}{' · ' + segl if segl else ''}: {ST_HE[x['from']]} ← {ST_HE[x['st']]}",
                            "src": {"k": "frag", "c": c, "sig": sig}, "rows": [r], "to": f"/fragility?c={c}&s={sig}", "fs": x["st"]})
    out.sort(key=lambda e: (e["d"], e["id"]), reverse=True)
    return out


def build():
    X = Ctx()
    PF = Perf(X)
    base_end = next(iter(X.drivers.values()))["meta"]["base"]["end"] if X.drivers else X.ref_end
    PR = presets(X, base_end)
    cos = [c for c in X.cos if c not in SKIP]
    raw = {}
    for c in cos:
        raw[c] = {"flow": sig_flow(X, c) or {}, "fee": sig_fee(X, c) or {}, "perf": sig_perf(X, c, PF), "cost": sig_cost(X, c) or {},
                  "solv": sig_solv(X, c), "csm": sig_csm(X, c), "scen": sig_scen(X, c, PR)}
    fee_relative(X, raw)
    peers = {}
    for c, by in raw.items():
        for sig, segs in by.items():
            for s, x in segs.items():
                if x["st"] in RANK:
                    peers.setdefault(sig, {}).setdefault(s, []).append(x["m"])
    rows, skipped = [], [{"c": c, "why": w} for c, w in SKIP.items()]
    for c in cos:
        cells = {sig: manager_cell(sig, raw[c][sig], peers.get(sig, {})) for sig in SIG_IDS}
        if not any(cells[s]["st"] in RANK for s in SIG_IDS):
            skipped.append({"c": c, "why": "אין אף אות עם נתונים"})
            continue
        flags = sorted([{"sig": s, "st": cells[s]["st"]} for s in SIG_IDS if cells[s]["st"] in ("watch", "alert")], key=lambda f: (-RANK[f["st"]], SIG_IDS.index(f["sig"])))
        rows.append({"c": c, "name": X.cos[c], "kind": X.kind[c], "sig": cells, "flags": flags,
                     "nodata": [s for s in SIG_IDS if cells[s]["st"] == "nodata"]})
    ev = events(X, rows)
    out = {
        "v": 1,
        "asof": {"lens": lq(X.last_q), "reg": ym(X.reg_asof), "funds": ym(PF.asof), "base": base_end},
        "rule": "אין ציון מצרפי: הסטטוס של מנהל הוא רשימת האותות במעקב או בהתראה, כל אחד עם הנתונים שהעבירו אותו",
        "sigs": [{**s, "rule": s["rule"]} for s in SIGS],
        "params": PARAMS,
        "stale_ratio_m": STALE_RATIO_M,
        "presets": [{k: p[k] for k in ("id", "he", "y10", "eq", "ok")} for p in PR],
        "cos": X.cos,
        "rows": rows,
        "skipped": skipped,
        "events": ev,
    }
    return out


# ------------------------------------------------------------------------------------------------ the checks (gate `fragility`)
BANNED_KEYS = re.compile(r"^(score|scores|rating|ratings|composite|grade|index|total|overall|rank|fox_rating|fragility_score|points)$", re.I)


def problems(o):
    bad = []

    def walk(x, path):
        if isinstance(x, dict):
            for k, v in x.items():
                if BANNED_KEYS.match(k):
                    bad.append(f"{path}.{k}: a composite-like field")
                walk(v, f"{path}.{k}")
        elif isinstance(x, list):
            for i, v in enumerate(x):
                walk(v, f"{path}[{i}]")
        elif isinstance(x, float) and (x != x or abs(x) == float("inf")):
            bad.append(f"{path}: NaN")
    walk(o, "$")
    for row in o["rows"]:
        if "score" in json.dumps(row.get("flags")):
            bad.append(f"{row['c']}: flags carry a score")
        for sig in SIG_IDS:
            cell = row["sig"].get(sig)
            if cell is None:
                bad.append(f"{row['c']}.{sig}: missing")
                continue
            if cell["st"] not in ("ok", "watch", "alert", "nodata", "na"):
                bad.append(f"{row['c']}.{sig}: state {cell['st']}")
            if cell["st"] in RANK:
                head = cell["segs"].get(cell["seg"]) or {}
                if head.get("st") != cell["st"]:
                    bad.append(f"{row['c']}.{sig}: the cell's state is not its driving segment's")
                for s, x in cell["segs"].items():
                    if x["st"] not in RANK:
                        if not x.get("why"):
                            bad.append(f"{row['c']}.{sig}.{s}: {x['st']} without a reason")
                        continue
                    if not x.get("prov"):
                        bad.append(f"{row['c']}.{sig}.{s}: no provenance")
                    if not x.get("asof") or not x.get("d"):
                        bad.append(f"{row['c']}.{sig}.{s}: no as-of date")
                    if state(sig, x["x"]) != x["st"]:
                        bad.append(f"{row['c']}.{sig}.{s}: state does not follow the rule")
                    if RANK[x["st"]] > RANK[cell["st"]]:
                        bad.append(f"{row['c']}.{sig}.{s}: a segment worse than the cell")
            elif not cell.get("why"):
                bad.append(f"{row['c']}.{sig}: {cell['st']} without a reason")
        want = [f["sig"] for f in row["flags"]]
        if sorted(want) != sorted(s for s in SIG_IDS if row["sig"][s]["st"] in ("watch", "alert")):
            bad.append(f"{row['c']}: flags differ from the signals in watch / alert")
    by = {r["c"]: r for r in o["rows"]}
    for e in o["events"]:
        for r in e.get("rows") or []:
            for part in ("a", "b"):
                if part not in r:
                    continue
                s = r[part]["s"]
                h = (((by.get(s["c"]) or {}).get("sig", {}).get(s["sig"]) or {}).get("segs", {}).get(s["seg"]) or {}).get("h") or []
                want = next((x[1] for x in h if x[0] == s["per"]), None)
                if want is None or abs(want - r[part]["v"]) > 1e-9:
                    bad.append(f"{e['id']}: {part} {r[part]['v']} vs history {want}")
    return bad


def dump(o):
    return json.dumps(o, ensure_ascii=False, separators=(",", ":"))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args(argv)
    out = build()
    bad = problems(out)
    n_sig = sum(1 for r in out["rows"] for s in SIG_IDS if r["sig"][s]["st"] in RANK)
    if a.check:
        try:
            disk = json.loads(OUT.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            disk = None
        if disk is None:
            bad.append("fragility.json missing")
        else:
            bad += [f"on disk: {b}" for b in problems(disk)]
            if dump(disk) != dump(out):
                bad.append("fragility.json differs from a rebuild")
        print(f"fragility: {len(out['rows'])} managers, {n_sig} signals with data, {sum(len(r['flags']) for r in out['rows'])} in watch/alert, "
              f"{len(out['events'])} events, {len(bad)} problems" + (f"; {bad[0]}" if bad else ""))
        for b in bad[:20]:
            print("FAIL", b)
        return 1 if bad else 0
    if bad:
        for b in bad[:20]:
            print("FAIL", b)
        return 1
    OUT.write_text(dump(out), encoding="utf-8")
    print(f"fragility.json: {len(out['rows'])} managers, {n_sig} signals with data, "
          + ", ".join(f"{r['c']} [{' '.join(f['sig'] + ':' + f['st'] for f in r['flags'])}]" for r in out["rows"] if r["flags"])
          + f"; {len(out['events'])} feed events")
    return 0


if __name__ == "__main__":
    sys.exit(main())
