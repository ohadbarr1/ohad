"""The Finding Engine (module S2): automated surprise detection over the published fact base. Every build, six detectors scan the files
the site already publishes; every candidate that passes its detector's thresholds is a finding, written as an S1 answer body (sourced
figures, a corridor sentence said out loud, an email paragraph, an exhibit, a falsifier), and ranked by materiality x surprise.
Standard library only; reads web/public/data only.

python3 pipeline/build_findings.py            write web/public/data/findings.json
python3 pipeline/build_findings.py --check    rebuild in memory, compare with the file on disk, run the answer rules (answer_core.body_problems)
                                              on every finding, re-derive every figure from the file it cites, reproduce the order and the
                                              top marks from the two published components (gate `findings`)

Detectors (`det`), thresholds are labelled assumptions in `params`:
  div   divergence: two series that normally move together separate. Normal = their pooled correlation over the history (stated per pair,
        must reach `div_rho`). A finding = the latest quarter's gap is |z| >= `div_z` against the company's own history of that gap and at
        least `div_gap` wide. Pairs: regulator average assets vs reported fee income (YoY growth, with the price / mix split from the
        regulator's declared fee rate) and reported fee income vs operating profit (YoY change, NIS m).
  brk   own-history break: the regulator's latest month outside the company's own previous `brk_win` months (beyond their range and
        |z| >= `brk_z`): net transfers and organic contributions as % of opening assets, the declared fee rate's monthly change.
        A month in which `brk_mkt` of the peers break the same way is a market event, not a company finding (suppressed with reason).
  peer  peer anomaly: in the latest period one manager moves opposite to at least `peer_share` of its peers (>= `peer_min` peers with data,
        each move beyond a dead band) and sits >= `peer_z` peer standard deviations from the peers' mean; and a manager whose segment
        operating result is a loss while every peer's is a profit (surprise measured on the operating margin, scale-free).
  sd    say-do gap: a management target (targets.json) against the reported outcome (the actual it is scored on, or for an open target the
        latest annual actual): the gap and how long the target has been on the record; and a target changed between two prints within
        `sd_recent` months. Surprise = the gap in standard deviations of the metric's own annual change (FY history; the IFRS 4 -> 17 year
        excluded for insurers); a metric with no own history (company-defined core profit, AUM ...) is skipped with the reason.
  disc  disclosure change: a flow line (P&L, OCI, segment note) printed for >= `disc_run` consecutive quarters and absent from the
        latest period, counted only when the company filed that period and the lines printed beside it (same report, same page) are
        still printed: the table was read. Statement lines only: the notes series (n.*) are extracted per metric with irregular coverage,
        and the cash-flow statement is cumulative, so neither is scanned. A line whose successor carries the
        same comparative figure is a rename (suppressed); lines whose sum equals a new line's comparative were collapsed into it; the same
        line stopping at >= `disc_xco` companies at once is an extraction / taxonomy artefact (suppressed). Surprise = the rarity of a stop:
        the pooled historical stop rate p of lines with a run that long, as standard deviations Phi^-1(1 - p).
  rank  rank shift: a manager's place in a ranked metric (asset share, cost / income LTM, realised fee yield LTM) moved >= `rank_min`
        places YoY among >= `rank_n` ranked managers, counting only managers crossed with a clear gap (`rank_band_*`) both before and
        after (a swap inside the band is noise); the driver (who was passed, by how much) is named. Surprise = the move in standard deviations of all YoY rank moves
        of that metric in the history.
Ranking: `mat` (NIS m a year at stake, rule per detector) x `sur` (standard deviations), descending, ties by id. No composite field is
published: the order is reproducible from the two components and `order_rule`. `top`: the first `top_n` in that order, at most
`top_per_det` per detector and `top_per_co` per company. Known data breaks (the regulator's definition changes, a reporting-perimeter mismatch between a manager's
report and the regulator, restated or IFRS 4 lines, market-wide moves) suppress a candidate; suppressed candidates are listed in `skipped`.
"""
import argparse
import json
import math
import re
import sys
from math import fsum
from pathlib import Path
from statistics import NormalDist

sys.path.insert(0, str(Path(__file__).resolve().parent))
import answer_core as A  # noqa: E402
from answer_core import (P_calc, P_rep, P_reg, SEG_HE, answer, changes_if, exhibit, fig, he, link, lq, nf, ym)  # noqa: E402

OUT = A.DATA / "findings.json"
FILES = "https://mayafiles.tase.co.il/"
DETS = ["div", "brk", "peer", "sd", "disc", "rank"]
FAM = {"pen": "pension", "gem": "gemel"}
SET = {"pen": "fam:pension", "gem": "fam:gemel"}
SEGS = ("pen", "gem")
MM = 'מיליוני ש"ח'

# ------------------------------------------------------------------------------------------------ the rules (labelled assumptions)
PARAMS = {
    "div_rho": {"v": 0.5, "he": "מתאם מינימלי בין שתי הסדרות בהיסטוריה (מאגר כל המנהלים) כדי שייחשבו 'נעות יחד'", "u": "מתאם", "det": "div"},
    "div_z": {"v": 2.0, "he": "חריגת הפער ברבעון האחרון מול ההיסטוריה של אותו פער בחברה", "u": "סטיות תקן", "det": "div"},
    "div_gap": {"v": 5.0, "he": "רוחב פער מינימלי (צמיחה) / ₪ מיליון (רווח)", "u": "נק׳ / ₪ מיליון", "det": "div"},
    "div_nmin": {"v": 5, "he": "רבעונים מינימליים בהיסטוריית הפער של החברה", "u": "רבעונים", "det": "div"},
    "brk_win": {"v": 24, "he": "חלון ההיסטוריה העצמית", "u": "חודשים", "det": "brk"},
    "brk_z": {"v": 3.0, "he": "חריגה מינימלית מממוצע החלון (ומחוץ לטווח המינימום–מקסימום שלו)", "u": "סטיות תקן", "det": "brk"},
    "brk_mkt": {"v": 0.5, "he": "שיעור העמיתים ששוברים באותו כיוון באותו חודש שהופך את השבר לאירוע שוק", "u": "שיעור", "det": "brk"},
    "brk_min_assets": {"v": 1000.0, "he": "נכסים מינימליים במוצר כדי שהסדרה תיבדק", "u": "₪ מיליון", "det": "brk"},
    "peer_min": {"v": 5, "he": "עמיתים מינימליים עם נתון", "u": "מנהלים", "det": "peer"},
    "peer_share": {"v": 0.85, "he": "שיעור העמיתים שנעים באותו כיוון", "u": "שיעור", "det": "peer"},
    "peer_z": {"v": 1.5, "he": "מרחק מינימלי מממוצע העמיתים", "u": "סטיות תקן של העמיתים", "det": "peer"},
    "peer_band_bp": {"v": 0.5, "he": "תנועה מינימלית בתשואת / שיעור דמי ניהול שנחשבת תזוזה", "u": "נ״ב", "det": "peer"},
    "peer_band_pp": {"v": 1.0, "he": "תנועה מינימלית ביחס הוצאות להכנסות / בצמיחה שנחשבת תזוזה", "u": "נק׳", "det": "peer"},
    "sd_gap": {"v": 15.0, "he": "פער מינימלי בין היעד לתוצאה, כשיעור מהיעד", "u": "%", "det": "sd"},
    "sd_z": {"v": 1.0, "he": "פער מינימלי בסטיות תקן של השינוי השנתי של המדד", "u": "סטיות תקן", "det": "sd"},
    "sd_recent": {"v": 24, "he": "שינוי יעד שנחשב עדכני", "u": "חודשים", "det": "sd"},
    "sd_nmin": {"v": 4, "he": "שינויים שנתיים מינימליים בהיסטוריה לחישוב סטיית התקן", "u": "שנים", "det": "sd"},
    "disc_run": {"v": 4, "he": "רבעונים רצופים של פרסום לפני ההפסקה", "u": "רבעונים", "det": "disc"},
    "disc_xco": {"v": 3, "he": "חברות שבהן אותה שורה נעלמת באותו רבעון: ארטיפקט חילוץ, לא החלטת גילוי", "u": "חברות", "det": "disc"},
    "disc_min": {"v": 1.0, "he": "היקף מינימלי של השורות שנעלמו, בשנה", "u": "₪ מיליון", "det": "disc"},
    "rank_n": {"v": 6, "he": "מנהלים מדורגים מינימליים", "u": "מנהלים", "det": "rank"},
    "rank_min": {"v": 2, "he": "תזוזה מינימלית בדירוג, YoY", "u": "מקומות", "det": "rank"},
    "rank_band_share": {"v": 0.1, "he": "עקיפה נספרת רק כשהפער בנתח לפני ואחרי הוא לפחות", "u": "נק׳", "det": "rank"},
    "rank_band_ci": {"v": 1.0, "he": "עקיפה נספרת רק כשהפער ביחס ההוצאות לפני ואחרי הוא לפחות", "u": "נק׳", "det": "rank"},
    "rank_band_fy": {"v": 0.5, "he": "עקיפה נספרת רק כשהפער בתשואת דמי הניהול לפני ואחרי הוא לפחות", "u": "נ״ב", "det": "rank"},
    "mat_min": {"v": 1.0, "he": "מהותיות מינימלית לפרסום ממצא", "u": "₪ מיליון בשנה", "det": "all"},
    "top_n": {"v": 5, "he": "ממצאים מובילים בכל בנייה", "u": "ממצאים", "det": "all"},
    "top_per_det": {"v": 2, "he": "לכל היותר ממצאים מובילים מאותו גלאי", "u": "ממצאים", "det": "all"},
    "top_per_co": {"v": 1, "he": "לכל היותר ממצאים מובילים לאותה חברה", "u": "ממצאים", "det": "all"},
}


def P(k):
    return PARAMS[k]["v"]


DET_HE = {
    "div": {"he": "התפצלות", "rule": "שתי סדרות שנעות יחד (מתאם של {div_rho} לפחות בהיסטוריה המאוחדת של כל המנהלים) נפרדות: הפער ברבעון האחרון "
            "חורג ב-{div_z} סטיות תקן לפחות מהיסטוריית הפער של החברה ורוחבו {div_gap} לפחות. זוגות: נכסים ממוצעים (רשות שוק ההון) מול הכנסות "
            "מדמי ניהול (דוחות), צמיחה YoY, עם פיצול מחיר / תמהיל לפי דמי הניהול המוצהרים; הכנסות מדמי ניהול מול רווח תפעולי, שינוי YoY. "
            "מהותיות: הפער מתורגם להכנסה / רווח שנתיים (₪ מיליון). הפתעה: ה-z מול ההיסטוריה העצמית."},
    "brk": {"he": "שבר בהיסטוריה העצמית", "rule": "החודש האחרון של רשות שוק ההון מחוץ ל-{brk_win} החודשים הקודמים של אותה חברה באותו מוצר: מעבר "
            "לטווח שלהם ו-{brk_z} סטיות תקן לפחות מהממוצע. סדרות: העברות נטו וצבירה אורגנית כשיעור מנכסי הפתיחה, שינוי חודשי בדמי הניהול "
            "המוצהרים. חודש שבו {brk_mkt} מהעמיתים שוברים באותו כיוון הוא אירוע שוק ומדוכא. מהותיות: עודף הזרימה מעל ממוצע החלון × תשואת "
            "דמי הניהול (הכנסה שנתית), או השינוי בדמי הניהול × הנכסים. הפתעה: ה-z."},
    "peer": {"he": "חריגה מהעמיתים", "rule": "בתקופה האחרונה מנהל אחד נע הפוך מ-{peer_share} לפחות מעמיתיו ({peer_min} עמיתים לפחות עם נתון, כל "
             "תזוזה מעבר לפס מת), ורחוק {peer_z} סטיות תקן לפחות מממוצע העמיתים; או מנהל שהרווח התפעולי שלו במגזר הפסד כשכל עמיתיו "
             "ברווח. מדדים: תשואת דמי ניהול ממומשת, יחס הוצאות להכנסות, צמיחת נכסים, דמי ניהול מוצהרים (YoY). מהותיות: התזוזה "
             "מתורגמת להכנסה / עלות שנתית (₪ מיליון). הפתעה: המרחק מממוצע העמיתים בסטיות התקן שלהם."},
    "sd": {"he": "פער בין אמירה לעשייה", "rule": "יעד הנהלה (targets.json) מול התוצאה המדווחת: התוצאה שעליה הוא נבחן, או ליעד פתוח התוצאה "
           "השנתית האחרונה; פער של {sd_gap}% לפחות מהיעד ו-{sd_z} סטיות תקן לפחות של השינוי השנתי של המדד בהיסטוריה של החברה. "
           "וגם יעד ששונה בין שתי הדפסות ב-{sd_recent} החודשים האחרונים. מהותיות: הפער ב-₪ מיליון (רווח בשנה; תשואה להון × הון ממוצע; "
           "כושר פירעון × הון נדרש). מדד בלי היסטוריה עצמית מדולג, עם הסיבה."},
    "disc": {"he": "שינוי גילוי", "rule": "שורת זרימה (רווח והפסד, ביאור מגזרים, תזרים) שפורסמה {disc_run} רבעונים רצופים לפחות ונעדרת "
             "מהתקופה האחרונה, רק כשהחברה הגישה את הדוח לאותה תקופה והשורות שהודפסו לידה (אותו דוח, אותו עמוד) עדיין מודפסות: הטבלה נקראה. "
             "רק שורות הדוחות (לא סדרות הביאורים n.*, שחולצו לפי מדד בכיסוי לא אחיד, ולא דוח תזרים המזומנים, שהוא מצטבר). שורה שיורשתה נושאת אותו מספר השוואה היא שינוי "
             "שם (מדוכא); שורות שסכומן שווה למספר ההשוואה של שורה חדשה אוחדו לתוכה; שורה שנעלמת ב-{disc_xco} חברות לפחות באותו רבעון היא "
             "ארטיפקט (מדוכא). מהותיות: היקף השורות שנעלמו בתקופה האחרונה שפורסמה, בשנה. הפתעה: נדירות ההפסקה, Φ⁻¹(1 − p), p = שיעור "
             "ההפסקה ההיסטורי של שורות עם רצף באורך הזה (מאגר כל החברות, בלי ארטיפקטים)."},
    "rank": {"he": "תזוזה בדירוג", "rule": "מקומו של מנהל בדירוג (נתח נכסים, יחס הוצאות להכנסות LTM, תשואת דמי ניהול LTM) זז {rank_min} מקומות "
             "לפחות YoY, מתוך {rank_n} מנהלים מדורגים לפחות; נספרים רק מנהלים שנעקפו בפער ברור לפני ואחרי (rank_band_*), "
             "החלפת מקומות בתוך הפס היא רעש; המניע (מי נעקף ובכמה) מוצג. מהותיות: השינוי במדד מתורגם להכנסה / עלות שנתית (₪ מיליון). "
             "הפתעה: התזוזה בסטיות התקן של כל תזוזות הדירוג YoY של אותו מדד בהיסטוריה."},
}
ORDER_RULE = ("מכפלת המהותיות (₪ מיליון בשנה) בהפתעה (סטיות תקן), מהגבוה לנמוך; בשוויון לפי המזהה. "
              "המובילים: {top_n} הראשונים בסדר הזה, לכל היותר {top_per_det} מכל גלאי ואחד לכל חברה. אין שדה מצרפי בקובץ: הסדר משוחזר "
              "משני הרכיבים שפורסמו.")  # placeholders filled from PARAMS at build (order_rule())


# ------------------------------------------------------------------------------------------------ small arithmetic (deterministic on 3.9 and 3.12)
def mean(xs):
    return fsum(xs) / len(xs)


def sd(xs):
    m = mean(xs)
    return math.sqrt(fsum((x - m) ** 2 for x in xs) / (len(xs) - 1)) if len(xs) > 1 else 0.0


def pearson(xy):
    n = len(xy)
    mx, my = fsum(x for x, _ in xy) / n, fsum(y for _, y in xy) / n
    sxy = fsum((x - mx) * (y - my) for x, y in xy)
    sx = math.sqrt(fsum((x - mx) ** 2 for x, _ in xy))
    sy = math.sqrt(fsum((y - my) ** 2 for _, y in xy))
    return sxy / (sx * sy) if sx and sy else 0.0


def r3(x):
    return None if x is None else round(x, 3)


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def months_between(a, b):
    """ISO dates a <= b, whole months"""
    return (int(b[:4]) - int(a[:4])) * 12 + int(b[5:7]) - int(a[5:7])


# ------------------------------------------------------------------------------------------------ sources: every figure carries `src`, re-derived from its file
class Reg:
    """market.json aggregates, the arithmetic of web/src/lib/market.ts (cell / flows / fee), in NIS millions"""

    def __init__(self):
        M = A.load("market.json")
        self.P = M["periods"]
        self.G = M["groups"]
        self.ins = {i for i, p in enumerate(M["products"]) if p["family"] == "insurance"}
        fam = [p["family"] for p in M["products"]]
        acc = {}
        for r in M["rows"]:
            f = fam[r[1]]
            for g in (r[2], -1):
                c = acc.setdefault((r[0], f, g), [[] for _ in range(8)])
                c[0].append(r[3])
                c[1].append(0.0 if r[1] in self.ins else r[3])
                for j, k in enumerate((4, 5, 6, 7, 8, 9)):
                    c[2 + j].append(r[k])
        self.cells = {k: [fsum(x) for x in v] for k, v in acc.items()}  # a, af, dep, wd, tr, fa, fn, fd

    def cell(self, pi, f, g):
        return self.cells.get((pi, f, g))

    def flows(self, pi, n, f, g):
        """(organic, transfers) summed over the n months ending at pi, or None (the page's coverage rule: flow assets >= 98% of assets)"""
        if pi - n + 1 < 0:
            return None
        org, tr = [], []
        for i in range(pi - n + 1, pi + 1):
            c = self.cell(i, f, g)
            if not c or not c[1] > 0 or c[5] < 0.98 * c[1]:
                return None
            org.append(c[2] - c[3])
            tr.append(c[4])
        return fsum(org), fsum(tr)

    def value(self, metric, pi, w, f, g):
        n = {"m": 1, "q": 3, "ltm": 12}[w]
        c = self.cell(pi, f, g)
        if c is None:
            return None
        if metric == "assets":
            return c[0]
        if metric == "fee":
            return c[6] / c[7] if c[7] > 0 else None
        fl = self.flows(pi, n, f, g)
        if fl is None:
            return None
        return fl[0] if metric == "organic" else fl[1]


_REG = None
_LENS = None


def REG():
    global _REG
    if _REG is None:
        _REG = Reg()
    return _REG


def LENS():
    global _LENS
    if _LENS is None:
        _LENS = A.Lens()
    return _LENS


def derive(src):
    """the value a figure's `src` names, read from the published file (the --check and the tests re-derive every figure with this)"""
    k = src[0]
    if k == "reg":
        _, metric, pi, w, set_, g = src
        return REG().value(metric, pi, w, {"fam:pension": "pension", "fam:gemel": "gemel"}[set_], g)
    if k == "lens":
        _, g, s, q, field = src
        r = next((r for r in A.load("lens.json")["rows"] if r["g"] == g and r["s"] == s and r["q"] == q), None)
        if r is None:
            return None
        if field in ("fees", "sm", "ga", "op"):
            return r["rep"][field]
        if field in ("avg", "aE", "aO"):
            return r["reg"][field]
        return r.get(field)
    if k == "fact":
        _, c, li, end, win = src
        F = A.load(f"facts/{c}.json")
        lo = sum(F["lines"]["n"][:li])
        R, per = F["rows"], F["periods"]
        for i in range(lo, lo + F["lines"]["n"][li]):
            if R["f"][i] & 16 and per[R["p"][i]] == [win, end]:
                return R["v"][i] / (1000.0 if F["lines"]["u"][li] == "k" else 1.0)
        return None
    if k == "tgt":
        _, i, key = src
        r = A.load("targets.json")["rows"][i]
        if key == "act":
            return r["act"]["v"]
        if key.startswith("in"):
            return r["act"]["in"][int(key[2:])][1]
        if key.startswith("H"):  # a print in the target's history: H<j>:<v|lo|hi>
            j, part = key[1:].split(":")
            h = r["hist"][int(j)]
            if len(h) == 4:  # [period, v, doc, pg]
                return h[1]
            return {"v": h[1], "lo": h[2], "hi": h[3]}[part]
        return r[key]
    if k == "kpi":
        _, c, concept, per = src
        K = A.load("kpi.json")["companies"][c]
        v = K["values"][concept][K["periods"].index(per)]
        return None if v is None else v / 1000.0
    if k == "sol":
        _, c, d, key = src
        return A.load("csm/solvency.json")["companies"][c][d][key]["v"]
    if k == "c":
        return src[1]
    a = [derive(x) for x in src[1:]]
    if any(x is None for x in a):
        return None
    if k == "sub":
        return a[0] - a[1]
    if k == "add":
        return fsum(a)
    if k == "mul":
        return a[0] * a[1]
    if k == "div":
        return a[0] / a[1] if a[1] else None
    if k == "pct":
        return a[0] / a[1] * 100 if a[1] else None
    if k == "growth":
        return (a[0] / a[1] - 1) * 100 if a[1] else None
    if k == "mean":
        return fsum(a) / len(a)
    if k == "abs":
        return abs(a[0])
    if k == "neg":
        return -a[0]
    if k == "x4":
        return a[0] * 4
    if k == "bp":   # percent-point difference in basis points
        return (a[0] - a[1]) * 100
    raise ValueError(f"src kind {k}")


def F(label, src, u, prov, asof, b="actual", d=None, signed=False, t=None, c=None):
    """a sourced figure whose value is derived from its src"""
    v = derive(src)
    f = fig(label, v, u, prov, asof, b=b, d=d, signed=signed, t=t, c=c)
    f["src"] = src
    return f


# ------------------------------------------------------------------------------------------------ provenance helpers
def reg_prov(metric, pi, w, s, g):
    return P_reg(metric, pi, w, SET[s], g)


def lens_prov(c, s, q, field):
    L = LENS()
    if field in ("fees", "sm", "ga", "op"):
        return L.prov_lts(c, s, field, q)
    if field == "ci":
        return L.prov_ci(c, s, q)
    if field in ("aum_share", "flow_share"):
        return L.prov_share(c, s, q, field)
    r = L.row(c, s, q)
    if field == "avg":
        pi = L.pi(L.q_end(q))
        return P_calc(f"נכסים ממוצעים · {he(c)} · {SEG_HE[s]} · {lq(q)}", nf(r["reg"]["avg"], 0), MM,
                      "ממוצע נכסי סוף החודש של ארבעת החודשים (פתיחה + שלושת חודשי הרבעון), רשות שוק ההון (lens.json reg.avg)",
                      [(f"נכסים, {ym(L.P[pi - 3 + i])}", nf(r["reg"]["m"][i], 1), P_reg("assets", pi - 3 + i, "m", SET[s], L.mg(c))) for i in range(4)])
    if field == "fy_reg":
        return P_calc(f"תשואת דמי ניהול ממומשת · {he(c)} · {SEG_HE[s]} · {lq(q)}", f"{nf(r['fy_reg'], 3)}%", "%",
                      "הכנסות מדמי ניהול ברבעון × 4 ÷ נכסים ממוצעים × 100 (lens.json fy_reg)",
                      [("הכנסות מדמי ניהול", nf(r["rep"]["fees"], 1), L.prov_lts(c, s, "fees", q)),
                       ("נכסים ממוצעים", nf(r["reg"]["avg"], 0), lens_prov(c, s, q, "avg"))])
    raise ValueError(field)


def calc(title, v, unit, formula, inputs):
    return P_calc(title, v, unit, formula, [(a, b, c) for a, b, c in inputs])


def fact_prov(Fc, li, row, title):
    V = Fc["vint"]
    t = Fc["rows"]["t"][row]
    url = Fc["urls"][V["u"][t]] if V["u"][t] is not None else None
    u = Fc["lines"]["u"][li]
    v = Fc["rows"]["v"][row] / (1000.0 if u == "k" else 1.0)
    win, end = Fc["periods"][Fc["rows"]["p"][row]]
    return P_rep(title, nf(v, 1), MM, url, Fc["rows"]["pg"][row], V["rid"][t], f"{win} {A.dlab(end)}")


def tgt_doc(T, doc):
    d = T["docs"].get(str(doc))
    return (FILES + d[4]) if d else None


# ------------------------------------------------------------------------------------------------ the finding row
def row(id_, det, c, seg, mat, sur, body, key):
    return {"id": id_, "det": det, "c": c, "seg": seg, "mat": mat, "sur": sur, "top": False, **body, "_k": key}


def mat_(v, t, why):
    return {"v": r3(v), "u": "m", "t": t, "why": why}


def sur_(v, why):
    return {"v": r3(v), "u": "sd", "t": f"{nf(v, 1)} ס״ת", "why": why}


def money(v):
    return A.fmt(v, "m")


# ------------------------------------------------------------------------------------------------ 1. divergence
def det_div(skipped):
    L = LENS()
    Q = L.quarters
    q = L.last_q
    qi = Q.index(q)
    out = []

    def perim_ok(c, s, qq):
        r = L.row(c, s, qq)
        cv = r.get("cover") if r else None
        return cv is None or 95.0 <= cv <= 105.0

    def pts(c, s, kind):
        """[(quarter, x, y)] YoY: assets vs fees (growth %), fees vs op (change NIS m)"""
        res = []
        for i in range(4, len(Q)):
            r1, r0 = L.row(c, s, Q[i]), L.row(c, s, Q[i - 4])
            if not (r1 and r0 and r1.get("rep") and r0.get("rep")):
                continue
            f1, f0 = r1["rep"].get("fees"), r0["rep"].get("fees")
            if kind == "fa":
                a1, a0 = r1["reg"].get("avg"), r0["reg"].get("avg")
                if f1 and f0 and f0 > 1 and a1 and a0:
                    res.append((Q[i], (a1 / a0 - 1) * 100, (f1 / f0 - 1) * 100))
            else:
                o1, o0 = r1["rep"].get("op"), r0["rep"].get("op")
                if f1 is not None and f0 is not None and o1 is not None and o0 is not None:
                    res.append((Q[i], f1 - f0, o1 - o0))
        return res

    cos = {s: [c for c in L.cos(s, q, rep=True)] for s in SEGS}
    marked = A.load("lens.json").get("marks", {})
    for kind in ("fa", "fo"):
        pool = []
        for s in SEGS:
            for c in L.gix:
                if kind == "fo" and c in marked:
                    continue
                pool += [(x, y) for qq, x, y in pts(c, s, kind) if qq != q]
        rho = pearson(pool)
        if rho < P("div_rho"):
            skipped.append({"id": f"div:{kind}", "det": "div", "c": None, "why": f"מתאם היסטורי {nf(rho, 2)} מתחת לסף: הזוג לא נחשב 'נע יחד'"})
            continue
        for s in SEGS:
            for c in sorted(cos[s]):
                if kind == "fo" and c in marked:
                    continue
                P_ = pts(c, s, kind)
                if not P_ or P_[-1][0] != q:
                    continue
                gaps = [(qq, y - x) for qq, x, y in P_]
                hist = [g for qq, g in gaps[:-1]]
                if len(hist) < P("div_nmin"):
                    continue
                g_now = gaps[-1][1]
                s_h = sd(hist)
                if not s_h:
                    continue
                z = (g_now - mean(hist)) / s_h
                if abs(z) < P("div_z") or abs(g_now) < P("div_gap"):
                    continue
                q0 = Q[qi - 4]
                if not (perim_ok(c, s, q) and perim_ok(c, s, q0)):
                    skipped.append({"id": f"F-div-{c}-{s}-{kind}", "det": "div", "c": c,
                                    "why": "פער היקף בין דוח החברה לנתוני הרשות (כיסוי מחוץ ל-95%–105%): התפצלות עלולה להיות ארטיפקט"})
                    continue
                out.append(div_finding(c, s, kind, q, q0, P_, gaps, hist, z, rho, len(pool)))
    return out


def div_finding(c, s, kind, q, q0, P_, gaps, hist, z, rho, npool):
    L = LENS()
    g, mg = L.g(c), L.mg(c)
    r1, r0 = L.row(c, s, q), L.row(c, s, q0)
    seg = SEG_HE[s]
    lab = lq(q)
    if kind == "fa":
        sa = ["growth", ["lens", g, s, q, "avg"], ["lens", g, s, q0, "avg"]]
        sf = ["growth", ["lens", g, s, q, "fees"], ["lens", g, s, q0, "fees"]]
        ga, gf = derive(sa), derive(sf)
        pa = calc(f"צמיחת נכסים ממוצעים YoY · {he(c)} · {seg} · {lab}", f"{nf(ga, 1)}%", "%", "(נכסים ממוצעים ברבעון ÷ אותו רבעון שנה קודם − 1) × 100",
                  [(f"נכסים ממוצעים, {lab}", nf(r1["reg"]["avg"], 0), lens_prov(c, s, q, "avg")), (f"נכסים ממוצעים, {lq(q0)}", nf(r0["reg"]["avg"], 0), lens_prov(c, s, q0, "avg"))])
        pf = calc(f"צמיחת הכנסות מדמי ניהול YoY · {he(c)} · {seg} · {lab}", f"{nf(gf, 1)}%", "%", "(הכנסות מדמי ניהול ברבעון ÷ אותו רבעון שנה קודם − 1) × 100",
                  [(f"הכנסות מדמי ניהול, {lab}", nf(r1["rep"]["fees"], 1), lens_prov(c, s, q, "fees")), (f"הכנסות מדמי ניהול, {lq(q0)}", nf(r0["rep"]["fees"], 1), lens_prov(c, s, q0, "fees"))])
        pi1, pi0 = L.pi(L.q_end(q)), L.pi(L.q_end(q0))
        sdec = ["bp", ["reg", "fee", pi1, "m", SET[s], mg], ["reg", "fee", pi0, "m", SET[s], mg]]
        sreal = ["bp", ["lens", g, s, q, "fy_reg"], ["lens", g, s, q0, "fy_reg"]]
        ddec, dreal = derive(sdec), derive(sreal)
        figs = {
            "ga": F(f"צמיחת נכסים ממוצעים YoY, {he(c)}, {seg}", sa, "pct", pa, lab, signed=True, c=c),
            "gf": F(f"צמיחת הכנסות מדמי ניהול YoY, {he(c)}, {seg}", sf, "pct", pf, lab, signed=True, c=c),
            "gap": F(f"פער צמיחה (דמי ניהול פחות נכסים), {he(c)}, {seg}", ["sub", sf, sa], "pp", calc(
                f"פער צמיחה · {he(c)} · {seg} · {lab}", f"{nf(gf - ga, 1)} נק׳", "נק׳", "צמיחת הכנסות דמי ניהול YoY פחות צמיחת הנכסים הממוצעים YoY",
                [("צמיחת דמי ניהול", f"{nf(gf, 1)}%", pf), ("צמיחת נכסים", f"{nf(ga, 1)}%", pa)]), lab, c=c),
            "dreal": F(f"שינוי בתשואת דמי ניהול ממומשת YoY, {he(c)}, {seg}", sreal, "bp", calc(
                f"שינוי בתשואת דמי ניהול ממומשת · {he(c)} · {seg}", f"{nf(dreal, 1)} נ״ב", "נ״ב", "(תשואה ממומשת ברבעון − אותו רבעון שנה קודם) × 100",
                [(lab, f"{nf(r1['fy_reg'], 3)}%", lens_prov(c, s, q, "fy_reg")), (lq(q0), f"{nf(r0['fy_reg'], 3)}%", lens_prov(c, s, q0, "fy_reg"))]), lab, d=1, c=c),
            "ddec": F(f"שינוי בדמי ניהול מוצהרים מנכסים YoY, {he(c)}, {seg}", sdec, "bp", calc(
                f"שינוי בדמי ניהול מוצהרים · {he(c)} · {seg}", f"{nf(ddec, 1)} נ״ב", "נ״ב", "(דמי ניהול ממוצעים משוקללים בנכסים בחודש סוף הרבעון − שנה קודם) × 100",
                [(ym(L.P[pi1]), "", P_reg("fee", pi1, "m", SET[s], mg)), (ym(L.P[pi0]), "", P_reg("fee", pi0, "m", SET[s], mg))]), lab, d=1, c=c),
        }
        mix = abs(ddec) < max(1.0, 0.25 * abs(dreal))
        down = gf < ga
        matv = abs(gf - ga) / 100 * r0["rep"]["fees"] * 4
        word = "תמהיל, לא מחיר" if mix else "גם מחיר"
        if down:
            corr = (f"ב{he(c)} {seg} הכנסות דמי הניהול מפגרות אחרי הנכסים בפער חריג של {{gap}} — {word}.")
        else:
            corr = (f"ב{he(c)} {seg} הכנסות דמי הניהול רצות לפני הנכסים בפער חריג של {{gap}} — {word}.")
        email = (f"{he(c)}, {seg}, {lab} מול {lq(q0)}: הנכסים הממוצעים צמחו ב-{{ga}} והכנסות דמי הניהול ב-{{gf}}. תשואת דמי הניהול הממומשת זזה "
                 f"ב-{{dreal}}, ודמי הניהול המוצהרים מנכסים ב-{{ddec}} בלבד: " + ("רוב השינוי הוא תמהיל (דמי הפקדה, מוצרים, לקוחות), לא תמחור." if mix
                                                                                  else "חלק מהותי מהשינוי הוא תמחור.")
                 + " שתי הסדרות נעות יחד בדרך כלל; הפער הזה חריג להיסטוריה של החברה.")
        qs = [qq for qq, _, _ in P_]
        ex = exhibit("line", f"{he(c)} · {seg}: צמיחת נכסים מול צמיחת דמי ניהול, YoY", "%", [lq(x) for x in qs],
                     [{"name": "נכסים ממוצעים", "type": "line", "data": [r3(x) for _, x, _ in P_]},
                      {"name": "הכנסות מדמי ניהול", "type": "line", "data": [r3(y) for _, _, y in P_]}],
                     [f"מתאם הצמיחות בהיסטוריה המאוחדת של המנהלים: {nf(rho, 2)} ({npool} תצפיות)",
                      "נכסים: רשות שוק ההון (גמל-נט, פנסיה-נט), ממוצע ארבעה סופי חודש; הכנסות: דוחות החברות המנהלות, ביאור מגזרים"],
                     span=f"{lq(qs[0])}–{lq(qs[-1])}")
        thr = r3(mean(hist) - P("div_z") * sd(hist)) if down else r3(mean(hist) + P("div_z") * sd(hist))
        chg = changes_if("הממצא נסגר כשפער הצמיחה חוזר אל מעבר ל-{thr}" if down else "הממצא נסגר כשפער הצמיחה יורד אל מתחת ל-{thr}",
                         "gap", ">" if down else "<", thr)
        vk = f"fa:{'down' if down else 'up'}:{'mix' if mix else 'price'}"
        mat = mat_(matv, money(matv), "פער הצמיחה × הכנסות דמי הניהול של הרבעון המקביל × 4: הכנסה שנתית שלא צמחה עם הנכסים" if down
                   else "פער הצמיחה × הכנסות דמי הניהול של הרבעון המקביל × 4: הכנסה שנתית מעבר לצמיחת הנכסים")
        sl = "fees-vs-assets"
    else:
        sf = ["sub", ["lens", g, s, q, "fees"], ["lens", g, s, q0, "fees"]]
        so = ["sub", ["lens", g, s, q, "op"], ["lens", g, s, q0, "op"]]
        df, do = derive(sf), derive(so)
        pf = calc(f"שינוי בהכנסות מדמי ניהול YoY · {he(c)} · {seg} · {lab}", nf(df, 1), MM, "הכנסות ברבעון פחות אותו רבעון שנה קודם",
                  [(lab, nf(r1["rep"]["fees"], 1), lens_prov(c, s, q, "fees")), (lq(q0), nf(r0["rep"]["fees"], 1), lens_prov(c, s, q0, "fees"))])
        po = calc(f"שינוי ברווח התפעולי YoY · {he(c)} · {seg} · {lab}", nf(do, 1), MM, "רווח תפעולי ברבעון פחות אותו רבעון שנה קודם",
                  [(lab, nf(r1["rep"]["op"], 1), lens_prov(c, s, q, "op")), (lq(q0), nf(r0["rep"]["op"], 1), lens_prov(c, s, q0, "op"))])
        figs = {
            "df": F(f"שינוי בהכנסות מדמי ניהול YoY, {he(c)}, {seg}", sf, "m", pf, lab, signed=True, c=c),
            "do": F(f"שינוי ברווח התפעולי YoY, {he(c)}, {seg}", so, "m", po, lab, signed=True, c=c),
            "gap": F(f"פער (רווח תפעולי פחות דמי ניהול), {he(c)}, {seg}", ["sub", so, sf], "m", calc(
                f"פער רווח מול הכנסות · {he(c)} · {seg} · {lab}", nf(do - df, 1), MM, "שינוי ברווח התפעולי YoY פחות שינוי בהכנסות מדמי ניהול YoY",
                [("שינוי ברווח", nf(do, 1), po), ("שינוי בהכנסות", nf(df, 1), pf)]), lab, signed=True, c=c),
        }
        down = do < df
        matv = abs(do - df) * 4
        if down:
            corr = f"ב{he(c)} {seg} הרווח התפעולי לא עולה עם ההכנסות: הפער הוא {{gap}} ברבעון, חריג להיסטוריה."
        else:
            corr = f"ב{he(c)} {seg} הרווח התפעולי עולה מהר מההכנסות: הפער הוא {{gap}} ברבעון, חריג להיסטוריה."
        email = (f"{he(c)}, {seg}, {lab} מול {lq(q0)}: הכנסות דמי הניהול השתנו ב-{{df}} והרווח התפעולי ב-{{do}}. "
                 + ("ההוצאות בלעו את הגידול בהכנסות." if down else "ההוצאות ירדו או גדלו לאט מההכנסות.")
                 + " בדרך כלל השניים נעים יחד; הפער הזה חריג להיסטוריה של החברה.")
        qs = [qq for qq, _, _ in P_]
        ex = exhibit("cat", f"{he(c)} · {seg}: שינוי YoY בהכנסות מול שינוי ברווח התפעולי", MM, [lq(x) for x in qs],
                     [{"name": "הכנסות מדמי ניהול", "type": "bar", "data": [r3(x) for _, x, _ in P_]},
                      {"name": "רווח תפעולי", "type": "bar", "data": [r3(y) for _, _, y in P_]}],
                     [f"מתאם השינויים בהיסטוריה המאוחדת של המנהלים: {nf(rho, 2)} ({npool} תצפיות)", "דוחות החברות המנהלות, ביאור מגזרי פעילות"],
                     span=f"{lq(qs[0])}–{lq(qs[-1])}")
        thr = r3(mean(hist) - P("div_z") * sd(hist)) if down else r3(mean(hist) + P("div_z") * sd(hist))
        chg = changes_if("הממצא נסגר כשהפער חוזר אל מעבר ל-{thr}" if down else "הממצא נסגר כשהפער יורד אל מתחת ל-{thr}", "gap", ">" if down else "<", thr)
        vk = f"fo:{'down' if down else 'up'}"
        mat = mat_(matv, money(matv), "הפער ברבעון × 4: רווח תפעולי שנתי שלא עקב אחרי ההכנסות" if down else "הפער ברבעון × 4: רווח תפעולי שנתי מעבר לשינוי בהכנסות")
        sl = "op-vs-fees"
    sur = sur_(abs(z), f"הפער ברבעון האחרון מול {len(hist)} רבעוני היסטוריה של אותו פער בחברה (ממוצע {nf(mean(hist), 1)}, סטיית תקן {nf(sd(hist), 1)})")
    body = answer(figs, corr, email, ex, chg, vk, links=[link("עדשת החיסכון", "/savings"), link(he(c), f"/company/{c}")], asof=lab)
    return row(f"F-div-{c}-{s}-{sl}", "div", c, s, mat, sur, body, (c, s, kind))


# ------------------------------------------------------------------------------------------------ 2. own-history break
BRK_M = {"tr": "העברות נטו", "org": "צבירה אורגנית", "fee": "דמי ניהול מוצהרים"}


def det_brk(skipped):
    R, L = REG(), LENS()
    pi = R.P.index(L.asof)
    W = int(P("brk_win"))
    cands = {}
    for s in SEGS:
        f = FAM[s]
        for c in sorted(L.gix):
            mg = L.mg(c)
            for kind in BRK_M:
                xs = []
                for i in range(pi - W, pi + 1):
                    c0, c1 = R.cell(i - 1, f, mg), R.cell(i, f, mg)
                    if not c0 or not c1 or c0[0] < P("brk_min_assets"):
                        xs = None
                        break
                    if kind == "fee":
                        f1, f0 = R.value("fee", i, "m", f, mg), R.value("fee", i - 1, "m", f, mg)
                        x = None if f1 is None or f0 is None else (f1 - f0) * 100
                    else:
                        fl = R.flows(i, 1, f, mg)
                        x = None if fl is None else (fl[1] if kind == "tr" else fl[0]) / c0[0] * 100
                    if x is None:
                        xs = None
                        break
                    xs.append(x)
                if not xs:
                    continue
                hist, x = xs[:-1], xs[-1]
                m, s_ = mean(hist), sd(hist)
                if not s_:
                    continue
                z = (x - m) / s_
                out_range = x > max(hist) or x < min(hist)
                cands[(c, s, kind)] = {"z": z, "x": x, "m": m, "sd": s_, "brk": out_range and abs(z) >= P("brk_z"), "xs": xs}
    out = []
    for (c, s, kind), v in sorted(cands.items()):
        if not v["brk"]:
            continue
        peers = [w for (cc, ss, kk), w in cands.items() if ss == s and kk == kind and cc != c]
        same = [w for w in peers if w["brk"] and (w["z"] > 0) == (v["z"] > 0)]
        if peers and len(same) / len(peers) >= P("brk_mkt"):
            skipped.append({"id": f"F-brk-{c}-{s}-{kind}", "det": "brk", "c": c, "why": f"אירוע שוק: {len(same)} מתוך {len(peers)} עמיתים שוברים באותו כיוון באותו חודש"})
            continue
        if kind != "fee" and L.row(c, s) is None:
            continue
        out.append(brk_finding(c, s, kind, pi, v, W))
    return out


def brk_finding(c, s, kind, pi, v, W):
    R, L = REG(), LENS()
    mg = L.mg(c)
    seg = SEG_HE[s]
    mon = ym(R.P[pi])
    P0 = pi - 1
    up = v["z"] > 0
    r = L.row(c, s)
    if kind == "fee":
        src = ["bp", ["reg", "fee", pi, "m", SET[s], mg], ["reg", "fee", P0, "m", SET[s], mg]]
        prov = calc(f"שינוי חודשי בדמי ניהול מוצהרים · {he(c)} · {seg} · {mon}", f"{nf(v['x'], 2)} נ״ב", "נ״ב", "(דמי ניהול ממוצעים משוקללים בנכסים, החודש − החודש הקודם) × 100",
                    [(mon, "", P_reg("fee", pi, "m", SET[s], mg)), (ym(R.P[P0]), "", P_reg("fee", P0, "m", SET[s], mg))])
        x_fig = F(f"שינוי חודשי בדמי ניהול מוצהרים, {he(c)}, {seg}", src, "bp", prov, mon, d=2, c=c)
        unit_he = "נ״ב"
        assets = R.cell(pi, FAM[s], mg)[0]
        matv = abs(v["x"] - v["m"]) / 10000 * assets
        mwhy = "השינוי מעבר לממוצע החלון × נכסי סוף החודש: הכנסה שנתית שמשתנה"
        a_src = ["reg", "assets", pi, "m", SET[s], mg]
        a_fig = F(f"נכסים, {he(c)}, {seg}", ["div", a_src, ["c", 1000.0]], "bn", P_reg("assets", pi, "m", SET[s], mg), mon, c=c)
        corr = (f"דמי הניהול המוצהרים ב{he(c)} {seg} " + ("קפצו" if up else "צנחו") + f" ב-{mon} ב-{{x}} — חריג להיסטוריה של {W} חודשים.")
        email = (f"{he(c)}, {seg}, {mon}: דמי הניהול הממוצעים המשוקללים בנכסים השתנו ב-{{x}} בחודש אחד, על נכסים של {{a}}. "
                 f"השינוי חורג מכל {W} חודשים קודמים של החברה, ושאר המנהלים לא זזו כך באותו חודש.")
        figs = {"x": x_fig, "a": a_fig}
        chg = changes_if("הממצא נחלש אם בחודש הבא השינוי מתהפך מעבר ל-{thr}", "x", "<" if up else ">", 0.0)
        sl = "fee"
    else:
        fl_m = "transfers" if kind == "tr" else "organic"
        flow_src = ["reg", fl_m, pi, "m", SET[s], mg]
        a0_src = ["reg", "assets", P0, "m", SET[s], mg]
        src = ["pct", flow_src, a0_src]
        flow_v = derive(flow_src)
        prov = calc(f"{BRK_M[kind]} כשיעור מנכסי הפתיחה · {he(c)} · {seg} · {mon}", f"{nf(v['x'], 2)}%", "%", f"{BRK_M[kind]} בחודש ÷ נכסי סוף החודש הקודם × 100",
                    [(BRK_M[kind], nf(flow_v, 1), P_reg(fl_m, pi, "m", SET[s], mg)), ("נכסי פתיחה", nf(derive(a0_src), 0), P_reg("assets", P0, "m", SET[s], mg))])
        x_fig = F(f"{BRK_M[kind]} כשיעור מנכסי הפתיחה, {he(c)}, {seg}", src, "pct", prov, mon, d=2, signed=True, c=c)
        fl_fig = F(f"{BRK_M[kind]}, {he(c)}, {seg}", flow_src, "m", P_reg(fl_m, pi, "m", SET[s], mg), mon, signed=True, c=c)
        fy = r["fy_reg"] if r and r.get("fy_reg") else None
        a0 = derive(a0_src)
        excess = (v["x"] - v["m"]) / 100 * a0
        matv = abs(excess) * (fy or 0) / 100
        mwhy = f"הזרימה מעבר לממוצע החלון (₪{nf(abs(excess), 0)} מיליון) × תשואת דמי הניהול הממומשת ({nf(fy or 0, 2)}%, {lq(L.last_q)}): הכנסה שנתית"
        unit_he = "%"
        what = "ניוד" if kind == "tr" else "צבירה אורגנית"
        if kind == "tr":
            corr = f"{he(c)} {seg} " + ("קיבלה" if up else "איבדה") + f" ב-{mon} ניוד חריג: {{x}} מהנכסים בחודש אחד, מחוץ להיסטוריה של {W} חודשים."
        else:
            corr = f"הצבירה האורגנית של {he(c)} {seg} " + ("קפצה" if up else "צנחה") + f" ב-{mon} ל-{{x}} מהנכסים, מחוץ להיסטוריה של {W} חודשים."
        email = (f"{he(c)}, {seg}, {mon}: {what} של {{fl}}, שהם {{x}} מנכסי הפתיחה — מחוץ לטווח של {W} חודשים קודמים של החברה, "
                 "ושאר המנהלים לא שברו כך באותו חודש.")
        figs = {"x": x_fig, "fl": fl_fig}
        thr = r3(v["m"] + (P("brk_z") * v["sd"] if up else -P("brk_z") * v["sd"]))
        chg = changes_if("הממצא נסגר אם החודש הבא חוזר אל " + ("מתחת" if up else "מעל") + " ל-{thr}", "x", "<" if up else ">", thr)
        sl = "transfers" if kind == "tr" else "organic"
    cats = [ym(R.P[i]) for i in range(pi - W, pi + 1)]
    ex = exhibit("line", f"{he(c)} · {seg}: {BRK_M[kind]}, {W} חודשים ועוד החודש האחרון", unit_he, cats,
                 [{"name": BRK_M[kind], "type": "line", "data": [r3(x) for x in v["xs"]]},
                  {"name": f"ממוצע {W} החודשים", "type": "line", "data": [r3(v["m"])] * len(cats)}],
                 [f"ממוצע החלון {nf(v['m'], 2)}, סטיית תקן {nf(v['sd'], 2)}; החודש האחרון: z = {nf(v['z'], 1)}",
                  "רשות שוק ההון: גמל-נט, פנסיה-נט (INTERNAL_TRANSFERS, DEPOSITS − WITHDRAWLS, TOTAL_ASSETS, AVG_ANNUAL_MANAGEMENT_FEE)"],
                 span=f"{cats[0]}–{cats[-1]}")
    mat = mat_(matv, money(matv), mwhy)
    sur = sur_(abs(v["z"]), f"מול {W} החודשים הקודמים של החברה באותו מוצר (ממוצע {nf(v['m'], 2)}, סטיית תקן {nf(v['sd'], 2)})")
    vk = f"{kind}:{'hi' if up else 'lo'}"
    body = answer(figs, corr, email, ex, chg, vk, links=[link("ניוד ושוק", "/market"), link(he(c), f"/company/{c}")], asof=mon)
    return row(f"F-brk-{c}-{s}-{sl}", "brk", c, s, mat, sur, body, (c, s, kind))


# ------------------------------------------------------------------------------------------------ 3. peer anomaly
PEER_M = {"fy": ("תשואת דמי ניהול ממומשת, שינוי YoY", "bp"), "ci": ("יחס הוצאות להכנסות, שינוי YoY", "pp"),
          "grow": ("צמיחת נכסים ממוצעים YoY", "pct"), "dec": ("דמי ניהול מוצהרים מנכסים, שינוי YoY", "bp")}


def peer_values(s, metric, q, q0):
    """{company: (value, src)} for the peer metric in segment s"""
    L = LENS()
    marked = A.load("lens.json").get("marks", {})
    out = {}
    for c in sorted(L.gix):
        g = L.g(c)
        r1, r0 = L.row(c, s, q), L.row(c, s, q0)
        if not r1 or not r0:
            continue
        if metric in ("fy", "ci") and not (r1.get("rep") and r0.get("rep")):
            continue
        if metric == "fy":
            if r1.get("fy_reg") is None or r0.get("fy_reg") is None:
                continue
            if any(not (95.0 <= (r.get("cover") or 100.0) <= 105.0) for r in (r1, r0)):
                continue
            src = ["bp", ["lens", g, s, q, "fy_reg"], ["lens", g, s, q0, "fy_reg"]]
        elif metric == "ci":
            if c in marked or r1.get("ci") is None or r0.get("ci") is None:
                continue
            src = ["sub", ["lens", g, s, q, "ci"], ["lens", g, s, q0, "ci"]]
        elif metric == "grow":
            if not r1["reg"].get("avg") or not r0["reg"].get("avg") or r0["reg"]["avg"] < P("brk_min_assets"):
                continue
            src = ["growth", ["lens", g, s, q, "avg"], ["lens", g, s, q0, "avg"]]
        else:
            pi1, pi0 = L.pi(L.q_end(q)), L.pi(L.q_end(q0))
            if r0["reg"].get("avg", 0) < P("brk_min_assets"):
                continue
            src = ["bp", ["reg", "fee", pi1, "m", SET[s], L.mg(c)], ["reg", "fee", pi0, "m", SET[s], L.mg(c)]]
        v = derive(src)
        if v is not None:
            out[c] = (v, src)
    return out


def det_peer(skipped):
    L = LENS()
    q = L.last_q
    q0 = L.quarters[L.quarters.index(q) - 4]
    out = []
    for s in SEGS:
        for metric in PEER_M:
            vals = peer_values(s, metric, q, q0)
            band = P("peer_band_bp") if PEER_M[metric][1] == "bp" else P("peer_band_pp")
            for c, (x, src) in sorted(vals.items()):
                peers = {k: v for k, (v, _) in vals.items() if k != c}
                if len(peers) < P("peer_min"):
                    continue
                pv = list(peers.values())
                up = [v for v in pv if v > band]
                dn = [v for v in pv if v < -band]
                n = len(pv)
                if len(up) / n >= P("peer_share") and x < -band:
                    d = "dn"
                elif len(dn) / n >= P("peer_share") and x > band:
                    d = "up"
                else:
                    continue
                m, s_ = mean(pv), sd(pv)
                if not s_:
                    continue
                z = (x - m) / s_
                if abs(z) < P("peer_z"):
                    continue
                out.append(peer_finding(c, s, metric, q, q0, x, src, vals, d, z, m, s_, len(up) if d == "dn" else len(dn), n))
        # the level anomaly: a segment operating loss where every peer is in profit
        ops = {}
        marked = A.load("lens.json").get("marks", {})
        for c in sorted(L.gix):
            r = L.row(c, s, q)
            if r and r.get("rep") and r["rep"].get("op") is not None and r["rep"].get("fees") and c not in marked:
                ops[c] = r["rep"]["op"]
        neg = [c for c, v in ops.items() if v < 0]
        if len(ops) - 1 >= P("peer_min") and len(neg) == 1:
            c = neg[0]
            mg_ = {k: v / L.row(k, s, q)["rep"]["fees"] * 100 for k, v in ops.items()}   # operating margin: scale-free across sizes
            pv = [v for k, v in mg_.items() if k != c]
            if not sd(pv):
                continue
            z = (mg_[c] - mean(pv)) / sd(pv)
            if abs(z) >= P("peer_z"):
                out.append(peer_loss_finding(c, s, q, ops, mg_, z, mean(pv), sd(pv)))
            else:
                skipped.append({"id": f"F-peer-{c}-{s}-op-loss", "det": "peer", "c": c, "why": f"הפסד יחיד אבל רק {nf(abs(z), 1)} ס״ת מממוצע העמיתים"})
    return out


def peer_finding(c, s, metric, q, q0, x, src, vals, d, z, m, s_, n_same, n):
    L = LENS()
    seg = SEG_HE[s]
    lab = lq(q)
    name, u = PEER_M[metric]
    r1, r0 = L.row(c, s, q), L.row(c, s, q0)
    if metric == "fy":
        prov = calc(f"{name} · {he(c)} · {seg}", f"{nf(x, 1)} נ״ב", "נ״ב", "(תשואה ממומשת ברבעון − אותו רבעון שנה קודם) × 100",
                    [(lab, f"{nf(r1['fy_reg'], 3)}%", lens_prov(c, s, q, "fy_reg")), (lq(q0), f"{nf(r0['fy_reg'], 3)}%", lens_prov(c, s, q0, "fy_reg"))])
        matv = abs(x - m) / 10000 * r1["reg"]["avg"]
        mwhy = "המרחק מממוצע העמיתים (נ״ב) × הנכסים הממוצעים: הכנסה שנתית"
        fu, dd = "bp", 1
    elif metric == "ci":
        prov = calc(f"{name} · {he(c)} · {seg}", f"{nf(x, 1)} נק׳", "נק׳", "יחס הוצאות להכנסות ברבעון פחות אותו רבעון שנה קודם",
                    [(lab, f"{nf(r1['ci'], 1)}%", lens_prov(c, s, q, "ci")), (lq(q0), f"{nf(r0['ci'], 1)}%", lens_prov(c, s, q0, "ci"))])
        matv = abs(x - m) / 100 * r1["rep"]["fees"] * 4
        mwhy = "המרחק מממוצע העמיתים (נק׳) × הכנסות דמי הניהול של הרבעון × 4: עלות שנתית"
        fu, dd = "pp", 1
    elif metric == "grow":
        prov = calc(f"{name} · {he(c)} · {seg}", f"{nf(x, 1)}%", "%", "(נכסים ממוצעים ברבעון ÷ אותו רבעון שנה קודם − 1) × 100",
                    [(lab, nf(r1["reg"]["avg"], 0), lens_prov(c, s, q, "avg")), (lq(q0), nf(r0["reg"]["avg"], 0), lens_prov(c, s, q0, "avg"))])
        fy = r1.get("fy_reg") or 0
        matv = abs(x - m) / 100 * r0["reg"]["avg"] * fy / 100
        mwhy = f"המרחק מממוצע העמיתים × הנכסים הממוצעים שנה קודם × תשואת דמי הניהול ({nf(fy, 2)}%): הכנסה שנתית"
        fu, dd = "pct", 1
    else:
        pi1, pi0 = L.pi(L.q_end(q)), L.pi(L.q_end(q0))
        prov = calc(f"{name} · {he(c)} · {seg}", f"{nf(x, 1)} נ״ב", "נ״ב", "(דמי ניהול ממוצעים משוקללים בנכסים, סוף הרבעון − שנה קודם) × 100",
                    [(ym(L.P[pi1]), "", P_reg("fee", pi1, "m", SET[s], L.mg(c))), (ym(L.P[pi0]), "", P_reg("fee", pi0, "m", SET[s], L.mg(c)))])
        matv = abs(x - m) / 10000 * r1["reg"]["avg"]
        mwhy = "המרחק מממוצע העמיתים (נ״ב) × הנכסים הממוצעים: הכנסה שנתית"
        fu, dd = "bp", 1
    pmean_src = ["mean"] + [src_ for k, (v, src_) in sorted(vals.items()) if k != c]
    figs = {
        "x": F(f"{name}, {he(c)}, {seg}", src, fu, prov, lab, d=dd, signed=True, c=c),
        "pm": F(f"{name}, ממוצע העמיתים, {seg}", pmean_src, fu, calc(f"{name} · ממוצע העמיתים · {seg}", nf(m, 1), PEER_M[metric][1],
                f"ממוצע פשוט של {n} העמיתים ({', '.join(he(k) for k in sorted(vals) if k != c)})", [(he(k), nf(v, 1), None) for k, (v, _) in sorted(vals.items()) if k != c]),
                lab, d=dd, signed=True),
    }
    other = "עולים" if d == "dn" else "יורדים"
    mine = "יורד" if d == "dn" else "עולה"
    nice = {"fy": "תשואת דמי הניהול", "ci": "יחס ההוצאות להכנסות", "grow": "הנכסים", "dec": "דמי הניהול המוצהרים"}[metric]
    nice_b = {"fy": "בתשואת דמי הניהול", "ci": "ביחס ההוצאות להכנסות", "grow": "בנכסים", "dec": "בדמי הניהול המוצהרים"}[metric]
    corr = f"{he(c)} היא היחידה ב{seg} ש{nice} שלה {mine} כשהעמיתים {other}: {{x}} YoY."
    if metric == "grow":
        corr = f"{he(c)} היא היחידה ב{seg} שהנכסים שלה " + ("מתכווצים" if d == "dn" else "צומחים") + " כשהעמיתים " + ("צומחים" if d == "dn" else "מתכווצים") + ": {x} YoY."
    who = f"כל העמיתים עם נתון ({n} עמיתים)" if n_same == n else f"{n_same} עמיתים מתוך {n} עמיתים עם נתון"
    email = (f"{seg}, {lab} מול {lq(q0)}: {who} " + ("עלו" if d == "dn" else "ירדו") + f" {nice_b}, בממוצע {{pm}}; "
             f"אצל {he(c)} התנועה הפוכה: {{x}}.")
    ranked = sorted(vals.items(), key=lambda kv: kv[1][0])
    ex = exhibit("hbar", f"{seg}: {name}, {lab} מול {lq(q0)}", PEER_M[metric][1] if PEER_M[metric][1] != "pct" else "%", [he(k) for k, _ in ranked],
                 [{"name": name, "type": "bar", "data": [r3(v) for _, (v, _) in ranked]}],
                 [f"ממוצע העמיתים {nf(m, 1)}, סטיית תקן {nf(s_, 1)}; {he(c)}: z = {nf(z, 1)}",
                  "רשות שוק ההון (נכסים, דמי ניהול מוצהרים); דוחות החברות המנהלות (הכנסות, הוצאות)"], span=f"{lq(q0)}–{lab}")
    chg = changes_if("הממצא נסגר כש" + nice + " של " + he(c) + " חוזרים לכיוון העמיתים, מעבר ל-{thr}", "x", ">" if d == "dn" else "<", 0.0)
    mat = mat_(matv, money(matv), mwhy)
    sur = sur_(abs(z), f"המרחק מממוצע {n} העמיתים בסטיות התקן שלהם (ממוצע {nf(m, 1)}, סטיית תקן {nf(s_, 1)})")
    body = answer(figs, corr, email, ex, chg, f"{metric}:{d}", links=[link("עדשת החיסכון", "/savings"), link(he(c), f"/company/{c}")], asof=lab)
    return row(f"F-peer-{c}-{s}-{metric}", "peer", c, s, mat, sur, body, (c, s, metric))


def peer_loss_finding(c, s, q, ops, mg_, z, m, s_):
    L = LENS()
    g = L.g(c)
    seg = SEG_HE[s]
    lab = lq(q)
    q0 = L.quarters[L.quarters.index(q) - 4]
    figs = {
        "op": F(f"הפסד תפעולי, {he(c)}, {seg}", ["neg", ["lens", g, s, q, "op"]], "m", lens_prov(c, s, q, "op"), lab, c=c),
        "ga": F(f"צמיחת נכסים ממוצעים YoY, {he(c)}, {seg}", ["growth", ["lens", g, s, q, "avg"], ["lens", g, s, q0, "avg"]], "pct",
                calc(f"צמיחת נכסים ממוצעים YoY · {he(c)} · {seg} · {lab}", "", "%", "(נכסים ממוצעים ÷ שנה קודם − 1) × 100",
                     [(lab, "", lens_prov(c, s, q, "avg")), (lq(q0), "", lens_prov(c, s, q0, "avg"))]), lab, signed=True, c=c),
        "ci": F(f"יחס הוצאות להכנסות, {he(c)}, {seg}", ["lens", g, s, q, "ci"], "pct", lens_prov(c, s, q, "ci"), lab, c=c),
    }
    n = len(ops) - 1
    corr = f"{he(c)} היא המנהלת היחידה שמפסידה על {seg}: הפסד תפעולי של {{op}} ברבעון, כשכל העמיתים ברווח."
    email = (f"{seg}, {lab}: {he(c)} רשמה הפסד תפעולי של {{op}}, ביחס הוצאות להכנסות של {{ci}}, בזמן שכל {n} עמיתים עם דוח מגזרי היו ברווח. "
             "במקביל הנכסים הממוצעים שלה צמחו ב-{ga} YoY: היא קונה צמיחה בהפסד.")
    ranked = sorted(ops.items(), key=lambda kv: kv[1])
    ex = exhibit("hbar", f"{seg}: רווח תפעולי לפי מנהלת, {lab}", MM, [he(k) for k, _ in ranked],
                 [{"name": "רווח תפעולי", "type": "bar", "data": [r3(v) for _, v in ranked]}],
                 [f"שיעור הרווח התפעולי מההכנסות: {he(c)} {nf(mg_[c], 1)}%, ממוצע העמיתים {nf(m, 1)}%, סטיית תקן {nf(s_, 1)} נק׳",
                  "דוחות החברות המנהלות, ביאור מגזרי פעילות (רווח תפעולי והכנסות מדמי ניהול של המגזר)"], span=lab)
    chg = changes_if("הממצא נסגר כשההפסד התפעולי של " + he(c) + " במגזר יורד אל {thr}", "op", "<=", 0.0)
    matv = abs(ops[c]) * 4
    mat = mat_(matv, money(matv), "ההפסד התפעולי ברבעון × 4: הפסד שנתי בקצב הנוכחי")
    sur = sur_(abs(z), f"שיעור הרווח התפעולי מההכנסות ({nf(mg_[c], 1)}%) מול ממוצע {n} העמיתים בסטיות התקן שלהם (ממוצע {nf(m, 1)}%, סטיית תקן {nf(s_, 1)} נק׳)")
    body = answer(figs, corr, email, ex, chg, "op:loss", links=[link("עדשת החיסכון", "/savings"), link(he(c), f"/company/{c}")], asof=lab)
    return row(f"F-peer-{c}-{s}-op-loss", "peer", c, s, mat, sur, body, (c, s, "op"))


# ------------------------------------------------------------------------------------------------ 4. say-do gap
SD_HIST = {"ci": "oci", "profit": "profit", "equity": "equity"}
SD_HE = {"ci": "רווח כולל לבעלי המניות", "profit": "רווח נקי לבעלי המניות", "equity": "הון לבעלי המניות", "roe": "תשואה להון", "sr": "יחס כושר פירעון"}


def fy_hist(c, k, f=None):
    """[(year, value)] of the metric's own FY history from kpi.json (NIS m; roe in %), or solvency ratios (Dec, without transitional)"""
    if k == "sr":
        S = A.load("csm/solvency.json")["companies"].get(c, {})
        return [(int(d[:4]), S[d]["sr_wo"]["v"]) for d in sorted(S) if d.endswith("12-31") and "sr_wo" in S[d]]
    K = A.load("kpi.json")["companies"].get(c)
    if not K:
        return []
    ys = [(int(p[:4]), i) for i, p in enumerate(K["periods"]) if p.endswith("FY")]
    V = K["values"]
    if k in SD_HIST:
        return [(y, V[SD_HIST[k]][i] / 1000.0) for y, i in ys if V[SD_HIST[k]][i] is not None]
    if k == "roe":
        num = "oci" if f and "רווח כולל" in f else "profit"
        out = []
        for j in range(1, len(ys)):
            (y, i), (_, i0) = ys[j], ys[j - 1]
            e1, e0, n = V["equity"][i], V["equity"][i0], V[num][i]
            if None not in (e1, e0, n) and e1 + e0:
                out.append((y, n / ((e1 + e0) / 2) * 100))
        return out
    return []


def sd_sigma(c, k, f=None):
    """the standard deviation of the metric's annual change, own FY history; the IFRS 4 -> 17 change (2023 -> 2024) excluded for insurers"""
    h = fy_hist(c, k, f)
    ins = set(A.load("restatements.json")["insurers"])
    ch = [(y, v - v0) for (y0, v0), (y, v) in zip(h, h[1:]) if y == y0 + 1 and not (c in ins and y == 2024 and k != "sr")]
    if len(ch) < P("sd_nmin"):
        return None, len(ch)
    return sd([d for _, d in ch]), len(ch)


def det_sd(skipped, asof_date):
    T = A.load("targets.json")
    out = []
    for i, r in enumerate(T["rows"]):
        c = r["c"]
        if c == "more_gemel" or r["m"].endswith("_prior"):
            continue
        # (a) the gap to the outcome
        act = r.get("act")
        if act and r["st"] in ("open", "met", "partial", "missed") and r["u"] in ("m", "pct"):
            k = act.get("k")
            ok = k in ("ci", "profit", "equity", "roe", "sr") and "הגדרת החברה" not in (act.get("f") or "") and not re.search(r"threshold|min|max", r["m"])
            if not ok:
                if r["st"] == "open" or r["st"] in ("met", "partial", "missed"):
                    skipped.append({"id": f"sd:{i}", "det": "sd", "c": c, "why": f"{r['l']} ({r['m']}): אין היסטוריה עצמית של המדד באותה הגדרה למדידת ההפתעה"})
            else:
                f = sd_gap_finding(T, i, r, skipped, asof_date)
                if f:
                    out.append(f)
        # (b) a target changed between two prints
        h = r.get("hist") or []
        if len(h) >= 2 and r["st"] != "policy":
            f = sd_rev_finding(T, i, r, skipped, asof_date)
            if f:
                out.append(f)
    # one finding per (company, metric, horizon): the duplicate prints of one target keep the latest
    seen, res = {}, []
    for f in out:
        k = f["id"]
        if k in seen:
            continue
        seen[k] = 1
        res.append(f)
    return res


def tgt_figs(T, i, r, lab):
    """the target as figures: lo / hi or v, basis target, provenance = its print"""
    url = tgt_doc(T, r["doc"])
    hy = f"FY'{str(r['h'])[2:]}" if r.get("h") else "ללא מועד"
    u = "m" if r["u"] == "m" else "pct"
    out = {}
    for key in ("lo", "hi", "v"):
        if r.get(key) is None:
            continue
        p = P_rep(f"{r['l']} · {he(r['c'])} · {r['e']} · {hy}", nf(r[key], 1), MM if u == "m" else "%", url, r["pg"], r["doc"], hy,
                  note=f"כפי שהודפס: {r['q'][:160]}")
        out["t" + key] = F(f"{r['l']} ({'גבול תחתון' if key == 'lo' else 'גבול עליון' if key == 'hi' else 'יעד'}), {he(r['c'])}", ["tgt", i, key], u, p, hy,
                           b="target", c=r["c"])
    return out


def act_fig(r, i, lab):
    act = r["act"]
    u = "m" if r["u"] == "m" else "pct"
    ins = act.get("in") or []
    inputs = [(a[0], nf(a[1], 1), P_rep(a[0], nf(a[1], 1), MM if u == "m" or "רווח" in a[0] or "הון" in a[0] else "%", a[2], a[3], None, a[4])) for a in ins]
    prov = P_calc(f"{SD_HE.get(act['k'], act['k'])} בפועל · {he(r['c'])} · FY'{str(act['y'])[2:]}", nf(act["v"], 1), MM if u == "m" else "%", act.get("f") or "", inputs)
    return F(f"{SD_HE.get(act['k'], act['k'])} בפועל, {he(r['c'])}", ["tgt", i, "act"], u, prov, f"FY'{str(act['y'])[2:]}", c=r["c"])


def sd_gap_finding(T, i, r, skipped, asof_date):
    act = r["act"]
    c, k = r["c"], act["k"]
    lo = r["lo"] if r.get("lo") is not None else r.get("v")
    hi = r["hi"] if r.get("hi") is not None else r.get("v")
    a = act["v"]
    if lo is None and hi is None:
        return None
    if r["u"] == "m" and lo and not (0.2 <= a / lo <= 5):
        skipped.append({"id": f"sd:{i}", "det": "sd", "c": c, "why": f"{r['l']}: יחידת היעד והתוצאה לא מתאימות"})
        return None
    if lo is not None and a < lo:
        gap, side, ref, refk = a - lo, "below", lo, "lo" if r.get("lo") is not None else "v"
    elif hi is not None and a > hi:
        gap, side, ref, refk = a - hi, "above", hi, "hi" if r.get("hi") is not None else "v"
    else:
        return None
    if not ref or abs(gap) / abs(ref) * 100 < P("sd_gap"):
        return None
    sig, n = sd_sigma(c, k, act.get("f"))
    if not sig:
        skipped.append({"id": f"sd:{i}", "det": "sd", "c": c, "why": f"{r['l']}: {n} שינויים שנתיים בלבד בהיסטוריה של המדד"})
        return None
    z = abs(gap) / sig
    if z < P("sd_z"):
        return None
    hy = r.get("h")
    ay = act["y"]
    alab = f"FY'{str(ay)[2:]}"
    hlab = f"FY'{str(hy)[2:]}" if hy else "ללא מועד"
    figs = tgt_figs(T, i, r, alab)
    figs["act"] = act_fig(r, i, alab)
    u = "m" if r["u"] == "m" else "pp"
    tkey = "t" + refk
    figs["gap"] = F(f"פער התוצאה מהיעד, {he(c)}", ["sub", ["tgt", i, "act"], ["tgt", i, refk]], u,
                    P_calc(f"פער מהיעד · {r['l']} · {he(c)}", nf(gap, 1), MM if u == "m" else "נק׳", "התוצאה בפועל פחות " + ("הגבול התחתון" if side == "below" else "הגבול העליון") + " של היעד",
                           [("בפועל", nf(a, 1), figs["act"]["prov"]), ("יעד", nf(ref, 1), figs[tkey]["prov"])]), alab, b="actual", signed=True, c=c)
    first = (r.get("st0") or r.get("st1") or [None])[0]
    open_m = months_between(first, asof_date) if first else None
    since = f", על השולחן מאז {A.dlab(first)}" if first else ""
    early = hy and ay < hy
    if side == "above" and early:
        corr = f"{he(c)} כבר עברה ב-{alab} את יעד {r['l'].replace('יעד ', '')} שלה ל-{hlab}: התוצאה מעל הגבול העליון ב-{{gap}}, לפני המועד."
    elif side == "above":
        corr = f"{he(c)} עברה את יעד {r['l'].replace('יעד ', '')} שלה ל-{hlab} בפער של {{gap}} מעל הגבול העליון של הטווח."
        vk = "above:early" if early else "above"
    else:
        corr = (f"{he(c)} רחוקה מיעד {r['l'].replace('יעד ', '')} שלה ל-{hlab}: התוצאה ב-{alab} מתחת לגבול התחתון ב-{{gap}}.")
        vk = "below:open" if early else "below"
    rng = "{tlo}–{thi}" if "tlo" in figs and "thi" in figs else ("{tv}" if "tv" in figs else ("{tlo}" if "tlo" in figs else "{thi}"))
    email = (f"{he(c)} ({r['e']}): יעד {r['l'].replace('יעד ', '')} ל-{hlab} הוא {rng}{since}. ב-{alab} התוצאה היא {{act}}, "
             + (("כלומר היעד כבר לא מחייב." if early else "מעל הגבול העליון של הטווח.") if side == "above" else "כלומר נדרש שיפור כדי לעמוד בו.")
             + " יעד ותוצאה מסומנים בנפרד.")
    rows_ = [["", "ערך", "בסיס", "מקור"]]
    for kk in ("tlo", "thi", "tv"):
        if kk in figs:
            rows_.append([figs[kk]["l"], figs[kk]["t"], "יעד", f"{r['doc']} עמ׳ {r['pg']}"])
    rows_.append([figs["act"]["l"], figs["act"]["t"], "בפועל", alab])
    rows_.append([figs["gap"]["l"], figs["gap"]["t"], "בפועל מול יעד", ""])
    ex = exhibit("table", f"{he(c)}: {r['l']} מול התוצאה", MM if u == "m" else "%", [], [], [
        f"סטיית התקן של השינוי השנתי ב{SD_HE[k]}: {nf(sig, 1)} ({n} שינויים שנתיים" + (", בלי מעבר IFRS 4 ל-IFRS 17" if k != "sr" else "") + ")",
        "יעד: כפי שהודפס במצגת / בדוח (targets.json); תוצאה: הדוח הכספי / דוח כושר הפירעון"], rows=rows_)
    thr = ref
    chg = changes_if("הממצא נסגר כשהתוצאה חוזרת אל תוך טווח היעד, " + ("מתחת" if side == "above" else "מעל") + " ל-{thr}", "act", "<=" if side == "above" else ">=", thr)
    if k in ("ci", "profit", "equity"):
        matv = abs(gap)
        mwhy = "הפער ב-₪ מיליון" + (" (רווח בשנה)" if k != "equity" else " (הון, יתרה)")
    elif k == "roe":
        eq = [x for x in act.get("in") or [] if "הון" in x[0]]
        avg_eq = fsum(x[1] for x in eq) / len(eq) if eq else None
        matv = abs(gap) / 100 * (avg_eq or 0)
        mwhy = f"הפער בנקודות התשואה × ההון הממוצע (₪{nf(avg_eq or 0, 0)} מיליון): רווח שנתי"
    else:
        S = A.load("csm/solvency.json")["companies"].get(c, {})
        d = max((d for d in S if d.startswith(str(ay)) and "scr_wo" in S[d]), default=None)
        scr = S[d]["scr_wo"]["v"] if d else 0
        matv = abs(gap) / 100 * scr
        mwhy = f"הפער בנקודות היחס × ההון הנדרש (₪{nf(scr, 0)} מיליון): הון עצמי"
    if not matv:
        return None
    mat = mat_(matv, money(matv), mwhy)
    sur = sur_(z, f"הפער ({nf(abs(gap), 1)}) בסטיות תקן של השינוי השנתי של המדד בהיסטוריה של החברה ({nf(sig, 1)}, {n} שינויים)"
               + (f"; היעד פתוח {open_m} חודשים" if open_m is not None else ""))
    body = answer(figs, corr, email, ex, chg, vk, links=[link("יעדים ואמינות", "/credibility"), link(he(c), f"/company/{c}")], asof=alab)
    body["open_m"] = open_m
    return row(f"F-sd-{c}-{slug(r['m'].replace('target_', ''))}-{slug(r['seg'])}-{hy or 'na'}", "sd", c, None, mat, sur, body, (c, r["m"], r["seg"], hy))


def sd_rev_finding(T, i, r, skipped, asof_date):
    h = r["hist"]
    c = r["c"]

    def mid(x):
        if len(x) == 4:
            return x[1], x[1], x[1]
        v, lo, hi = x[1], x[2], x[3]
        if v is not None:
            return v, v, v
        if lo is not None and hi is not None:
            return (lo + hi) / 2, lo, hi
        return (lo if lo is not None else hi), lo, hi
    pts = [(x[0], mid(x)) for x in h]
    j = len(pts) - 1
    while j > 0 and pts[j][1][0] == pts[j - 1][1][0]:
        j -= 1
    if j == 0:
        return None
    d1, (m1, _, _) = pts[j]
    d0, (m0, _, _) = pts[j - 1]
    if not re.fullmatch(r"\d{4}-\d\d-\d\d", d1) or not re.fullmatch(r"\d{4}-\d\d-\d\d", d0):
        return None
    age = months_between(d1, asof_date)
    if age > P("sd_recent") or m0 is None or m1 is None:
        return None
    k = {"target_comprehensive_income": "ci", "target_profit": "profit", "target_net_income": "profit", "target_equity": "equity",
         "target_roe": "roe", "target_solvency_ratio": "sr"}.get(r["m"])
    if k is None or r["seg"] not in ("group",) and k != "sr":
        skipped.append({"id": f"sd:rev:{i}", "det": "sd", "c": c, "why": f"{r['l']} ({r['e']}) שונה ב-{A.dlab(d1)}: אין היסטוריה עצמית של המדד לישות הזו"})
        return None
    sig, n = sd_sigma(c, k, (r.get("act") or {}).get("f"))
    if not sig:
        skipped.append({"id": f"sd:rev:{i}", "det": "sd", "c": c, "why": f"{r['l']} שונה: {n} שינויים שנתיים בלבד בהיסטוריה"})
        return None
    dm = m1 - m0
    if not m0 or abs(dm) / abs(m0) * 100 < P("sd_gap"):
        return None
    z = abs(dm) / sig
    if z < P("sd_z"):
        return None
    u = "m" if r["u"] == "m" else "pct"
    hy = r.get("h")
    hlab = f"FY'{str(hy)[2:]}" if hy else "ללא מועד"

    def hfig(jj, lab):
        x = h[jj]
        part = "v" if (len(x) == 4 or x[1] is not None) else None
        doc, pg = (x[2], x[3]) if len(x) == 4 else (x[4], x[5])
        url = tgt_doc(T, doc)
        if part:
            src = ["tgt", i, f"H{jj}:v"]
        else:
            src = ["mean", ["tgt", i, f"H{jj}:lo"], ["tgt", i, f"H{jj}:hi"]] if x[2] is not None and x[3] is not None else ["tgt", i, f"H{jj}:{'lo' if x[2] is not None else 'hi'}"]
        p = P_rep(f"{r['l']} · {he(c)} · {hlab} · הודפס {A.dlab(x[0])}", nf(derive(src), 1), MM if u == "m" else "%", url, pg, doc, hlab,
                  note="אמצע הטווח שהודפס" if src[0] == "mean" else None)
        return F(f"{r['l']}, {lab}, {he(c)}", src, u, p, A.dlab(x[0]), b="target", c=c)
    figs = {"t0": hfig(j - 1, "הנוסח הקודם"), "t1": hfig(j, "הנוסח החדש")}
    figs["dt"] = F(f"שינוי ביעד, {he(c)}", ["sub", figs["t1"]["src"], figs["t0"]["src"]], "m" if u == "m" else "pp",
                   P_calc(f"שינוי ביעד · {r['l']} · {he(c)}", nf(dm, 1), MM if u == "m" else "נק׳", "הנוסח החדש פחות הנוסח הקודם (אמצע טווח כשהודפס טווח)",
                          [("חדש", nf(m1, 1), figs["t1"]["prov"]), ("קודם", nf(m0, 1), figs["t0"]["prov"])]), A.dlab(d1), b="target", signed=True, c=c)
    up = dm > 0
    word = "העלתה" if up else "הורידה"
    corr = f"{he(c)} {word} בשקט את יעד {r['l'].replace('יעד ', '')} ל-{hlab} ב-{{dt}} בין הדפסה להדפסה."
    email = (f"{he(c)} ({r['e']}): יעד {r['l'].replace('יעד ', '')} ל-{hlab} הודפס ב-{A.dlab(d0)} כ-{{t0}} וב-{A.dlab(d1)} כ-{{t1}}. "
             + "השינוי גדול מהתנודה השנתית הרגילה של המדד.")
    rows_ = [["הדפסה", "יעד", "מסמך"]] + [[A.dlab(x[0]) if re.fullmatch(r"\d{4}-\d\d-\d\d", x[0]) else x[0],
                                            nf(mid(x)[0], 1), f"{x[2] if len(x) == 4 else x[4]} עמ׳ {x[3] if len(x) == 4 else x[5]}"] for x in h]
    ex = exhibit("table", f"{he(c)}: {r['l']} ל-{hlab}, הדפסה אחר הדפסה", MM if u == "m" else "%", [], [],
                 [f"אמצע טווח כשהודפס טווח; סטיית התקן של השינוי השנתי במדד: {nf(sig, 1)} ({n} שינויים)", "מצגות ודוחות החברה (targets.json, היסטוריית הדפסות)"],
                 rows=rows_)
    chg = changes_if("הממצא נסגר אם היעד חוזר לנוסח הקודם, " + ("מתחת" if up else "מעל") + " ל-{thr}", "t1", "<=" if up else ">=", r3(m0))
    if k in ("ci", "profit", "equity"):
        matv, mwhy = abs(dm), "השינוי ביעד ב-₪ מיליון" + (" (רווח בשנה)" if k != "equity" else " (הון)")
    elif k == "roe":
        eq = fy_hist(c, "equity")
        e = eq[-1][1] if eq else 0
        matv, mwhy = abs(dm) / 100 * e, f"השינוי בנקודות × ההון האחרון (₪{nf(e, 0)} מיליון): רווח שנתי"
    else:
        S = A.load("csm/solvency.json")["companies"].get(c, {})
        d = max((d for d in S if "scr_wo" in S[d]), default=None)
        scr = S[d]["scr_wo"]["v"] if d else 0
        matv, mwhy = abs(dm) / 100 * scr, f"השינוי בנקודות × ההון הנדרש (₪{nf(scr, 0)} מיליון)"
    if not matv:
        return None
    mat = mat_(matv, money(matv), mwhy)
    sur = sur_(z, f"השינוי ביעד בסטיות תקן של השינוי השנתי במדד בהיסטוריה של החברה ({nf(sig, 1)}, {n} שינויים)")
    body = answer(figs, corr, email, ex, chg, "rev:up" if up else "rev:down", links=[link("יעדים ואמינות", "/credibility"), link(he(c), f"/company/{c}")], asof=A.dlab(d1))
    body["open_m"] = age
    return row(f"F-sd-{c}-{slug(r['m'].replace('target_', ''))}-{slug(r['seg'])}-{hy or 'na'}-rev", "sd", c, None, mat, sur, body, (c, r["m"], r["seg"], hy, "rev"))


# ------------------------------------------------------------------------------------------------ 5. disclosure change
Q_END = ("03-31", "06-30", "09-30", "12-31")


def season(end):
    return f"{end[:4]}{'FY' if end[5:] == '12-31' else 'Q' + str(Q_END.index(end[5:]) + 1)}"


def qlab(end):
    return f"Q{Q_END.index(end[5:]) + 1}'{end[2:4]}"


def disc_scan():
    """per company: the Q-window flow lines (P&L, segment notes, OCI; not the cash-flow statement, which is cumulative), and per quarter
    end the current row that printed it (its report and page)"""
    I = A.load("facts/index.json")
    ins = set(A.load("restatements.json")["insurers"])   # an insurer's IFRS 4 lines end with the standard (2024), by design
    scan = {}
    for co in sorted(c["id"] for c in I["companies"]):
        Fc = A.load(f"facts/{co}.json")
        per, V, Ln, R = Fc["periods"], Fc["vint"], Fc["lines"], Fc["rows"]
        filed = {}
        for t, p in enumerate(V["per"]):
            filed.setdefault(p, []).append(t)
        qends = sorted({e for w, e in per if w == "Q"})
        lines = []
        pos = 0
        for li in range(len(Ln["id"])):
            n = Ln["n"][li]
            rows = range(pos, pos + n)
            pos += n
            if (Ln["u"][li] not in ("k", "m") or (Ln["std"][li] == "4" and co in ins) or "תזרים" in Fc["sheets"][Ln["sh"][li]]
                    or Ln["id"][li].startswith("n.")):
                continue
            ends, vints, cur = set(), set(), {}
            for r in rows:
                if R["f"][r] & 64:
                    continue
                vints.add(R["t"][r])
                w, e = per[R["p"][r]]
                if w == "Q":
                    ends.add(e)
                    if R["f"][r] & 16:
                        cur[e] = r
            if ends:
                lines.append({"li": li, "id": Ln["id"][li], "sh": Ln["sh"][li], "dim": Ln["dim"][li], "label": Ln["label"][li], "ends": ends, "vints": vints, "cur": cur})
        by_page = {}
        for Lx in lines:
            for e, r in Lx["cur"].items():
                by_page.setdefault((e, Lx["sh"], R["t"][r], R["pg"][r]), []).append(Lx)
        scan[co] = {"F": Fc, "filed": filed, "qends": qends, "lines": lines, "by_page": by_page}
    return scan


def run_before(ends, qends, k):
    n, j = 0, k - 1
    while j >= 0 and qends[j] in ends:
        n += 1
        j -= 1
    return n


def stop_at(S, k, Lx, own):
    """the line printed in the quarter before k and absent from quarter k (not even a comparative in the period's own report), while the
    lines printed beside it (same sheet, same report, same page, the quarter before) are still printed in quarter k: its table was read"""
    qe = S["qends"]
    e, prev = qe[k], qe[k - 1]
    if e in Lx["ends"] or any(t in Lx["vints"] for t in own) or prev not in Lx["cur"]:
        return None
    r = Lx["cur"][prev]
    R = S["F"]["rows"]
    sib = [Ly for Ly in S["by_page"].get((prev, Lx["sh"], R["t"][r], R["pg"][r]), []) if Ly is not Lx]
    if not any(e in Ly["ends"] for Ly in sib):
        return "table"
    return "line"


def det_disc(skipped, latest_season):
    scan = disc_scan()
    R0 = int(P("disc_run"))
    stops_at = {}   # (line id, quarter end) -> companies: a shared stop is an artefact
    events = []     # (co, k, line, run, kind)
    for co, S in scan.items():
        qe = S["qends"]
        for k in range(1, len(qe)):
            own = S["filed"].get(season(qe[k]))
            if not own:
                continue
            for Lx in S["lines"]:
                n = run_before(Lx["ends"], qe, k)
                if n < R0:
                    continue
                st = stop_at(S, k, Lx, own)
                if st:
                    events.append((co, k, Lx, n, st))
                    if st == "line":
                        stops_at.setdefault((Lx["id"], qe[k]), set()).add(co)
    # the historical stop rate by run bucket (pooled over companies; artefacts, unread tables and the latest quarter excluded)
    buckets = [4, 8, 12, 20]
    opp = {b: 0 for b in buckets}
    stp = {b: 0 for b in buckets}
    ev_set = {(co, k, Lx["li"]) for co, k, Lx, n, st in events if st == "line" and len(stops_at[(Lx["id"], scan[co]["qends"][k])]) < P("disc_xco")}
    tbl = {(co, k, Lx["li"]) for co, k, Lx, n, st in events if st == "table"}
    for co, S in scan.items():
        qe = S["qends"]
        for k in range(1, len(qe)):
            if season(qe[k]) == latest_season or not S["filed"].get(season(qe[k])):
                continue
            for Lx in S["lines"]:
                if (co, k, Lx["li"]) in tbl:
                    continue
                n = run_before(Lx["ends"], qe, k)
                for b in buckets:
                    if n >= b:
                        opp[b] += 1
                        stp[b] += (co, k, Lx["li"]) in ev_set
    rate = {b: (stp[b] + 0.5) / (opp[b] + 1) for b in buckets}
    out = []
    groups = {}
    n_tbl = {}
    for co, k, Lx, n, st in events:
        S = scan[co]
        e = S["qends"][k]
        if season(e) != latest_season or k != len(S["qends"]) - 1:
            continue
        if st == "table":
            n_tbl.setdefault(co, []).append(Lx["label"])
            continue
        xco = stops_at[(Lx["id"], e)]
        if len(xco) >= P("disc_xco"):
            skipped.append({"id": f"disc:{co}:{Lx['id']}", "det": "disc", "c": co,
                            "why": f"{Lx['label']}: נעלמה ב-{len(xco)} חברות באותו רבעון ({qlab(e)}), ארטיפקט חילוץ / טקסונומיה"})
            continue
        groups.setdefault((co, Lx["sh"], e), []).append((Lx, n))
    for co, labs in sorted(n_tbl.items()):
        skipped.append({"id": f"disc:{co}:tables", "det": "disc", "c": co,
                        "why": f"{len(labs)} שורות שכל הטבלה שלהן (אותו עמוד) לא נקראה ב-{lq(LENS().last_q)}: לא ניתן להבחין בין טבלה שהושמטה לטבלה שלא חולצה"})
    for (co, sh, e), items in sorted(groups.items(), key=lambda kv: (kv[0][0], kv[0][1], kv[0][2])):
        f = disc_finding(scan[co], co, sh, e, items, rate, buckets, skipped)
        if f:
            out.append(f)
    return out, {"opp": {str(b): opp[b] for b in buckets}, "stops": {str(b): stp[b] for b in buckets}, "rate": {str(b): r3(rate[b]) for b in buckets}}


def disc_finding(S, co, sh, e, items, rate, buckets, skipped):
    Fc = S["F"]
    R, Ln = Fc["rows"], Fc["lines"]
    qe = S["qends"]
    k = qe.index(e)
    prev = qe[k - 1]
    yago = f"{int(e[:4]) - 1}{e[4:]}"
    latest_t = set(S["filed"][season(e)])
    unit = lambda li: 1000.0 if Ln["u"][li] == "k" else 1.0  # noqa: E731
    items = [(Lx, n) for Lx, n in items if R["v"][Lx["cur"][prev]] != 0]
    if not items:
        return None
    # a remap: a line of the same sheet that the latest report prints with the stopped line's figure as its comparative (a year ago)
    comp_at = {}
    for Ly in S["lines"]:
        if Ly["sh"] != sh or any(Ly is Lx for Lx, _ in items):
            continue
        pos = sum(Ln["n"][:Ly["li"]])
        for r in range(pos, pos + Ln["n"][Ly["li"]]):
            if R["t"][r] in latest_t and Fc["periods"][R["p"][r]] == ["Q", yago]:
                comp_at.setdefault(Ly["li"], []).append(R["v"][r] / unit(Ly["li"]))
    kept = []
    for Lx, n in items:
        y = R["v"][Lx["cur"][yago]] / unit(Lx["li"]) if yago in Lx["cur"] else None
        hit = None
        if y:
            hit = next((li for li, vs in comp_at.items() if any(abs(v - y) <= max(0.005 * abs(y), 0.01) for v in vs)), None)
        if hit is not None:
            skipped.append({"id": f"disc:{co}:{Lx['id']}", "det": "disc", "c": co,
                            "why": f"{Lx['label']}: הדוח של {qlab(e)} מדפיס את מספר ההשוואה שלה תחת שורה אחרת ({Ln['label'][hit]}): מיפוי או שם חדש, לא הפסקת גילוי"})
        else:
            kept.append((Lx, n))
    items = kept
    if not items:
        return None
    # a successor: a line of the same sheet printed only by the latest report, whose comparative (a year ago) equals the stopped lines' sum
    new = [Ly for Ly in S["lines"] if Ly["sh"] == sh and Ly["vints"] and Ly["vints"] <= latest_t and e in Ly["ends"]]
    succ, kind = None, "dropped"
    stopped_yago = [R["v"][Lx["cur"][yago]] / unit(Lx["li"]) for Lx, _ in items if yago in Lx["cur"]]
    if len(stopped_yago) == len(items):
        tot = fsum(stopped_yago)
        for Ly in new:
            pos = sum(Ln["n"][:Ly["li"]])
            comp = [R["v"][r] / unit(Ly["li"]) for r in range(pos, pos + Ln["n"][Ly["li"]]) if Fc["periods"][R["p"][r]] == ["Q", yago]]
            if comp and tot and abs(comp[0] - tot) <= max(0.005 * abs(tot), 0.01):
                succ = Ly
                kind = "renamed" if len(items) == 1 else "collapsed"
                break
    if kind == "renamed":
        skipped.append({"id": f"disc:{co}:{items[0][0]['id']}", "det": "disc", "c": co,
                        "why": f"{items[0][0]['label']}: שם חדש לאותה שורה ({succ['label']}), מספר ההשוואה זהה"})
        return None
    n_run = min(n for _, n in items)
    b = max(x for x in buckets if x <= n_run)
    p = rate[b]
    z = NormalDist().inv_cdf(1 - p)
    figs = {}
    srcs = []
    for j, (Lx, n) in enumerate(sorted(items, key=lambda it: it[0]["li"])):
        rr = Lx["cur"][prev]
        src = ["fact", co, Lx["li"], prev, "Q"]
        srcs.append(src)
        figs[f"l{j}"] = F(f"{Lx['label']}, {he(co)}, {qlab(prev)}", src, "m", fact_prov(Fc, Lx["li"], rr, f"{Lx['label']} · {he(co)} · {qlab(prev)}"), qlab(prev), c=co)
    tot_src = ["add"] + srcs if len(srcs) > 1 else srcs[0]
    totv = derive(tot_src)
    if len(srcs) > 1:
        figs["tot"] = F(f"סך השורות שהפסיקו להיות מפורטות, {he(co)}, {qlab(prev)}", tot_src, "m",
                        P_calc(f"סך השורות · {he(co)} · {qlab(prev)}", nf(totv, 1), MM, "סכום השורות בתקופה האחרונה שבה פורטו",
                               [(figs[f"l{j}"]["l"], figs[f"l{j}"]["t"], figs[f"l{j}"]["prov"]) for j in range(len(srcs))]), qlab(prev), c=co)
        key = "tot"
    else:
        key = "l0"
    matv = abs(totv) * 4
    if matv < P("disc_min"):
        return None
    raw = Fc["sheets"][sh].replace("X.", "")
    sheet = raw.replace("_", " ")
    where = {"רווח_והפסד": "בדוח רווח והפסד", "רווח_כולל": "בדוח על הרווח הכולל", "מאזן": "במאזן"}.get(raw, ("בביאור " if raw.startswith("מגזר") else "בגיליון ") + sheet)
    labels = [Lx["label"] for Lx, _ in sorted(items, key=lambda it: it[0]["li"])]
    what = "، ".join(labels[:5]).replace("،", ",") + (" ועוד שורות נוספות" if len(labels) > 5 else "")
    if kind == "collapsed":
        corr = (f"{he(co)} הפסיקה לפרט {where} את השורות {what}: מ-{qlab(e)} הן מוצגות כשורה אחת, '{succ['label']}', אחרי {n_run} רבעונים "
                f"רצופים של פירוט; ברבעון האחרון שפורט הן הסתכמו ב-{{{key}}}.")
        vk = "collapsed"
    else:
        corr = (f"{he(co)} הפסיקה לפרסם {where} את {what} ב-{qlab(e)} — הפעם הראשונה אחרי {n_run} רבעונים רצופים; ברבעון האחרון שפורסם: {{{key}}}.")
        vk = "dropped"
    if len(figs) < 2:
        figs["ann"] = F(f"היקף שנתי של השורה, {he(co)}", ["x4", srcs[0]], "m",
                        P_calc(f"היקף שנתי · {labels[0]} · {he(co)}", nf(totv * 4, 1), MM, "הרבעון האחרון שבו פורטה × 4", [(labels[0], nf(totv, 1), figs["l0"]["prov"])]),
                        qlab(prev), c=co)
    email = (f"{he(co)}, {where}: " + (f"השורות {what} פורטו {n_run} רבעונים רצופים לפחות; ב-{qlab(prev)} " if len(labels) > 1 else f"השורה {what} פורסמה {n_run} רבעונים רצופים; ב-{qlab(prev)} ")
             + ("הן הגיעו " if len(labels) > 1 else "היא הגיעה ") + f"ל-{{{key}}}"
             + (" (" + "; ".join(f"{figs[o]['l'].split(',')[0]}: {{{o}}}" for o in sorted(k_ for k_ in figs if k_.startswith("l"))[:5]) + ")" if len(labels) > 1 else ", בקצב שנתי של {ann}")
             + f". בדוח {qlab(e)} " + (f"מופיעה במקומן שורה אחת, {succ['label']}, שמספר ההשוואה שלה שווה לסכומן." if kind == "collapsed"
                                       else "הן אינן מופיעות, גם לא כמספר השוואה, והחברה הגישה את הדוח." if len(labels) > 1 else "היא אינה מופיעה, גם לא כמספר השוואה, והחברה הגישה את הדוח."))
    qs = qe[max(0, k - 8):k + 1]
    ser = []
    for Lx, _ in sorted(items, key=lambda it: it[0]["li"])[:6]:
        ser.append({"name": Lx["label"], "type": "bar", "data": [r3(R["v"][Lx["cur"][x]] / unit(Lx["li"])) if x in Lx["cur"] else None for x in qs]})
    ex = exhibit("cat", f"{he(co)} · {sheet}: השורות שהפסיקו להתפרסם", MM, [qlab(x) for x in qs], ser,
                 [f"רצף פרסום של {n_run} רבעונים לפחות; שיעור ההפסקה ההיסטורי של שורות עם רצף של {b}+ רבעונים: {nf(p * 100, 2)}% לרבעון",
                  "טבלת העובדות (facts/): כל הדפסה של כל שורה בדוחות החברה, עם הדוח והעמוד; " + (f"השורה החדשה: {succ['label']}" if succ else "")],
                 span=f"{qlab(qs[0])}–{qlab(qs[-1])}")
    sl = {"רווח_והפסד": "pl", "רווח_כולל": "oci", "מאזן": "bs"}.get(raw, "seg" if raw.startswith("מגזר") else "note")
    hid = __import__("hashlib").sha1(("|".join(sorted(Lx["id"] for Lx, _ in items)) + Fc["sheets"][sh]).encode()).hexdigest()[:8]
    mat = mat_(matv, money(matv), "היקף השורות ברבעון האחרון שבו פורטו × 4: הכנסה / הוצאה שנתית שכבר לא נראית בפירוט")
    sur = sur_(z, f"Φ⁻¹(1 − p), p = {nf(p * 100, 2)}%: שיעור ההפסקה ההיסטורי לרבעון של שורות עם רצף של {b}+ רבעונים (כל החברות, בלי ארטיפקטים)")
    body = answer(figs, corr, email, ex, None, vk, links=[link("טבלת העובדות", f"/facts/{co}"), link(he(co), f"/company/{co}")], asof=qlab(e))
    body["run"] = n_run
    body["lines"] = [{"id": Lx["id"], "l": Lx["label"], "n": n} for Lx, n in sorted(items, key=lambda it: it[0]["li"])]
    if succ:
        body["succ"] = {"id": succ["id"], "l": succ["label"]}
    return row(f"F-disc-{co}-{sl}-{hid}", "disc", co, None, mat, sur, body, (co, sh))


# ------------------------------------------------------------------------------------------------ 6. rank shift
RANK_M = {"share": ("נתח נכסים", "hi"), "ci": ("יחס הוצאות להכנסות LTM", "lo"), "fy": ("תשואת דמי ניהול ממומשת LTM", "hi")}


def rank_value(c, s, metric, qi):
    """(value, src) of a manager's ranked metric at quarter index qi"""
    L = LENS()
    Q = L.quarters
    g = L.g(c)
    marked = A.load("lens.json").get("marks", {})
    if metric == "share":
        r = L.row(c, s, Q[qi])
        if not r or r.get("aum_share") is None:
            return None
        return r["aum_share"], ["lens", g, s, Q[qi], "aum_share"]
    if qi < 3:
        return None
    rs = [L.row(c, s, Q[j]) for j in range(qi - 3, qi + 1)]
    if any(not r or not r.get("rep") or r["rep"].get("fees") is None for r in rs):
        return None
    if metric == "ci":
        if c in marked or any(r["rep"].get("sm") is None or r["rep"].get("ga") is None for r in rs):
            return None
        src = ["pct", ["add"] + [["lens", g, s, Q[j], m] for j in range(qi - 3, qi + 1) for m in ("sm", "ga")],
               ["add"] + [["lens", g, s, Q[j], "fees"] for j in range(qi - 3, qi + 1)]]
    else:
        if any(not (95.0 <= (r.get("cover") or 100.0) <= 105.0) for r in rs) or any(not r["reg"].get("avg") for r in rs):
            return None
        src = ["pct", ["add"] + [["lens", g, s, Q[j], "fees"] for j in range(qi - 3, qi + 1)],
               ["mean"] + [["lens", g, s, Q[j], "avg"] for j in range(qi - 3, qi + 1)]]
    v = derive(src)
    return None if v is None else (v, src)


def ranks(s, metric, qi):
    L = LENS()
    vals = {}
    for c in sorted(L.gix):
        x = rank_value(c, s, metric, qi)
        if x:
            vals[c] = x
    better = RANK_M[metric][1]
    order = sorted(vals, key=lambda c: (-vals[c][0] if better == "hi" else vals[c][0], c))
    return {c: i + 1 for i, c in enumerate(order)}, vals


def clear_move(c, metric, v1, v0):
    """places gained (+) or lost (-) against the managers crossed with a clear gap both before and after (a band per metric): a swap of
    two managers within the band is noise, not a rank shift"""
    band = P(f"rank_band_{metric}") / (100.0 if metric == "fy" else 1.0)
    sign = 1 if RANK_M[metric][1] == "hi" else -1
    gained, lost = [], []
    for k in v1:
        if k == c or k not in v0:
            continue
        b0 = sign * (v0[k][0] - v0[c][0])    # > band: k clearly ahead a year ago
        b1 = sign * (v1[c][0] - v1[k][0])    # > band: c clearly ahead now
        if b0 >= band and b1 >= band:
            gained.append(k)
        elif -b0 >= band and -b1 >= band:
            lost.append(k)
    return len(gained) - len(lost), gained if len(gained) >= len(lost) else lost


def det_rank(skipped):
    L = LENS()
    Q = L.quarters
    qi = Q.index(L.last_q)
    out = []
    for s in SEGS:
        for metric in RANK_M:
            hist = []
            for j in range(4, qi):
                r1, v1 = ranks(s, metric, j)
                r0, v0 = ranks(s, metric, j - 4)
                common = set(r1) & set(r0)
                if len(common) >= P("rank_n"):
                    hist += [clear_move(c, metric, {k: v1[k] for k in common}, {k: v0[k] for k in common})[0] for c in sorted(common)]
            if len(hist) < 10:
                continue
            sig = math.sqrt(fsum(d * d for d in hist) / len(hist))
            r1, v1 = ranks(s, metric, qi)
            r0, v0 = ranks(s, metric, qi - 4)
            common = sorted(set(r1) & set(r0))
            if len(common) < P("rank_n") or not sig:
                continue
            for c in common:
                d, crossed = clear_move(c, metric, {k: v1[k] for k in common}, {k: v0[k] for k in common})
                if abs(d) < P("rank_min"):
                    continue
                out.append(rank_finding(c, s, metric, qi, r1, r0, v1, v0, d, sig, len(hist), crossed))
    return out


def rank_finding(c, s, metric, qi, r1, r0, v1, v0, d, sig, nh, crossed):
    L = LENS()
    Q = L.quarters
    q, q0 = Q[qi], Q[qi - 4]
    seg = SEG_HE[s]
    name, better = RANK_M[metric]
    u = "pct"
    # the driver: the manager(s) it passed or that passed it, and the change in its own metric
    up = d > 0
    passed = sorted(crossed, key=lambda k: r1[k])
    x1, s1 = v1[c]
    x0, s0 = v0[c]

    def vprov(k, vv, qq, src):
        if metric == "share":
            return lens_prov(k, s, qq, "aum_share")
        qj = Q.index(qq)
        qs = Q[qj - 3:qj + 1]
        if metric == "ci":
            return calc(f"{name} · {he(k)} · {seg} · {lq(qq)}", f"{nf(vv, 1)}%", "%", "(שיווק ומכירה + הנהלה וכלליות) ÷ הכנסות מדמי ניהול, ארבעה רבעונים × 100",
                        [(f"יחס ברבעון {lq(x)}", "", lens_prov(k, s, x, "ci")) for x in qs])
        return calc(f"{name} · {he(k)} · {seg} · {lq(qq)}", f"{nf(vv, 3)}%", "%", "הכנסות מדמי ניהול בארבעה רבעונים ÷ ממוצע הנכסים הממוצעים × 100",
                    [(f"הכנסות {lq(x)}", "", lens_prov(k, s, x, "fees")) for x in qs] + [(f"נכסים ממוצעים {lq(x)}", "", lens_prov(k, s, x, "avg")) for x in qs])
    dd = 2 if metric == "fy" else 1
    rk = lambda k, rr, qq: calc(f"מקום בדירוג {name} · {he(k)} · {seg} · {lq(qq)}", str(rr[k]), "מקום",  # noqa: E731
                                "מיון המנהלים עם נתון לפי " + name + (" מהגבוה לנמוך" if better == "hi" else " מהנמוך לגבוה"), [])
    figs = {
        "x1": F(f"{name}, {he(c)}, {seg}", s1, u, vprov(c, x1, q, s1), lq(q), d=dd, c=c),
        "x0": F(f"{name}, {he(c)}, {seg}, שנה קודם", s0, u, vprov(c, x0, q0, s0), lq(q0), d=dd, c=c),
        "rk1": F(f"מקום בדירוג, {he(c)}, {seg}", ["c", float(r1[c])], "n", rk(c, r1, q), lq(q), d=0, c=c),
        "rk0": F(f"מקום בדירוג שנה קודם, {he(c)}, {seg}", ["c", float(r0[c])], "n", rk(c, r0, q0), lq(q0), d=0, c=c),
    }
    driver = ""
    if passed:
        k = passed[0]
        figs["p1"] = F(f"{name}, {he(k)}, {seg}", v1[k][1], u, vprov(k, v1[k][0], q, v1[k][1]), lq(q), d=dd, c=k)
        driver = (f" עקפה את {he(k)}" if up else f" נעקפה על ידי {he(k)}") + (f" ועוד {len(passed) - 1} מתחרים" if len(passed) > 2 else " ועוד מתחרה" if len(passed) == 2 else "") + " ({p1})"
    verb = "עלתה" if up else "ירדה"
    top_is = "הגבוה" if better == "hi" else "הנמוך"
    # "N מקומות" is a count; the core's ALLOWED list does not include it, so the move is said in words
    words = {2: "שני", 3: "שלושה", 4: "ארבעה", 5: "חמישה", 6: "שישה", 7: "שבעה", 8: "שמונה", 9: "תשעה", 10: "עשרה"}
    corr = (f"{he(c)} {verb} בדירוג {name} ב{seg} למקום {{rk1}}, " + ("עלייה" if up else "ירידה") + f" של {words.get(abs(d), 'כמה')} מקומות בשנה"
            + (" — " + ("עקפה את " if up else "נעקפה על ידי ") + he(passed[0]) if passed else "") + ".")
    email = (f"{seg}, {lq(q)} מול {lq(q0)} (מקום ראשון = {top_is} ביותר): {name} של {he(c)} עבר מ-{{x0}} ל-{{x1}}, והיא עברה ממקום {{rk0}} למקום {{rk1}}"
             + ("," + driver if driver else "") + ".")
    order = sorted(r1, key=lambda k: r1[k])
    ex = exhibit("hbar", f"{seg}: {name}, {lq(q)}", "%", [he(k) for k in order], [{"name": name, "type": "bar", "data": [r3(v1[k][0]) for k in order]},
                 {"name": f"{lq(q0)}", "type": "bar", "data": [r3(v0[k][0]) if k in v0 else None for k in order]}],
                 [f"סטיית התקן של תזוזות הדירוג YoY של המדד בהיסטוריה: {nf(sig, 2)} מקומות ({nh} תזוזות)",
                  "רשות שוק ההון (נכסים); דוחות החברות המנהלות, ביאור מגזרי פעילות (הכנסות, הוצאות)"], span=f"{lq(q0)}–{lq(q)}")
    chg = changes_if("הממצא נסגר אם המקום חוזר ל-{thr}", "rk1", ">=" if up else "<=", float(r0[c]))
    if metric == "share":
        mk = [L.row(k, s, q) for k in r1]
        mkt = fsum(r["reg"]["avg"] for r in mk if r) / (fsum(r["aum_share"] for r in mk if r) / 100)
        fy = (L.row(c, s, q) or {}).get("fy_reg") or 0
        matv = abs(x1 - x0) / 100 * mkt * fy / 100
        mwhy = f"השינוי בנתח × נכסי השוק (₪{nf(mkt, 0)} מיליון) × תשואת דמי הניהול ({nf(fy, 2)}%): הכנסה שנתית"
    elif metric == "ci":
        fees = fsum(L.row(c, s, Q[j])["rep"]["fees"] for j in range(qi - 3, qi + 1))
        matv = abs(x1 - x0) / 100 * fees
        mwhy = "השינוי ביחס × הכנסות דמי הניהול LTM: עלות שנתית"
    else:
        avg = fsum(L.row(c, s, Q[j])["reg"]["avg"] for j in range(qi - 3, qi + 1)) / 4
        matv = abs(x1 - x0) / 100 * avg
        mwhy = "השינוי בתשואה × הנכסים הממוצעים LTM: הכנסה שנתית"
    mat = mat_(matv, money(matv), mwhy)
    sur = sur_(abs(d) / sig, f"התזוזה ({abs(d)} מקומות, עקיפות מעבר לפס) בסטיות התקן של כל תזוזות הדירוג YoY של המדד בהיסטוריה, באותו כלל ({nf(sig, 2)}, {nh} תצפיות)")
    body = answer(figs, corr, email, ex, chg, f"{metric}:{'up' if up else 'down'}:{abs(d)}", links=[link("דירוג", "/ranking"), link(he(c), f"/company/{c}")], asof=lq(q))
    return row(f"F-rank-{c}-{s}-{metric}", "rank", c, s, mat, sur, body, (c, s, metric))


# ------------------------------------------------------------------------------------------------ build
def build():
    L = LENS()
    T = A.load("targets.json")
    asof_date = T["built"]
    lens_end = f"{L.last_q[-4:]}-{int(L.last_q[1]) * 3:02d}"
    latest_season = f"{L.last_q[-4:]}Q{L.last_q[1]}"
    skipped = []
    rows = []
    rows += det_div(skipped)
    rows += det_brk(skipped)
    rows += det_peer(skipped)
    rows += det_sd(skipped, asof_date)
    disc_rows, disc_stats = det_disc(skipped, latest_season)
    rows += disc_rows
    rows += det_rank(skipped)
    rows = [r for r in rows if r["mat"]["v"] is not None and r["mat"]["v"] >= P("mat_min")]
    ids = {}
    for r in rows:
        if r["id"] in ids:
            raise ValueError(f"duplicate finding id {r['id']}")
        ids[r["id"]] = 1
        r.pop("_k", None)
    order(rows)
    out = {
        "v": 1,
        "asof": {"lens": lq(L.last_q), "reg": ym(L.asof), "targets": A.dlab(asof_date), "facts": lq(L.last_q), "end": lens_end},
        "params": PARAMS,
        "dets": {k: {"he": DET_HE[k]["he"], "rule": DET_HE[k]["rule"]} for k in DETS},
        "order_rule": ORDER_RULE.format(top_n=P("top_n"), top_per_det=P("top_per_det")),
        "n": {k: sum(1 for r in rows if r["det"] == k) for k in DETS},
        "disc_base": disc_stats,
        "rows": rows,
        "skipped": sorted(skipped, key=lambda s: (s["det"], s["id"])),
    }
    return out


def order(rows):
    """the order rule: mat.v x sur.v descending, ties by id; top = the first top_n, at most top_per_det per detector"""
    rows.sort(key=lambda r: (-(r["mat"]["v"] * r["sur"]["v"]), r["id"]))
    per, cos = {}, set()
    n = 0
    for r in rows:
        r["top"] = False
        if n < P("top_n") and per.get(r["det"], 0) < P("top_per_det") and (r["c"] is None or r["c"] not in cos or P("top_per_co") > 1):
            r["top"] = True
            per[r["det"]] = per.get(r["det"], 0) + 1
            if r["c"]:
                cos.add(r["c"])
            n += 1
    return rows


# ------------------------------------------------------------------------------------------------ the checks (gate `findings`)
ID = re.compile(r"F-(div|brk|peer|sd|disc|rank)-[a-z0-9_]+(-[a-z0-9_]+)*")


def problems(o):
    bad = []
    if not isinstance(o, dict) or "rows" not in o:
        return ["findings.json: no rows"]
    for k in ("v", "asof", "params", "dets", "order_rule", "rows"):
        if k not in o:
            bad.append(f"findings.json: no {k}")
    seen = set()
    for r in o["rows"]:
        w = r.get("id", "?")
        if not ID.fullmatch(w or ""):
            bad.append(f"{w}: id format")
        if w in seen:
            bad.append(f"{w}: duplicate id")
        seen.add(w)
        if r.get("det") not in DETS or not w.startswith(f"F-{r.get('det')}-"):
            bad.append(f"{w}: detector {r.get('det')}")
        for part, u in (("mat", "m"), ("sur", "sd")):
            x = r.get(part) or {}
            if not isinstance(x.get("v"), (int, float)) or x.get("u") != u or not x.get("t") or not x.get("why"):
                bad.append(f"{w}: {part} incomplete")
        bad += A.body_problems(w, r)
        for k, f in (r.get("figs") or {}).items():
            src = f.get("src")
            if not src:
                bad.append(f"{w}/{k}: no src")
                continue
            try:
                v = derive(src)
            except Exception as e:  # noqa: BLE001
                bad.append(f"{w}/{k}: src does not resolve ({e})")
                continue
            if (v is None) != (f.get("v") is None) or (v is not None and abs(round(v, 6) - f["v"]) > 1e-6 * max(1.0, abs(v))):
                bad.append(f"{w}/{k}: {f.get('v')} vs its source {v}")
    # the order and the top marks reproduce from the two published components
    want = sorted(o["rows"], key=lambda r: (-(r["mat"]["v"] * r["sur"]["v"]), r["id"]))
    if [r["id"] for r in want] != [r["id"] for r in o["rows"]]:
        bad.append("rows are not in the order of order_rule")
    per, cos, n, tops = {}, set(), 0, []
    for r in want:
        if n < P("top_n") and per.get(r["det"], 0) < P("top_per_det") and (r["c"] is None or r["c"] not in cos or P("top_per_co") > 1):
            tops.append(r["id"])
            per[r["det"]] = per.get(r["det"], 0) + 1
            if r["c"]:
                cos.add(r["c"])
            n += 1
    if tops != [r["id"] for r in o["rows"] if r.get("top")]:
        bad.append("top marks do not follow the stated rule")
    bad += A.banned(o)
    return bad


def dump(o):
    return json.dumps(o, ensure_ascii=False, separators=(",", ":"))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args(argv)
    out = build()
    bad = problems(out)
    n = len(out["rows"])
    per = " ".join(f"{k}:{v}" for k, v in out["n"].items())
    if a.check:
        try:
            disk = json.loads(OUT.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            disk = None
        if disk is None:
            bad.append("findings.json missing")
        else:
            bad += [f"on disk: {b}" for b in problems(disk)]
            if dump(disk) != dump(out):
                bad.append("findings.json differs from a rebuild")
        print(f"findings: {n} findings ({per}), {sum(r['top'] for r in out['rows'])} top, {len(out['skipped'])} suppressed, {len(bad)} problems"
              + (f"; {bad[0]}" if bad else ""))
        for b in bad[:30]:
            print("FAIL", b)
        return 1 if bad else 0
    if bad:
        for b in bad[:30]:
            print("FAIL", b)
        return 1
    OUT.write_text(dump(out), encoding="utf-8")
    print(f"findings.json: {n} findings ({per}), {len(out['skipped'])} suppressed; top: " + ", ".join(r["id"] for r in out["rows"] if r["top"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
