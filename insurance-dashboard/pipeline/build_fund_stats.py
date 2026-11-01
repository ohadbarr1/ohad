"""Funds F2 "tools and time": the precomputed analytics of the savings tracks, from the files build_funds.py publishes (standard library;
it reads only committed files, so it rebuilds anywhere, CI included).

python3 pipeline/build_fund_stats.py            write the files below
python3 pipeline/build_fund_stats.py --check    rebuild in memory: byte-equal to the files on disk and the rules hold (gate `fund_stats`)

  -> web/public/data/funds/stats/index.json        the categories: {slug, cat, prod, track, n, rank}
  -> web/public/data/funds/stats/<slug>.json       risk panel per live track of a category, 36 months ending at asof, and the category median
  -> web/public/data/funds/rank/<slug>.json        percentile rank in category over time (12M and 3Y annualised; net and gross), point-in-time
  -> web/public/data/funds/persist.json            do winners stay winners: quartile transition matrices per product, 12M→12M and 36M→36M
  -> web/public/data/funds/default.json            the default (selected) pension funds: tenders, winners, fees (data/regulation/default_funds.json)
                                                   and each winner's deposits / assets / net return before, during and after its period
  -> web/public/data/funds/trackers.json           the index-tracker lab: tracks grouped by index, tracking difference vs the group median
  -> web/public/data/funds/glide.json              age tracks (עד 50 / 50-60 / 60 ומעלה) per manager: equity share over time, returns, the gaps

Slug of a category (cat.json key, "prod | track"): "c" + the first 10 hex digits of sha1(key, UTF-8); funds/stats/index.json maps both ways,
so a reader never recomputes it. Inputs: funds.json, funds/closed.json, funds/cat.json, funds/<k>.json (monthly y, yn, a, st, fo, dep, nd, tr,
ct), macro/boi_curve.json (the risk-free rate), data/regulation/default_funds.json. Units: returns and fees percent, assets and flows NIS
millions, months yyyymm.
"""
import hashlib
import json
import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import funds_lib as FL  # noqa: E402
import fund_stats_lib as S  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / "web" / "public" / "data"
FD = D / "funds"
DEF = ROOT / "data" / "regulation" / "default_funds.json"
V = 1
WIN = 36
RANK_FROM = 201201       # the rank files start here (pensia-net starts 10/11; earlier gemel months stay in the persistence pool)
MIN_PEERS = FL.MIN_PEERS  # percentile ranks: as funds.json pr / pn
PERSIST_MIN = 8           # a category-month enters the persistence pool with at least 8 ranked tracks
BOOT = 2000
AGE = ("עד 50", "50-60", "60 ומעלה")
GLIDE_PRODS = ("פנסיה מקיפה", "גמל")
GLIDE_FROM = 201601       # the age tracks start in 01/16 (the default-track reform)
PENSION = "פנסיה מקיפה"
# self-directed accounts (personal management, IRA): the regulator publishes a near-zero return for them, so they sit at the bottom of every
# category; the questions already leave them out of peer sets (questions/funds.py members). Here: flagged, out of medians and persistence
SELF = re.compile(r"בניהול אישי|IRA")
TRACKERS = (("sp500", "עוקב מדד S&P 500", "S&P 500"), ("eq_idx", "עוקב מדדי מניות", "מדדי מניות"),
            ("bond_idx", 'עוקב מדדי אג"ח', 'מדדי אג"ח'), ("flex_idx", "עוקב מדדים, גמיש", "עוקב מדדים, גמיש"))
SRC = "הרשות לשוק ההון: גמל-נט, פנסיה-נט, ביטוח-נט (data.gov.il), כפי שהאתר מפרסם אותם: funds.json, funds/<k>.json, funds/cat.json"

RF_METHOD = ("ריבית חסרת סיכון: תשואת אג\"ח ממשלתי שקלי אפס-קופון לשנה, ממוצע חודשי (בנק ישראל, ZCM, ZC_TSB_ZND_01Y_MA, macro/boi_curve.json), "
             "מומרת לחודש: (1 + תשואה)^(1/12) − 1; חודש שאין לו נתון: הנתון האחרון שפורסם (מסומן rf.filled)")
STATS_METHOD = {
    "window": "36 החודשים שמסתיימים ב-asof; מסלול נכנס למדדי ה-36 רק עם 36 תשואות חודשיות רצופות",
    "basis": "net = התשואה החודשית נטו, אומדן (yn: ברוטו פחות דמי הניהול מהצבירה ÷ 12, funds.json net_method), כשהיא קיימת בכל 36 החודשים; "
             "אחרת gross, כפי שפורסמה; מדד הקטגוריה באותו בסיס (funds/cat.json yn או y)",
    "vol36": "סטיית תקן מדגמית של 36 התשואות החודשיות × √12, אחוזים לשנה",
    "dd_max": "הירידה העמוקה ביותר מהשיא המצטבר בתוך החלון (שווי מתחיל ב-1), אחוזים, ≤ 0; dd_cur = הירידה מהשיא בחודש האחרון; dd_len = חודשים מהשיא "
              "לשפל; rec_months = חודשים מהשפל עד שהשווי חזר לשיא (null = טרם חזר); dd_peak / dd_trough = חודשי השיא והשפל",
    "dd_max_all": "אותה ירידה מקסימלית על כל הרצף הרציף של תשואות שמסתיים ב-asof (dd_all_from = החודש הראשון שלו)",
    "sharpe36": "ממוצע התשואה החודשית העודפת על הריבית חסרת הסיכון ÷ סטיית התקן המדגמית שלה × √12",
    "sortino36": "ממוצע התשואה העודפת ÷ סטיית החסר × √12; סטיית החסר = √(Σ min(0, עודפת)² ÷ 36), יעד = הריבית חסרת הסיכון",
    "beta36_vs_cat": "שיפוע OLS של התשואה החודשית על תשואת הקטגוריה (ממוצע משוקלל בנכסים של חברי הקטגוריה באותו חודש, funds/cat.json, כולל "
                     "המסלול עצמו), te36_vs_cat = סטיית התקן של ההפרש × √12",
    "up_cap36": "ממוצע גאומטרי של תשואת המסלול בחודשים שבהם הקטגוריה עלתה ÷ של הקטגוריה באותם חודשים × 100 (down_cap36: בחודשים שירדה)",
    "worst_m": "התשואה החודשית הנמוכה / הגבוהה (best_m) בחלון; pct_pos_m = אחוז החודשים עם תשואה חיובית; a36 = התשואה הממוצעת השנתית בחלון",
    "cat_median": "חציון כל מדד על המסלולים הפעילים בקטגוריה שיש להם ערך (n = מספרם), בלי חשבונות בניהול אישי ו-IRA (self_dir: הרשות מפרסמת להם "
                  "תשואה קרובה לאפס); sector = מסלול שפתוח רק לאוכלוסייה מסוימת",
}
RANK_METHOD = ("אחוזון בקטגוריה בכל חודש: 100 × (מסלולים שתשואתם נמוכה + חצי מהשווים) ÷ (n − 1), מעוגל (funds_lib.percentiles, כמו pr ב-funds.json); "
               "y12 = ריבית דריבית של 12 התשואות החודשיות שמסתיימות בחודש, a3 = ממוצע שנתי של 36, מעוגלות ל-0.01 לפני הדירוג; "
               f"חברי הקטגוריה כפי שהיו באותו חודש (ct), כולל מסלולים שנסגרו בזמן שפעלו, עם נכסים חיוביים; רק חודשים עם {MIN_PEERS} מסלולים לפחות. "
               "net = מהתשואות נטו (אומדן); gross = כפי שפורסמו. הדירוג בחודש האחרון יכול להיבדל ב-1 מ-pr / pn ב-funds.json: שם 12 החודשים מחושבים "
               "מהתשואות לפני עיגול")
PERSIST_METHOD = ("בכל חודש התחלה t ובכל קטגוריה (מוצר | מסלול, החברים כפי שהיו ב-t, עם נכסים, לפחות 8): רבעון לפי התשואה בחלון שמסתיים ב-t "
                  "(12 או 36 חודשים, ריבית דריבית), 1 = הרבע העליון; רבעון קדימה לפי התשואה ב-12 / 36 החודשים שאחרי t, בין המסלולים מאותה קבוצה "
                  "שדיווחו בכל חודשי החלון הבא (בלי חשבונות בניהול אישי ו-IRA); מסלול שהפסיק לדווח לפני סוף החלון הבא = \"נסגר\"; מסלול שחסרו לו חודשים בלי שנסגר = gap (לא נספר). "
                  "המטריצות מצטברות על כל חודשי ההתחלה (חלונות חופפים). stay = נשארו ברבע העליון ÷ כל מי שהתחיל בו (נסגרו במכנה); stay_surv = "
                  "÷ מי ששרד; מטבע הוגן: 25% מהשורדים. ci90: bootstrap מעגלי בבלוקים של חודשי התחלה רצופים באורך החלון (2,000 חזרות, אחוזונים 5 ו-95), "
                  "שמכבד את החפיפה; eff = חודשי ההתחלה ÷ אורך החלון (מספר החלונות הבלתי חופפים); thin = פחות משלושה: אין bootstrap (ci90 = null), רק Wilson; wilson90: רווח Wilson על חודשי התחלה שאינם חופפים (כל 12 / 36 חודשים, אחורה מההתחלה האחרונה); rho = ממוצע "
                  "מתאם הדירוגים (Spearman) בין החלון לחלון הבא, בין השורדים, על פני הקבוצות")
DEFAULT_METHOD = ("לכל הליך: הקרנות שנבחרו מול שאר קרנות הפנסיה המקיפות (פנסיה-נט, מסלולים שהקטגוריה שלהם באותו חודש היא פנסיה מקיפה). pre = 12 החודשים "
                  "שלפני תחילת התקופה; post = 12 החודשים הראשונים שלה (עד asof); aft = 12 החודשים שאחרי סופה, כשפורסמו. dep / nd / tr = סכום ההפקדות / "
                  "ההפקדות נטו / ההעברות בחלון (מיליוני ש\"ח); share = ההפקדות ÷ כל ההפקדות לפנסיה המקיפה × 100; a0 = נכסים בחודש שלפני החלון, a1 = בחודש "
                  "האחרון שלו; ret = התשואה נטו (אומדן) המצטברת בחלון, ממוצע משוקלל בנכסים של מסלולי הקרן בכל חודש, רק כשהקרן דיווחה בכל 12 החודשים. "
                  "resid = שינוי הנכסים שההפקדות נטו והתשואה אינן מסבירות (Σ חודשי: נכסים − נכסים קודמים − הפקדות נטו − נכסים קודמים × תשואה נטו): "
                  "סכום גדול מסמן מיזוג קרן או העברה שלא נרשמה כהפקדה, והשוואת ההפקדות לפני ואחרי צריכה להתחשב בו. "
                  "שיוך הזוכה לקרן בפנסיה-נט (pid) הוא של האתר, לפי שם הקרן (map = inferred)")
TRACKER_METHOD = ("מסלולים פעילים שהקטגוריה שלהם מחקה מדד, בקבוצה לפי המדד (ללא חלוקה למוצר). med = חציון התשואה ברוטו של הקבוצה; td = ברוטו פחות החציון "
                  "(הפער בביצוע); tdn = נטו (אומדן) פחות חציון הברוטו: מה שהעטיפה עולה לחוסך מעבר לתשואת הקבוצה. y12: ריבית דריבית של 12 חודשים; a3 / a5: "
                  "ממוצע שנתי כפי שפורסם. fx = חשיפה למט\"ח באחוזי נכסים (הבדלי גידור מסבירים חלק מהפער). same_index: רק בקבוצת S&P 500 כל המסלולים "
                  "עוקבים אחרי אותו מדד; בשאר הקבוצות המדדים שונים (ת\"א 35, עולמי, אג\"ח ממשלתי או קונצרני), וה-td משקף גם את בחירת המדד; "
                  "sector = מסלול שפתוח רק לאוכלוסייה מסוימת")
GLIDE_METHOD = ("לכל מנהל ומוצר: מסלול הגיל הפעיל הגדול בנכסיו בכל קבוצת גיל (עד 50, 50-60, 60 ומעלה). st = חשיפה למניות באחוזי נכסים, fo = חשיפה לחו\"ל, "
                "חודשיים מ-01/16; net / gross = תשואות 12 חודשים, ממוצע שנתי 3 ו-5 שנים (funds.json); gap = עד 50 פחות 60 ומעלה (נקודות אחוז)")


# ------------------------------------------------------------------------------------------------ inputs
def jload(p):
    return json.loads(p.read_text(encoding="utf-8"))


def dumps(x):
    return json.dumps(x, ensure_ascii=False, separators=(",", ":"))


def slug(cat):
    return "c" + hashlib.sha1(cat.encode("utf-8")).hexdigest()[:10]


def r(x, nd=2):
    return None if x is None else round(x, nd)


class Hist:
    __slots__ = ("k", "p", "ix", "y", "yn", "a", "st", "fo", "dep", "nd", "tr", "ct", "row", "_g")

    def __init__(self, k, h, row):
        self.k, self.row = k, row
        self.p = h["p"]
        self.ix = {FL.mi(p): i for i, p in enumerate(self.p)}
        n = len(self.p)
        self.y, self.yn, self.a = h["y"], h.get("yn") or [None] * n, h.get("a") or [None] * n
        self.st, self.fo = h.get("st") or [None] * n, h.get("fo") or [None] * n
        self.dep, self.nd, self.tr = h.get("dep"), h.get("nd"), h.get("tr")
        self.ct = h["ct"]
        self._g = {}

    def cat_at(self, T):
        c = None
        for p, x in self.ct:
            if p > T:
                break
            c = x
        return c

    def at(self, T):
        return self.ix.get(FL.mi(T))

    def run(self, T, n, net):
        """the n monthly returns ending at T (consecutive months), or None"""
        t = FL.mi(T)
        s = self.yn if net else self.y
        out = []
        for j in range(n - 1, -1, -1):
            i = self.ix.get(t - j)
            if i is None or s[i] is None:
                return None
            out.append(s[i])
        return out

    def g12(self, T, net):
        """wealth multiple of the 12 months ending at T (cached)"""
        key = (T, net)
        if key not in self._g:
            self._g[key] = S.growth(self.run(T, 12, net) or [None])
        return self._g[key]

    def g36(self, T, net):
        a, b, c = self.g12(FL.madd(T, -24), net), self.g12(FL.madd(T, -12), net), self.g12(T, net)
        return None if a is None or b is None or c is None else a * b * c


def load_all():
    F = jload(D / "funds.json")
    C = jload(FD / "closed.json")
    cats = jload(FD / "cat.json")
    curve = jload(D / "macro" / "boi_curve.json")
    rows = {f["k"]: f for f in C["funds"]}
    rows.update({f["k"]: f for f in F["funds"]})
    H = {k: Hist(k, jload(FD / f"{k}.json"), rows[k]) for k in sorted(rows)}
    return F, C, cats, curve, H


def rf_series(curve, asof):
    """{yyyymm: monthly rf percent}, carried forward to asof; and the months that were filled"""
    ys = curve["nominal"]["1"]
    out, filled = {}, []
    for m, y in zip(curve["months"], ys):
        if y is not None:
            out[int(m.replace("-", ""))] = S.monthly_rf(y)
    if out:
        last = max(out)
        T = FL.madd(last, 1)
        while T <= asof:
            out[T] = out[last]
            filled.append(T)
            T = FL.madd(T, 1)
    return out, filled


# ------------------------------------------------------------------------------------------------ 1. risk panel per category
KEYS = ("vol36", "dd_max", "dd_cur", "dd_len", "rec_months", "sharpe36", "sortino36", "beta36_vs_cat", "te36_vs_cat", "up_cap36", "down_cap36",
        "worst_m", "best_m", "pct_pos_m", "a36", "dd_max_all")


def track_stats(h, asof, rf, cat_rec):
    W = [FL.madd(asof, -j) for j in range(WIN - 1, -1, -1)]
    net = h.run(asof, WIN, True)
    gross = h.run(asof, WIN, False)
    basis = "net" if net is not None else "gross"
    xs = net if net is not None else gross
    o = {"k": h.k, "name": h.row["name"], "mgr": h.row["mgr"], "grp": h.row["grp"], "n_months": sum(1 for x in h.y if x is not None), "basis": basis}
    if SELF.search(h.row["name"]):
        o["self_dir"] = True
    if h.row.get("closed"):
        o["sector"] = True
    # the longest consecutive run of returns ending at asof, on the same basis
    s = h.yn if basis == "net" else h.y
    t, run = FL.mi(asof), []
    while True:
        i = h.ix.get(t)
        if i is None or s[i] is None:
            break
        run.append(s[i])
        t -= 1
    run.reverse()
    if run:
        dda = S.drawdown(run)
        o["dd_max_all"], o["dd_all_from"] = r(dda["max"]), FL.pm(t + 1)
    if xs is None:
        o["basis"] = basis if run else None
        return o
    rfx = [rf.get(m) for m in W]
    dd = S.drawdown(xs)
    o.update({"vol36": r(S.vol_ann(xs)), "dd_max": r(dd["max"]), "dd_cur": r(dd["cur"]), "dd_len": dd["len"], "rec_months": dd["rec"],
              "worst_m": r(min(xs)), "best_m": r(max(xs)), "pct_pos_m": r(100 * sum(1 for x in xs if x > 0) / WIN, 1),
              "a36": r(S.annualise_growth(S.growth(xs), WIN))})
    if dd["trough"] >= 0:
        o["dd_peak"] = FL.madd(W[0], -1) if dd["peak"] < 0 else W[dd["peak"]]
        o["dd_trough"] = W[dd["trough"]]
    if all(x is not None for x in rfx):
        o["sharpe36"], o["sortino36"] = r(S.sharpe_ann(xs, rfx)), r(S.sortino_ann(xs, rfx))
    if cat_rec:
        cy = dict(zip(cat_rec["p"], cat_rec["yn" if basis == "net" else "y"]))
        bs = [cy.get(m) for m in W]
        if all(b is not None for b in bs):
            o.update({"beta36_vs_cat": r(S.beta(xs, bs), 3), "te36_vs_cat": r(S.te_ann(xs, bs)), "up_cap36": r(S.capture(xs, bs, True), 1),
                      "down_cap36": r(S.capture(xs, bs, False), 1)})
    return o


def build_stats(F, cats, H, rf, rf_filled, asof):
    by = {}
    for f in F["funds"]:
        by.setdefault(f["prod"] + " | " + f["track"], []).append(f["k"])
    rfm = {"src": "בנק ישראל, עקום אפס-קופון ממשלתי (ZCM): ZC_TSB_ZND_01Y_MA, ממוצע חודשי", "url": "macro/boi_curve.json", "method": RF_METHOD,
           "series": "ZC_TSB_ZND_01Y_MA"}
    W = [FL.madd(asof, -j) for j in range(WIN - 1, -1, -1)]
    if all(rf.get(m) is not None for m in W):
        rfm["a36"] = r(S.annualise_growth(S.growth([rf[m] for m in W]), WIN), 3)
    if rf_filled:
        rfm["filled"] = rf_filled
    out = {}
    for c in sorted(by):
        prod, track = c.split(" | ", 1)
        ts = [track_stats(H[k], asof, rf, cats.get(c)) for k in sorted(by[c])]
        ts.sort(key=lambda o: (-(H[o["k"]].row.get("assets") or 0), o["k"]))
        med = {}
        for key in KEYS:
            v = S.median([o.get(key) for o in ts if not o.get("self_dir")])
            if v is not None:
                med[key] = r(v, 3 if key == "beta36_vs_cat" else 1 if key in ("up_cap36", "down_cap36", "pct_pos_m", "dd_len", "rec_months") else 2)
        med["n"] = sum(1 for o in ts if o.get("vol36") is not None and not o.get("self_dir"))
        out[c] = {"v": V, "cat": c, "label": track, "prod": prod, "slug": slug(c), "asof": asof, "win": [W[0], W[-1]], "rf": rfm, "src": SRC,
                  "method": STATS_METHOD, "tracks": ts, "cat_median": med}
    return out


# ------------------------------------------------------------------------------------------------ 2. ranks over time and 3. persistence
def months_between(a, b):
    out, T = [], a
    while T <= b:
        out.append(T)
        T = FL.madd(T, 1)
    return out


def panel(H, first, asof):
    """{T: {cat: {(metric, basis): [(k, value)]}}} for every month: members point-in-time, assets > 0"""
    P = {}
    for h in H.values():
        for i, T in enumerate(h.p):
            if T < first or not (h.a[i] or 0) > 0:
                continue
            c = h.cat_at(T)
            if c is None:
                continue
            slot = P.setdefault(T, {}).setdefault(c, {})
            for net in (True, False):
                b = "net" if net else "gross"
                g = h.g12(T, net)
                if g is not None:
                    slot.setdefault(("y12", b), []).append((h.k, round((g - 1) * 100, 2)))
                g3 = h.g36(T, net)
                if g3 is not None:
                    v = S.annualise_growth(g3, 36)
                    if v is not None:
                        slot.setdefault(("a3", b), []).append((h.k, round(v, 2)))
    return P


SETS = (("y12", "net"), ("a3", "net"), ("y12", "gross"), ("a3", "gross"))


def build_ranks(P, asof):
    by = {}
    for T in sorted(P):
        if T < RANK_FROM:
            continue
        for c, slot in P[T].items():
            for key in SETS:
                pr = FL.percentiles(slot.get(key, []), MIN_PEERS)
                if pr:
                    by.setdefault(c, {}).setdefault(key, {})[T] = pr
    out = {}
    for c in sorted(by):
        allT = sorted({T for d in by[c].values() for T in d})
        months = months_between(allT[0], allT[-1])
        sets = []
        for metric, basis in SETS:
            d = by[c].get((metric, basis), {})
            ks = sorted({k for pr in d.values() for k in pr})
            tracks = {k: [d[T][k][0] if T in d and k in d[T] else None for T in months] for k in ks}
            n = [next(iter(d[T].values()))[1] if T in d else 0 for T in months]
            sets.append({"metric": metric, "basis": basis, "tracks": tracks, "n": n})
        prod, track = c.split(" | ", 1)
        top = sets[0]
        out[c] = {"v": V, "cat": c, "label": track, "prod": prod, "slug": slug(c), "asof": asof, "months": months, "metric": top["metric"],
                  "basis": top["basis"], "tracks": top["tracks"], "n": top["n"], "sets": sets, "method": RANK_METHOD, "src": SRC}
    return out


def build_persist(H, P, asof):
    """quartile transitions per product family x window x basis, pooled over start months"""
    res = []
    for wname, w in (("12", 12), ("36", 36)):
        for basis in ("net", "gross"):
            net = basis == "net"
            fams = {}
            for t in sorted(P):
                end = FL.madd(t, w)
                if end > asof:
                    continue
                for c, slot in P[t].items():
                    past = [(k, v) for k, v in (slot.get((("y12" if w == 12 else "a3"), basis)) or []) if not SELF.search(H[k].row["name"])]
                    if len(past) < PERSIST_MIN:
                        continue
                    q0 = S.quartiles(past)
                    fwd, gone, gap = [], [], []
                    for k, _ in past:
                        h = H[k]
                        g = h.g12(end, net) if w == 12 else h.g36(end, net)
                        if g is not None:
                            fwd.append((k, g))
                        elif h.p[-1] < end:
                            gone.append(k)
                        else:
                            gap.append(k)
                    if len(fwd) < 4:
                        continue
                    q1 = S.quartiles(fwd)
                    fam = c.split(" | ", 1)[0]
                    for fk in (fam, "הכל"):
                        A = fams.setdefault(fk, {"m": [[0] * 5 for _ in range(4)], "gap": 0, "units": {}, "rho": [], "cats": set(), "t": []})
                        for k in q0:
                            if k in q1:
                                A["m"][q0[k] - 1][q1[k] - 1] += 1
                            elif k in gone:
                                A["m"][q0[k] - 1][4] += 1
                        A["gap"] += len(gap)
                        gs = set(gap)
                        tops = [k for k in q0 if q0[k] == 1 and k not in gs]
                        u = A["units"].setdefault(t, [0, 0, 0, 0])  # stay, top, stay among survivors, top survivors
                        u[0] += sum(1 for k in tops if q1.get(k) == 1)
                        u[1] += len(tops)
                        u[2] += sum(1 for k in tops if q1.get(k) == 1)
                        u[3] += sum(1 for k in tops if k in q1)
                        pv = dict(past)
                        rho = S.spearman([pv[k] for k, _ in fwd], [g for _, g in fwd])
                        if rho is not None:
                            A["rho"].append(rho)
                        A["cats"].add(c)
                        A["t"].append(t)
            for fk in sorted(fams, key=lambda x: (x != "הכל", x)):
                A = fams[fk]
                m = A["m"]
                ts = sorted(A["units"])
                units = [A["units"][t] for t in ts]
                top = sum(u[1] for u in units)
                stay = sum(u[0] for u in units)
                topS = sum(u[3] for u in units)
                if top < 20:
                    continue
                seed = int(hashlib.sha1(f"{fk}|{wname}|{basis}".encode("utf-8")).hexdigest()[:12], 16)
                thin = len(ts) < 3 * w  # fewer than three non-overlapping windows: the bootstrap cannot see the overlap; Wilson only
                ci = (None, None) if thin else S.block_bootstrap([(u[0], u[1]) for u in units], w, BOOT, seed)
                ciS = (None, None) if thin else S.block_bootstrap([(u[2], u[3]) for u in units], w, BOOT, seed + 1)
                # non-overlapping start months: every w months back from the last start
                last = ts[-1]
                pick, T = set(), last
                while T >= ts[0]:
                    pick.add(T)
                    T = FL.madd(T, -w)
                nk = sum(A["units"][t][2] for t in ts if t in pick)
                nn = sum(A["units"][t][3] for t in ts if t in pick)
                wl = S.wilson(nk, nn)
                rows = [{"q": q + 1, "n": sum(m[q]), "to": m[q][:4], "gone": m[q][4],
                         "pct": [r(x / sum(m[q]) * 100, 1) if sum(m[q]) else None for x in m[q]]} for q in range(4)]
                res.append({"fam": fk, "win": wname, "basis": basis, "from": ts[0], "to": ts[-1], "starts": len(ts), "cats": len(A["cats"]),
                            "rows": rows, "gap": A["gap"], "top": top, "stay": stay, "stay_pct": r(stay / top * 100, 1),
                            "top_surv": topS, "stay_surv_pct": r(stay / topS * 100, 1) if topS else None, "coin": 25.0,
                            "gone_pct": r(m[0][4] / top * 100, 1), "gone_q4_pct": r(m[3][4] / sum(m[3]) * 100, 1) if sum(m[3]) else None,
                            "ci90": [r(ci[0], 1), r(ci[1], 1)], "ci90_surv": [r(ciS[0], 1), r(ciS[1], 1)], "eff": r(len(ts) / w, 1), "thin": thin,
                            "wilson90": {"k": nk, "n": nn, "starts": len([t for t in ts if t in pick]), "lo": r(wl[0], 1), "hi": r(wl[1], 1),
                                         "pct": r(nk / nn * 100, 1) if nn else None},
                            "rho": r(S.mean(A["rho"]), 3) if A["rho"] else None, "rho_n": len(A["rho"])})
    return {"v": V, "asof": asof, "src": SRC, "method": PERSIST_METHOD, "cols": ["Q1", "Q2", "Q3", "Q4", "נסגר"],
            "note": "Q1 = הרבע העליון. כולל מסלולים שנסגרו (survivorship): מי שנסגר בחלון הבא נספר בעמודה נסגר", "rows": res}


# ------------------------------------------------------------------------------------------------ 4. default funds
def ym_of(d):
    return int(d[:4]) * 100 + int(d[5:7])


def build_default(H, asof):
    reg = jload(DEF)
    srcs = {s["id"]: s for s in reg["sources"]}
    pen = {}  # T -> [(hist, i)] comprehensive-pension tracks reporting in month T
    for h in H.values():
        if h.k[0] != "p":
            continue
        for i, T in enumerate(h.p):
            if h.cat_at(T) and h.cat_at(T).startswith(PENSION + " | "):
                pen.setdefault(T, []).append((h, i))

    def window(pids, a, b, rest=False):
        """sums over months a..b of the funds in pids (or all others when rest)"""
        ms = [T for T in months_between(a, b) if T <= asof]
        if not ms:
            return None

        def mine(h):
            pid = h.row.get("pid")
            return (pid not in pids) if rest else (pid in pids)
        dep, nd, tr, alld, rets, seen = [], [], [], [], [], 0
        for T in ms:
            xs = pen.get(T, [])
            alld.extend(h.dep[i] for h, i in xs if h.dep and h.dep[i] is not None)
            ys = [(h, i) for h, i in xs if mine(h)]
            if ys:
                seen += 1
            dep.extend(h.dep[i] for h, i in ys if h.dep and h.dep[i] is not None)
            nd.extend(h.nd[i] for h, i in ys if h.nd and h.nd[i] is not None)
            tr.extend(h.tr[i] for h, i in ys if h.tr and h.tr[i] is not None)
            wa = [(h.a[i], h.yn[i]) for h, i in ys if (h.a[i] or 0) > 0 and h.yn[i] is not None]
            W_ = math.fsum(a_ for a_, _ in wa)
            rets.append(math.fsum(a_ * y for a_, y in wa) / W_ if W_ else None)

        def assets(T):
            return math.fsum(h.a[i] or 0 for h, i in pen.get(T, []) if mine(h))
        tot = math.fsum(alld)
        o = {"from": ms[0], "to": ms[-1], "m": seen, "a0": r(assets(FL.madd(ms[0], -1)), 1), "a1": r(assets(ms[-1]), 1),
             "dep": r(math.fsum(dep), 1), "nd": r(math.fsum(nd), 1), "tr": r(math.fsum(tr), 1),
             "share": r(math.fsum(dep) / tot * 100, 2) if tot else None}
        if not seen:
            return None
        if len(ms) == 12 and seen == 12 and all(x is not None for x in rets):
            o["ret"] = r(S.compound(rets))
        if seen == len(ms) and all(x is not None for x in rets):
            # the asset change that net deposits and the month's return do not explain (a fund merged in, a reclassification)
            gain = math.fsum(assets(FL.madd(T, -1)) * x / 100 for T, x in zip(ms, rets))
            res = assets(ms[-1]) - assets(FL.madd(ms[0], -1)) - math.fsum(nd) - gain
            o["resid"] = r(res, 1)
        return o

    tenders, funds = [], []
    for t in reg["tenders"]:
        fr, to = ym_of(t["from"]), ym_of(t["to"])
        wins = {"pre": (FL.madd(fr, -12), FL.madd(fr, -1)), "post": (fr, min(FL.madd(fr, 11), to)), "aft": (FL.madd(to, 1), FL.madd(to, 12))}
        fees = {(w.get("fee"), w.get("depfee")) for w in t["winners"]}
        row = {"id": t["id"], "label": t["label"], "announced": t["announced"], "from": t["from"], "to": t["to"],
               "fee": t.get("fee", next(iter(fees))[0] if len(fees) == 1 else None),
               "depfee": t.get("depfee", next(iter(fees))[1] if len(fees) == 1 else None)}
        for k in ("fee_years", "alloc", "fee_alt", "note"):
            if k in t:
                row[k] = t[k]
        prim = [i for k in ("from_src", "fee_src") for i in t.get(k, []) if srcs[i]["kind"] == "primary"]
        main = (prim or t.get("announced_src") or t["from_src"])[0]
        row["src"], row["src_title"] = srcs[main]["url"], srcs[main]["doc"]
        vers = {k[:-4]: t[k] for k in t if k.endswith("_ver")}
        row["ver"] = vers
        row["verified"] = all(v in ("primary", "derived") for v in vers.values()) and all(w["ver"] == "primary" for w in t["winners"])
        row["sources"] = sorted({i for k in t if k.endswith("_src") for i in t[k]} | {i for w in t["winners"] for i in w["src"]})
        row["winners"] = []
        for w in t["winners"]:
            ks = sorted((h.k for h in H.values() if h.k[0] == "p" and h.row.get("pid") == w["pid"]
                         and any(c.startswith(PENSION + " | ") for _, c in h.ct)), key=lambda k: int(k[1:]))
            row["winners"].append({"co": w["co"], "fund": w.get("fund"), "grp": w["grp"], "fee": w.get("fee"), "depfee": w.get("depfee"), "pid": w["pid"],
                                   "ks": ks, "src": srcs[w["src"][0]]["url"], "ver": w["ver"], "verified": w["ver"] == "primary",
                                   "map": w["map"], "map_note": w["map_note"]})
            row["winners"][-1] = {k: v for k, v in row["winners"][-1].items() if v is not None}
        pids = {w["pid"] for w in t["winners"]}
        cmp_ = []
        for w in t["winners"]:
            x = {"tender": t["id"], "grp": w["grp"], "sel": True, "pid": w["pid"], "ks": next(z["ks"] for z in row["winners"] if z["pid"] == w["pid"])}
            for nm, (a, b) in wins.items():
                o = window({w["pid"]}, a, b)
                if o is not None:
                    x[nm] = o
            cmp_.append(x)
        x = {"tender": t["id"], "grp": "כל הנבחרות", "sel": True, "pid": None, "all": True}
        y_ = {"tender": t["id"], "grp": "שאר הקרנות", "sel": False, "pid": None, "rest": True}
        for nm, (a, b) in wins.items():
            o, o2 = window(pids, a, b), window(pids, a, b, rest=True)
            if o is not None:
                x[nm], y_[nm] = o, o2
        cmp_ += [x, y_]
        if "pre" in x and "post" in x and x["pre"]["share"] is not None and x["post"]["share"] is not None:
            row["sel_share"] = {"pre": x["pre"]["share"], "post": x["post"]["share"], "d": r(x["post"]["share"] - x["pre"]["share"], 2)}
            if "aft" in x and x["aft"].get("share") is not None and x["aft"]["m"] == 12:
                row["sel_share"]["aft"] = x["aft"]["share"]
        tenders.append(row)
        funds += [{k: v for k, v in z.items() if v is not None} for z in cmp_]
    return {"v": V, "asof": asof, "method": DEFAULT_METHOD, "src": SRC, "reg": "data/regulation/default_funds.json",
            "sources": reg["sources"], "tenders": tenders, "funds": funds}


# ------------------------------------------------------------------------------------------------ 5. trackers, 6. glide
def build_trackers(F, asof):
    groups = []
    for gid, track, label in TRACKERS:
        xs = [f for f in F["funds"] if f["track"] == track and (f.get("assets") or 0) > 0]
        if not xs:
            continue
        med = {w: S.median([f.get(w) for f in xs]) for w in ("y12", "a3", "a5")}
        medn = {w: S.median([f.get("net", {}).get(w) for f in xs]) for w in ("y12", "a3", "a5")}
        tracks = []
        for f in sorted(xs, key=lambda f: (-(f.get("assets") or 0), f["k"])):
            g = {w: f.get(w) for w in ("y12", "a3", "a5") if f.get(w) is not None}
            nt = {w: f["net"][w] for w in ("y12", "a3", "a5") if f.get("net", {}).get(w) is not None}
            o = {"k": f["k"], "name": f["name"], "grp": f["grp"], "prod": f["prod"], "fee": f.get("fee"), "depfee": f.get("depfee"),
                 "assets": f.get("assets"), "fx": f.get("fx"), "g": g, "nt": nt,
                 "td": {w: r(v - med[w]) for w, v in g.items() if med[w] is not None},
                 "tdn": {w: r(v - med[w]) for w, v in nt.items() if med[w] is not None}}
            if f.get("tx", {}).get("dis"):
                o["tx_dis"] = True
            if f.get("closed"):
                o["sector"] = True  # open only to a sector / employer population (funds.json closed)
            tracks.append({k: v for k, v in o.items() if v is not None})
        groups.append({"id": gid, "label": label, "track": track, "n": len(xs), "same_index": gid == "sp500", "med": {w: r(v) for w, v in med.items() if v is not None},
                       "med_n": {w: r(v) for w, v in medn.items() if v is not None},
                       "n_w": {w: sum(1 for f in xs if f.get(w) is not None) for w in ("y12", "a3", "a5")}, "tracks": tracks})
    return {"v": V, "asof": asof, "src": SRC, "method": TRACKER_METHOD,
            "basis_note": "g = ברוטו כפי שפורסם; nt = נטו, אומדן (funds.json net_method)", "groups": groups}


def build_glide(F, H, asof):
    months = months_between(GLIDE_FROM, asof)
    prods = []
    for prod in GLIDE_PRODS:
        by = {}
        for f in F["funds"]:
            if f["prod"] == prod and f["track"] in AGE and (f.get("assets") or 0) > 0 and not f.get("closed"):
                cur = by.setdefault(f["grp"], {}).get(f["track"])
                if cur is None or (f["assets"], f["k"]) > (cur["assets"], cur["k"]):
                    by[f["grp"]][f["track"]] = f
        mgrs = []
        for grp in sorted(by, key=lambda g: (-math.fsum(f["assets"] for f in by[g].values()), g)):
            tr = {}
            for age in AGE:
                f = by[grp].get(age)
                if not f:
                    continue
                h = H[f["k"]]
                st = [None] * len(months)
                fo = [None] * len(months)
                for j, T in enumerate(months):
                    i = h.at(T)
                    if i is not None:
                        st[j], fo[j] = h.st[i], h.fo[i]
                tr[age] = {"k": f["k"], "name": f["name"], "assets": f["assets"], "st": st, "fo": fo,
                           "net": {w: f["net"][w] for w in ("y12", "a3", "a5") if f.get("net", {}).get(w) is not None},
                           "gross": {w: f[w] for w in ("y12", "a3", "a5") if f.get(w) is not None}, "st_now": f.get("st"), "fo_now": f.get("fo")}
            gap = {}
            y, o = tr.get(AGE[0]), tr.get(AGE[2])
            if y and o:
                if y.get("st_now") is not None and o.get("st_now") is not None:
                    gap["st"] = r(y["st_now"] - o["st_now"], 1)
                for w in ("y12", "a3", "a5"):
                    if w in y["net"] and w in o["net"]:
                        gap["n_" + w] = r(y["net"][w] - o["net"][w])
            mgrs.append({"grp": grp, "tracks": tr, "gap": gap})
        med = {}
        for age in AGE:
            v = S.median([m["tracks"][age]["st_now"] for m in mgrs if age in m["tracks"]])
            if v is not None:
                med[age] = {"st": r(v, 1), "n": sum(1 for m in mgrs if age in m["tracks"] and m["tracks"][age]["st_now"] is not None)}
        gs = S.median([m["gap"].get("st") for m in mgrs])
        prods.append({"prod": prod, "mgrs": mgrs, "med": med, "gap_med": {"st": r(gs, 1)} if gs is not None else {}})
    return {"v": V, "asof": asof, "src": SRC, "method": GLIDE_METHOD, "months": months, "ages": list(AGE), "prods": prods}


# ------------------------------------------------------------------------------------------------ assemble, check, write
def build():
    F, C, cats, curve, H = load_all()
    asof = F["asof"]
    rf, filled = rf_series(curve, asof)
    stats = build_stats(F, cats, H, rf, filled, asof)
    P = panel(H, 0, asof)
    ranks = build_ranks(P, asof)
    files = {}
    idx = []
    for c in sorted(set(stats) | set(ranks)):
        prod, track = c.split(" | ", 1)
        st = stats.get(c)
        idx.append({"slug": slug(c), "cat": c, "prod": prod, "track": track, "n": st["cat_median"]["n"] if st else 0, "stats": st is not None,
                    "rank": c in ranks})
    files["funds/stats/index.json"] = {"v": V, "asof": asof, "slug": "c + sha1(cat, UTF-8) hex[:10]", "cats": idx}
    for c, doc in stats.items():
        files[f"funds/stats/{slug(c)}.json"] = doc
    for c, doc in ranks.items():
        files[f"funds/rank/{slug(c)}.json"] = doc
    files["funds/persist.json"] = build_persist(H, P, asof)
    files["funds/default.json"] = build_default(H, asof)
    files["funds/trackers.json"] = build_trackers(F, asof)
    files["funds/glide.json"] = build_glide(F, H, asof)
    return files


def rules(files):
    """the invariants the gate holds the files to; -> list of problems"""
    bad = []
    asof = files["funds/persist.json"]["asof"]
    idx = files["funds/stats/index.json"]["cats"]
    if len({c["slug"] for c in idx}) != len(idx):
        bad.append("stats/index: slug collision")
    for c in idx:
        if c["stats"] and f"funds/stats/{c['slug']}.json" not in files or c["rank"] and f"funds/rank/{c['slug']}.json" not in files:
            bad.append(f"index: missing file for {c['cat']}")
    for path, doc in files.items():
        if path.startswith("funds/stats/c"):
            for o in doc["tracks"]:
                if o.get("vol36") is not None and o["vol36"] < 0:
                    bad.append(f"{path}: {o['k']} vol36 < 0")
                for kk in ("dd_max", "dd_cur", "dd_max_all"):
                    if o.get(kk) is not None and o[kk] > 0:
                        bad.append(f"{path}: {o['k']} {kk} > 0")
                if o.get("dd_max") is not None and o.get("dd_cur") is not None and o["dd_cur"] < o["dd_max"] - 0.01:
                    bad.append(f"{path}: {o['k']} dd_cur below dd_max")
                if o.get("pct_pos_m") is not None and not 0 <= o["pct_pos_m"] <= 100:
                    bad.append(f"{path}: {o['k']} pct_pos_m out of range")
                if o.get("worst_m") is not None and o["worst_m"] > o["best_m"]:
                    bad.append(f"{path}: {o['k']} worst > best")
                if o.get("basis") not in ("net", "gross", None):
                    bad.append(f"{path}: {o['k']} basis")
        elif path.startswith("funds/rank/"):
            m = len(doc["months"])
            for s in doc["sets"]:
                if len(s["n"]) != m:
                    bad.append(f"{path}: n length")
                for k, xs in s["tracks"].items():
                    if len(xs) != m or any(x is not None and not 0 <= x <= 100 for x in xs):
                        bad.append(f"{path}: {k} ranks out of range or misaligned")
                    if any(x is not None and n < MIN_PEERS for x, n in zip(xs, s["n"])):
                        bad.append(f"{path}: {k} ranked with fewer than {MIN_PEERS} peers")
            if doc["months"][-1] > asof:
                bad.append(f"{path}: month beyond asof")
    for row in files["funds/persist.json"]["rows"]:
        tot = sum(q["n"] for q in row["rows"])
        if any(q["n"] != sum(q["to"]) + q["gone"] for q in row["rows"]):
            bad.append(f"persist {row['fam']} {row['win']} {row['basis']}: row sums")
        if row["rows"][0]["n"] != row["top"] or row["rows"][0]["to"][0] != row["stay"]:
            bad.append(f"persist {row['fam']} {row['win']} {row['basis']}: top / stay disagree with the matrix")
        lo, hi = row["ci90"]
        if (lo is None or hi is None) and not row["thin"] or lo is not None and lo > hi:
            bad.append(f"persist {row['fam']} {row['win']} {row['basis']}: interval")
        if tot <= 0:
            bad.append("persist: empty row")
    dflt = files["funds/default.json"]
    for t in dflt["tenders"]:
        if not t["src"].startswith("https://"):
            bad.append(f"default {t['id']}: src")
        for w in t["winners"]:
            if w["ver"] not in ("primary", "issuer", "press"):
                bad.append(f"default {t['id']} {w['co']}: ver")
            if w["verified"] and not w["src"].startswith("https://www.gov.il/"):
                bad.append(f"default {t['id']} {w['co']}: verified without a gov.il source")
            if not w["ks"]:
                bad.append(f"default {t['id']} {w['co']}: no pensia-net tracks for pid {w['pid']}")
    for g in files["funds/trackers.json"]["groups"]:
        for t in g["tracks"]:
            for w, v in t["td"].items():
                if abs(v - (t["g"][w] - g["med"][w])) > 0.011:
                    bad.append(f"trackers {g['id']} {t['k']}: td {w}")
    for p in files["funds/glide.json"]["prods"]:
        for m in p["mgrs"]:
            if len({len(x["st"]) for x in m["tracks"].values()} | {len(files["funds/glide.json"]["months"])}) != 1:
                bad.append(f"glide {p['prod']} {m['grp']}: series length")
    return bad


def main(argv):
    check = "--check" in argv
    files = build()
    blobs = {p: dumps(doc).encode("utf-8") for p, doc in files.items()}
    bad = rules(files)
    n_tr = sum(len(d["tracks"]) for p, d in files.items() if p.startswith("funds/stats/c"))
    summary = (f"{sum(1 for p in files if p.startswith('funds/stats/c'))} categories with stats ({n_tr} tracks), "
               f"{sum(1 for p in files if p.startswith('funds/rank/'))} rank files, {len(files['funds/persist.json']['rows'])} persistence rows, "
               f"{len(files['funds/default.json']['tenders'])} default-fund tenders, {sum(g['n'] for g in files['funds/trackers.json']['groups'])} trackers, "
               f"{sum(len(p['mgrs']) for p in files['funds/glide.json']['prods'])} glide managers")
    if check:
        diff = [p for p, b in blobs.items() if not (D / p).exists() or (D / p).read_bytes() != b]
        stale = [str(f.relative_to(D)) for sub in ("stats", "rank") for f in sorted((FD / sub).glob("*.json")) if str(f.relative_to(D)) not in blobs] \
            if FD.exists() else []
        for p in diff[:5]:
            print(f"  differs from a rebuild: {p}")
        for p in stale[:5]:
            print(f"  stale file (no category): {p}")
        for b in bad[:8]:
            print(f"  rule: {b}")
        ok = not diff and not stale and not bad
        print(("fund_stats ok: " if ok else f"fund_stats FAILED ({len(diff)} differ, {len(stale)} stale, {len(bad)} rule): ") + summary)
        return 0 if ok else 1
    for sub in ("stats", "rank"):
        (FD / sub).mkdir(parents=True, exist_ok=True)
        for f in (FD / sub).glob("*.json"):
            if str(f.relative_to(D)) not in blobs:
                f.unlink()
    for p, b in blobs.items():
        q = D / p
        if not q.exists() or q.read_bytes() != b:
            q.write_bytes(b)
    for b in bad:
        print("  rule: " + b)
    print(summary + f"; {sum(len(b) for b in blobs.values()) // 1024} KB")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
