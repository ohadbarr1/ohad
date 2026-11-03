"""Wave 11 "under": the shekel cost of staying in a bottom-quartile track that still receives money. Month by month since 2016, for every
open track with a 5-year net return in a category fox ranks within (product | track): its gap to the category median (net, annualised;
a gap inside the 10bp tie band of lib/fundsTie.ts is zero), its assets, its 12-month net flow with the intra-group migration taken out,
and the "cost of the gap": assets x gap per year (and, as a second measure, the 12-month inflow x gap). Standard library; it reads only
files the site already publishes (build_funds.py, build_flows.py), so it rebuilds anywhere, CI included.

python3 pipeline/build_under.py            write the files below
python3 pipeline/build_under.py --check    rebuild in memory: byte-equal to the files on disk, and the rules hold

  -> web/public/data/under.json              methods (every formula in words), the monthly series since 2016 (the headline total and
                                             its context) and the latest month: every ranked track with its gap, flow and cost
  -> web/public/data/under/m/<yyyymm>.json   one month: the category medians and the headline rows behind that month's series point

Inputs: funds.json, funds/closed.json (name, group, manager of every track, closed ones included: no survivorship), funds/<k>.json
(monthly a, yn, dep, wd, tr, nd, ct), flows/<prod>.json (the group x product monthly org and comp of build_flows.py).
Units: NIS millions; returns and gaps percent per year; months yyyymm.
"""
import json
import math
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import funds_lib as FL  # noqa: E402
import build_flows as BF  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / "web" / "public" / "data"
V = 1
FROM = 201601
WIN = 60            # 5 years, months
TIE_BP = 10         # lib/fundsTie.ts TIE_BP: a gap inside the band is zero
BAND = TIE_BP / 100  # percent points per year
BQ = 25             # bottom quartile: category percentile <= 25 (funds_lib.percentiles, 100 = best)
SAVER_BP = 25       # the saver's line (components/saver/UnderLine.tsx) needs a gap of at least 25bp
EPS = 1e-9
SRC = ("הרשות לשוק ההון: גמל-נט, פנסיה-נט, ביטוח-נט (data.gov.il), כפי שהאתר מפרסם אותם: funds/<k>.json (תשואה חודשית נטו, נכסים, תזרימים), "
       "funds.json, funds/closed.json, flows/<prod>.json")

METHOD = {
    "what": "כמה עולה לחוסכים להישאר במסלול ברבעון התחתון של הקטגוריה שלו, כשהמסלול עדיין מקבל כסף. מדד היסטורי: מה היה הפער ב-5 השנים "
            "שהסתיימו בחודש, לא תחזית",
    "past": "תשואות עבר אינן מנבאות תשואות עתיד. פער של 5 שנים אינו אומר שהפער יימשך, ואינו המלצה לעבור מסלול",
    "why5": "למה 5 שנים: חלון ברירת המחדל של הדירוגים באתר (lib/fundsTie.ts DEFAULT_PER); קצר מזה מושפע בעיקר מתזמון ומרעש שוק, ארוך מזה מכסה "
            "מעט מסלולים ומנהלים שהתחלפו",
    "net": "נטו, אומדן: " + FL.NET_METHOD.split(": ", 1)[1].split(". תקופות")[0] + ". 5 שנים: ריבית דריבית של 60 התשואות החודשיות הנטו "
           "(yn ב-funds/<k>.json) בחזקת 1/5, מעוגל ל-0.01 (עד 0.01 נ\"א מהמספר שבדף המסלול); בחודש האחרון: המספר שבדף המסלול (funds.json net.a5). דמי הניהול: הממוצע "
           "בפועל של המסלול, לא מה שחוסך מסוים משלם; דמי ניהול מהפקדה אינם נכללים",
    "cat": "קטגוריה: אותו מוצר ואותו מסלול (מוצר | מסלול, כפי שהאתר מדרג), לפי הקטגוריה של המסלול באותו חודש (ct). נכנסים המסלולים הפתוחים "
           "באותו חודש עם נכסים חיוביים ועם 60 חודשי תשואה רצופים; לא מסלולים בניהול אישי (IRA). רק קטגוריה של 5 מסלולים לפחות. "
           "מסלולים שנסגרו אחר כך נכללים בחודשים שבהם היו פתוחים",
    "pct": "אחוזון בקטגוריה: " + FL.PR_METHOD.split(": ", 1)[1].split(". בקבוצה")[0] + f". רבעון תחתון: אחוזון {BQ} ומטה",
    "med": "חציון הקטגוריה: החציון של תשואות 5 השנים הנטו של המסלולים בקטגוריה (לא משוקלל בנכסים; במספר זוגי, ממוצע שני האמצעיים)",
    "gap": f"פער: חציון הקטגוריה פחות תשואת המסלול, נקודות אחוז לשנה. פער של פחות מ-{BAND:.2f} נ\"א לשנה (פס השוויון של האתר) = 0. "
           "מסלול מעל החציון: פער 0",
    "cost": "עלות הפער: נכסי המסלול בסוף החודש × הפער ÷ 100, מיליוני ש\"ח לשנה. כמה פחות היה צובר בשנה סכום כזה בתשואה שנתית נמוכה מהחציון "
            "בגודל הפער; קירוב ליניארי, בלי ריבית דריבית",
    "icost": "עלות הפער על הכסף החדש: הצבירה נטו של 12 החודשים (בלי נדידה פנימית, כשהיא חיובית) × הפער ÷ 100, מיליוני ש\"ח לשנה. מדד שני: "
             "רק הכסף שנכנס בשנה האחרונה",
    "flow": "צבירה נטו 12M בלי נדידה פנימית (c12): הפקדות − משיכות + ניוד חיצוני משוער של המסלול ב-12 החודשים שמסתיימים בחודש. "
            "הרשות מפרסמת לכל מסלול ניוד נטו בלבד, ולכן החלק הפנימי (בין מסלולי אותה קבוצה באותו מוצר) נאמד: בכל חודש, הנדידה הפנימית של "
            "הקבוצה במוצר (flows.json mig = min(סך ההעברות החיוביות, סך השליליות)) מנוכה מהעברות המסלולים בצד הזה באופן יחסי. הנחת קיזוז מרבי: "
            "הצבירה החיצונית של מסלול מקבל היא לכל היותר זו. סכום המסלולים בקבוצה = הצבירה נטו של הקבוצה במוצר. בפנסיה מקיפה כולל "
            "הפקדות לקרן ברירת מחדל",
    "mig": "סימון נדידה (funds_lib.migration, כמו בדף המסלול): צבירה נטו 12M של המסלול בכיוון הפוך לסך הקבוצה במוצר, לפחות 250 מיליון ו-1% "
           "מנכסיו. במסלול מסומן מוצגת במקום הצבירה של המסלול הצבירה התחרותית של הקבוצה במוצר (flows/<prod>.json: אורגנית + ניוד תחרותי, "
           "12M), ונכנס לרשימה רק כששתיהן חיוביות",
    "head": "הרשימה: מסלולים ברבעון התחתון, עם פער מעל פס השוויון, שהצבירה נטו 12M שלהם חיובית גם כפי שפורסמה (NET_MONTHLY_DEPOSITS) וגם "
            "בלי נדידה פנימית (ובמסלול מסומן נדידה גם הצבירה התחרותית של הקבוצה במוצר). שתי הדרישות יחד: מסלול שהרשות מראה בו יציאה נטו "
            "אינו נכנס בזכות האומדן לבדו. כל השאר הקשר: בטבלה המלאה ובסכומי הרבעון התחתון",
    "series": "הסדרה: סכום עלות הפער של מסלולי הרשימה בכל חודש מ-2016. מוצר נכנס לסדרה מהחודש שבו יש לו גם קטגוריה מדורגת (5 מסלולים "
              "עם 5 שנות תשואה) וגם 12 חודשי תזרים (cov_from); לפני כן הוא חסר בסכום, ולכן העלייה בתחילת הסדרה היא בחלקה כיסוי ולא שינוי. "
              "פוליסות חיסכון וביטוחי מנהלים: ביטוח-נט אינו מפרסם תזרימים, ולכן אינם נכנסים לרשימה לעולם; הם בסכומי הרבעון התחתון",
    "not": "מה לא נמדד: סיכון (מסלול מתחת לחציון עשוי להיות פחות מסוכן; התנודתיות אינה בחשבון), דמי הניהול של חוסך מסוים (הממוצע של "
           "המסלול בלבד; דמי ניהול מהפקדה אינם נכללים), מס, ומה שהחוסך היה מרוויח במסלול אחר בפועל. הסכום אינו הפסד שמומש",
}


def dumps(x):
    return json.dumps(x, ensure_ascii=False, separators=(",", ":"))


def r1(x):
    return None if x is None else round(x + 0.0, 1) + 0.0


def r2(x):
    return None if x is None else round(x + 0.0, 2) + 0.0


def r3(x):
    return None if x is None else round(x + 0.0, 3) + 0.0


def months_between(a, b):
    out, p = [], a
    while p <= b:
        out.append(p)
        p = FL.madd(p, 1)
    return out


def gap_of(med, r5):
    """the shortfall to the median, percent points per year; 0 inside the tie band or above the median"""
    g = med - r5
    return r3(g) if g >= BAND - EPS else 0.0


def ann5(yn):
    """60 monthly net returns (percent) -> annualised percent, rounded to 0.01 (as the site's tables publish it)"""
    c = math.prod(1 + x / 100 for x in yn)
    return r2((c ** (12 / len(yn)) - 1) * 100)


def load(d=D):
    F = json.loads((d / "funds.json").read_text(encoding="utf-8"))
    C = json.loads((d / "funds" / "closed.json").read_text(encoding="utf-8"))
    rows = {f["k"]: f for f in F["funds"] + C["funds"]}
    H = {k: json.loads((d / "funds" / f"{k}.json").read_text(encoding="utf-8")) for k in sorted(rows)}
    G = {}
    for pid, *_ in BF.PRODS:
        fp = d / "flows" / f"{pid}.json"
        if fp.exists():
            G[pid] = json.loads(fp.read_text(encoding="utf-8"))
    return F, rows, H, G


def unit_of(row):
    return ("m:" + row.get("mgr", "")) if row["grp"] == BF.BUCKET else row["grp"]


class Track:
    """one track's history, indexed by month"""
    __slots__ = ("k", "row", "h", "ix", "ira")

    def __init__(self, k, row, h):
        self.k, self.row, self.h = k, row, h
        self.ix = {p: i for i, p in enumerate(h["p"])}
        self.ira = bool(FL.IRA.search(row.get("name", "")))

    def g(self, key, i):
        xs = self.h.get(key)
        return xs[i] if xs is not None else None

    def cat(self, p):
        return BF.cat_at(self.h["ct"], p)

    def r5(self, p):
        i = self.ix.get(p)
        if i is None or i < WIN - 1 or self.h["p"][i - WIN + 1] != FL.madd(p, -(WIN - 1)):
            return None
        yn = self.h["yn"][i - WIN + 1:i + 1]
        return None if any(x is None for x in yn) else ann5(yn)

    def win12(self, p):
        """the 12 indexes ending in p, or None when a month is missing"""
        i = self.ix.get(p)
        if i is None or i < 11 or self.h["p"][i - 11] != FL.madd(p, -11):
            return None
        return range(i - 11, i + 1)


def flow_units(T):
    """(pid, unit, p) -> (P, N): the sums of positive and of negative (absolute) net transfers of the unit's tracks with full flows,
    the same tracks and units as build_flows.py's `mig`"""
    acc = {}
    for t in T.values():
        for i, p in enumerate(t.h["p"]):
            dep, wd, tr = t.g("dep", i), t.g("wd", i), t.g("tr", i)
            if None in (dep, wd, tr):
                continue
            c = BF.cat_at(t.h["ct"], p)
            pid = BF.PROD_OF.get(c.split(" | ")[0]) if c else None
            if pid is None:
                continue
            a = acc.setdefault((pid, unit_of(t.row), p), [[], []])
            if tr > 0:
                a[0].append(tr)
            elif tr < 0:
                a[1].append(-tr)
    return {key: (math.fsum(pos), math.fsum(neg)) for key, (pos, neg) in acc.items()}


def track_flow(t, p, pid, units):
    """12M ending p: (nd12 as published, org12, ext12, c12 = org12 + ext12) or None where a month lacks flows"""
    w = t.win12(p)
    if w is None:
        return None
    nd, org, ext = [], [], []
    for i in w:
        q = t.h["p"][i]
        dep, wd, tr, x = t.g("dep", i), t.g("wd", i), t.g("tr", i), t.g("nd", i)
        if None in (dep, wd, tr):
            return None
        c = BF.cat_at(t.h["ct"], q)
        qid = BF.PROD_OF.get(c.split(" | ")[0]) if c else None
        P, N = units.get((qid, unit_of(t.row), q), (0.0, 0.0))
        M = min(P, N)
        e = tr * (1 - M / P) if tr > 0 else tr * (1 - M / N) if tr < 0 else 0.0
        org.append(dep - wd)
        ext.append(e)
        nd.append(x)
    nd12 = r1(math.fsum(nd)) if all(x is not None for x in nd) else None
    o, e = math.fsum(org), math.fsum(ext)
    return nd12, r1(o), r1(e), r1(o + e)


def group_flow(G, pid, grp, p):
    """the group's competitive net flow in the product over 12M ending p: Σ (org + comp) of flows/<pid>.json, or None"""
    doc = G.get(pid)
    if not doc or not doc.get("flows") or grp == BF.BUCKET:
        return None
    S = doc["groups"].get(grp)
    if not S or p not in doc["months"]:
        return None
    j = doc["months"].index(p)
    if j < 11:
        return None
    org, comp = S.get("org"), S.get("comp")
    if not org or not comp:
        return None
    xs = [(org[i], comp[i]) for i in range(j - 11, j + 1)]
    if any(a is None or b is None for a, b in xs):
        return None
    return r1(math.fsum(a + b for a, b in xs))


COLS = ["k", "name", "grp", "cat", "pid", "a", "r5", "med", "n", "pct", "gap", "cost", "nd12", "org12", "ext12", "c12", "mig", "gfl12",
        "icost", "head"]
MCOLS = ["k", "a", "r5", "pct", "gap", "cost", "nd12", "c12", "mig", "gfl12", "icost"]


def month(p, T, G, units, pub=None):
    """every ranked track of month p, as dicts, and the category medians {cat: [n, median]}. pub: {k: 5Y net} the site publishes for the
    latest month (funds.json net.a5), used there instead of the compounded figure so the page and the track card agree"""
    live = []
    for t in T.values():
        i = t.ix.get(p)
        if i is None:
            continue
        a = t.h["a"][i]
        c = t.cat(p)
        if a is None or c is None:
            continue
        live.append((t, a, c))
    # the migration flag of the month, on the same rows as funds.json (funds_lib.migration)
    mrows, flows = [], {}
    for t, a, c in live:
        prod = c.split(" | ")[0]
        pid = BF.PROD_OF.get(prod)
        fl = track_flow(t, p, pid, units) if pid else None
        flows[t.k] = fl
        mrows.append({"k": t.k, "grp": t.row["grp"], "prod": prod, "assets": a, "nd12": fl[0] if fl else None})
    mig = FL.migration(mrows)
    by = {}
    for t, a, c in live:
        if a <= 0 or t.ira:
            continue
        r = t.r5(p)
        if pub is not None and r is not None:
            r = pub.get(t.k)
        if r is not None:
            by.setdefault(c, []).append((t, a, r))
    out, cats = [], {}
    for c, xs in sorted(by.items()):
        pr = FL.percentiles([(t.k, r) for t, _, r in xs])
        if not pr:
            continue
        med = r3(statistics.median(r for _, _, r in xs))
        cats[c] = [len(xs), med]
        pid = BF.PROD_OF.get(c.split(" | ")[0])
        for t, a, r in xs:
            pct = pr[t.k][0]
            gap = gap_of(med, r)
            fl = flows.get(t.k)
            nd12, org12, ext12, c12 = fl if fl else (None, None, None, None)
            m = t.k in mig
            gfl = group_flow(G, pid, t.row["grp"], p) if m else None
            cost = r1(a * gap / 100)
            icost = r1(c12 * gap / 100) if c12 is not None and c12 > 0 and gap > 0 else None
            head = (pct <= BQ and gap > 0 and nd12 is not None and nd12 > 0 and c12 is not None and c12 > 0
                    and (not m or (gfl is not None and gfl > 0)))
            out.append({"k": t.k, "name": t.row.get("name", t.k), "grp": t.row["grp"], "cat": c, "pid": pid, "a": r1(a), "r5": r, "med": med,
                        "n": len(xs), "pct": pct, "gap": gap, "cost": cost, "nd12": nd12, "org12": org12, "ext12": ext12, "c12": c12,
                        "mig": int(m), "gfl12": gfl, "icost": icost, "head": int(head)})
    out.sort(key=lambda x: (x["cat"], -x["r5"], x["k"]))
    return out, cats


def build(d=D):
    F, rows, H, G = load(d)
    asof = F["asof"]
    T = {k: Track(k, rows[k], H[k]) for k in sorted(H)}
    units = flow_units(T)
    months = months_between(FROM, asof)
    flow_pids = [pid for pid, _, _, has in BF.PRODS if has]
    ser = {f: [] for f in ("n", "a", "cost", "icost", "fl", "n_bq", "a_bq", "cost_bq", "n_rk", "n_cat")}
    byp = {pid: [] for pid, *_ in BF.PRODS}
    cov = []
    files = {}
    latest = None
    pub = {f["k"]: f["net"]["a5"] for f in F["funds"] if (f.get("net") or {}).get("a5") is not None}
    for p in months:
        rs, cats = month(p, T, G, units, pub if p == asof else None)
        hd = [r for r in rs if r["head"]]
        bq = [r for r in rs if r["pct"] <= BQ and r["gap"] > 0]
        ser["n"].append(len(hd))
        ser["a"].append(r1(math.fsum(r["a"] for r in hd)))
        ser["cost"].append(r1(math.fsum(r["cost"] for r in hd)))
        ser["icost"].append(r1(math.fsum(r["icost"] for r in hd)))
        ser["fl"].append(r1(math.fsum(r["c12"] for r in hd)))
        ser["n_bq"].append(len(bq))
        ser["a_bq"].append(r1(math.fsum(r["a"] for r in bq)))
        ser["cost_bq"].append(r1(math.fsum(r["cost"] for r in bq)))
        ser["n_rk"].append(len(rs))
        ser["n_cat"].append(len(cats))
        for pid in byp:
            byp[pid].append(r1(math.fsum(r["cost"] for r in hd if r["pid"] == pid)))
        cov.append([pid for pid in flow_pids if any(r["pid"] == pid and r["c12"] is not None for r in rs)])
        files[f"under/m/{p}.json"] = {"v": V, "p": p, "cols": MCOLS, "cats": cats,
                                      "rows": [[r[c] for c in MCOLS] for r in sorted(hd, key=lambda r: -r["cost"])]}
        if p == asof:
            latest = rs
    full = next((p for p, c in zip(months, cov) if set(c) == set(flow_pids)), None)
    cov_from = {pid: next((p for p, c in zip(months, cov) if pid in c), None) for pid in flow_pids}
    lp = latest or []
    hd = sorted((r for r in lp if r["head"]), key=lambda r: -r["cost"])
    files["under.json"] = {
        "v": V, "asof": asof, "src": SRC, "from": FROM, "win": WIN, "band_bp": TIE_BP, "bq": BQ, "saver_bp": SAVER_BP, "method": METHOD,
        "months": months, "series": ser, "byp": {pid: xs for pid, xs in byp.items() if any(xs)},
        "prods": {pid: label for pid, _, label, _ in BF.PRODS}, "flow_prods": flow_pids, "cov": cov, "cov_from": cov_from, "full_from": full,
        "cols": COLS, "rows": [[r[c] for c in COLS] for r in sorted(lp, key=lambda r: (-r["head"], -r["cost"], r["k"]))],
        "head_n": len(hd), "files": {"month": "under/m/<yyyymm>.json"},
    }
    return files


# ------------------------------------------------------------------------------------------------------------------------------ rules
def rules(files, d=D):
    """the identities the files must keep: [] when they hold"""
    bad = []
    U = files["under.json"]
    for key in ("what", "past", "why5", "net", "cat", "pct", "med", "gap", "cost", "icost", "flow", "mig", "head", "series", "not"):
        if not U["method"].get(key):
            bad.append(f"method string missing: {key}")
    S = U["series"]
    for j, p in enumerate(U["months"]):
        m = files[f"under/m/{p}.json"]
        rows = [dict(zip(m["cols"], r)) for r in m["rows"]]
        if len(rows) != S["n"][j]:
            bad.append(f"{p}: n {S['n'][j]} vs {len(rows)} rows")
        if abs(math.fsum(r["cost"] for r in rows) - S["cost"][j]) > 0.051:
            bad.append(f"{p}: cost ≠ Σ rows")
        for r in rows:
            if not (r["pct"] <= BQ and r["gap"] >= BAND - EPS and r["c12"] > 0 and r["nd12"] > 0):
                bad.append(f"{p} {r['k']}: a headline row outside the rule")
            if abs(r["cost"] - r["a"] * r["gap"] / 100) > 0.051:
                bad.append(f"{p} {r['k']}: cost ≠ a × gap")
        if S["cost"][j] > S["cost_bq"][j] + 0.051:
            bad.append(f"{p}: headline cost above the bottom-quartile total")
    for r in U["rows"]:
        x = dict(zip(U["cols"], r))
        if x["gap"] and x["gap"] < BAND - EPS:
            bad.append(f"latest {x['k']}: a gap inside the band")
        if x["gap"] > 0 and abs(x["med"] - x["r5"] - x["gap"]) > 0.0011:
            bad.append(f"latest {x['k']}: gap ≠ med − r5")
    return bad


def parity(files, d=D):
    """the latest month against what the site already publishes: [] when it agrees.
    5Y net within 0.01 of funds.json net.a5; percentile = pn.a5; migration flag = funds.json mig; Σ c12 of a group = its flows net12"""
    bad = []
    F = json.loads((d / "funds.json").read_text(encoding="utf-8"))
    U = files["under.json"]
    by = {f["k"]: f for f in F["funds"]}
    rows = [dict(zip(U["cols"], r)) for r in U["rows"]]
    for x in rows:
        f = by.get(x["k"])
        if f is None:
            bad.append(f"{x['k']}: not a live track")
            continue
        a5 = (f.get("net") or {}).get("a5")
        if a5 is None or abs(a5 - x["r5"]) > 0.0101:
            bad.append(f"{x['k']}: r5 {x['r5']} vs net.a5 {a5}")
        pn = (f.get("pn") or {}).get("a5")
        if pn != x["pct"]:
            bad.append(f"{x['k']}: pct {x['pct']} vs pn.a5 {pn}")
        if bool(f.get("mig")) != bool(x["mig"]):
            bad.append(f"{x['k']}: mig {x['mig']} vs funds.json {f.get('mig')}")
    return bad


def main(argv):
    check = "--check" in argv
    files = build()
    blobs = {p: dumps(doc).encode("utf-8") for p, doc in files.items()}
    bad = rules(files)
    U = files["under.json"]
    S = U["series"]
    summary = (f"{len(U['months'])} months ({U['months'][0]}-{U['asof']}), full flow coverage from {U['full_from']}; latest: {S['n'][-1]} "
               f"headline tracks, ₪{S['a'][-1] / 1000:.1f}bn AUM, cost ₪{S['cost'][-1]:.1f}m/yr (inflows ₪{S['icost'][-1]:.1f}m/yr); "
               f"{S['n_rk'][-1]} ranked tracks in {S['n_cat'][-1]} categories")
    if check:
        diff = [p for p, b in blobs.items() if not (D / p).exists() or (D / p).read_bytes() != b]
        mdir = D / "under" / "m"
        stale = [f"under/m/{f.name}" for f in sorted(mdir.glob("*.json")) if f"under/m/{f.name}" not in blobs] if mdir.exists() else []
        for p in diff[:5]:
            print(f"  differs from a rebuild: {p}")
        for p in stale[:5]:
            print(f"  stale file: {p}")
        for b in bad[:8]:
            print(f"  rule: {b}")
        ok = not diff and not stale and not bad
        print(("under ok: " if ok else f"under FAILED ({len(diff)} differ, {len(stale)} stale, {len(bad)} rule): ") + summary)
        return 0 if ok else 1
    (D / "under" / "m").mkdir(parents=True, exist_ok=True)
    for f in (D / "under" / "m").glob("*.json"):
        if f"under/m/{f.name}" not in blobs:
            f.unlink()
    for p, b in blobs.items():
        q = D / p
        if not q.exists() or q.read_bytes() != b:
            q.write_bytes(b)
    for b in bad[:20]:
        print("  rule: " + b)
    print(summary + f"; {sum(len(b) for b in blobs.values()) // 1024} KB")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
